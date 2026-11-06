import { queryOne } from '../db/database.ts';

/**
 * Input validation helpers for financial records. Each throws an Error with a
 * user-facing message; routes turn these into 400 responses.
 */

/** True for a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function requireIsoDate(value: unknown, field: string): string {
  if (!isIsoDate(value)) throw new Error(`${field} must be a valid date (YYYY-MM-DD)`);
  return value;
}

/** Parse a finite number, rejecting NaN, Infinity, empty strings and non-numeric input. */
export function toFiniteNumber(value: unknown, field: string): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`${field} is required`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  return n;
}

export function requireNumberInRange(value: unknown, field: string, min: number, max: number, opts: { minExclusive?: boolean } = {}): number {
  const n = toFiniteNumber(value, field);
  const tooLow = opts.minExclusive ? n <= min : n < min;
  if (tooLow || n > max) {
    throw new Error(`${field} must be ${opts.minExclusive ? 'greater than' : 'at least'} ${min}${max !== Number.MAX_SAFE_INTEGER ? ` and at most ${max}` : ''}`);
  }
  return n;
}

/** Exchange rates: optional, but when given must be a positive finite number. */
export function optionalExchangeRate(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return requireNumberInRange(value, 'Exchange rate', 0, 1e9, { minExclusive: true });
}

/** The currency must be configured and active for the company. Returns the normalized code. */
export function requireCompanyCurrency(companyId: string, currency: unknown): string {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!code) throw new Error('Currency is required');
  const row = queryOne(`SELECT is_active FROM currencies WHERE company_id = ? AND code = ?`, [companyId, code]);
  if (!row) throw new Error(`Currency ${code} is not configured for this company`);
  if (!row.is_active) throw new Error(`Currency ${code} is disabled for this company`);
  return code;
}

export const PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Card', 'Mobile Money', 'Cheque', 'Other'] as const;

export function requirePaymentMethod(value: unknown): string {
  if (typeof value !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(value)) {
    throw new Error(`Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`);
  }
  return value;
}

export function requireText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
  if (value.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return value.trim();
}
