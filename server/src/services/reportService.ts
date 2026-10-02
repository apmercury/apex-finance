import { queryAll, queryOne } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import { CurrencyService } from './currencyService.ts';

export class ReportService {
  /**
   * Profit & Loss Report
   */
  public static getProfitAndLoss(companyId: string, startDate?: string, endDate?: string, reportingCurrency?: string): any {
    const baseCurr = CurrencyService.getBaseCurrency(companyId).code;
    const targetCurrency = reportingCurrency || baseCurr;
    const targetRate = CurrencyService.getExchangeRate(companyId, baseCurr, targetCurrency);

    let revSql = `SELECT * FROM revenues WHERE company_id = ?`;
    const revParams: any[] = [companyId];
    if (startDate) { revSql += ` AND revenue_date >= ?`; revParams.push(startDate); }
    if (endDate) { revSql += ` AND revenue_date <= ?`; revParams.push(endDate); }

    const revenues = queryAll(revSql, revParams);

    let expSql = `SELECT e.*, ec.name as category_name FROM expenses e LEFT JOIN expense_categories ec ON e.category_id = ec.id WHERE e.company_id = ?`;
    const expParams: any[] = [companyId];
    if (startDate) { expSql += ` AND e.expense_date >= ?`; expParams.push(startDate); }
    if (endDate) { expSql += ` AND e.expense_date <= ?`; expParams.push(endDate); }

    const expenses = queryAll(expSql, expParams);

    let totalRevenueBase = 0;
    const revenueBySource: Record<string, number> = {};
    for (const r of revenues) {
      totalRevenueBase = SafeMoney.add(totalRevenueBase, r.base_currency_amount);
      const src = r.source_type || 'Invoice Payment';
      revenueBySource[src] = SafeMoney.add(revenueBySource[src] || 0, r.base_currency_amount);
    }

    let totalExpenseBase = 0;
    const expenseByCategory: Record<string, number> = {};
    for (const e of expenses) {
      totalExpenseBase = SafeMoney.add(totalExpenseBase, e.base_currency_amount);
      const cat = e.category_name || 'General';
      expenseByCategory[cat] = SafeMoney.add(expenseByCategory[cat] || 0, e.base_currency_amount);
    }

    const netProfitBase = SafeMoney.subtract(totalRevenueBase, totalExpenseBase);

    // Convert to target reporting currency if different from base
    const convert = (val: number) => targetCurrency === baseCurr ? val : SafeMoney.convertCurrency(val, targetRate);

    return {
      reportingCurrency: targetCurrency,
      isConverted: targetCurrency !== baseCurr,
      exchangeRateUsed: targetRate,
      totalRevenue: convert(totalRevenueBase),
      totalExpense: convert(totalExpenseBase),
      netProfit: convert(netProfitBase),
      profitMargin: totalRevenueBase > 0 ? SafeMoney.round((netProfitBase / totalRevenueBase) * 100, 2) : 0,
      revenueBySource: Object.fromEntries(Object.entries(revenueBySource).map(([k, v]) => [k, convert(v)])),
      expenseByCategory: Object.fromEntries(Object.entries(expenseByCategory).map(([k, v]) => [k, convert(v)]))
    };
  }

  /**
   * Cash Flow Report: Money In, Money Out, Net Cash Flow
   */
  public static getCashFlow(companyId: string, startDate?: string, endDate?: string, reportingCurrency?: string): any {
    const baseCurr = CurrencyService.getBaseCurrency(companyId).code;
    const targetCurrency = reportingCurrency || baseCurr;
    const targetRate = CurrencyService.getExchangeRate(companyId, baseCurr, targetCurrency);

    let paySql = `SELECT * FROM payments WHERE company_id = ? AND status = 'Completed'`;
    const payParams: any[] = [companyId];
    if (startDate) { paySql += ` AND payment_date >= ?`; payParams.push(startDate); }
    if (endDate) { paySql += ` AND payment_date <= ?`; payParams.push(endDate); }

    const payments = queryAll(paySql, payParams);

    let expSql = `SELECT * FROM expenses WHERE company_id = ?`;
    const expParams: any[] = [companyId];
    if (startDate) { expSql += ` AND expense_date >= ?`; expParams.push(startDate); }
    if (endDate) { expSql += ` AND expense_date <= ?`; expParams.push(endDate); }

    const expenses = queryAll(expSql, expParams);

    let moneyInBase = 0;
    for (const p of payments) {
      moneyInBase = SafeMoney.add(moneyInBase, p.base_currency_amount);
    }

    let moneyOutBase = 0;
    for (const e of expenses) {
      moneyOutBase = SafeMoney.add(moneyOutBase, e.base_currency_amount);
    }

    const netCashFlowBase = SafeMoney.subtract(moneyInBase, moneyOutBase);
    const convert = (val: number) => targetCurrency === baseCurr ? val : SafeMoney.convertCurrency(val, targetRate);

    return {
      reportingCurrency: targetCurrency,
      moneyIn: convert(moneyInBase),
      moneyOut: convert(moneyOutBase),
      netCashFlow: convert(netCashFlowBase),
      paymentsCount: payments.length,
      expensesCount: expenses.length
    };
  }

  /**
   * Accounts Receivable (AR) Aging Report
   * Buckets: Current, 1-30 days, 31-60 days, 61-90 days, 90+ days
   */
  public static getAccountsReceivableAging(companyId: string, reportingCurrency?: string): any {
    const baseCurr = CurrencyService.getBaseCurrency(companyId).code;
    const targetCurrency = reportingCurrency || baseCurr;
    const targetRate = CurrencyService.getExchangeRate(companyId, baseCurr, targetCurrency);

    const invoices = queryAll(
      `SELECT i.*, c.company_name, c.email, c.phone,
              ROUND((JULIANDAY('now') - JULIANDAY(i.due_date))) as days_overdue
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.company_id = ? AND i.status NOT IN ('Paid', 'Cancelled') AND i.balance_due > 0
       ORDER BY days_overdue DESC`,
      [companyId]
    );

    const buckets = {
      current: 0,     // Not yet due
      days_1_30: 0,   // 1 to 30 days overdue
      days_31_60: 0,  // 31 to 60 days overdue
      days_61_90: 0,  // 61 to 90 days overdue
      days_90_plus: 0 // > 90 days overdue
    };

    const details: any[] = [];

    for (const inv of invoices) {
      const balanceBase = SafeMoney.convertCurrency(inv.balance_due, inv.exchange_rate);
      const balanceReporting = targetCurrency === baseCurr ? balanceBase : SafeMoney.convertCurrency(balanceBase, targetRate);
      const days = Number(inv.days_overdue) || 0;

      let bucketName = 'current';
      if (days <= 0) {
        buckets.current = SafeMoney.add(buckets.current, balanceReporting);
        bucketName = 'Current';
      } else if (days <= 30) {
        buckets.days_1_30 = SafeMoney.add(buckets.days_1_30, balanceReporting);
        bucketName = '1-30 Days';
      } else if (days <= 60) {
        buckets.days_31_60 = SafeMoney.add(buckets.days_31_60, balanceReporting);
        bucketName = '31-60 Days';
      } else if (days <= 90) {
        buckets.days_61_90 = SafeMoney.add(buckets.days_61_90, balanceReporting);
        bucketName = '61-90 Days';
      } else {
        buckets.days_90_plus = SafeMoney.add(buckets.days_90_plus, balanceReporting);
        bucketName = '90+ Days';
      }

      details.push({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        clientName: inv.company_name,
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        daysOverdue: Math.max(0, days),
        bucket: bucketName,
        originalAmount: inv.total_amount,
        originalCurrency: inv.currency,
        amountPaid: inv.amount_paid,
        balanceDueOriginal: inv.balance_due,
        balanceDueReporting: balanceReporting
      });
    }

    const totalOutstanding = SafeMoney.add(
      SafeMoney.add(SafeMoney.add(buckets.current, buckets.days_1_30), buckets.days_31_60),
      SafeMoney.add(buckets.days_61_90, buckets.days_90_plus)
    );

    return {
      reportingCurrency: targetCurrency,
      totalOutstanding,
      buckets,
      invoices: details
    };
  }

  /**
   * Client Statement Report
   */
  public static getClientStatement(companyId: string, clientId: string, startDate?: string, endDate?: string, reportingCurrency?: string): any {
    const client = queryOne(`SELECT * FROM clients WHERE id = ? AND company_id = ?`, [clientId, companyId]);
    if (!client) throw new Error('Client not found');

    const baseCurr = CurrencyService.getBaseCurrency(companyId).code;
    const targetCurrency = reportingCurrency || client.preferred_currency || baseCurr;

    // Get previous transactions before startDate for Opening Balance
    let openingBalance = 0;
    if (startDate) {
      const priorInvoices = queryAll(
        `SELECT SUM(balance_due * exchange_rate) as prior_bal FROM invoices
         WHERE company_id = ? AND client_id = ? AND issue_date < ? AND status != 'Cancelled'`,
        [companyId, clientId, startDate]
      );
      openingBalance = priorInvoices[0]?.prior_bal || 0;
    }

    // Invoices in period
    let invSql = `SELECT * FROM invoices WHERE company_id = ? AND client_id = ? AND status != 'Cancelled'`;
    const invParams: any[] = [companyId, clientId];
    if (startDate) { invSql += ` AND issue_date >= ?`; invParams.push(startDate); }
    if (endDate) { invSql += ` AND issue_date <= ?`; invParams.push(endDate); }
    invSql += ` ORDER BY issue_date ASC`;

    const invoices = queryAll(invSql, invParams);

    // Payments in period
    let paySql = `SELECT * FROM payments WHERE company_id = ? AND client_id = ? AND status = 'Completed'`;
    const payParams: any[] = [companyId, clientId];
    if (startDate) { paySql += ` AND payment_date >= ?`; payParams.push(startDate); }
    if (endDate) { paySql += ` AND payment_date <= ?`; payParams.push(endDate); }
    paySql += ` ORDER BY payment_date ASC`;

    const payments = queryAll(paySql, payParams);

    // Combine transactions chronologically
    const ledger: any[] = [];
    let runningBalance = openingBalance;

    for (const inv of invoices) {
      const invBase = SafeMoney.convertCurrency(inv.total_amount, inv.exchange_rate);
      runningBalance = SafeMoney.add(runningBalance, invBase);
      ledger.push({
        date: inv.issue_date,
        type: 'INVOICE',
        reference: inv.invoice_number,
        description: `Invoice ${inv.invoice_number}`,
        amount: inv.total_amount,
        currency: inv.currency,
        baseAmount: invBase,
        runningBalanceBase: runningBalance
      });
    }

    for (const p of payments) {
      const payBase = SafeMoney.convertCurrency(p.amount, p.exchange_rate);
      runningBalance = SafeMoney.subtract(runningBalance, payBase);
      ledger.push({
        date: p.payment_date,
        type: 'PAYMENT',
        reference: p.payment_number,
        description: `Payment ${p.payment_number} via ${p.payment_method}`,
        amount: -p.amount,
        currency: p.currency,
        baseAmount: -payBase,
        runningBalanceBase: runningBalance
      });
    }

    ledger.sort((a, b) => a.date.localeCompare(b.date));

    return {
      client,
      period: { startDate: startDate || 'All time', endDate: endDate || new Date().toISOString().slice(0, 10) },
      targetCurrency,
      openingBalance,
      closingBalance: runningBalance,
      totalInvoiced: client.total_invoiced,
      totalPaid: client.total_paid,
      ledger
    };
  }

  /**
   * Tax Report (Taxes collected on invoices vs taxes paid on expenses)
   */
  public static getTaxReport(companyId: string, startDate?: string, endDate?: string): any {
    const taxRates = queryAll(`SELECT * FROM tax_rates WHERE company_id = ?`, [companyId]);

    const invoiceTaxes = queryAll(
      `SELECT ii.tax_rate_id, tr.name as tax_name, tr.code as tax_code, tr.percentage,
              SUM(ii.tax_amount * i.exchange_rate) as total_tax_collected_base,
              SUM(ii.line_total * i.exchange_rate) as taxable_amount_base
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       LEFT JOIN tax_rates tr ON ii.tax_rate_id = tr.id
       WHERE ii.company_id = ? AND i.status != 'Cancelled'
       GROUP BY ii.tax_rate_id`,
      [companyId]
    );

    const expenseTaxTotal = queryOne(
      `SELECT COALESCE(SUM(tax_amount * exchange_rate), 0) as total_expense_tax
       FROM expenses WHERE company_id = ?`,
      [companyId]
    );

    return {
      taxRates,
      collectedTaxes: invoiceTaxes,
      totalTaxCollectedBase: invoiceTaxes.reduce((acc, t) => SafeMoney.add(acc, t.total_tax_collected_base || 0), 0),
      totalExpenseTaxBase: expenseTaxTotal?.total_expense_tax || 0
    };
  }

  /**
   * Currency Report (Distribution of transactions by currency)
   */
  public static getCurrencyReport(companyId: string): any {
    const invoicesByCurrency = queryAll(
      `SELECT currency, COUNT(*) as count, SUM(total_amount) as total_original, SUM(base_currency_total) as total_base
       FROM invoices WHERE company_id = ? AND status != 'Cancelled' GROUP BY currency`,
      [companyId]
    );

    const paymentsByCurrency = queryAll(
      `SELECT currency, COUNT(*) as count, SUM(amount) as total_original, SUM(base_currency_amount) as total_base
       FROM payments WHERE company_id = ? AND status = 'Completed' GROUP BY currency`,
      [companyId]
    );

    const expensesByCurrency = queryAll(
      `SELECT currency, COUNT(*) as count, SUM(amount) as total_original, SUM(base_currency_amount) as total_base
       FROM expenses WHERE company_id = ? GROUP BY currency`,
      [companyId]
    );

    return {
      invoicesByCurrency,
      paymentsByCurrency,
      expensesByCurrency
    };
  }

  /**
   * Generate CSV format for any tabular report
   */
  public static exportToCsv(data: Record<string, any>[]): string {
    if (!data || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const rows = data.map(row =>
      headers.map(field => {
        let val = row[field];
        if (val === null || val === undefined) return '""';
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }
}
