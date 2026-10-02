import { execute, queryAll, queryOne, sanitizeFk } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import { CurrencyService } from './currencyService.ts';
import { AuditService } from './auditService.ts';
import { NotificationService } from './notificationService.ts';
import { sseService } from './sseService.ts';
import * as crypto from 'node:crypto';

export interface ExpenseCategory {
  id: string;
  company_id: string;
  name: string;
  description: string;
  is_system: number;
}

export interface ExpenseInput {
  company_id: string;
  category_id?: string;
  category_name?: string; // If new custom category
  vendor: string;
  description: string;
  amount: number;
  currency: string;
  exchange_rate?: number;
  tax_amount?: number;
  expense_date: string;
  payment_method?: string;
  reference_number?: string;
  notes?: string;
  receipt_url?: string;
  user_id?: string;
  user_name?: string;
}

export class ExpenseService {
  public static getCategories(companyId: string): ExpenseCategory[] {
    return queryAll<ExpenseCategory>(
      `SELECT * FROM expense_categories WHERE company_id = ? ORDER BY is_system DESC, name ASC`,
      [companyId]
    );
  }

  public static createCategory(companyId: string, name: string, description?: string): ExpenseCategory {
    const existing = queryOne<ExpenseCategory>(
      `SELECT * FROM expense_categories WHERE company_id = ? AND LOWER(name) = LOWER(?)`,
      [companyId, name.trim()]
    );
    if (existing) return existing;

    const id = crypto.randomUUID();
    execute(
      `INSERT INTO expense_categories (id, company_id, name, description, is_system, created_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))`,
      [id, companyId, name.trim(), description || '']
    );
    return queryOne<ExpenseCategory>(`SELECT * FROM expense_categories WHERE id = ?`, [id])!;
  }

  public static createExpense(dto: ExpenseInput): any {
    const amount = Number(dto.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Expense amount must be greater than zero');
    }

    let categoryId = dto.category_id;
    if (!categoryId && dto.category_name) {
      const cat = this.createCategory(dto.company_id, dto.category_name);
      categoryId = cat.id;
    }

    const baseCurr = CurrencyService.getBaseCurrency(dto.company_id).code;
    const rate = dto.exchange_rate || CurrencyService.getExchangeRate(dto.company_id, dto.currency, baseCurr, dto.expense_date);
    const baseAmount = SafeMoney.convertCurrency(amount, rate);
    const taxAmount = Number(dto.tax_amount) || 0;

    const id = crypto.randomUUID();
    execute(
      `INSERT INTO expenses (
        id, company_id, category_id, vendor, description, amount, currency,
        exchange_rate, base_currency_amount, tax_amount, expense_date, payment_method,
        reference_number, notes, receipt_url, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        id,
        dto.company_id,
        sanitizeFk('expense_categories', categoryId),
        dto.vendor,
        dto.description,
        amount,
        dto.currency.toUpperCase(),
        rate,
        baseAmount,
        taxAmount,
        dto.expense_date,
        dto.payment_method || 'Bank Transfer',
        dto.reference_number || '',
        dto.notes || '',
        dto.receipt_url || '',
        sanitizeFk('users', dto.user_id)
      ]
    );

    // Unified ledger transaction
    execute(
      `INSERT INTO transactions (
        id, company_id, transaction_type, reference_type, reference_id,
        amount, currency, exchange_rate, base_currency_amount, transaction_date, notes, created_at
      ) VALUES (?, ?, 'EXPENSE_RECORDED', 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        crypto.randomUUID(),
        dto.company_id,
        id,
        amount,
        dto.currency.toUpperCase(),
        rate,
        baseAmount,
        dto.expense_date,
        `Expense to ${dto.vendor}: ${dto.description}`
      ]
    );

    // Audit Log
    AuditService.log({
      companyId: dto.company_id,
      userId: dto.user_id,
      userName: dto.user_name,
      action: 'EXPENSE_CREATED',
      entityType: 'EXPENSE',
      entityId: id,
      newValue: { vendor: dto.vendor, amount, currency: dto.currency }
    });

    // Notification
    NotificationService.create({
      companyId: dto.company_id,
      userId: dto.user_id,
      type: 'expense_created',
      title: `Expense Recorded`,
      message: `${dto.vendor}: ${SafeMoney.format(amount, dto.currency + ' ')}`,
      link: `/expenses`
    });

    sseService.broadcast(dto.company_id, 'expense_recorded', { expenseId: id, amount });

    return this.getExpenseById(dto.company_id, id);
  }

  public static getExpenses(companyId: string, filters: { categoryId?: string; search?: string; startDate?: string; endDate?: string } = {}): any[] {
    let sql = `
      SELECT e.*, ec.name AS category_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      WHERE e.company_id = ?
    `;
    const params: any[] = [companyId];

    if (filters.categoryId && filters.categoryId !== 'all') {
      sql += ` AND e.category_id = ?`;
      params.push(filters.categoryId);
    }
    if (filters.startDate) {
      sql += ` AND e.expense_date >= ?`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND e.expense_date <= ?`;
      params.push(filters.endDate);
    }
    if (filters.search && filters.search.trim()) {
      sql += ` AND (e.vendor LIKE ? OR e.description LIKE ? OR e.reference_number LIKE ?)`;
      const term = `%${filters.search.trim()}%`;
      params.push(term, term, term);
    }

    sql += ` ORDER BY e.expense_date DESC, e.created_at DESC`;
    return queryAll(sql, params);
  }

  public static getExpenseById(companyId: string, id: string): any {
    return queryOne(
      `SELECT e.*, ec.name AS category_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON e.category_id = ec.id
       WHERE e.id = ? AND e.company_id = ?`,
      [id, companyId]
    );
  }

  public static deleteExpense(companyId: string, id: string, userId?: string, userName?: string): boolean {
    const existing = this.getExpenseById(companyId, id);
    if (!existing) return false;

    execute(`DELETE FROM expenses WHERE id = ? AND company_id = ?`, [id, companyId]);

    AuditService.log({
      companyId,
      userId,
      userName,
      action: 'EXPENSE_DELETED',
      entityType: 'EXPENSE',
      entityId: id,
      previousValue: existing
    });

    sseService.broadcast(companyId, 'expense_deleted', { expenseId: id });
    return true;
  }
}
