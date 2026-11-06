import { execute, queryAll, queryOne, runTransaction, sanitizeFk, sanitizeTenantFk, requireTenantClient } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import { CurrencyService } from './currencyService.ts';
import { ClientService } from './clientService.ts';
import { AuditService } from './auditService.ts';
import { NotificationService } from './notificationService.ts';
import { sseService } from './sseService.ts';
import { requireCompanyCurrency, requireIsoDate, requireNumberInRange, requireText, optionalExchangeRate } from '../utils/validation.ts';
import * as crypto from 'node:crypto';

export interface InvoiceItemInput {
  description: string;
  quantity: number;
  unit_price: number;
  discount_percent?: number;
  tax_rate_id?: string;
  line_order?: number;
}

export interface CreateInvoiceDTO {
  company_id: string;
  client_id: string;
  template_id?: string;
  issue_date: string;
  due_date: string;
  currency: string;
  exchange_rate?: number; // If not provided, fetch from currencyService
  items: InvoiceItemInput[];
  discount_type?: 'none' | 'percent' | 'fixed';
  discount_value?: number;
  notes?: string;
  terms?: string;
  status?: string; // Default 'Unpaid' or 'Draft'
  user_id?: string;
  user_name?: string;
}

export class InvoiceService {
  /**
   * Generate next sequential invoice number based on company settings
   */
  public static generateInvoiceNumber(companyId: string): string {
    const company = queryOne(`SELECT invoice_prefix, invoice_number_format FROM companies WHERE id = ?`, [companyId]);
    const prefix = company?.invoice_prefix || 'INV-';
    const year = new Date().getFullYear();

    const last = queryOne(
      `SELECT invoice_number FROM invoices WHERE company_id = ? ORDER BY rowid DESC LIMIT 1`,
      [companyId]
    );

    let nextSeq = 1;
    if (last && last.invoice_number) {
      const match = last.invoice_number.match(/(\d+)$/);
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    const seqStr = nextSeq.toString().padStart(4, '0');
    return `${prefix}${year}-${seqStr}`;
  }

  /**
   * Calculate automatic status based on payment progress and due date
   */
  public static calculateStatus(totalAmount: number, amountPaid: number, dueDate: string, currentStatus?: string): string {
    if (currentStatus === 'Draft' || currentStatus === 'Cancelled') {
      return currentStatus;
    }

    const balance = SafeMoney.subtract(totalAmount, amountPaid);
    const today = new Date().toISOString().slice(0, 10);

    if (SafeMoney.isZero(balance) || amountPaid >= totalAmount) {
      return 'Paid';
    }

    // Past due with money outstanding is Overdue, even if partly paid
    if (dueDate < today && balance > 0) {
      return 'Overdue';
    }

    if (amountPaid > 0) {
      return 'Partially Paid';
    }

    return 'Unpaid';
  }

  /**
   * Recalculate invoice totals, line items, taxes, discounts, and exchange rates safely
   */
  public static computeInvoiceTotals(companyId: string, currency: string, items: InvoiceItemInput[], discountType: string = 'none', discountValue: number = 0, exchangeRate?: number) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('An invoice needs at least one line item');
    if (items.length > 500) throw new Error('An invoice can have at most 500 line items');
    if (!['none', 'percent', 'fixed'].includes(discountType)) throw new Error('Discount type must be none, percent or fixed');
    if (discountType === 'percent') requireNumberInRange(discountValue, 'Discount percentage', 0, 100);
    if (discountType === 'fixed') requireNumberInRange(discountValue, 'Discount amount', 0, Number.MAX_SAFE_INTEGER);

    const baseCurr = CurrencyService.getBaseCurrency(companyId).code;
    const rate = exchangeRate || CurrencyService.getExchangeRate(companyId, currency, baseCurr);

    // Every billed amount is rounded to the currency's minor unit (cents for most currencies)
    const precision = queryOne<{ decimal_precision: number }>(
      `SELECT decimal_precision FROM currencies WHERE company_id = ? AND code = ?`,
      [companyId, String(currency).toUpperCase()]
    )?.decimal_precision ?? 2;
    const r = (v: number) => SafeMoney.roundToPrecision(v, precision);

    // Pass 1: validate lines and compute net line amounts (after any per-line discount)
    const lines = items.map((item, index) => {
      const label = `Line ${index + 1}`;
      const description = requireText(item.description, `${label} description`);
      const qty = requireNumberInRange(item.quantity, `${label} quantity`, 0, 1e9, { minExclusive: true });
      const price = requireNumberInRange(item.unit_price, `${label} unit price`, 0, 1e12);
      const discPercent = item.discount_percent === undefined || item.discount_percent === null || (item.discount_percent as any) === ''
        ? 0
        : requireNumberInRange(item.discount_percent, `${label} discount`, 0, 100);

      const rawLine = r(SafeMoney.multiply(qty, price));
      const itemDisc = discPercent > 0 ? r(SafeMoney.percentage(rawLine, discPercent)) : 0;
      const netLine = SafeMoney.subtract(rawLine, itemDisc);

      let taxPercentage = 0;
      if (item.tax_rate_id) {
        const taxRate = queryOne(`SELECT percentage FROM tax_rates WHERE id = ? AND company_id = ?`, [item.tax_rate_id, companyId]);
        if (taxRate) taxPercentage = taxRate.percentage;
      }
      return { item, index, description, qty, price, discPercent, netLine, taxPercentage };
    });

    const subtotal = lines.reduce((sum, l) => SafeMoney.add(sum, l.netLine), 0);

    // Invoice-level discount, capped at the subtotal
    let invoiceDiscountAmount = 0;
    if (discountType === 'percent' && discountValue > 0) {
      invoiceDiscountAmount = r(SafeMoney.percentage(subtotal, discountValue));
    } else if (discountType === 'fixed' && discountValue > 0) {
      invoiceDiscountAmount = r(SafeMoney.compare(discountValue, subtotal) > 0 ? subtotal : discountValue);
    }

    // Pass 2: spread the invoice discount across lines in proportion to their value and
    // charge tax on the discounted amount. The last line absorbs rounding so the
    // allocated shares always sum exactly to the discount.
    let allocated = 0;
    let totalTax = 0;
    const calculatedItems = lines.map((l, i) => {
      let lineDiscountShare = 0;
      if (invoiceDiscountAmount > 0 && subtotal > 0) {
        lineDiscountShare = i === lines.length - 1
          ? SafeMoney.subtract(invoiceDiscountAmount, allocated)
          : r((l.netLine / subtotal) * invoiceDiscountAmount);
        allocated = SafeMoney.add(allocated, lineDiscountShare);
      }
      const taxableLine = SafeMoney.subtract(l.netLine, lineDiscountShare);
      const taxAmount = l.taxPercentage > 0 ? r(SafeMoney.percentage(taxableLine, l.taxPercentage)) : 0;
      totalTax = SafeMoney.add(totalTax, taxAmount);

      return {
        description: l.description,
        quantity: l.qty,
        unit_price: l.price,
        discount_percent: l.discPercent,
        tax_rate_id: l.item.tax_rate_id || null,
        tax_rate_percentage: l.taxPercentage,
        tax_amount: taxAmount,
        line_total: SafeMoney.add(l.netLine, taxAmount),
        line_order: l.item.line_order ?? l.index
      };
    });

    const netSubtotal = SafeMoney.subtract(subtotal, invoiceDiscountAmount);
    const grandTotal = SafeMoney.add(netSubtotal, totalTax);
    const baseTotal = SafeMoney.convertCurrency(grandTotal, rate);

    return {
      subtotal,
      discount_amount: invoiceDiscountAmount,
      tax_amount: totalTax,
      total_amount: grandTotal,
      base_currency_total: baseTotal,
      exchange_rate: rate,
      base_currency: baseCurr,
      items: calculatedItems
    };
  }

  /**
   * Create an invoice with line items atomically
   */
  public static createInvoice(dto: CreateInvoiceDTO): any {
    return runTransaction(() => {
      requireTenantClient(dto.company_id, dto.client_id);
      dto.currency = requireCompanyCurrency(dto.company_id, dto.currency);
      requireIsoDate(dto.issue_date, 'Issue date');
      requireIsoDate(dto.due_date, 'Due date');
      if (dto.due_date < dto.issue_date) throw new Error('Due date cannot be before the issue date');
      dto.exchange_rate = optionalExchangeRate(dto.exchange_rate);

      const invoiceId = crypto.randomUUID();
      const invoiceNumber = this.generateInvoiceNumber(dto.company_id);

      const computed = this.computeInvoiceTotals(
        dto.company_id,
        dto.currency,
        dto.items,
        dto.discount_type || 'none',
        Number(dto.discount_value) || 0,
        dto.exchange_rate
      );

      // A new invoice can only start as Draft or with its status derived from (zero) payments
      const status = dto.status === 'Draft' ? 'Draft' : this.calculateStatus(computed.total_amount, 0, dto.due_date);

      // Insert Invoice
      execute(
        `INSERT INTO invoices (
          id, company_id, invoice_number, client_id, template_id, issue_date, due_date, currency,
          exchange_rate, base_currency, subtotal, discount_type, discount_value, discount_amount,
          tax_amount, total_amount, base_currency_total, amount_paid, balance_due, status, notes, terms,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          invoiceId,
          dto.company_id,
          invoiceNumber,
          dto.client_id,
          sanitizeTenantFk('invoice_templates', dto.template_id, dto.company_id),
          dto.issue_date,
          dto.due_date,
          dto.currency.toUpperCase(),
          computed.exchange_rate,
          computed.base_currency,
          computed.subtotal,
          dto.discount_type || 'none',
          Number(dto.discount_value) || 0,
          computed.discount_amount,
          computed.tax_amount,
          computed.total_amount,
          computed.base_currency_total,
          computed.total_amount, // initial balance_due = total
          status,
          dto.notes || '',
          dto.terms || '',
          sanitizeFk('users', dto.user_id)
        ]
      );

      // Insert Line Items
      for (const item of computed.items) {
        execute(
          `INSERT INTO invoice_items (
            id, company_id, invoice_id, description, quantity, unit_price, discount_percent,
            tax_rate_id, tax_rate_percentage, tax_amount, line_total, line_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            dto.company_id,
            invoiceId,
            item.description,
            item.quantity,
            item.unit_price,
            item.discount_percent,
            sanitizeTenantFk('tax_rates', item.tax_rate_id, dto.company_id),
            item.tax_rate_percentage,
            item.tax_amount,
            item.line_total,
            item.line_order
          ]
        );
      }

      // Record in unified transactions ledger
      execute(
        `INSERT INTO transactions (
          id, company_id, transaction_type, reference_type, reference_id, client_id,
          amount, currency, exchange_rate, base_currency_amount, transaction_date, notes, created_at
        ) VALUES (?, ?, 'INVOICE_ISSUED', 'INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          crypto.randomUUID(),
          dto.company_id,
          invoiceId,
          dto.client_id,
          computed.total_amount,
          dto.currency.toUpperCase(),
          computed.exchange_rate,
          computed.base_currency_total,
          dto.issue_date,
          `Invoice ${invoiceNumber} issued`
        ]
      );

      // Update client balance stats
      ClientService.refreshClientBalances(dto.company_id, dto.client_id);

      // Audit Log
      AuditService.log({
        companyId: dto.company_id,
        userId: dto.user_id,
        userName: dto.user_name,
        action: 'INVOICE_CREATED',
        entityType: 'INVOICE',
        entityId: invoiceId,
        newValue: { invoiceNumber, total: computed.total_amount, currency: dto.currency }
      });

      // Notification
      NotificationService.create({
        companyId: dto.company_id,
        userId: dto.user_id,
        type: 'invoice_created',
        title: `Invoice ${invoiceNumber} Created`,
        message: `Created invoice for ${SafeMoney.format(computed.total_amount, dto.currency + ' ')}`,
        link: `/invoices/${invoiceId}`
      });

      // SSE Real-time broadcast
      sseService.broadcast(dto.company_id, 'invoice_created', { invoiceId, invoiceNumber, total: computed.total_amount });

      return this.getInvoiceById(dto.company_id, invoiceId);
    });
  }

  public static getInvoices(companyId: string, filters: { status?: string; clientId?: string; currency?: string; search?: string; startDate?: string; endDate?: string } = {}): any[] {
    let sql = `
      SELECT i.*, c.company_name AS client_name, c.email AS client_email,
             ROUND((i.amount_paid * 100.0) / NULLIF(i.total_amount, 0), 1) AS payment_percentage
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.company_id = ?
    `;
    const params: any[] = [companyId];

    if (filters.status && filters.status !== 'all') {
      sql += ` AND i.status = ?`;
      params.push(filters.status);
    }
    if (filters.clientId) {
      sql += ` AND i.client_id = ?`;
      params.push(filters.clientId);
    }
    if (filters.currency && filters.currency !== 'all') {
      sql += ` AND i.currency = ?`;
      params.push(filters.currency.toUpperCase());
    }
    if (filters.startDate) {
      sql += ` AND i.issue_date >= ?`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND i.issue_date <= ?`;
      params.push(filters.endDate);
    }
    if (filters.search && filters.search.trim()) {
      sql += ` AND (i.invoice_number LIKE ? OR c.company_name LIKE ?)`;
      const term = `%${filters.search.trim()}%`;
      params.push(term, term);
    }

    sql += ` ORDER BY i.created_at DESC`;
    return queryAll(sql, params).map(inv => ({
      ...inv,
      payment_percentage: Math.min(100, Math.max(0, inv.payment_percentage || 0))
    }));
  }

  public static getInvoiceById(companyId: string, id: string): any {
    const inv = queryOne(
      `SELECT i.*, c.company_name AS client_name, c.contact_person AS client_contact,
              c.email AS client_email, c.phone AS client_phone, c.address AS client_address,
              c.tax_id AS client_tax_id, c.country AS client_country,
              ROUND((i.amount_paid * 100.0) / NULLIF(i.total_amount, 0), 1) AS payment_percentage
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.id = ? AND i.company_id = ?`,
      [id, companyId]
    );

    if (!inv) return null;

    const items = queryAll(
      `SELECT ii.*, tr.name AS tax_name, tr.code AS tax_code
       FROM invoice_items ii
       LEFT JOIN tax_rates tr ON ii.tax_rate_id = tr.id
       WHERE ii.invoice_id = ? AND ii.company_id = ?
       ORDER BY ii.line_order ASC`,
      [id, companyId]
    );

    const payments = queryAll(
      `SELECT p.* FROM payments p
       JOIN payment_allocations pa ON pa.payment_id = p.id
       WHERE pa.invoice_id = ? AND p.company_id = ?
       ORDER BY p.payment_date DESC`,
      [id, companyId]
    );

    return {
      ...inv,
      payment_percentage: Math.min(100, Math.max(0, inv.payment_percentage || 0)),
      items,
      payments
    };
  }

  /**
   * Statuses a user may set by hand. Paid / Partially Paid / Overdue are always derived
   * from recorded payments and the due date, never set directly.
   * 'Unpaid' means "reopen": the status is recalculated from the invoice's payments.
   */
  public static readonly MANUAL_STATUSES = ['Draft', 'Cancelled', 'Unpaid'] as const;

  public static updateInvoiceStatus(companyId: string, id: string, requestedStatus: string, userId?: string, userName?: string): any {
    const existing = this.getInvoiceById(companyId, id);
    if (!existing) return null;

    if (!(this.MANUAL_STATUSES as readonly string[]).includes(requestedStatus)) {
      throw new Error(`Invalid status "${requestedStatus}". Allowed: ${this.MANUAL_STATUSES.join(', ')}. Paid and Partially Paid are set by recording payments.`);
    }
    if ((requestedStatus === 'Draft' || requestedStatus === 'Cancelled') && Number(existing.amount_paid) > 0) {
      throw new Error(`Cannot mark an invoice with recorded payments as ${requestedStatus}. Reverse the payments first.`);
    }

    const status = requestedStatus === 'Unpaid'
      ? this.calculateStatus(existing.total_amount, existing.amount_paid, existing.due_date)
      : requestedStatus;

    execute(`UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?`, [status, id, companyId]);

    AuditService.log({
      companyId,
      userId,
      userName,
      action: 'INVOICE_STATUS_UPDATED',
      entityType: 'INVOICE',
      entityId: id,
      previousValue: { status: existing.status },
      newValue: { status }
    });

    ClientService.refreshClientBalances(companyId, existing.client_id);
    sseService.broadcast(companyId, 'invoice_updated', { invoiceId: id, status });

    return this.getInvoiceById(companyId, id);
  }

  /**
   * Move every open invoice whose due date has passed to Overdue.
   * Runs at startup and on a timer (see index.ts), since status otherwise only
   * changes when a payment is recorded. Returns the number of invoices updated.
   */
  public static refreshOverdueStatuses(companyId?: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const params: any[] = [today];
    let sql = `SELECT id, company_id, client_id, invoice_number, status, due_date FROM invoices
               WHERE status IN ('Unpaid', 'Partially Paid') AND balance_due > 0 AND due_date < ?`;
    if (companyId) {
      sql += ` AND company_id = ?`;
      params.push(companyId);
    }
    const due = queryAll(sql, params);

    for (const inv of due) {
      runTransaction(() => {
        execute(`UPDATE invoices SET status = 'Overdue', updated_at = datetime('now') WHERE id = ? AND status = ?`, [inv.id, inv.status]);
        AuditService.log({
          companyId: inv.company_id,
          userName: 'System',
          userRole: 'System',
          action: 'INVOICE_OVERDUE',
          entityType: 'INVOICE',
          entityId: inv.id,
          previousValue: { status: inv.status },
          newValue: { status: 'Overdue', dueDate: inv.due_date }
        });
        NotificationService.create({
          companyId: inv.company_id,
          type: 'invoice_overdue',
          title: `Invoice ${inv.invoice_number} is overdue`,
          message: `Payment was due on ${inv.due_date}`,
          link: `/invoices/${inv.id}`
        });
        ClientService.refreshClientBalances(inv.company_id, inv.client_id);
      });
      sseService.broadcast(inv.company_id, 'invoice_updated', { invoiceId: inv.id, status: 'Overdue' });
    }
    return due.length;
  }

  public static markAsSent(companyId: string, id: string, userId?: string, userName?: string): any {
    const existing = this.getInvoiceById(companyId, id);
    if (!existing) return null;

    const newStatus = existing.status === 'Draft' ? 'Unpaid' : existing.status;
    execute(
      `UPDATE invoices SET sent_at = datetime('now'), status = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?`,
      [newStatus, id, companyId]
    );

    NotificationService.create({
      companyId,
      userId,
      type: 'invoice_sent',
      title: `Invoice ${existing.invoice_number} Sent`,
      message: `Invoice sent to ${existing.client_name}`,
      link: `/invoices/${id}`
    });

    AuditService.log({
      companyId,
      userId,
      userName,
      action: 'INVOICE_SENT',
      entityType: 'INVOICE',
      entityId: id,
      newValue: { sent_at: new Date().toISOString() }
    });

    sseService.broadcast(companyId, 'invoice_updated', { invoiceId: id, sent: true });
    return this.getInvoiceById(companyId, id);
  }
}
