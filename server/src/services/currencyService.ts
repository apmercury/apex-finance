import { execute, queryAll, queryOne } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import * as crypto from 'node:crypto';

export interface Currency {
  id: string;
  company_id: string;
  code: string;
  name: string;
  symbol: string;
  decimal_precision: number;
  is_active: number;
  is_base: number;
  created_at: string;
}

export interface ExchangeRate {
  id: string;
  company_id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
  source: string;
  created_at: string;
}

// Abstraction for future automatic exchange-rate providers (ECB, Fixer, OpenExchangeRates, etc.)
export interface IExchangeRateProvider {
  name: string;
  fetchRate(from: string, to: string): Promise<number | null>;
}

export class ManualExchangeRateProvider implements IExchangeRateProvider {
  name = 'Manual/System Administrator';
  async fetchRate(from: string, to: string): Promise<number | null> {
    return null; // Uses stored database rates
  }
}

export class CurrencyService {
  private static provider: IExchangeRateProvider = new ManualExchangeRateProvider();

  public static setProvider(newProvider: IExchangeRateProvider) {
    this.provider = newProvider;
  }

  public static getCurrencies(companyId: string): Currency[] {
    return queryAll<Currency>(
      `SELECT * FROM currencies WHERE company_id = ? ORDER BY is_base DESC, code ASC`,
      [companyId]
    );
  }

  public static getActiveCurrencies(companyId: string): Currency[] {
    return queryAll<Currency>(
      `SELECT * FROM currencies WHERE company_id = ? AND is_active = 1 ORDER BY is_base DESC, code ASC`,
      [companyId]
    );
  }

  public static getBaseCurrency(companyId: string): Currency {
    const base = queryOne<Currency>(
      `SELECT * FROM currencies WHERE company_id = ? AND is_base = 1 LIMIT 1`,
      [companyId]
    );
    if (!base) {
      // Fallback
      return {
        id: 'default',
        company_id: companyId,
        code: 'GHS',
        name: 'Ghanaian Cedi',
        symbol: 'GH₵',
        decimal_precision: 2,
        is_active: 1,
        is_base: 1,
        created_at: new Date().toISOString()
      };
    }
    return base;
  }

  public static setBaseCurrency(companyId: string, currencyCode: string): void {
    execute(`UPDATE currencies SET is_base = 0 WHERE company_id = ?`, [companyId]);
    execute(`UPDATE currencies SET is_base = 1, is_active = 1 WHERE company_id = ? AND code = ?`, [companyId, currencyCode]);
    execute(`UPDATE companies SET default_currency = ? WHERE id = ?`, [currencyCode, companyId]);
  }

  public static toggleCurrencyStatus(companyId: string, currencyCode: string, isActive: boolean): void {
    execute(
      `UPDATE currencies SET is_active = ? WHERE company_id = ? AND code = ?`,
      [isActive ? 1 : 0, companyId, currencyCode]
    );
  }

  public static createCurrency(companyId: string, data: { code: string; name: string; symbol: string; decimal_precision?: number; is_active?: boolean }): Currency {
    const id = crypto.randomUUID();
    execute(
      `INSERT INTO currencies (id, company_id, code, name, symbol, decimal_precision, is_active, is_base, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
      [id, companyId, data.code.toUpperCase(), data.name, data.symbol, data.decimal_precision || 2, data.is_active !== false ? 1 : 0]
    );
    return queryOne<Currency>(`SELECT * FROM currencies WHERE id = ?`, [id])!;
  }

  /**
   * Get the most recent effective exchange rate between two currencies for a company
   */
  public static getExchangeRate(companyId: string, fromCurrency: string, toCurrency: string, targetDate?: string): number {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();

    if (from === to) return 1.0;

    const date = targetDate || new Date().toISOString().slice(0, 10);

    // Direct lookup: from -> to
    const direct = queryOne<ExchangeRate>(
      `SELECT rate FROM exchange_rates 
       WHERE company_id = ? AND from_currency = ? AND to_currency = ? AND effective_date <= ? 
       ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
      [companyId, from, to, date]
    );

    if (direct) return direct.rate;

    // Inverse lookup: to -> from
    const inverse = queryOne<ExchangeRate>(
      `SELECT rate FROM exchange_rates 
       WHERE company_id = ? AND from_currency = ? AND to_currency = ? AND effective_date <= ? 
       ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
      [companyId, to, from, date]
    );

    if (inverse && inverse.rate > 0) {
      return SafeMoney.round(1 / inverse.rate, 6);
    }

    // Triangular arbitrage lookup via base currency if neither direct nor inverse was found
    const base = this.getBaseCurrency(companyId).code;
    if (from !== base && to !== base) {
      const fromToBase = this.getExchangeRate(companyId, from, base, date);
      const toToBase = this.getExchangeRate(companyId, to, base, date);
      if (toToBase > 0) {
        return SafeMoney.round(fromToBase / toToBase, 6);
      }
    }

    return 1.0; // Default fallback
  }

  public static addExchangeRate(companyId: string, data: { from_currency: string; to_currency: string; rate: number; effective_date?: string; source?: string }): ExchangeRate {
    const id = crypto.randomUUID();
    const date = data.effective_date || new Date().toISOString().slice(0, 10);
    const source = data.source || 'manual';

    execute(
      `INSERT INTO exchange_rates (id, company_id, from_currency, to_currency, rate, effective_date, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, companyId, data.from_currency.toUpperCase(), data.to_currency.toUpperCase(), data.rate, date, source]
    );

    return queryOne<ExchangeRate>(`SELECT * FROM exchange_rates WHERE id = ?`, [id])!;
  }

  public static getExchangeRatesHistory(companyId: string, limit: number = 100): ExchangeRate[] {
    return queryAll<ExchangeRate>(
      `SELECT * FROM exchange_rates WHERE company_id = ? ORDER BY effective_date DESC, created_at DESC LIMIT ?`,
      [companyId, limit]
    );
  }
}
