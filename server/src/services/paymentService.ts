import { execute, queryAll, queryOne, runTransaction, sanitizeFk } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import { CurrencyService } from './currencyService.ts';
import { ClientService } from './clientService.ts';
import { InvoiceService } from './invoiceService.ts';
import { AuditService } from './auditService.ts';
import { NotificationService } from './notificationService.ts';
import { sseService } from './sseService.ts';
import * as crypto from 'node:crypto';

// ============================================================================
// Future Payment Provider Abstraction (Stripe, PayPal, Mobile Money, Bank APIs)
// ============================================================================
export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  clientSecret?: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'processing' | 'succeeded' | 'canceled';
}

export interface PaymentWebhookEvent {
  provider: string;
  eventType: string;
  transactionId: string;
  amount: number;
  currency: string;
  invoiceId: string;
  payload: any;
}

export interface IPaymentProvider {
  name: string;
  createPaymentIntent(amount: number, currency: string, metadata: Record<string, any>): Promise<PaymentIntent>;
  handleWebhook(event: PaymentWebhookEvent): Promise<boolean>;
}

export class ManualPaymentProvider implements IPaymentProvider {
  name = 'Manual Payment Entry';
  async createPaymentIntent(amount: number, currency: string, metadata: Record<string, any>): Promise<PaymentIntent> {
    return {
      id: `man_${Date.now()}`,
      amount,
      currency,
      status: 'succeeded'
    };
  }
  async handleWebhook(event: PaymentWebhookEvent): Promise<boolean> {
    return true;
  }
}

export interface RecordPaymentDTO {
  company_id: string;
  client_id: string;
  invoice_id?: string;
  amount: number;
  currency: string;
  exchange_rate?: number;
  payment_date: string;
  payment_method: 'Bank Transfer' | 'Cash' | 'Card' | 'Mobile Money' | 'Cheque' | 'Other';
  reference_number?: string;
  notes?: string;
  allow_overpayment?: boolean;
  user_id?: string;
  user_name?: string;
  user_role?: string;
}

export class PaymentService {
  private static provider: IPaymentProvider = new ManualPaymentProvider();

  public static setPaymentProvider(provider: IPaymentProvider) {
    this.provider = provider;
  }

  public static generatePaymentNumber(companyId: string): string {
    const year = new Date().getFullYear();
    const last = queryOne(
      `SELECT payment_number FROM payments WHERE company_id = ? ORDER BY rowid DESC LIMIT 1`,
      [companyId]
    );

    let nextSeq = 1;
    if (last && last.payment_number) {
      const match = last.payment_number.match(/(\d+)$/);
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }
    return `PAY-${year}-${nextSeq.toString().padStart(4, '0')}`;
  }

  /**
   * Atomic Payment Recording
   * Supports Full, Partial, and Multi-currency payments with overpayment validation
   */
  public static recordPayment(dto: RecordPaymentDTO): any {
    return runTransaction(() => {
      const paymentAmount = Number(dto.amount);
      if (isNaN(paymentAmount) || paymentAmount <= 0) {
        throw new Error('Payment amount must be greater than zero');
      }

      // Check invoice if associated
      let invoice: any = null;
      let effectiveRate = dto.exchange_rate;

      if (dto.invoice_id) {
        invoice = queryOne(
          `SELECT * FROM invoices WHERE id = ? AND company_id = ?`,
          [dto.invoice_id, dto.company_id]
        );
        if (!invoice) {
          throw new Error('Invoice not found');
        }

        // Validate currency alignment or exchange rate
        if (dto.currency.toUpperCase() !== invoice.currency.toUpperCase()) {
          throw new Error(`Payment currency (${dto.currency}) must match invoice currency (${invoice.currency}) or be converted prior to recording`);
        }

        // Use invoice exchange rate if not explicitly specified to preserve historical conversion
        if (!effectiveRate) {
          effectiveRate = invoice.exchange_rate;
        }

        // Overpayment check
        const currentBalance = invoice.balance_due;
        if (SafeMoney.compare(paymentAmount, currentBalance) > 0) {
          const isOverpaymentAllowed = dto.allow_overpayment === true && dto.user_role === 'Administrator';
          if (!isOverpaymentAllowed) {
            throw new Error(
              `Payment amount (${SafeMoney.format(paymentAmount, dto.currency + ' ')}) exceeds invoice balance (${SafeMoney.format(currentBalance, dto.currency + ' ')}). Overpayment not permitted without Administrator approval.`
            );
          }
        }
      }

      // Base currency conversion
      const baseCurr = CurrencyService.getBaseCurrency(dto.company_id).code;
      if (!effectiveRate) {
        effectiveRate = CurrencyService.getExchangeRate(dto.company_id, dto.currency, baseCurr);
      }
      const baseCurrencyAmount = SafeMoney.convertCurrency(paymentAmount, effectiveRate);

      const paymentId = crypto.randomUUID();
      const paymentNumber = this.generatePaymentNumber(dto.company_id);

      // 1. Create Payment record
      execute(
        `INSERT INTO payments (
          id, company_id, payment_number, client_id, invoice_id, amount, currency,
          exchange_rate, base_currency_amount, payment_date, payment_method, reference_number,
          notes, status, recorded_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completed', ?, datetime('now'), datetime('now'))`,
        [
          paymentId,
          dto.company_id,
          paymentNumber,
          dto.client_id,
          sanitizeFk('invoices', dto.invoice_id),
          paymentAmount,
          dto.currency.toUpperCase(),
          effectiveRate,
          baseCurrencyAmount,
          dto.payment_date,
          dto.payment_method,
          dto.reference_number || '',
          dto.notes || '',
          sanitizeFk('users', dto.user_id)
        ]
      );

      // 2. Allocate payment to invoice if linked
      if (invoice) {
        execute(
          `INSERT INTO payment_allocations (id, company_id, payment_id, invoice_id, amount_allocated, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [crypto.randomUUID(), dto.company_id, paymentId, invoice.id, paymentAmount]
        );

        // 3. Update invoice balance and paid amount
        const newAmountPaid = SafeMoney.add(invoice.amount_paid, paymentAmount);
        const newBalanceDue = Math.max(0, SafeMoney.subtract(invoice.total_amount, newAmountPaid));
        const newStatus = InvoiceService.calculateStatus(invoice.total_amount, newAmountPaid, invoice.due_date, invoice.status);

        execute(
          `UPDATE invoices SET
            amount_paid = ?,
            balance_due = ?,
            status = ?,
            updated_at = datetime('now')
           WHERE id = ? AND company_id = ?`,
          [newAmountPaid, newBalanceDue, newStatus, invoice.id, dto.company_id]
        );
      }

      // 4. Update Client balances
      ClientService.refreshClientBalances(dto.company_id, dto.client_id);

      // 5. Create Revenue record (Collected Revenue)
      execute(
        `INSERT INTO revenues (
          id, company_id, source_type, client_id, invoice_id, payment_id, amount, currency,
          exchange_rate, base_currency_amount, revenue_date, payment_method, reference_number, description, created_at
        ) VALUES (?, ?, 'Invoice Payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          crypto.randomUUID(),
          dto.company_id,
          dto.client_id,
          dto.invoice_id || null,
          paymentId,
          paymentAmount,
          dto.currency.toUpperCase(),
          effectiveRate,
          baseCurrencyAmount,
          dto.payment_date,
          dto.payment_method,
          dto.reference_number || '',
          `Payment ${paymentNumber} for ${invoice ? invoice.invoice_number : 'Account'}`
        ]
      );

      // 6. Unified Transaction Ledger
      execute(
        `INSERT INTO transactions (
          id, company_id, transaction_type, reference_type, reference_id, client_id,
          amount, currency, exchange_rate, base_currency_amount, transaction_date, notes, created_at
        ) VALUES (?, ?, 'PAYMENT_RECEIVED', 'PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          crypto.randomUUID(),
          dto.company_id,
          paymentId,
          dto.client_id,
          paymentAmount,
          dto.currency.toUpperCase(),
          effectiveRate,
          baseCurrencyAmount,
          dto.payment_date,
          `Payment ${paymentNumber} received via ${dto.payment_method}`
        ]
      );

      // 7. Audit Log
      AuditService.log({
        companyId: dto.company_id,
        userId: dto.user_id,
        userName: dto.user_name,
        userRole: dto.user_role,
        action: 'PAYMENT_RECORDED',
        entityType: 'PAYMENT',
        entityId: paymentId,
        newValue: {
          paymentNumber,
          amount: paymentAmount,
          currency: dto.currency,
          invoiceId: dto.invoice_id,
          client_id: dto.client_id
        }
      });

      // 8. Notifications
      const isPartial = invoice && invoice.total_amount > paymentAmount && invoice.balance_due > 0;
      NotificationService.create({
        companyId: dto.company_id,
        userId: dto.user_id,
        type: isPartial ? 'partial_payment' : 'payment_received',
        title: isPartial ? `Partial Payment ${paymentNumber}` : `Payment ${paymentNumber} Received`,
        message: `Recorded ${SafeMoney.format(paymentAmount, dto.currency + ' ')} for ${invoice ? invoice.invoice_number : 'client'}`,
        link: `/payments`
      });

      // 9. Real-time SSE Broadcast
      sseService.broadcast(dto.company_id, 'payment_recorded', {
        paymentId,
        paymentNumber,
        amount: paymentAmount,
        invoiceId: dto.invoice_id,
        clientId: dto.client_id
      });

      return queryOne(`SELECT * FROM payments WHERE id = ?`, [paymentId]);
    });
  }

  /**
   * Reverse payment atomically
   */
  public static reversePayment(companyId: string, paymentId: string, reason: string, userId?: string, userName?: string, userRole?: string): any {
    return runTransaction(() => {
      const payment = queryOne(`SELECT * FROM payments WHERE id = ? AND company_id = ?`, [paymentId, companyId]);
      if (!payment) throw new Error('Payment not found');
      if (payment.status === 'Reversed') throw new Error('Payment is already reversed');

      // Update payment status
      execute(
        `UPDATE payments SET
          status = 'Reversed',
          reversal_reason = ?,
          reversed_at = datetime('now'),
          updated_at = datetime('now')
         WHERE id = ? AND company_id = ?`,
        [reason, paymentId, companyId]
      );

      // If allocated to invoice, reverse invoice amount_paid
      const allocations = queryAll(`SELECT * FROM payment_allocations WHERE payment_id = ? AND company_id = ?`, [paymentId, companyId]);
      for (const alloc of allocations) {
        const invoice = queryOne(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`, [alloc.invoice_id, companyId]);
        if (invoice) {
          const newAmountPaid = Math.max(0, SafeMoney.subtract(invoice.amount_paid, alloc.amount_allocated));
          const newBalanceDue = SafeMoney.subtract(invoice.total_amount, newAmountPaid);
          const newStatus = InvoiceService.calculateStatus(invoice.total_amount, newAmountPaid, invoice.due_date, invoice.status);

          execute(
            `UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
            [newAmountPaid, newBalanceDue, newStatus, invoice.id]
          );
        }
      }

      // Re-calculate client balances
      ClientService.refreshClientBalances(companyId, payment.client_id);

      // Unified Ledger reversal entry
      execute(
        `INSERT INTO transactions (
          id, company_id, transaction_type, reference_type, reference_id, client_id,
          amount, currency, exchange_rate, base_currency_amount, transaction_date, notes, created_at
        ) VALUES (?, ?, 'PAYMENT_REVERSED', 'PAYMENT', ?, ?, ?, ?, ?, ?, date('now'), ?, datetime('now'))`,
        [
          crypto.randomUUID(),
          companyId,
          paymentId,
          payment.client_id,
          -payment.amount,
          payment.currency,
          payment.exchange_rate,
          -payment.base_currency_amount,
          `Reversed Payment ${payment.payment_number}: ${reason}`
        ]
      );

      // Audit Log
      AuditService.log({
        companyId,
        userId,
        userName,
        userRole,
        action: 'PAYMENT_REVERSED',
        entityType: 'PAYMENT',
        entityId: paymentId,
        previousValue: { status: 'Completed' },
        newValue: { status: 'Reversed', reason }
      });

      // Real-time broadcast
      sseService.broadcast(companyId, 'payment_reversed', { paymentId });

      return queryOne(`SELECT * FROM payments WHERE id = ?`, [paymentId]);
    });
  }

  public static getPayments(companyId: string, filters: { clientId?: string; invoiceId?: string; status?: string; search?: string; startDate?: string; endDate?: string } = {}): any[] {
    let sql = `
      SELECT p.*, c.company_name AS client_name, i.invoice_number
      FROM payments p
      JOIN clients c ON p.client_id = c.id
      LEFT JOIN invoices i ON p.invoice_id = i.id
      WHERE p.company_id = ?
    `;
    const params: any[] = [companyId];

    if (filters.clientId) {
      sql += ` AND p.client_id = ?`;
      params.push(filters.clientId);
    }
    if (filters.invoiceId) {
      sql += ` AND p.invoice_id = ?`;
      params.push(filters.invoiceId);
    }
    if (filters.status && filters.status !== 'all') {
      sql += ` AND p.status = ?`;
      params.push(filters.status);
    }
    if (filters.startDate) {
      sql += ` AND p.payment_date >= ?`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND p.payment_date <= ?`;
      params.push(filters.endDate);
    }
    if (filters.search && filters.search.trim()) {
      sql += ` AND (p.payment_number LIKE ? OR p.reference_number LIKE ? OR c.company_name LIKE ?)`;
      const term = `%${filters.search.trim()}%`;
      params.push(term, term, term);
    }

    sql += ` ORDER BY p.payment_date DESC, p.created_at DESC`;
    return queryAll(sql, params);
  }

  public static getPaymentById(companyId: string, id: string): any {
    const payment = queryOne(
      `SELECT p.*, c.company_name AS client_name, c.email AS client_email, c.phone AS client_phone,
              i.invoice_number, i.total_amount AS invoice_total, i.balance_due AS invoice_balance
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       LEFT JOIN invoices i ON p.invoice_id = i.id
       WHERE p.id = ? AND p.company_id = ?`,
      [id, companyId]
    );

    if (!payment) return null;

    const allocations = queryAll(
      `SELECT pa.*, i.invoice_number, i.total_amount, i.currency AS invoice_currency
       FROM payment_allocations pa
       JOIN invoices i ON pa.invoice_id = i.id
       WHERE pa.payment_id = ? AND pa.company_id = ?`,
      [id, companyId]
    );

    return {
      ...payment,
      allocations
    };
  }
}
