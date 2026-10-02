import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'storage', 'apexfinance.sqlite');

// Ensure directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// Optimize database for ACID transactions & integrity
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

/**
 * Initialize all database tables with strict schema matching PostgreSQL specification
 */
export function initDatabase() {
  db.exec(`
    -- 1. Companies
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_registration_number TEXT,
      tax_identification_number TEXT,
      address TEXT,
      country TEXT DEFAULT 'Ghana',
      state TEXT,
      city TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      default_currency TEXT NOT NULL DEFAULT 'GHS',
      fiscal_year_start TEXT DEFAULT '01-01',
      invoice_prefix TEXT DEFAULT 'INV-',
      invoice_number_format TEXT DEFAULT 'INV-{YYYY}-{SEQ:4}',
      default_payment_terms INTEGER DEFAULT 30,
      bank_details TEXT DEFAULT '{}',
      payment_instructions TEXT,
      logo_url TEXT,
      primary_color TEXT DEFAULT '#0284c7',
      secondary_color TEXT DEFAULT '#0f172a',
      invoice_theme TEXT DEFAULT 'modern',
      email_branding TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      full_name TEXT NOT NULL,
      avatar_url TEXT,
      is_superadmin INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. Roles
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 4. Permissions
    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT
    );

    -- 5. Role Permissions
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    -- 6. Company Users
    CREATE TABLE IF NOT EXISTS company_users (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, user_id)
    );

    -- 7. Currencies
    CREATE TABLE IF NOT EXISTS currencies (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      decimal_precision INTEGER DEFAULT 2,
      is_active INTEGER DEFAULT 1,
      is_base INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, code)
    );

    -- 8. Exchange Rates
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      effective_date TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 9. Tax Rates
    CREATE TABLE IF NOT EXISTS tax_rates (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      percentage REAL NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 10. Clients
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      country TEXT,
      tax_id TEXT,
      preferred_currency TEXT NOT NULL DEFAULT 'USD',
      payment_terms INTEGER DEFAULT 30,
      notes TEXT,
      status TEXT DEFAULT 'active',
      total_invoiced REAL DEFAULT 0,
      total_paid REAL DEFAULT 0,
      outstanding_balance REAL DEFAULT 0,
      overdue_balance REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 11. Invoice Templates
    CREATE TABLE IF NOT EXISTS invoice_templates (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      primary_color TEXT DEFAULT '#0284c7',
      secondary_color TEXT DEFAULT '#0f172a',
      font_family TEXT DEFAULT 'Inter',
      layout_style TEXT DEFAULT 'modern',
      show_logo INTEGER DEFAULT 1,
      show_tax_breakdown INTEGER DEFAULT 1,
      payment_instructions TEXT,
      custom_notes TEXT,
      custom_css TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 12. Invoices
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      template_id TEXT REFERENCES invoice_templates(id) ON DELETE SET NULL,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL DEFAULT 1.0,
      base_currency TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_type TEXT DEFAULT 'none',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      base_currency_total REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'Draft',
      notes TEXT,
      terms TEXT,
      sent_at TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, invoice_number)
    );

    -- 13. Invoice Items
    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount_percent REAL DEFAULT 0,
      tax_rate_id TEXT REFERENCES tax_rates(id) ON DELETE SET NULL,
      tax_rate_percentage REAL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL,
      line_order INTEGER DEFAULT 0
    );

    -- 14. Payments
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      payment_number TEXT NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL DEFAULT 1.0,
      base_currency_amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      reference_number TEXT,
      notes TEXT,
      status TEXT DEFAULT 'Completed',
      reversal_reason TEXT,
      reversed_at TEXT,
      recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, payment_number)
    );

    -- 15. Payment Allocations
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount_allocated REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 16. Expense Categories
    CREATE TABLE IF NOT EXISTS expense_categories (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      is_system INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, name)
    );

    -- 17. Expenses
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES expense_categories(id) ON DELETE SET NULL,
      vendor TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL DEFAULT 1.0,
      base_currency_amount REAL NOT NULL,
      tax_amount REAL DEFAULT 0,
      expense_date TEXT NOT NULL,
      payment_method TEXT DEFAULT 'Bank Transfer',
      reference_number TEXT,
      notes TEXT,
      receipt_url TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 18. Revenues
    CREATE TABLE IF NOT EXISTS revenues (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL DEFAULT 'Invoice Payment',
      client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL DEFAULT 1.0,
      base_currency_amount REAL NOT NULL,
      revenue_date TEXT NOT NULL,
      payment_method TEXT DEFAULT 'Bank Transfer',
      reference_number TEXT,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 19. General Financial Transactions (Unified Ledger)
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      transaction_type TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL DEFAULT 1.0,
      base_currency_amount REAL NOT NULL,
      transaction_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 20. Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 21. Audit Logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT,
      user_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      previous_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- 22. Company Settings
    CREATE TABLE IF NOT EXISTS company_settings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      setting_value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, setting_key)
    );

    -- 23. Payment Note Templates (Customizable notes and split presets)
    CREATE TABLE IF NOT EXISTS payment_note_templates (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      split_ratio REAL DEFAULT NULL,
      is_system INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Ensure default user placeholder exists for default unauthenticated API operations
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, is_superadmin, status)
    VALUES ('u_admin_default', 'admin@apexfin.com', 'seeded', 'seeded', 'Alexander Vance (Admin)', 1, 'active');
  `);

  // Safe schema migrations for existing SQLite databases
  ensureColumnExists('companies', 'status', "TEXT DEFAULT 'active'");
  ensureColumnExists('companies', 'subscription_plan', "TEXT DEFAULT 'professional'");
  ensureColumnExists('companies', 'created_by', 'TEXT');
  ensureColumnExists('company_users', 'invitation_status', "TEXT DEFAULT 'accepted'");
  ensureColumnExists('company_users', 'invited_by', 'TEXT');
  ensureColumnExists('company_users', 'joined_at', "TEXT");
}

function ensureColumnExists(table: string, column: string, definition: string) {
  try {
    const columns = queryAll(`PRAGMA table_info(${table})`);
    if (!columns.some((c: any) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch (e: any) {
    console.warn(`[Migration Warning] Could not add column ${column} to ${table}:`, e.message);
  }
}

/**
 * Execute an atomic transaction safely
 */
export function runTransaction<T>(action: () => T): T {
  db.exec('BEGIN TRANSACTION;');
  try {
    const result = action();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // ignore rollback error if already rolled back
    }
    throw error;
  }
}

/**
 * Helper to fetch all rows
 */
export function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  return stmt.all(...params) as T[];
}

/**
 * Helper to fetch one row
 */
export function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  const stmt = db.prepare(sql);
  const result = stmt.get(...params);
  return (result as T) || null;
}

/**
 * Helper to execute an insert / update / delete statement
 */
export function execute(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number | bigint } {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

/**
 * Helper to ensure foreign key values are valid IDs or null (preventing empty string or non-existent FK crashes)
 */
export function sanitizeFk(tableName: string, id: any): string | null {
  if (!id || typeof id !== 'string' || id.trim() === '' || id === 'null' || id === 'undefined') {
    return null;
  }
  const cleanId = id.trim();
  const row = queryOne(`SELECT id FROM ${tableName} WHERE id = ?`, [cleanId]);
  return row ? cleanId : null;
}

