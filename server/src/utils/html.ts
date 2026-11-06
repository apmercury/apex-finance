/**
 * HTML output-encoding helpers for server-rendered documents (invoices, receipts, emails).
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/**
 * Return a copy of a DB record (or array of records) with every string value HTML-escaped.
 * Numbers, booleans and null are left untouched so arithmetic and formatting keep working.
 */
export function escapeDeep<T>(value: T): T {
  if (typeof value === 'string') return escapeHtml(value) as unknown as T;
  if (Array.isArray(value)) return value.map(v => escapeDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = escapeDeep(v);
    }
    return out as T;
  }
  return value;
}

/** Accept only hex colors (#rgb, #rrggbb, #rrggbbaa); otherwise use the fallback. */
export function safeCssColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
}

/** Accept only plain font-family lists (letters, digits, spaces, commas, quotes, hyphens). */
export function safeCssFontFamily(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[\w\s,'"-]{1,200}$/.test(value) ? value : fallback;
}

/**
 * Neutralise user-supplied CSS so it cannot break out of the <style> element
 * or pull remote resources. Rendering also blocks network requests as defence in depth.
 */
export function sanitizeCustomCss(css: unknown): string {
  if (typeof css !== 'string') return '';
  return css
    .replace(/</g, '')
    .replace(/@import/gi, '')
    .replace(/url\s*\(/gi, 'invalid(')
    .replace(/expression\s*\(/gi, 'invalid(');
}
