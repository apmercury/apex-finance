import { queryAll } from '../db/database.ts';

export class SearchService {
  public static globalSearch(companyId: string, queryStr: string, limit: number = 8): any {
    const term = `%${queryStr.trim()}%`;
    if (!queryStr || queryStr.trim().length === 0) {
      return { clients: [], invoices: [], payments: [], expenses: [] };
    }

    const clients = queryAll(
      `SELECT id, company_name as title, contact_person as subtitle, 'client' as type, '/clients' as url
       FROM clients WHERE company_id = ? AND (company_name LIKE ? OR contact_person LIKE ? OR email LIKE ?)
       LIMIT ?`,
      [companyId, term, term, term, limit]
    );

    const invoices = queryAll(
      `SELECT i.id, i.invoice_number as title, c.company_name as subtitle, i.total_amount as amount, i.currency, 'invoice' as type, '/invoices' as url
       FROM invoices i JOIN clients c ON i.client_id = c.id
       WHERE i.company_id = ? AND (i.invoice_number LIKE ? OR c.company_name LIKE ?)
       LIMIT ?`,
      [companyId, term, term, limit]
    );

    const payments = queryAll(
      `SELECT p.id, p.payment_number as title, c.company_name as subtitle, p.amount, p.currency, 'payment' as type, '/payments' as url
       FROM payments p JOIN clients c ON p.client_id = c.id
       WHERE p.company_id = ? AND (p.payment_number LIKE ? OR p.reference_number LIKE ? OR c.company_name LIKE ?)
       LIMIT ?`,
      [companyId, term, term, term, limit]
    );

    const expenses = queryAll(
      `SELECT id, vendor as title, description as subtitle, amount, currency, 'expense' as type, '/expenses' as url
       FROM expenses WHERE company_id = ? AND (vendor LIKE ? OR description LIKE ? OR reference_number LIKE ?)
       LIMIT ?`,
      [companyId, term, term, term, limit]
    );

    return {
      query: queryStr,
      results: [
        ...clients,
        ...invoices,
        ...payments,
        ...expenses
      ]
    };
  }
}
