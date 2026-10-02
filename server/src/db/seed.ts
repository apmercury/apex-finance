import { initDatabase, db, queryOne, queryAll, execute } from './database.ts';
import { hashPassword } from '../utils/security.ts';
import { CurrencyService } from '../services/currencyService.ts';
import { TaxService } from '../services/taxService.ts';
import { ClientService } from '../services/clientService.ts';
import { InvoiceService } from '../services/invoiceService.ts';
import { PaymentService } from '../services/paymentService.ts';
import { ExpenseService } from '../services/expenseService.ts';
import { TemplateService } from '../services/templateService.ts';
import * as crypto from 'node:crypto';

export function seedDemoData() {
  initDatabase();

  // Check if company exists
  const existingCompany = queryOne(`SELECT id FROM companies LIMIT 1`);
  if (existingCompany) {
    seedPermissionsAndSecondCompany();
    return existingCompany.id;
  }

  console.log('Seeding fresh demo data...');

  // 1. Roles & Permissions
  const adminRoleId = crypto.randomUUID();
  const financeRoleId = crypto.randomUUID();
  const staffRoleId = crypto.randomUUID();

  execute(`INSERT INTO roles (id, name, description) VALUES (?, 'Administrator', 'Full system access')`, [adminRoleId]);
  execute(`INSERT INTO roles (id, name, description) VALUES (?, 'Finance Manager', 'Finance, billing, payments, analytics access')`, [financeRoleId]);
  execute(`INSERT INTO roles (id, name, description) VALUES (?, 'Staff', 'Limited operational access')`, [staffRoleId]);

  // 2. Company Profile
  const companyId = 'comp_apex_01';
  execute(
    `INSERT INTO companies (
      id, name, business_registration_number, tax_identification_number, address,
      country, state, city, phone, email, website, default_currency, fiscal_year_start,
      invoice_prefix, invoice_number_format, default_payment_terms, bank_details,
      payment_instructions, primary_color, secondary_color, invoice_theme
    ) VALUES (
      ?, 'Apex Commercial Technologies Ltd', 'CS-2022-99881', 'TIN-GH-99827361',
      'Suite 500, Apex Financial Tower, Independence Ave', 'Ghana', 'Greater Accra', 'Accra',
      '+233 30 299 4400', 'contact@apextech.com', 'https://apextech.com', 'GHS', '01-01',
      'INV-', 'INV-{YYYY}-{SEQ:4}', 30,
      '{"bank_name":"Standard Chartered Bank","account_name":"Apex Commercial Technologies Ltd","account_number":"0100293847101","swift_code":"SCBLGHAC"}',
      'Please remit wire payments to our Standard Chartered account or Mobile Money merchant ID 449201. Quote invoice number as payment reference.',
      '#0284c7', '#0f172a', 'modern'
    )`,
    [companyId]
  );

  // 3. Users
  const adminCred = hashPassword('admin123');
  const adminUserId = crypto.randomUUID();
  execute(
    `INSERT INTO users (id, email, password_hash, salt, full_name, is_superadmin, status)
     VALUES (?, 'admin@apexfin.com', ?, ?, 'Alexander Vance (Admin)', 1, 'active')`,
    [adminUserId, adminCred.hash, adminCred.salt]
  );
  execute(
    `INSERT INTO company_users (id, company_id, user_id, role_id) VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), companyId, adminUserId, adminRoleId]
  );

  const financeCred = hashPassword('finance123');
  const financeUserId = crypto.randomUUID();
  execute(
    `INSERT INTO users (id, email, password_hash, salt, full_name, is_superadmin, status)
     VALUES (?, 'finance@apexfin.com', ?, ?, 'Kofi Mensah (Finance Mgr)', 0, 'active')`,
    [financeUserId, financeCred.hash, financeCred.salt]
  );
  execute(
    `INSERT INTO company_users (id, company_id, user_id, role_id) VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), companyId, financeUserId, financeRoleId]
  );

  const staffCred = hashPassword('staff123');
  const staffUserId = crypto.randomUUID();
  execute(
    `INSERT INTO users (id, email, password_hash, salt, full_name, is_superadmin, status)
     VALUES (?, 'staff@apexfin.com', ?, ?, 'Ama Osei (Staff)', 0, 'active')`,
    [staffUserId, staffCred.hash, staffCred.salt]
  );
  execute(
    `INSERT INTO company_users (id, company_id, user_id, role_id) VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), companyId, staffUserId, staffRoleId]
  );

  // 4. Currencies
  const currencies = [
    { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', is_base: 1, precision: 2 },
    { code: 'USD', name: 'US Dollar', symbol: '$', is_base: 0, precision: 2 },
    { code: 'EUR', name: 'Euro', symbol: '€', is_base: 0, precision: 2 },
    { code: 'GBP', name: 'British Pound', symbol: '£', is_base: 0, precision: 2 },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', is_base: 0, precision: 2 },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', is_base: 0, precision: 2 }
  ];

  for (const c of currencies) {
    execute(
      `INSERT INTO currencies (id, company_id, code, name, symbol, decimal_precision, is_active, is_base, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))`,
      [crypto.randomUUID(), companyId, c.code, c.name, c.symbol, c.precision, c.is_base]
    );
  }

  // 5. Exchange Rates (from currency -> base GHS)
  const exchangeRates = [
    { from: 'USD', to: 'GHS', rate: 15.20 },
    { from: 'EUR', to: 'GHS', rate: 16.50 },
    { from: 'GBP', to: 'GHS', rate: 19.30 },
    { from: 'NGN', to: 'GHS', rate: 0.010 },
    { from: 'CAD', to: 'GHS', rate: 11.10 }
  ];

  for (const er of exchangeRates) {
    CurrencyService.addExchangeRate(companyId, {
      from_currency: er.from,
      to_currency: er.to,
      rate: er.rate,
      effective_date: new Date().toISOString().slice(0, 10),
      source: 'Central Bank Fixing'
    });
  }

  // 6. Tax Rates
  TaxService.createTaxRate(companyId, { name: 'Standard VAT', code: 'VAT-15', percentage: 15.0, description: 'Standard Value Added Tax 15%' });
  TaxService.createTaxRate(companyId, { name: 'NHIL & GETFund', code: 'NHIL-5', percentage: 5.0, description: 'Health & Education Levies' });
  TaxService.createTaxRate(companyId, { name: 'COVID-19 Levy', code: 'COVID-1', percentage: 1.0, description: 'Recovery Levy 1%' });
  TaxService.createTaxRate(companyId, { name: 'Zero Rated Tax', code: 'ZERO-0', percentage: 0.0, description: 'Zero Rated for Export of Services' });

  // 7. Expense Categories
  const categories = [
    'Salaries & Wages', 'Office Rent', 'Cloud Software & SaaS', 'Marketing & Advertising',
    'Hardware & Equipment', 'Utilities & Internet', 'Professional Services', 'Travel & Transportation',
    'Taxes & Regulatory', 'General Operations'
  ];

  for (const catName of categories) {
    execute(
      `INSERT INTO expense_categories (id, company_id, name, description, is_system, created_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'))`,
      [crypto.randomUUID(), companyId, catName, `Category for ${catName}`]
    );
  }

  // 8. Invoice Templates
  TemplateService.createTemplate(companyId, {
    name: 'Executive Modern (Default)',
    is_default: true,
    primary_color: '#0284c7',
    secondary_color: '#0f172a',
    font_family: 'Inter, sans-serif',
    layout_style: 'modern',
    payment_instructions: 'Please wire funds directly to our Standard Chartered account or pay via Mobile Money.',
    custom_notes: 'Apex Commercial Technologies appreciates your partnership.'
  });

  TemplateService.createTemplate(companyId, {
    name: 'Corporate Slate',
    is_default: false,
    primary_color: '#475569',
    secondary_color: '#1e293b',
    font_family: 'Roboto, sans-serif',
    layout_style: 'corporate',
    payment_instructions: 'Remittance notice required upon payment transmission.',
    custom_notes: 'All disputes must be registered within 14 calendar days.'
  });

  // 9. Clients
  const clientAtlas = ClientService.createClient(companyId, {
    company_name: 'Atlas Cloud Systems Ltd',
    contact_person: 'Sarah Jenkins',
    email: 'billing@atlascloud.io',
    phone: '+1 415 555 0199',
    address: '450 Mission St, San Francisco, CA',
    country: 'United States',
    tax_id: 'US-EIN-9482019',
    preferred_currency: 'USD',
    payment_terms: 30
  }, adminUserId, 'Alexander Vance');

  const clientAccra = ClientService.createClient(companyId, {
    company_name: 'Accra Retail Ventures',
    contact_person: 'Kwame Mensah',
    email: 'accounts@accraretail.gh',
    phone: '+233 24 411 9900',
    address: 'Plot 12, Oxford Street, Osu, Accra',
    country: 'Ghana',
    tax_id: 'TIN-P00293810',
    preferred_currency: 'GHS',
    payment_terms: 14
  }, adminUserId, 'Alexander Vance');

  const clientEuro = ClientService.createClient(companyId, {
    company_name: 'EuroTrans Logistics GmbH',
    contact_person: 'Hans Becker',
    email: 'finance@eurotrans.de',
    phone: '+49 30 901820',
    address: 'Friedrichstraße 40, Berlin',
    country: 'Germany',
    tax_id: 'DE-VAT-83920192',
    preferred_currency: 'EUR',
    payment_terms: 45
  }, adminUserId, 'Alexander Vance');

  const clientLagos = ClientService.createClient(companyId, {
    company_name: 'Lagos Digital Dynamics',
    contact_person: 'Olufemi Adeleke',
    email: 'payments@lagosdigital.ng',
    phone: '+234 1 882 9900',
    address: 'Victoria Island, Lagos',
    country: 'Nigeria',
    tax_id: 'NG-TIN-882910',
    preferred_currency: 'NGN',
    payment_terms: 30
  }, adminUserId, 'Alexander Vance');

  // 10. Invoices with varied statuses
  const vatTax = queryOne(`SELECT id FROM tax_rates WHERE company_id = ? AND code = 'VAT-15'`, [companyId]);
  const zeroTax = queryOne(`SELECT id FROM tax_rates WHERE company_id = ? AND code = 'ZERO-0'`, [companyId]);

  // Invoice 1: Fully Paid (USD)
  const inv1 = InvoiceService.createInvoice({
    company_id: companyId,
    client_id: clientAtlas.id,
    issue_date: '2026-08-01',
    due_date: '2026-08-31',
    currency: 'USD',
    exchange_rate: 15.20,
    items: [
      { description: 'Cloud Architecture & Security Audit', quantity: 1, unit_price: 6000, tax_rate_id: zeroTax?.id },
      { description: 'High Availability Deployment Implementation', quantity: 1, unit_price: 2000, tax_rate_id: zeroTax?.id }
    ],
    notes: 'Completed milestone audit and rollout',
    user_id: adminUserId,
    user_name: 'Alexander Vance'
  });

  PaymentService.recordPayment({
    company_id: companyId,
    client_id: clientAtlas.id,
    invoice_id: inv1.id,
    amount: 8000,
    currency: 'USD',
    exchange_rate: 15.20,
    payment_date: '2026-08-15',
    payment_method: 'Bank Transfer',
    reference_number: 'SWIFT-WIRE-88910',
    notes: 'Full payment via wire transfer',
    user_id: adminUserId,
    user_name: 'Alexander Vance',
    user_role: 'Administrator'
  });

  // Invoice 2: Partially Paid (GHS)
  const inv2 = InvoiceService.createInvoice({
    company_id: companyId,
    client_id: clientAccra.id,
    issue_date: '2026-09-01',
    due_date: '2026-10-15',
    currency: 'GHS',
    exchange_rate: 1.0,
    items: [
      { description: 'Custom ERP POS Integration', quantity: 1, unit_price: 45000, tax_rate_id: vatTax?.id },
      { description: 'Barcode Scanner API Gateway & Licenses', quantity: 5, unit_price: 2000, tax_rate_id: vatTax?.id }
    ],
    notes: '50% deposit paid upon project initiation',
    user_id: financeUserId,
    user_name: 'Kofi Mensah'
  });

  PaymentService.recordPayment({
    company_id: companyId,
    client_id: clientAccra.id,
    invoice_id: inv2.id,
    amount: 30000,
    currency: 'GHS',
    exchange_rate: 1.0,
    payment_date: '2026-09-05',
    payment_method: 'Mobile Money',
    reference_number: 'MTN-MM-9928192',
    notes: 'First tranche initial deposit',
    user_id: financeUserId,
    user_name: 'Kofi Mensah',
    user_role: 'Finance Manager'
  });

  // Invoice 3: Overdue (EUR)
  const inv3 = InvoiceService.createInvoice({
    company_id: companyId,
    client_id: clientEuro.id,
    issue_date: '2026-07-01',
    due_date: '2026-08-15', // Past due date!
    currency: 'EUR',
    exchange_rate: 16.50,
    items: [
      { description: 'European Route Fleet Telematics Integration', quantity: 1, unit_price: 12000, tax_rate_id: zeroTax?.id }
    ],
    notes: 'Urgent: Payment past due term',
    user_id: adminUserId,
    user_name: 'Alexander Vance'
  });
  // Check that its status automatically calculates to 'Overdue'
  InvoiceService.updateInvoiceStatus(companyId, inv3.id, 'Overdue');

  // Invoice 4: Unpaid (recent)
  const inv4 = InvoiceService.createInvoice({
    company_id: companyId,
    client_id: clientAtlas.id,
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    currency: 'USD',
    exchange_rate: 15.20,
    items: [
      { description: 'Managed Cloud Infrastructure Retainer - Q4', quantity: 3, unit_price: 4000, tax_rate_id: zeroTax?.id }
    ],
    notes: 'Quarterly recurring maintenance retainer',
    user_id: adminUserId,
    user_name: 'Alexander Vance'
  });

  // 11. Expenses across categories
  const catSalaries = queryOne(`SELECT id FROM expense_categories WHERE company_id = ? AND name = 'Salaries & Wages'`, [companyId]);
  const catSoftware = queryOne(`SELECT id FROM expense_categories WHERE company_id = ? AND name = 'Cloud Software & SaaS'`, [companyId]);
  const catRent = queryOne(`SELECT id FROM expense_categories WHERE company_id = ? AND name = 'Office Rent'`, [companyId]);
  const catMarketing = queryOne(`SELECT id FROM expense_categories WHERE company_id = ? AND name = 'Marketing & Advertising'`, [companyId]);

  ExpenseService.createExpense({
    company_id: companyId,
    category_id: catSalaries?.id,
    vendor: 'Apex Staff Payroll',
    description: 'Engineering and Product Team Payroll for August',
    amount: 42000,
    currency: 'GHS',
    exchange_rate: 1.0,
    expense_date: '2026-08-28',
    payment_method: 'Bank Transfer',
    reference_number: 'PAYROLL-2026-08',
    user_id: adminUserId,
    user_name: 'Alexander Vance'
  });

  ExpenseService.createExpense({
    company_id: companyId,
    category_id: catSoftware?.id,
    vendor: 'Amazon Web Services Inc.',
    description: 'AWS Production Cloud Compute and Database hosting',
    amount: 1450,
    currency: 'USD',
    exchange_rate: 15.20,
    expense_date: '2026-09-02',
    payment_method: 'Card',
    reference_number: 'AWS-INV-778291',
    user_id: financeUserId,
    user_name: 'Kofi Mensah'
  });

  ExpenseService.createExpense({
    company_id: companyId,
    category_id: catRent?.id,
    vendor: 'Independence Heights Property Mgmt',
    description: 'Quarterly Office Lease - Independence Avenue Accra',
    amount: 18000,
    currency: 'GHS',
    exchange_rate: 1.0,
    expense_date: '2026-09-01',
    payment_method: 'Cheque',
    reference_number: 'CHQ-88291',
    user_id: financeUserId,
    user_name: 'Kofi Mensah'
  });

  ExpenseService.createExpense({
    company_id: companyId,
    category_id: catMarketing?.id,
    vendor: 'Google Ads & LinkedIn Media',
    description: 'B2B Enterprise Lead Acquisition Campaigns',
    amount: 850,
    currency: 'USD',
    exchange_rate: 15.20,
    expense_date: '2026-09-10',
    payment_method: 'Card',
    reference_number: 'GGL-99281',
    user_id: staffUserId,
    user_name: 'Ama Osei'
  });

  seedPermissionsAndSecondCompany();

  console.log('Seed demo data completed successfully!');
  return companyId;
}

export function seedPermissionsAndSecondCompany() {
  // 1. Roles & Permissions
  const roles = queryAll(`SELECT id, name FROM roles`);
  let adminRole = roles.find(r => r.name === 'Administrator');
  let financeRole = roles.find(r => r.name === 'Finance Manager');
  let staffRole = roles.find(r => r.name === 'Staff');

  if (!adminRole) {
    const id = crypto.randomUUID();
    execute(`INSERT INTO roles (id, name, description) VALUES (?, 'Administrator', 'Full system access')`, [id]);
    adminRole = { id, name: 'Administrator' };
  }
  if (!financeRole) {
    const id = crypto.randomUUID();
    execute(`INSERT INTO roles (id, name, description) VALUES (?, 'Finance Manager', 'Finance, billing, payments, analytics access')`, [id]);
    financeRole = { id, name: 'Finance Manager' };
  }
  if (!staffRole) {
    const id = crypto.randomUUID();
    execute(`INSERT INTO roles (id, name, description) VALUES (?, 'Staff', 'Limited operational access')`, [id]);
    staffRole = { id, name: 'Staff' };
  }

  const standardPermissions = [
    { name: 'companies:read', resource: 'companies', action: 'read', description: 'View company settings' },
    { name: 'companies:write', resource: 'companies', action: 'write', description: 'Update company settings' },
    { name: 'users:read', resource: 'users', action: 'read', description: 'View company users' },
    { name: 'users:invite', resource: 'users', action: 'invite', description: 'Invite users to company' },
    { name: 'users:manage', resource: 'users', action: 'manage', description: 'Manage user roles and remove users' },
    { name: 'clients:read', resource: 'clients', action: 'read', description: 'View clients' },
    { name: 'clients:write', resource: 'clients', action: 'write', description: 'Create and update clients' },
    { name: 'clients:delete', resource: 'clients', action: 'delete', description: 'Delete or archive clients' },
    { name: 'invoices:read', resource: 'invoices', action: 'read', description: 'View invoices' },
    { name: 'invoices:write', resource: 'invoices', action: 'write', description: 'Create and send invoices' },
    { name: 'invoices:delete', resource: 'invoices', action: 'delete', description: 'Cancel or delete invoices' },
    { name: 'payments:read', resource: 'payments', action: 'read', description: 'View payments' },
    { name: 'payments:write', resource: 'payments', action: 'write', description: 'Record payments' },
    { name: 'payments:reverse', resource: 'payments', action: 'reverse', description: 'Reverse payments' },
    { name: 'payments:override_overpayment', resource: 'payments', action: 'override_overpayment', description: 'Authorize overpayment' },
    { name: 'expenses:read', resource: 'expenses', action: 'read', description: 'View expenses' },
    { name: 'expenses:write', resource: 'expenses', action: 'write', description: 'Record expenses' },
    { name: 'expenses:delete', resource: 'expenses', action: 'delete', description: 'Delete expenses' },
    { name: 'revenue:read', resource: 'revenue', action: 'read', description: 'View revenue streams' },
    { name: 'reports:read', resource: 'reports', action: 'read', description: 'View financial reports' },
    { name: 'templates:read', resource: 'templates', action: 'read', description: 'View invoice templates' },
    { name: 'templates:write', resource: 'templates', action: 'write', description: 'Modify invoice templates' },
    { name: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs' }
  ];

  for (const p of standardPermissions) {
    const existing = queryOne(`SELECT id FROM permissions WHERE name = ?`, [p.name]);
    const permId = existing ? existing.id : crypto.randomUUID();
    if (!existing) {
      execute(`INSERT INTO permissions (id, name, resource, action, description) VALUES (?, ?, ?, ?, ?)`,
        [permId, p.name, p.resource, p.action, p.description]);
    }
    execute(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [adminRole.id, permId]);
    if (!['companies:write', 'users:manage', 'clients:delete', 'expenses:delete', 'templates:write'].includes(p.name)) {
      execute(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [financeRole.id, permId]);
    }
    if (['clients:read', 'invoices:read', 'payments:read', 'expenses:read', 'expenses:write', 'reports:read'].includes(p.name)) {
      execute(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [staffRole.id, permId]);
    }
  }

  // 2. Check Second Company
  const comp2Id = 'comp_stellar_02';
  const existingComp2 = queryOne(`SELECT id FROM companies WHERE id = ?`, [comp2Id]);
  if (!existingComp2) {
    execute(
      `INSERT INTO companies (
        id, name, business_registration_number, tax_identification_number, address,
        country, state, city, phone, email, website, default_currency, fiscal_year_start,
        invoice_prefix, invoice_number_format, default_payment_terms, bank_details,
        payment_instructions, primary_color, secondary_color, invoice_theme, status, subscription_plan
      ) VALUES (
        ?, 'Stellar Maritime & Logistics LLC', 'DE-CORP-48821', 'US-EIN-12938471',
        'Pier 39, Embarcadero Way', 'United States', 'California', 'San Francisco',
        '+1 415 882 1000', 'billing@stellarmaritime.com', 'https://stellarmaritime.com', 'USD', '01-01',
        'STM-', 'STM-{YYYY}-{SEQ:4}', 30,
        '{"bank_name":"JPMorgan Chase Bank","account_name":"Stellar Maritime & Logistics LLC","account_number":"4492810029","routing_number":"021000021"}',
        'Wire transfer remittance to JPMorgan Chase Bank. Quote invoice number on payment.',
        '#0d9488', '#0f172a', 'corporate', 'active', 'enterprise'
      )`,
      [comp2Id]
    );

    // Users
    const sarahCred = hashPassword('sarah123');
    let sarahUser = queryOne(`SELECT id FROM users WHERE email = 'sarah@stellarmaritime.com'`);
    if (!sarahUser) {
      const sId = crypto.randomUUID();
      execute(
        `INSERT INTO users (id, email, password_hash, salt, full_name, is_superadmin, status)
         VALUES (?, 'sarah@stellarmaritime.com', ?, ?, 'Sarah Jenkins (Director)', 0, 'active')`,
        [sId, sarahCred.hash, sarahCred.salt]
      );
      sarahUser = { id: sId };
    }

    // Sarah is Administrator of Company 2
    execute(
      `INSERT OR IGNORE INTO company_users (id, company_id, user_id, role_id, is_active, invitation_status, joined_at)
       VALUES (?, ?, ?, ?, 1, 'accepted', datetime('now'))`,
      [crypto.randomUUID(), comp2Id, sarahUser.id, adminRole.id]
    );

    // Alexander Vance (Admin of Company 1) is Finance Manager of Company 2!
    const alexUser = queryOne(`SELECT id FROM users WHERE email = 'admin@apexfin.com'`);
    if (alexUser) {
      execute(
        `INSERT OR IGNORE INTO company_users (id, company_id, user_id, role_id, is_active, invitation_status, joined_at)
         VALUES (?, ?, ?, ?, 1, 'accepted', datetime('now'))`,
        [crypto.randomUUID(), comp2Id, alexUser.id, financeRole.id]
      );
    }

    // Currencies for Company 2
    const currenciesComp2 = [
      { code: 'USD', name: 'US Dollar', symbol: '$', is_base: 1, precision: 2 },
      { code: 'EUR', name: 'Euro', symbol: '€', is_base: 0, precision: 2 },
      { code: 'GBP', name: 'British Pound', symbol: '£', is_base: 0, precision: 2 },
      { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', is_base: 0, precision: 2 }
    ];
    for (const c of currenciesComp2) {
      execute(
        `INSERT OR IGNORE INTO currencies (id, company_id, code, name, symbol, decimal_precision, is_active, is_base)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [crypto.randomUUID(), comp2Id, c.code, c.name, c.symbol, c.precision, c.is_base]
      );
    }

    CurrencyService.addExchangeRate(comp2Id, { from_currency: 'EUR', to_currency: 'USD', rate: 1.08, effective_date: new Date().toISOString().slice(0, 10), source: 'Fed Fixing' });
    CurrencyService.addExchangeRate(comp2Id, { from_currency: 'GBP', to_currency: 'USD', rate: 1.28, effective_date: new Date().toISOString().slice(0, 10), source: 'Fed Fixing' });

    // Tax Rates
    TaxService.createTaxRate(comp2Id, { name: 'US State Sales Tax', code: 'SALES-8', percentage: 8.25, description: 'California State Tax' });
    TaxService.createTaxRate(comp2Id, { name: 'Exempt Port Surcharge', code: 'EXEMPT-0', percentage: 0.0, description: 'International Waters Freight' });

    // Expense Categories
    const categoriesComp2 = ['Vessel Fuel & Bunkers', 'Port & Dockage Fees', 'Crew Payroll', 'Equipment Maintenance', 'Marine Insurance'];
    for (const cat of categoriesComp2) {
      execute(
        `INSERT OR IGNORE INTO expense_categories (id, company_id, name, description, is_system)
         VALUES (?, ?, ?, ?, 1)`,
        [crypto.randomUUID(), comp2Id, cat, cat]
      );
    }

    // Template
    TemplateService.createTemplate(comp2Id, {
      name: 'Maritime Slate (Default)',
      is_default: true,
      primary_color: '#0d9488',
      secondary_color: '#0f172a',
      font_family: 'Roboto, sans-serif',
      layout_style: 'corporate',
      payment_instructions: 'Payment terms net 30 via JPMorgan Chase wire transfer.',
      custom_notes: 'Stellar Maritime appreciates your maritime partnership.'
    });

    // Clients
    const clientPacific = ClientService.createClient(comp2Id, {
      company_name: 'Pacific Freightways Corp',
      contact_person: 'Captain Robert Vance',
      email: 'logistics@pacificfreight.com',
      phone: '+1 206 555 0142',
      address: 'Port of Seattle Pier 66, Seattle, WA',
      country: 'United States',
      tax_id: 'US-WA-992810',
      preferred_currency: 'USD',
      payment_terms: 30
    }, sarahUser.id, 'Sarah Jenkins');

    const clientTokyo = ClientService.createClient(comp2Id, {
      company_name: 'Tokyo Marine Lines KK',
      contact_person: 'Kenji Takahashi',
      email: 'finance@tokyomarine.jp',
      phone: '+81 3 5555 0199',
      address: 'Chiyoda-ku, Tokyo, Japan',
      country: 'Japan',
      tax_id: 'JP-TIN-881920',
      preferred_currency: 'USD',
      payment_terms: 45
    }, sarahUser.id, 'Sarah Jenkins');

    // Invoices for Company 2
    const inv1 = InvoiceService.createInvoice({
      company_id: comp2Id,
      client_id: clientPacific.id,
      issue_date: '2026-08-10',
      due_date: '2026-09-10',
      currency: 'USD',
      exchange_rate: 1.0,
      items: [
        { description: 'Trans-Pacific Container Freight Charter (40ft High Cube x 10)', quantity: 10, unit_price: 2500 }
      ],
      notes: 'Completed vessel voyage V-408',
      user_id: sarahUser.id,
      user_name: 'Sarah Jenkins'
    });

    PaymentService.recordPayment({
      company_id: comp2Id,
      client_id: clientPacific.id,
      invoice_id: inv1.id,
      amount: 25000,
      currency: 'USD',
      exchange_rate: 1.0,
      payment_date: '2026-08-25',
      payment_method: 'Bank Transfer',
      reference_number: 'JPMC-WIRE-99210',
      notes: 'Settled in full via wire',
      user_id: sarahUser.id,
      user_name: 'Sarah Jenkins',
      user_role: 'Administrator'
    });

    InvoiceService.createInvoice({
      company_id: comp2Id,
      client_id: clientTokyo.id,
      issue_date: '2026-09-15',
      due_date: '2026-10-30',
      currency: 'USD',
      exchange_rate: 1.0,
      items: [
        { description: 'Harbor Tug Assist & Pilotage Services', quantity: 2, unit_price: 7250 }
      ],
      notes: 'Berthing and departure escort services',
      user_id: sarahUser.id,
      user_name: 'Sarah Jenkins'
    });

    const bunkerCat = queryOne(`SELECT id FROM expense_categories WHERE company_id = ? AND name = 'Vessel Fuel & Bunkers'`, [comp2Id]);
    ExpenseService.createExpense({
      company_id: comp2Id,
      category_id: bunkerCat?.id,
      vendor: 'Chevron Marine Fuel Supply',
      description: 'Low-Sulfur Marine Gas Oil (LSMGO) 25 Metric Tons',
      amount: 14200,
      currency: 'USD',
      exchange_rate: 1.0,
      expense_date: '2026-09-02',
      payment_method: 'Bank Transfer',
      reference_number: 'CHV-MGO-8819',
      user_id: sarahUser.id,
      user_name: 'Sarah Jenkins'
    });
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedDemoData();
}
