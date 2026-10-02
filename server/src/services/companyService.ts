import { execute, queryAll, queryOne, runTransaction } from '../db/database.ts';
import { hashPassword, createToken } from '../utils/security.ts';
import { CurrencyService } from './currencyService.ts';
import { TaxService } from './taxService.ts';
import { TemplateService } from './templateService.ts';
import { AuditService } from './auditService.ts';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CompanyOnboardInput {
  name: string;
  business_registration_number?: string;
  tax_identification_number?: string;
  address?: string;
  country?: string;
  state?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  default_currency?: string;
  invoice_prefix?: string;
  invoice_number_format?: string;
  default_payment_terms?: number;
  bank_details?: string;
  payment_instructions?: string;
  primary_color?: string;
  secondary_color?: string;
  invoice_theme?: string;
}

export class CompanyService {
  /**
   * Get all companies an authenticated user belongs to
   */
  public static getUserCompanies(userId: string, isSuperAdmin: boolean = false): any[] {
    let sql = `
      SELECT 
        c.id, c.name, c.default_currency, c.country, c.city, c.logo_url,
        c.primary_color, c.status as company_status, c.created_at,
        r.name as role_name, cu.is_active as membership_active, cu.created_at as joined_at
      FROM company_users cu
      JOIN companies c ON cu.company_id = c.id
      JOIN roles r ON cu.role_id = r.id
      WHERE cu.user_id = ? AND cu.is_active = 1
      ORDER BY c.name ASC
    `;
    const companies = queryAll(sql, [userId]);

    // If superadmin, also include any company not explicitly joined
    if (isSuperAdmin) {
      const allCompanies = queryAll(`SELECT id, name, default_currency, country, city, logo_url, primary_color, status as company_status, created_at FROM companies ORDER BY name ASC`);
      for (const comp of allCompanies) {
        if (!companies.some((c: any) => c.id === comp.id)) {
          companies.push({
            ...comp,
            role_name: 'Platform Admin',
            membership_active: 1,
            joined_at: comp.created_at
          });
        }
      }
    }

    return companies;
  }

  /**
   * Switch the active company context and generate a fresh JWT token
   */
  public static switchCompany(userId: string, targetCompanyId: string, isSuperAdmin: boolean = false): { token: string; user: any; company: any } {
    const user = queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
    if (!user) throw new Error('User not found');

    const company = queryOne(`SELECT * FROM companies WHERE id = ?`, [targetCompanyId]);
    if (!company) throw new Error('Target company not found');

    let roleName = 'Staff';
    if (isSuperAdmin) {
      roleName = 'Administrator';
    } else {
      const membership = queryOne(
        `SELECT cu.*, r.name as role_name FROM company_users cu
         JOIN roles r ON cu.role_id = r.id
         WHERE cu.user_id = ? AND cu.company_id = ? AND cu.is_active = 1`,
        [userId, targetCompanyId]
      );
      if (!membership) {
        throw new Error('Access denied: You are not a member of this company');
      }
      roleName = membership.role_name;
    }

    const token = createToken({
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      role: roleName,
      companyId: company.id,
      companyName: company.name,
      isSuperAdmin
    });

    AuditService.log({
      companyId: company.id,
      userId: user.id,
      userName: user.full_name,
      userRole: roleName,
      action: 'COMPANY_SWITCHED',
      entityType: 'COMPANY',
      entityId: company.id,
      newValue: { activeCompany: company.name }
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: roleName,
        companyId: company.id,
        companyName: company.name,
        isSuperAdmin
      },
      company
    };
  }

  /**
   * Onboard a new company with isolated currencies, taxes, templates, and categories
   */
  public static onboardCompany(userId: string, data: CompanyOnboardInput): { company: any; token: string; user: any } {
    return runTransaction(() => {
      const user = queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
      if (!user) throw new Error('User not found');

      const companyId = 'comp_' + crypto.randomUUID().substring(0, 8);
      const baseCurrency = (data.default_currency || 'USD').toUpperCase().trim();
      const prefix = data.invoice_prefix || 'INV-';
      const numberFormat = data.invoice_number_format || `${prefix}{YYYY}-{SEQ:4}`;

      // 1. Create Company
      execute(
        `INSERT INTO companies (
          id, name, business_registration_number, tax_identification_number, address,
          country, state, city, phone, email, website, default_currency, invoice_prefix,
          invoice_number_format, default_payment_terms, bank_details, payment_instructions,
          primary_color, secondary_color, invoice_theme, status, subscription_plan, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'professional', ?, datetime('now'), datetime('now'))`,
        [
          companyId,
          data.name.trim(),
          data.business_registration_number || '',
          data.tax_identification_number || '',
          data.address || '',
          data.country || 'United States',
          data.state || '',
          data.city || '',
          data.phone || '',
          data.email || user.email,
          data.website || '',
          baseCurrency,
          prefix,
          numberFormat,
          Number(data.default_payment_terms) || 30,
          data.bank_details || '{}',
          data.payment_instructions || 'Please remit payment as indicated on invoice.',
          data.primary_color || '#0284c7',
          data.secondary_color || '#0f172a',
          data.invoice_theme || 'modern',
          userId
        ]
      );

      // 2. Fetch or create Administrator role
      let adminRole = queryOne(`SELECT id FROM roles WHERE name = 'Administrator'`);
      if (!adminRole) {
        const roleId = crypto.randomUUID();
        execute(`INSERT INTO roles (id, name, description) VALUES (?, 'Administrator', 'Full system access')`, [roleId]);
        adminRole = { id: roleId };
      }

      // 3. Assign User as Company Admin
      execute(
        `INSERT INTO company_users (id, company_id, user_id, role_id, is_active, invitation_status, joined_at, created_at)
         VALUES (?, ?, ?, ?, 1, 'accepted', datetime('now'), datetime('now'))`,
        [crypto.randomUUID(), companyId, userId, adminRole.id]
      );

      // 4. Seed Standard Currencies for this new Company
      const standardCurrencies = [
        { code: 'USD', name: 'US Dollar', symbol: '$', is_base: baseCurrency === 'USD' ? 1 : 0 },
        { code: 'EUR', name: 'Euro', symbol: '€', is_base: baseCurrency === 'EUR' ? 1 : 0 },
        { code: 'GBP', name: 'British Pound', symbol: '£', is_base: baseCurrency === 'GBP' ? 1 : 0 },
        { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', is_base: baseCurrency === 'GHS' ? 1 : 0 },
        { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', is_base: baseCurrency === 'CAD' ? 1 : 0 },
        { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', is_base: baseCurrency === 'NGN' ? 1 : 0 }
      ];

      // If user provided a base currency not in standard list
      if (!standardCurrencies.some(c => c.code === baseCurrency)) {
        standardCurrencies.unshift({ code: baseCurrency, name: baseCurrency, symbol: baseCurrency + ' ', is_base: 1 });
      }

      for (const c of standardCurrencies) {
        execute(
          `INSERT INTO currencies (id, company_id, code, name, symbol, decimal_precision, is_active, is_base, created_at)
           VALUES (?, ?, ?, ?, ?, 2, 1, ?, datetime('now'))`,
          [crypto.randomUUID(), companyId, c.code, c.name, c.symbol, c.is_base]
        );
      }

      // Standard exchange rates relative to base
      for (const c of standardCurrencies) {
        if (!c.is_base) {
          execute(
            `INSERT INTO exchange_rates (id, company_id, from_currency, to_currency, rate, effective_date, source, created_at)
             VALUES (?, ?, ?, ?, 1.0, date('now'), 'Initial Setup', datetime('now'))`,
            [crypto.randomUUID(), companyId, c.code, baseCurrency]
          );
        }
      }

      // 5. Default Tax Rates
      TaxService.createTaxRate(companyId, { name: 'Standard Sales Tax / VAT', code: 'TAX-10', percentage: 10.0, description: 'Standard rate' });
      TaxService.createTaxRate(companyId, { name: 'Zero-Rated / Tax Exempt', code: 'ZERO-0', percentage: 0.0, description: 'Export or exempt services' });

      // 6. Default Expense Categories
      const categories = [
        'Salaries & Wages', 'Office Rent', 'Software & Subscriptions',
        'Marketing & Advertising', 'Utilities & Internet', 'Professional Services',
        'Travel & Transportation', 'General Operations'
      ];
      for (const catName of categories) {
        execute(
          `INSERT INTO expense_categories (id, company_id, name, description, is_system, created_at)
           VALUES (?, ?, ?, ?, 1, datetime('now'))`,
          [crypto.randomUUID(), companyId, catName, `Operational expense for ${catName}`]
        );
      }

      // 7. Default Invoice Template
      TemplateService.createTemplate(companyId, {
        name: 'Executive Modern (Default)',
        is_default: true,
        primary_color: data.primary_color || '#0284c7',
        secondary_color: data.secondary_color || '#0f172a',
        font_family: 'Inter, sans-serif',
        layout_style: 'modern',
        payment_instructions: data.payment_instructions || 'Please remit payment as indicated on invoice.',
        custom_notes: `Thank you for your business with ${data.name.trim()}!`
      });

      const newCompany = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);

      // Generate switched token
      const token = createToken({
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        role: 'Administrator',
        companyId: companyId,
        companyName: newCompany.name,
        isSuperAdmin: Boolean(user.is_superadmin)
      });

      AuditService.log({
        companyId,
        userId: user.id,
        userName: user.full_name,
        userRole: 'Administrator',
        action: 'COMPANY_ONBOARDED',
        entityType: 'COMPANY',
        entityId: companyId,
        newValue: { name: newCompany.name, currency: baseCurrency }
      });

      return {
        company: newCompany,
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: 'Administrator',
          companyId: companyId,
          companyName: newCompany.name,
          isSuperAdmin: Boolean(user.is_superadmin)
        }
      };
    });
  }

  /**
   * Get members of a company
   */
  public static getCompanyMembers(companyId: string): any[] {
    return queryAll(
      `SELECT cu.id as membership_id, cu.user_id, cu.role_id, cu.is_active, cu.invitation_status, cu.joined_at,
              u.email, u.full_name, u.avatar_url, u.status as user_status,
              r.name as role_name
       FROM company_users cu
       JOIN users u ON cu.user_id = u.id
       JOIN roles r ON cu.role_id = r.id
       WHERE cu.company_id = ?
       ORDER BY cu.joined_at ASC`,
      [companyId]
    );
  }

  /**
   * Invite or add a member to the company
   */
  public static inviteMember(companyId: string, inviter: { userId: string; userName: string }, data: { email: string; fullName: string; roleName: string }): any {
    return runTransaction(() => {
      const email = data.email.toLowerCase().trim();
      let user = queryOne(`SELECT * FROM users WHERE email = ?`, [email]);

      if (!user) {
        // Create user with default temporary credentials
        const cred = hashPassword('welcome123');
        const newUserId = crypto.randomUUID();
        execute(
          `INSERT INTO users (id, email, password_hash, salt, full_name, is_superadmin, status, created_at)
           VALUES (?, ?, ?, ?, ?, 0, 'active', datetime('now'))`,
          [newUserId, email, cred.hash, cred.salt, data.fullName.trim()]
        );
        user = queryOne(`SELECT * FROM users WHERE id = ?`, [newUserId]);
      }

      // Find role ID
      const targetRoleName = data.roleName || 'Staff';
      let role = queryOne(`SELECT id FROM roles WHERE name = ?`, [targetRoleName]);
      if (!role) {
        const roleId = crypto.randomUUID();
        execute(`INSERT INTO roles (id, name, description) VALUES (?, ?, 'User role')`, [roleId, targetRoleName]);
        role = { id: roleId };
      }

      // Check if membership already exists
      const existing = queryOne(
        `SELECT id, is_active FROM company_users WHERE company_id = ? AND user_id = ?`,
        [companyId, user.id]
      );

      if (existing) {
        execute(
          `UPDATE company_users SET role_id = ?, is_active = 1, invitation_status = 'accepted' WHERE id = ?`,
          [role.id, existing.id]
        );
      } else {
        execute(
          `INSERT INTO company_users (id, company_id, user_id, role_id, is_active, invitation_status, invited_by, joined_at, created_at)
           VALUES (?, ?, ?, ?, 1, 'accepted', ?, datetime('now'), datetime('now'))`,
          [crypto.randomUUID(), companyId, user.id, role.id, inviter.userId]
        );
      }

      AuditService.log({
        companyId,
        userId: inviter.userId,
        userName: inviter.userName,
        action: 'MEMBER_INVITED',
        entityType: 'COMPANY_USER',
        entityId: user.id,
        newValue: { email: user.email, fullName: user.full_name, role: targetRoleName }
      });

      return this.getCompanyMembers(companyId).find(m => m.user_id === user.id);
    });
  }

  /**
   * Update a member's role
   */
  public static updateMemberRole(companyId: string, actor: { userId: string; userName: string }, targetUserId: string, newRoleName: string): any {
    const role = queryOne(`SELECT id FROM roles WHERE name = ?`, [newRoleName]);
    if (!role) throw new Error(`Role "${newRoleName}" does not exist`);

    execute(
      `UPDATE company_users SET role_id = ? WHERE company_id = ? AND user_id = ?`,
      [role.id, companyId, targetUserId]
    );

    AuditService.log({
      companyId,
      userId: actor.userId,
      userName: actor.userName,
      action: 'MEMBER_ROLE_UPDATED',
      entityType: 'COMPANY_USER',
      entityId: targetUserId,
      newValue: { newRole: newRoleName }
    });

    return queryOne(
      `SELECT cu.*, r.name as role_name, u.full_name, u.email
       FROM company_users cu
       JOIN roles r ON cu.role_id = r.id
       JOIN users u ON cu.user_id = u.id
       WHERE cu.company_id = ? AND cu.user_id = ?`,
      [companyId, targetUserId]
    );
  }

  /**
   * Remove a member from the company
   */
  public static removeMember(companyId: string, actor: { userId: string; userName: string }, targetUserId: string): boolean {
    // Prevent removing the only Administrator
    const admins = queryAll(
      `SELECT cu.user_id FROM company_users cu
       JOIN roles r ON cu.role_id = r.id
       WHERE cu.company_id = ? AND r.name = 'Administrator' AND cu.is_active = 1`,
      [companyId]
    );

    if (admins.length <= 1 && admins[0]?.user_id === targetUserId) {
      throw new Error('Cannot remove the only Administrator of the company.');
    }

    execute(
      `DELETE FROM company_users WHERE company_id = ? AND user_id = ?`,
      [companyId, targetUserId]
    );

    AuditService.log({
      companyId,
      userId: actor.userId,
      userName: actor.userName,
      action: 'MEMBER_REMOVED',
      entityType: 'COMPANY_USER',
      entityId: targetUserId
    });

    return true;
  }

  /**
   * Platform Admin: Get all platform companies with summary statistics
   */
  public static getPlatformCompanies(): any[] {
    const sql = `
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM company_users cu WHERE cu.company_id = c.id AND cu.is_active = 1) as member_count,
        (SELECT COUNT(*) FROM clients cl WHERE cl.company_id = c.id) as client_count,
        (SELECT COUNT(*) FROM invoices inv WHERE inv.company_id = c.id) as invoice_count,
        (SELECT COALESCE(SUM(base_currency_amount), 0) FROM revenues rev WHERE rev.company_id = c.id) as total_revenue_base
      FROM companies c
      ORDER BY c.created_at DESC
    `;
    return queryAll(sql);
  }

  /**
   * Platform Admin: Toggle company status (active / suspended)
   */
  public static updateCompanyStatus(companyId: string, status: 'active' | 'suspended', actor: { userId: string; userName: string }): any {
    execute(
      `UPDATE companies SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, companyId]
    );

    AuditService.log({
      companyId,
      userId: actor.userId,
      userName: actor.userName,
      userRole: 'Platform Admin',
      action: 'PLATFORM_COMPANY_STATUS_UPDATED',
      entityType: 'COMPANY',
      entityId: companyId,
      newValue: { status }
    });

    return queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);
  }

  /**
   * Delete a company workspace and all associated tenant records
   */
  public static deleteCompany(companyId: string, actor: { userId: string; userName: string; isSuperAdmin: boolean }): boolean {
    return runTransaction(() => {
      const company = queryOne<{ id: string; name: string }>(`SELECT id, name FROM companies WHERE id = ?`, [companyId]);
      if (!company) throw new Error('Company workspace not found');

      // Check permissions: Actor must be platform superadmin or Administrator in that company
      if (!actor.isSuperAdmin) {
        const membership = queryOne<{ role_name: string }>(
          `SELECT r.name as role_name FROM company_users cu
           JOIN roles r ON cu.role_id = r.id
           WHERE cu.user_id = ? AND cu.company_id = ? AND cu.is_active = 1`,
          [actor.userId, companyId]
        );
        if (!membership || membership.role_name !== 'Administrator') {
          throw new Error('Only Company Administrators or Platform Superadmins can delete a company');
        }
      }

      // Safeguard: Never delete the last remaining company in the entire platform
      const totalCount = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM companies`);
      if ((totalCount?.count || 0) <= 1) {
        throw new Error('Cannot delete the only remaining company in the system');
      }

      // Cascade deletion across tenant tables
      execute(`DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE company_id = ?)`, [companyId]);
      execute(`DELETE FROM payments WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = ?)`, [companyId]);
      execute(`DELETE FROM invoices WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM clients WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM expenses WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM expense_categories WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM revenues WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM transactions WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM tax_rates WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM invoice_templates WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM exchange_rates WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM notifications WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM company_users WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM audit_logs WHERE company_id = ?`, [companyId]);
      execute(`DELETE FROM companies WHERE id = ?`, [companyId]);

      // Remove storage files if existing
      const companyStorage = path.join(process.cwd(), 'storage', companyId);
      if (fs.existsSync(companyStorage)) {
        try { fs.rmSync(companyStorage, { recursive: true, force: true }); } catch {}
      }

      return true;
    });
  }
}
