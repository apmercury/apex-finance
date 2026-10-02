import { execute, queryAll, queryOne, runTransaction, sanitizeFk } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import { CurrencyService } from './currencyService.ts';
import { ClientService } from './clientService.ts';
import { AuditService } from './auditService.ts';
import { NotificationService } from './notificationService.ts';
import { sseService } from './sseService.ts';
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

    if (amountPaid > 0 && amountPaid < totalAmount) {
      return 'Partially Paid';
    }

    if (dueDate < today && balance > 0) {
      return 'Overdue';
    }

    return 'Unpaid';
  }

  /**
   * Recalculate invoice totals, line items, taxes, discounts, and exchange rates safely
   */
  public static computeInvoiceTotals(companyId: string, currency: string, items: InvoiceItemInput[], discountType: string = 'none', discountValue: number = 0, exchangeRate?: number) {
    const baseCurr = CurrencyService.getBaseCurrency(companyId).code;
    const rate = exchangeRate || CurrencyService.getExchangeRate(companyId, currency, baseCurr);

    let subtotal = 0;
    let totalTax = 0;

    const calculatedItems = items.map((item, index) => {
      const qty = Number(item.quantity) || 1;
      const price = Number(item.unit_price) || 0;
      const discPercent = Number(item.discount_percent) || 0;

      // Base line total = qty * price
      const rawLine = SafeMoney.multiply(qty, price);
      // Item discount
      const itemDisc = discPercent > 0 ? SafeMoney.percentage(rawLine, discPercent) : 0;
      const netLine = SafeMoney.subtract(rawLine, itemDisc);

      // Tax calculation
      let taxPercentage = 0;
      let taxAmount = 0;
      if (item.tax_rate_id) {
        const taxRate = queryOne(`SELECT percentage FROM tax_rates WHERE id = ? AND company_id = ?`, [item.tax_rate_id, companyId]);
        if (taxRate) {
          taxPercentage = taxRate.percentage;
          taxAmount = SafeMoney.percentage(netLine, taxPercentage);
        }
      }

      subtotal = SafeMoney.add(subtotal, netLine);
      totalTax = SafeMoney.add(totalTax, taxAmount);

      return {
        description: item.description,
        quantity: qty,
        unit_price: price,
        discount_percent: discPercent,
        tax_rate_id: item.tax_rate_id || null,
        tax_rate_percentage: taxPercentage,
        tax_amount: taxAmount,
        line_total: SafeMoney.add(netLine, taxAmount),
        line_order: item.line_order ?? index
      };
    });

    // Invoice level discount
    let invoiceDiscountAmount = 0;
    if (discountType === 'percent' && discountValue > 0) {
      invoiceDiscountAmount = SafeMoney.percentage(subtotal, discountValue);
    } else if (discountType === 'fixed' && discountValue > 0) {
      invoiceDiscountAmount = Math.min(discountValue, subtotal);
    }

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

      const status = dto.status || this.calculateStatus(computed.total_amount, 0, dto.due_date);

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
          sanitizeFk('invoice_templates', dto.template_id),
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
            sanitizeFk('tax_rates', item.tax_rate_id),
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

  public static updateInvoiceStatus(companyId: string, id: string, status: string, userId?: string, userName?: string): any {
    const existing = this.getInvoiceById(companyId, id);
    if (!existing) return null;

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
