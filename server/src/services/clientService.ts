import { execute, queryAll, queryOne, sanitizeFk } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import { AuditService } from './auditService.ts';
import * as crypto from 'node:crypto';

export interface Client {
  id: string;
  company_id: string;
  company_name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  tax_id: string;
  preferred_currency: string;
  payment_terms: number;
  notes: string;
  status: string;
  total_invoiced: number;
  total_paid: number;
  outstanding_balance: number;
  overdue_balance: number;
  created_at: string;
  updated_at: string;
}

export class ClientService {
  public static getClients(companyId: string, search?: string, status?: string): Client[] {
    let sql = `SELECT * FROM clients WHERE company_id = ?`;
    const params: any[] = [companyId];

    if (status && status !== 'all') {
      sql += ` AND status = ?`;
      params.push(status);
    }

    if (search && search.trim()) {
      sql += ` AND (company_name LIKE ? OR contact_person LIKE ? OR email LIKE ? OR phone LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    sql += ` ORDER BY company_name ASC`;
    return queryAll<Client>(sql, params);
  }

  public static getClientById(companyId: string, id: string): Client | null {
    return queryOne<Client>(`SELECT * FROM clients WHERE id = ? AND company_id = ?`, [id, companyId]);
  }

  public static createClient(companyId: string, data: any, userId?: string, userName?: string): Client {
    const id = crypto.randomUUID();
    execute(
      `INSERT INTO clients (
        id, company_id, company_name, contact_person, email, phone, address, country, tax_id,
        preferred_currency, payment_terms, notes, status, total_invoiced, total_paid, outstanding_balance, overdue_balance,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, datetime('now'), datetime('now'))`,
      [
        id,
        companyId,
        data.company_name,
        data.contact_person || '',
        data.email || '',
        data.phone || '',
        data.address || '',
        data.country || 'Ghana',
        data.tax_id || '',
        data.preferred_currency || 'USD',
        Number(data.payment_terms) || 30,
        data.notes || '',
        data.status || 'active'
      ]
    );

    const client = queryOne<Client>(`SELECT * FROM clients WHERE id = ?`, [id])!;
    AuditService.log({
      companyId,
      userId: sanitizeFk('users', userId),
      userName,
      action: 'CLIENT_CREATED',
      entityType: 'CLIENT',
      entityId: id,
      newValue: client
    });

    return client;
  }

  public static updateClient(companyId: string, id: string, data: any, userId?: string, userName?: string): Client | null {
    const existing = this.getClientById(companyId, id);
    if (!existing) return null;

    execute(
      `UPDATE clients SET
        company_name = COALESCE(?, company_name),
        contact_person = COALESCE(?, contact_person),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        country = COALESCE(?, country),
        tax_id = COALESCE(?, tax_id),
        preferred_currency = COALESCE(?, preferred_currency),
        payment_terms = COALESCE(?, payment_terms),
        notes = COALESCE(?, notes),
        status = COALESCE(?, status),
        updated_at = datetime('now')
       WHERE id = ? AND company_id = ?`,
      [
        data.company_name ?? null,
        data.contact_person ?? null,
        data.email ?? null,
        data.phone ?? null,
        data.address ?? null,
        data.country ?? null,
        data.tax_id ?? null,
        data.preferred_currency ?? null,
        data.payment_terms !== undefined ? Number(data.payment_terms) : null,
        data.notes ?? null,
        data.status ?? null,
        id,
        companyId
      ]
    );

    const updated = this.getClientById(companyId, id)!;
    AuditService.log({
      companyId,
      userId: sanitizeFk('users', userId),
      userName,
      action: 'CLIENT_UPDATED',
      entityType: 'CLIENT',
      entityId: id,
      previousValue: existing,
      newValue: updated
    });

    return updated;
  }

  public static deleteClient(companyId: string, id: string, userId?: string, userName?: string): { success: boolean; mode: 'deleted' | 'archived'; message: string } {
    const existing = this.getClientById(companyId, id);
    if (!existing) {
      throw new Error('Client not found');
    }

    const invoiceCount = queryOne(`SELECT COUNT(*) as count FROM invoices WHERE client_id = ? AND company_id = ?`, [id, companyId])?.count || 0;
    const paymentCount = queryOne(`SELECT COUNT(*) as count FROM payments WHERE client_id = ? AND company_id = ?`, [id, companyId])?.count || 0;

    if (invoiceCount > 0 || paymentCount > 0) {
      execute(`UPDATE clients SET status = 'archived', updated_at = datetime('now') WHERE id = ? AND company_id = ?`, [id, companyId]);

      AuditService.log({
        companyId,
        userId: sanitizeFk('users', userId),
        userName,
        action: 'CLIENT_ARCHIVED',
        entityType: 'CLIENT',
        entityId: id,
        previousValue: existing,
        newValue: { ...existing, status: 'archived' }
      });

      return {
        success: true,
        mode: 'archived',
        message: `Client '${existing.company_name}' has linked invoices/payments. Account has been archived to preserve ledger records.`
      };
    } else {
      execute(`DELETE FROM clients WHERE id = ? AND company_id = ?`, [id, companyId]);

      AuditService.log({
        companyId,
        userId: sanitizeFk('users', userId),
        userName,
        action: 'CLIENT_DELETED',
        entityType: 'CLIENT',
        entityId: id,
        previousValue: existing
      });

      return {
        success: true,
        mode: 'deleted',
        message: `Client '${existing.company_name}' was permanently deleted.`
      };
    }
  }

  /**
   * Recalculate client financial metrics atomically across all invoices and payments
   */
  public static refreshClientBalances(companyId: string, clientId: string): void {
    const today = new Date().toISOString().slice(0, 10);

    const invoices = queryAll(
      `SELECT total_amount, amount_paid, balance_due, status, due_date, currency, exchange_rate, base_currency_total
       FROM invoices WHERE company_id = ? AND client_id = ? AND status != 'Cancelled'`,
      [companyId, clientId]
    );

    let totalInvoicedBase = 0;
    let totalPaidBase = 0;
    let outstandingBase = 0;
    let overdueBase = 0;

    for (const inv of invoices) {
      const invTotalBase = inv.base_currency_total || SafeMoney.convertCurrency(inv.total_amount, inv.exchange_rate);
      const invPaidBase = SafeMoney.convertCurrency(inv.amount_paid, inv.exchange_rate);
      const invBalBase = SafeMoney.convertCurrency(inv.balance_due, inv.exchange_rate);

      totalInvoicedBase = SafeMoney.add(totalInvoicedBase, invTotalBase);
      totalPaidBase = SafeMoney.add(totalPaidBase, invPaidBase);
      outstandingBase = SafeMoney.add(outstandingBase, invBalBase);

      if (inv.due_date < today && inv.balance_due > 0) {
        overdueBase = SafeMoney.add(overdueBase, invBalBase);
      }
    }

    execute(
      `UPDATE clients SET
        total_invoiced = ?,
        total_paid = ?,
        outstanding_balance = ?,
        overdue_balance = ?,
        updated_at = datetime('now')
       WHERE id = ? AND company_id = ?`,
      [totalInvoicedBase, totalPaidBase, outstandingBase, overdueBase, clientId, companyId]
    );
  }

  /**
   * Get complete client 360 profile with history and statement
   */
  public static getClientProfile(companyId: string, clientId: string): any {
    const client = this.getClientById(companyId, clientId);
    if (!client) return null;

    const invoices = queryAll(
      `SELECT * FROM invoices WHERE company_id = ? AND client_id = ? ORDER BY issue_date DESC, created_at DESC`,
      [companyId, clientId]
    );

    const payments = queryAll(
      `SELECT * FROM payments WHERE company_id = ? AND client_id = ? ORDER BY payment_date DESC, created_at DESC`,
      [companyId, clientId]
    );

    const invoiceCount = invoices.length;
    const paidInvoicesCount = invoices.filter(i => i.status === 'Paid').length;
    const unpaidInvoicesCount = invoices.filter(i => ['Unpaid', 'Partially Paid', 'Overdue'].includes(i.status)).length;

    return {
      client,
      stats: {
        invoiceCount,
        paidInvoicesCount,
        unpaidInvoicesCount,
        totalInvoiced: client.total_invoiced,
        totalPaid: client.total_paid,
        outstandingBalance: client.outstanding_balance,
        overdueBalance: client.overdue_balance
      },
      invoices,
      payments
    };
  }
}

