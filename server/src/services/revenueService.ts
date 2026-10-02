import { queryAll, queryOne } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';

export class RevenueService {
  /**
   * Get Revenue breakdown: Invoiced vs Collected vs Outstanding
   */
  public static getRevenueBreakdown(companyId: string, filters: { startDate?: string; endDate?: string; currency?: string } = {}): any {
    // 1. Invoiced Revenue (Billed)
    let invSql = `
      SELECT 
        COUNT(*) as total_invoices,
        COALESCE(SUM(base_currency_total), 0) as total_invoiced_base,
        COALESCE(SUM(total_amount), 0) as total_invoiced_original,
        COALESCE(SUM(CASE WHEN currency = ? THEN total_amount ELSE 0 END), 0) as total_invoiced_curr
      FROM invoices
      WHERE company_id = ? AND status != 'Cancelled'
    `;
    const curr = filters.currency || 'USD';
    const invParams: any[] = [curr, companyId];

    if (filters.startDate) {
      invSql += ` AND issue_date >= ?`;
      invParams.push(filters.startDate);
    }
    if (filters.endDate) {
      invSql += ` AND issue_date <= ?`;
      invParams.push(filters.endDate);
    }

    const invoicedStats = queryOne(invSql, invParams) || {};

    // 2. Collected Revenue (Payments Received)
    let paySql = `
      SELECT 
        COUNT(*) as total_payments,
        COALESCE(SUM(base_currency_amount), 0) as total_collected_base,
        COALESCE(SUM(CASE WHEN currency = ? THEN amount ELSE 0 END), 0) as total_collected_curr
      FROM payments
      WHERE company_id = ? AND status = 'Completed'
    `;
    const payParams: any[] = [curr, companyId];

    if (filters.startDate) {
      paySql += ` AND payment_date >= ?`;
      payParams.push(filters.startDate);
    }
    if (filters.endDate) {
      paySql += ` AND payment_date <= ?`;
      payParams.push(filters.endDate);
    }

    const collectedStats = queryOne(paySql, payParams) || {};

    // 3. Outstanding Receivables
    let outSql = `
      SELECT 
        COALESCE(SUM(balance_due * exchange_rate), 0) as total_outstanding_base,
        COALESCE(SUM(CASE WHEN due_date < date('now') THEN balance_due * exchange_rate ELSE 0 END), 0) as total_overdue_base
      FROM invoices
      WHERE company_id = ? AND status NOT IN ('Paid', 'Cancelled') AND balance_due > 0
    `;
    const outstandingStats = queryOne(outSql, [companyId]) || {};

    return {
      invoiced: {
        count: invoicedStats.total_invoices || 0,
        amountBase: invoicedStats.total_invoiced_base || 0,
        amountCurrency: invoicedStats.total_invoiced_curr || 0
      },
      collected: {
        count: collectedStats.total_payments || 0,
        amountBase: collectedStats.total_collected_base || 0,
        amountCurrency: collectedStats.total_collected_curr || 0
      },
      outstanding: {
        amountBase: outstandingStats.total_outstanding_base || 0,
        overdueBase: outstandingStats.total_overdue_base || 0
      }
    };
  }

  public static getRevenueTransactions(companyId: string, limit: number = 100): any[] {
    return queryAll(
      `SELECT r.*, c.company_name AS client_name, i.invoice_number
       FROM revenues r
       LEFT JOIN clients c ON r.client_id = c.id
       LEFT JOIN invoices i ON r.invoice_id = i.id
       WHERE r.company_id = ?
       ORDER BY r.revenue_date DESC, r.created_at DESC LIMIT ?`,
      [companyId, limit]
    );
  }
}
