import * as crypto from 'node:crypto';
import { initDatabase, queryOne, execute } from './database.ts';
import { seedDemoData, seedRolesAndPermissions } from './seed.ts';
import { hashPassword, verifyPassword } from '../utils/security.ts';
import { CompanyService } from '../services/companyService.ts';

/**
 * Demo mode seeds sample companies and users with published passwords, and shows
 * one-click demo logins on the sign-in page. It defaults ON in development and OFF in
 * production; set DEMO_MODE=true|false to override.
 */
export function isDemoMode(): boolean {
  if (process.env.DEMO_MODE === 'true') return true;
  if (process.env.DEMO_MODE === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Prepare the database at startup.
 * - Demo mode: schema + sample data (idempotent).
 * - Otherwise: schema + built-in roles, then on an empty database create the first
 *   platform administrator and company from ADMIN_* environment variables.
 */
export function initializeDatabase(): void {
  if (isDemoMode()) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Bootstrap] DEMO_MODE=true in production: demo accounts with public passwords are enabled.');
    }
    seedDemoData();
    return;
  }

  initDatabase();
  seedRolesAndPermissions();
  bootstrapFirstAdmin();
  warnAboutDemoAccounts();
}

function bootstrapFirstAdmin(): void {
  const userCount = queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)?.n || 0;
  if (userCount > 0) return;

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(
      'Empty database: set ADMIN_EMAIL (and optionally ADMIN_PASSWORD, ADMIN_NAME, ADMIN_COMPANY_NAME, ' +
      'ADMIN_COMPANY_CURRENCY) to create the first administrator, or set DEMO_MODE=true for sample data.'
    );
  }

  const providedPassword = process.env.ADMIN_PASSWORD || '';
  if (providedPassword && providedPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters (or leave it unset to generate one).');
  }
  const password = providedPassword || crypto.randomBytes(12).toString('base64url');
  const cred = hashPassword(password);
  const userId = crypto.randomUUID();

  // must_change_password = 1: the bootstrap password lives in env/logs, so it is rotated on first login
  execute(
    `INSERT INTO users (id, email, password_hash, salt, full_name, is_superadmin, status, must_change_password, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 'active', 1, datetime('now'))`,
    [userId, email, cred.hash, cred.salt, (process.env.ADMIN_NAME || 'Administrator').trim()]
  );

  const company = CompanyService.onboardCompany(userId, {
    name: (process.env.ADMIN_COMPANY_NAME || 'My Company').trim(),
    default_currency: (process.env.ADMIN_COMPANY_CURRENCY || 'USD').trim().toUpperCase()
  }).company;

  console.log('================================================================');
  console.log('[Bootstrap] Created the first administrator and company:');
  console.log(`  Admin:   ${email}`);
  console.log(`  Company: ${company.name} (${company.default_currency})`);
  if (!providedPassword) {
    console.log(`  Temporary password: ${password}`);
  }
  console.log('  You will be asked to choose a new password on first login.');
  console.log('================================================================');
}

/** Refuse to stay silent if a production database still contains the public demo accounts. */
function warnAboutDemoAccounts(): void {
  const demo = queryOne(`SELECT salt, password_hash FROM users WHERE email = 'admin@apexfin.com'`);
  if (demo && verifyPassword('admin123', demo.salt, demo.password_hash)) {
    console.warn('================================================================');
    console.warn('[Security] The demo account admin@apexfin.com still has its public password.');
    console.warn('  This database looks like demo data. Use a fresh database in production,');
    console.warn('  or change/disable the demo accounts immediately.');
    console.warn('================================================================');
  }
}
