import { queryAll, queryOne } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import { CurrencyService } from './currencyService.ts';

export interface DashboardFilterOptions {
  period?: 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'previous_year' | 'custom';
  startDate?: string;
  endDate?: string;
  currencyMode?: 'base' | 'currency' | 'all'; // all = convert all to reporting currency
  selectedCurrency?: string; // e.g. 'USD' or 'GHS'
}

export class DashboardService {
  /**
   * Resolve date ranges for comparison (current period vs previous period)
   */
  private static resolveDateRanges(options: DashboardFilterOptions) {
    const now = new Date();
    let currentStart = '';
    let currentEnd = now.toISOString().slice(0, 10);
    let prevStart = '';
    let prevEnd = '';

    const period = options.period || 'this_month';

    if (period === 'today') {
      currentStart = currentEnd;
      const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      prevStart = yesterday;
      prevEnd = yesterday;
    } else if (period === 'this_week') {
      const day = now.getDay() || 7; // Sunday = 7
      const mon = new Date(now.getTime() - (day - 1) * 86400000);
      currentStart = mon.toISOString().slice(0, 10);
      const prevMon = new Date(mon.getTime() - 7 * 86400000);
      const prevSun = new Date(mon.getTime() - 86400000);
      prevStart = prevMon.toISOString().slice(0, 10);
      prevEnd = prevSun.toISOString().slice(0, 10);
    } else if (period === 'last_month') {
      const y = now.getFullYear();
      const m = now.getMonth(); // 0-indexed, current month
      const lmYear = m === 0 ? y - 1 : y;
      const lmMonth = m === 0 ? 11 : m - 1;
      const lastDayOfLm = new Date(lmYear, lmMonth + 1, 0).getDate();
      currentStart = `${lmYear}-${String(lmMonth + 1).padStart(2, '0')}-01`;
      currentEnd = `${lmYear}-${String(lmMonth + 1).padStart(2, '0')}-${lastDayOfLm}`;

      const pmMonth = lmMonth === 0 ? 11 : lmMonth - 1;
      const pmYear = lmMonth === 0 ? lmYear - 1 : lmYear;
      const lastDayOfPm = new Date(pmYear, pmMonth + 1, 0).getDate();
      prevStart = `${pmYear}-${String(pmMonth + 1).padStart(2, '0')}-01`;
      prevEnd = `${pmYear}-${String(pmMonth + 1).padStart(2, '0')}-${lastDayOfPm}`;
    } else if (period === 'this_quarter') {
      const q = Math.floor(now.getMonth() / 3);
      currentStart = `${now.getFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`;
      const prevQ = q === 0 ? 3 : q - 1;
      const prevQYear = q === 0 ? now.getFullYear() - 1 : now.getFullYear();
      prevStart = `${prevQYear}-${String(prevQ * 3 + 1).padStart(2, '0')}-01`;
      const lastDayOfPrevQ = new Date(prevQYear, prevQ * 3 + 3, 0).getDate();
      prevEnd = `${prevQYear}-${String(prevQ * 3 + 3).padStart(2, '0')}-${lastDayOfPrevQ}`;
    } else if (period === 'this_year') {
      currentStart = `${now.getFullYear()}-01-01`;
      prevStart = `${now.getFullYear() - 1}-01-01`;
      prevEnd = `${now.getFullYear() - 1}-12-31`;
    } else if (period === 'previous_year') {
      currentStart = `${now.getFullYear() - 1}-01-01`;
      currentEnd = `${now.getFullYear() - 1}-12-31`;
      prevStart = `${now.getFullYear() - 2}-01-01`;
      prevEnd = `${now.getFullYear() - 2}-12-31`;
    } else if (period === 'custom' && options.startDate && options.endDate) {
      currentStart = options.startDate;
      currentEnd = options.endDate;
      const durationMs = new Date(currentEnd).getTime() - new Date(currentStart).getTime();
      prevEnd = new Date(new Date(currentStart).getTime() - 86400000).toISOString().slice(0, 10);
      prevStart = new Date(new Date(prevEnd).getTime() - durationMs).toISOString().slice(0, 10);
    } else {
      // Default: this_month
      currentStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const lastDay = new Date(prevYear, prevMonth + 1, 0).getDate();
      prevStart = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
      prevEnd = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${lastDay}`;
    }

    return { currentStart, currentEnd, prevStart, prevEnd };
  }

  public static getDashboardMetrics(companyId: string, options: DashboardFilterOptions = {}): any {
    const { currentStart, currentEnd, prevStart, prevEnd } = this.resolveDateRanges(options);
    const baseCurr = CurrencyService.getBaseCurrency(companyId).code;
    const reportingCurrency = options.selectedCurrency || baseCurr;
    const isCurrencyConverted = reportingCurrency !== baseCurr;
    const conversionRate = CurrencyService.getExchangeRate(companyId, baseCurr, reportingCurrency);

    // Filter by specific currency if single-currency mode selected
    const currencyFilterSql = options.currencyMode === 'currency' && options.selectedCurrency
      ? `AND currency = '${options.selectedCurrency.toUpperCase()}'`
      : '';

    // --- Current Period Metrics ---
    // 1. Collected Revenue (from payments)
    const curCollected = queryOne(
      `SELECT COALESCE(SUM(base_currency_amount), 0) as total FROM payments
       WHERE company_id = ? AND status = 'Completed' AND payment_date >= ? AND payment_date <= ? ${currencyFilterSql}`,
      [companyId, currentStart, currentEnd]
    )?.total || 0;

    // 2. Invoiced Revenue
    const curInvoiced = queryOne(
      `SELECT COALESCE(SUM(base_currency_total), 0) as total FROM invoices
       WHERE company_id = ? AND status != 'Cancelled' AND issue_date >= ? AND issue_date <= ? ${currencyFilterSql}`,
      [companyId, currentStart, currentEnd]
    )?.total || 0;

    // 3. Expenses
    const curExpenses = queryOne(
      `SELECT COALESCE(SUM(base_currency_amount), 0) as total FROM expenses
       WHERE company_id = ? AND expense_date >= ? AND expense_date <= ? ${currencyFilterSql}`,
      [companyId, currentStart, currentEnd]
    )?.total || 0;

    // --- Previous Period Metrics for Trend Calculation ---
    const prevCollected = queryOne(
      `SELECT COALESCE(SUM(base_currency_amount), 0) as total FROM payments
       WHERE company_id = ? AND status = 'Completed' AND payment_date >= ? AND payment_date <= ? ${currencyFilterSql}`,
      [companyId, prevStart, prevEnd]
    )?.total || 0;

    const prevInvoiced = queryOne(
      `SELECT COALESCE(SUM(base_currency_total), 0) as total FROM invoices
       WHERE company_id = ? AND status != 'Cancelled' AND issue_date >= ? AND issue_date <= ? ${currencyFilterSql}`,
      [companyId, prevStart, prevEnd]
    )?.total || 0;

    const prevExpenses = queryOne(
      `SELECT COALESCE(SUM(base_currency_amount), 0) as total FROM expenses
       WHERE company_id = ? AND expense_date >= ? AND expense_date <= ? ${currencyFilterSql}`,
      [companyId, prevStart, prevEnd]
    )?.total || 0;

    // Lifetime / Global Totals
    const outstanding = queryOne(
      `SELECT COALESCE(SUM(balance_due * exchange_rate), 0) as total FROM invoices
       WHERE company_id = ? AND status NOT IN ('Paid', 'Cancelled') AND balance_due > 0`,
      [companyId]
    )?.total || 0;

    const overdue = queryOne(
      `SELECT COALESCE(SUM(balance_due * exchange_rate), 0) as total FROM invoices
       WHERE company_id = ? AND status NOT IN ('Paid', 'Cancelled') AND balance_due > 0 AND due_date < date('now')`,
      [companyId]
    )?.total || 0;

    const clientCount = queryOne(`SELECT COUNT(*) as count FROM clients WHERE company_id = ? AND status = 'active'`, [companyId])?.count || 0;
    const outstandingInvoicesCount = queryOne(
      `SELECT COUNT(*) as count FROM invoices WHERE company_id = ? AND status NOT IN ('Paid', 'Cancelled') AND balance_due > 0`,
      [companyId]
    )?.count || 0;

    // Value converter to reporting currency
    const toReporting = (val: number) => isCurrencyConverted ? SafeMoney.convertCurrency(val, conversionRate) : val;

    const curNetProfit = SafeMoney.subtract(curCollected, curExpenses);
    const prevNetProfit = SafeMoney.subtract(prevCollected, prevExpenses);

    // Percentage change calculation safely
    const calcChange = (cur: number, prev: number) => {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return SafeMoney.round(((cur - prev) / Math.abs(prev)) * 100, 1);
    };

    // --- Charts: Monthly Revenue vs Expenses (Last 6 Months) ---
    const monthlyData = queryAll(
      `WITH RECURSIVE months(m) AS (
         SELECT date('now', 'start of month', '-5 months')
         UNION ALL
         SELECT date(m, '+1 month') FROM months WHERE m < date('now', 'start of month')
       )
       SELECT 
         strftime('%Y-%m', m) as month_key,
         strftime('%b %Y', m) as month_label,
         COALESCE((
           SELECT SUM(base_currency_amount) FROM payments 
           WHERE company_id = ? AND status = 'Completed' AND strftime('%Y-%m', payment_date) = strftime('%Y-%m', m)
         ), 0) as revenue,
         COALESCE((
           SELECT SUM(base_currency_amount) FROM expenses 
           WHERE company_id = ? AND strftime('%Y-%m', expense_date) = strftime('%Y-%m', m)
         ), 0) as expenses
       FROM months ORDER BY m ASC`,
      [companyId, companyId]
    ).map(row => {
      const rev = toReporting(row.revenue);
      const exp = toReporting(row.expenses);
      return {
        month: row.month_label,
        revenue: rev,
        expenses: exp,
        netProfit: SafeMoney.subtract(rev, exp),
        netCashFlow: SafeMoney.subtract(rev, exp)
      };
    });

    // --- Expense breakdown by category ---
    const expenseBreakdown = queryAll(
      `SELECT COALESCE(ec.name, 'Other') as category, SUM(e.base_currency_amount) as total
       FROM expenses e
       LEFT JOIN expense_categories ec ON e.category_id = ec.id
       WHERE e.company_id = ?
       GROUP BY category ORDER BY total DESC LIMIT 6`,
      [companyId]
    ).map(row => ({
      name: row.category,
      value: toReporting(row.total)
    }));

    // --- Revenue by Client (Top 5) ---
    const revenueByClient = queryAll(
      `SELECT c.company_name, SUM(p.base_currency_amount) as total
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       WHERE p.company_id = ? AND p.status = 'Completed'
       GROUP BY c.id ORDER BY total DESC LIMIT 5`,
      [companyId]
    ).map(row => ({
      name: row.company_name,
      value: toReporting(row.total)
    }));

    // --- Revenue and Expenses by Currency ---
    const revenueByCurrency = queryAll(
      `SELECT currency, SUM(amount) as original_amount, SUM(base_currency_amount) as base_amount, COUNT(*) as count
       FROM payments WHERE company_id = ? AND status = 'Completed' GROUP BY currency`,
      [companyId]
    );

    const expensesByCurrency = queryAll(
      `SELECT currency, SUM(amount) as original_amount, SUM(base_currency_amount) as base_amount, COUNT(*) as count
       FROM expenses WHERE company_id = ? GROUP BY currency`,
      [companyId]
    );

    return {
      period: {
        currentStart,
        currentEnd,
        prevStart,
        prevEnd,
        name: options.period || 'this_month'
      },
      reportingCurrency,
      isConverted: isCurrencyConverted,
      conversionNote: isCurrencyConverted
        ? `Converted into ${reportingCurrency} at effective rate (1 ${baseCurr} = ${conversionRate} ${reportingCurrency})`
        : `Reported in company base currency (${baseCurr})`,
      summary: {
        totalRevenue: {
          value: toReporting(curCollected),
          previousValue: toReporting(prevCollected),
          changePercent: calcChange(curCollected, prevCollected),
          isPositive: curCollected >= prevCollected
        },
        invoicedRevenue: {
          value: toReporting(curInvoiced),
          previousValue: toReporting(prevInvoiced),
          changePercent: calcChange(curInvoiced, prevInvoiced),
          isPositive: curInvoiced >= prevInvoiced
        },
        totalExpenses: {
          value: toReporting(curExpenses),
          previousValue: toReporting(prevExpenses),
          changePercent: calcChange(curExpenses, prevExpenses),
          isPositive: curExpenses <= prevExpenses // lower expenses is positive
        },
        netProfit: {
          value: toReporting(curNetProfit),
          previousValue: toReporting(prevNetProfit),
          changePercent: calcChange(curNetProfit, prevNetProfit),
          isPositive: curNetProfit >= prevNetProfit
        },
        outstandingReceivables: {
          value: toReporting(outstanding)
        },
        overdueAmount: {
          value: toReporting(overdue)
        },
        clientCount,
        outstandingInvoicesCount
      },
      charts: {
        monthlyTrends: monthlyData,
        expenseBreakdown,
        revenueByClient,
        revenueByCurrency,
        expensesByCurrency
      }
    };
  }
}
