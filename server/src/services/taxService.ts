import { execute, queryAll, queryOne } from '../db/database.ts';
import * as crypto from 'node:crypto';

export interface TaxRate {
  id: string;
  company_id: string;
  name: string;
  code: string;
  percentage: number;
  description: string;
  is_active: number;
  created_at: string;
}

export class TaxService {
  public static getTaxRates(companyId: string): TaxRate[] {
    return queryAll<TaxRate>(
      `SELECT * FROM tax_rates WHERE company_id = ? ORDER BY percentage ASC, name ASC`,
      [companyId]
    );
  }

  public static getActiveTaxRates(companyId: string): TaxRate[] {
    return queryAll<TaxRate>(
      `SELECT * FROM tax_rates WHERE company_id = ? AND is_active = 1 ORDER BY percentage ASC, name ASC`,
      [companyId]
    );
  }

  public static createTaxRate(companyId: string, data: { name: string; code: string; percentage: number; description?: string; is_active?: boolean }): TaxRate {
    const id = crypto.randomUUID();
    execute(
      `INSERT INTO tax_rates (id, company_id, name, code, percentage, description, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, companyId, data.name, data.code.toUpperCase(), data.percentage, data.description || '', data.is_active !== false ? 1 : 0]
    );
    return queryOne<TaxRate>(`SELECT * FROM tax_rates WHERE id = ?`, [id])!;
  }

  public static updateTaxRate(companyId: string, id: string, data: Partial<{ name: string; code: string; percentage: number; description: string; is_active: boolean }>): TaxRate | null {
    const tax = queryOne<TaxRate>(`SELECT * FROM tax_rates WHERE id = ? AND company_id = ?`, [id, companyId]);
    if (!tax) return null;

    execute(
      `UPDATE tax_rates SET 
        name = COALESCE(?, name),
        code = COALESCE(?, code),
        percentage = COALESCE(?, percentage),
        description = COALESCE(?, description),
        is_active = COALESCE(?, is_active)
       WHERE id = ? AND company_id = ?`,
      [
        data.name ?? null,
        data.code ? data.code.toUpperCase() : null,
        data.percentage ?? null,
        data.description ?? null,
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : null,
        id,
        companyId
      ]
    );

    return queryOne<TaxRate>(`SELECT * FROM tax_rates WHERE id = ?`, [id]);
  }
}
