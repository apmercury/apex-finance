import { IncomingMessage, ServerResponse } from 'node:http';
import * as url from 'node:url';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { verifyPassword, createToken } from '../utils/security.ts';
import { queryOne, execute } from '../db/database.ts';
import { getAuthContext, hasRole, hasPermission } from '../middleware/auth.ts';
import { CompanyService } from '../services/companyService.ts';
import { CurrencyService } from '../services/currencyService.ts';
import { TaxService } from '../services/taxService.ts';
import { ClientService } from '../services/clientService.ts';
import { InvoiceService } from '../services/invoiceService.ts';
import { PaymentService } from '../services/paymentService.ts';
import { ExpenseService } from '../services/expenseService.ts';
import { RevenueService } from '../services/revenueService.ts';
import { ReportService } from '../services/reportService.ts';
import { DashboardService } from '../services/dashboardService.ts';
import { TemplateService } from '../services/templateService.ts';
import { PaymentNoteService } from '../services/paymentNoteService.ts';
import { PdfService } from '../services/pdfService.ts';
import { NotificationService } from '../services/notificationService.ts';
import { AuditService } from '../services/auditService.ts';
import { SearchService } from '../services/searchService.ts';
import { sseService } from '../services/sseService.ts';
import { EmailService } from '../services/emailService.ts';
import { FailureLimiter } from '../utils/rateLimit.ts';
import { hashPassword } from '../utils/security.ts';

// Helper to read JSON body
function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) { // 10MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// The SPA is served from the same origin, so cross-origin access is off unless
// CORS_ORIGIN explicitly names a trusted origin (e.g. a separately hosted frontend).
function corsHeaders(): Record<string, string> {
  const origin = process.env.CORS_ORIGIN;
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Vary': 'Origin'
  };
}

// JSON response helper
function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders()
  });
  res.end(JSON.stringify(data));
}

// Unexpected failures: log the detail server-side, never send internals to the client
function sendServerError(res: ServerResponse, error: unknown, publicMessage = 'Internal server error') {
  console.error('[API] Unhandled error:', error);
  sendJson(res, 500, { error: publicMessage });
}

// Brute-force protection: 5 failures per account+IP, 30 per IP, per 15 minutes
const loginFailuresByAccount = new FailureLimiter(5, 15 * 60 * 1000);
const loginFailuresByIp = new FailureLimiter(30, 15 * 60 * 1000);

function clientIp(req: IncomingMessage): string {
  // Only trust X-Forwarded-For when running behind a known reverse proxy
  if (process.env.TRUST_PROXY === 'true') {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function appBaseUrl(req: IncomingMessage): string {
  // Prefer the configured URL: the Host header is attacker-controlled and would end up in emailed links
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['host'] || 'localhost:3000';
  return `${host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'}://${host}`;
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsedUrl = url.parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '';
  const method = req.method?.toUpperCase() || 'GET';
  const query = parsedUrl.query;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return true;
  }

  // --- PUBLIC: health check (for container/orchestrator probes) ---
  if (pathname === '/api/health' && method === 'GET') {
    try {
      queryOne(`SELECT 1 AS ok`);
      sendJson(res, 200, { status: 'ok' });
    } catch {
      sendJson(res, 503, { status: 'unavailable' });
    }
    return true;
  }

  // --- PUBLIC: client configuration (demo logins appear only in demo mode) ---
  if (pathname === '/api/public-config' && method === 'GET') {
    sendJson(res, 200, isDemoMode()
      ? { demoMode: true, demoAccounts: DEMO_ACCOUNTS }
      : { demoMode: false });
    return true;
  }

  // --- REAL-TIME SSE BROADCAST ENDPOINT ---
  if (pathname === '/api/events') {
    const auth = getAuthContext(req);
    if (!auth) {
      sendJson(res, 401, { error: 'Authentication required' });
      return true;
    }
    sseService.registerClient(crypto.randomUUID(), auth.companyId, auth.userId, res);
    return true;
  }

  // --- 1. AUTHENTICATION & LOGIN ---
  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { email, password } = body;
      if (!email || !password) {
        sendJson(res, 400, { error: 'Email and password required' });
        return true;
      }

      const normalizedEmail = String(email).toLowerCase().trim();
      const ip = clientIp(req);
      const accountKey = `${ip}|${normalizedEmail}`;
      const retryAfter = Math.max(loginFailuresByAccount.retryAfter(accountKey), loginFailuresByIp.retryAfter(ip));
      if (retryAfter > 0) {
        res.setHeader('Retry-After', String(retryAfter));
        sendJson(res, 429, { error: `Too many failed login attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` });
        return true;
      }

      const user = queryOne(`SELECT * FROM users WHERE email = ?`, [normalizedEmail]);
      if (!user || !verifyPassword(String(password), user.salt, user.password_hash)) {
        loginFailuresByAccount.recordFailure(accountKey);
        loginFailuresByIp.recordFailure(ip);
        sendJson(res, 401, { error: 'Invalid email or password' });
        return true;
      }
      loginFailuresByAccount.reset(accountKey);

      if (user.status !== 'active') {
        sendJson(res, 403, { error: 'Account is deactivated or suspended' });
        return true;
      }

      const isSuperAdmin = Boolean(user.is_superadmin);
      const myCompanies = CompanyService.getUserCompanies(user.id, isSuperAdmin);

      // Select initial active company (prefer comp_apex_01 if user is member, else first)
      const activeComp = myCompanies.find((c: any) => c.id === 'comp_apex_01') || myCompanies[0];
      const companyId = activeComp?.id || 'comp_apex_01';
      const roleName = activeComp?.role_name || (isSuperAdmin ? 'Administrator' : 'Staff');
      const companyName = activeComp?.name || 'Apex Commercial Technologies';

      const token = createToken({
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        role: roleName,
        companyId,
        companyName,
        isSuperAdmin
      });

      const companyRecord = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);

      sendJson(res, 200, {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: roleName,
          companyId,
          companyName,
          isSuperAdmin,
          mustChangePassword: Boolean(user.must_change_password)
        },
        company: companyRecord,
        myCompanies
      });
      return true;
    } catch (e: any) {
      sendServerError(res, e);
      return true;
    }
  }

  // ==========================================================================
  // AUTHENTICATED CONTEXT RESOLUTION & STRICT TENANT ISOLATION
  // ==========================================================================
  const auth = getAuthContext(req);
  if (!auth) {
    sendJson(res, 401, { error: 'Authentication required. Please provide a valid Bearer token.' });
    return true;
  }

  // Verified tenant company_id from authenticated context (never from user-supplied query/param)
  const companyId = auth.companyId;

  // Accounts created with a temporary password may only change it (or read their profile) until they do
  const mustChangePassword = Boolean(
    queryOne<{ must_change_password: number }>(`SELECT must_change_password FROM users WHERE id = ?`, [auth.userId])?.must_change_password
  );
  if (mustChangePassword && pathname !== '/api/auth/me' && pathname !== '/api/auth/change-password') {
    sendJson(res, 403, { error: 'You must change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
    return true;
  }

  // Current authenticated user & tenant context
  if (pathname === '/api/auth/me' && method === 'GET') {
    const comp = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    const myCompanies = CompanyService.getUserCompanies(auth.userId, auth.isSuperAdmin);
    sendJson(res, 200, {
      user: {
        userId: auth.userId,
        email: auth.email,
        fullName: auth.fullName,
        role: auth.role,
        companyId: auth.companyId,
        companyName: auth.companyName,
        isSuperAdmin: auth.isSuperAdmin,
        permissions: auth.permissions,
        mustChangePassword
      },
      company: comp,
      myCompanies
    });
    return true;
  }

  // --- CHANGE OWN PASSWORD ---
  if (pathname === '/api/auth/change-password' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      const user = queryOne(`SELECT * FROM users WHERE id = ?`, [auth.userId]);
      if (!user || !verifyPassword(currentPassword, user.salt, user.password_hash)) {
        sendJson(res, 400, { error: 'Current password is incorrect' });
        return true;
      }
      if (newPassword.length < 10) {
        sendJson(res, 400, { error: 'New password must be at least 10 characters' });
        return true;
      }
      if (newPassword === currentPassword) {
        sendJson(res, 400, { error: 'New password must be different from the current password' });
        return true;
      }
      const cred = hashPassword(newPassword);
      execute(
        `UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`,
        [cred.hash, cred.salt, auth.userId]
      );
      AuditService.log({
        companyId,
        userId: auth.userId,
        userName: auth.fullName,
        userRole: auth.role,
        action: 'PASSWORD_CHANGED',
        entityType: 'USER',
        entityId: auth.userId
      });
      sendJson(res, 200, { success: true });
    } catch (e: any) {
      sendServerError(res, e);
    }
    return true;
  }

  // --- COMPANY SWITCHING ---
  if (pathname === '/api/auth/switch-company' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const targetCompanyId = body.companyId;
      if (!targetCompanyId) {
        sendJson(res, 400, { error: 'target companyId required' });
        return true;
      }
      const switched = CompanyService.switchCompany(auth.userId, targetCompanyId, auth.isSuperAdmin);
      sendJson(res, 200, switched);
      return true;
    } catch (e: any) {
      sendJson(res, 403, { error: e.message });
      return true;
    }
  }

  // --- 2. MULTI-COMPANY & TEAM MANAGEMENT ---
  if (pathname === '/api/companies/my-companies' && method === 'GET') {
    const companies = CompanyService.getUserCompanies(auth.userId, auth.isSuperAdmin);
    sendJson(res, 200, companies);
    return true;
  }

  if (pathname === '/api/companies/onboard' && method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!body.name || !body.name.trim()) {
        sendJson(res, 400, { error: 'Company name is required' });
        return true;
      }
      const onboarded = CompanyService.onboardCompany(auth.userId, body);
      sendJson(res, 201, onboarded);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname === '/api/companies/members' && method === 'GET') {
    const members = CompanyService.getCompanyMembers(companyId);
    sendJson(res, 200, members);
    return true;
  }

  if (pathname === '/api/companies/members/invite' && method === 'POST') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Company Administrators can invite team members' });
      return true;
    }
    try {
      const body = await parseBody(req);
      if (!body.email || !body.fullName) {
        sendJson(res, 400, { error: 'Email and full name are required' });
        return true;
      }
      const { member, temporaryPassword } = CompanyService.inviteMember(
        companyId,
        { userId: auth.userId, userName: auth.fullName },
        body
      );

      const company = CompanyService.getCompanyById(companyId);

      // Dispatch background invitation email. The temporary password (new accounts only)
      // goes only to the invitee's mailbox, never into the API response.
      EmailService.sendInvitationEmail({
        toEmail: body.email.trim(),
        fullName: body.fullName.trim(),
        companyName: company?.name || 'Your Organization',
        inviterName: auth.fullName || 'Administrator',
        roleName: body.roleName || 'Staff',
        temporaryPassword: temporaryPassword || undefined,
        appUrl: appBaseUrl(req)
      }).catch(err => {
        console.error('[EmailService] Background invite email error:', err);
      });

      sendJson(res, 201, {
        member,
        message: `Invitation successfully processed. Email dispatched to ${body.email.trim()}`
      });
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/companies\/members\/([A-Za-z0-9_-]+)\/role$/) && method === 'PUT') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Company Administrators can modify member roles' });
      return true;
    }
    const targetUserId = pathname.split('/')[4];
    try {
      const body = await parseBody(req);
      const updated = CompanyService.updateMemberRole(
        companyId,
        { userId: auth.userId, userName: auth.fullName },
        targetUserId,
        body.roleName
      );
      sendJson(res, 200, updated);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/companies\/members\/([A-Za-z0-9_-]+)$/) && method === 'DELETE') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Company Administrators can remove members' });
      return true;
    }
    const targetUserId = pathname.split('/')[4];
    try {
      CompanyService.removeMember(
        companyId,
        { userId: auth.userId, userName: auth.fullName },
        targetUserId
      );
      sendJson(res, 200, { success: true });
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  // --- 3. PLATFORM ADMIN ROUTES ---
  if (pathname === '/api/platform/companies' && method === 'GET') {
    if (!auth.isSuperAdmin) {
      sendJson(res, 403, { error: 'Platform Administrator access required' });
      return true;
    }
    sendJson(res, 200, CompanyService.getPlatformCompanies());
    return true;
  }

  if (pathname.match(/^\/api\/platform\/companies\/([A-Za-z0-9_-]+)\/status$/) && method === 'PUT') {
    if (!auth.isSuperAdmin) {
      sendJson(res, 403, { error: 'Platform Administrator access required' });
      return true;
    }
    const targetCompId = pathname.split('/')[4];
    const body = await parseBody(req);
    if (body.status !== 'active' && body.status !== 'suspended') {
      sendJson(res, 400, { error: 'status must be "active" or "suspended"' });
      return true;
    }
    if (!CompanyService.getCompanyById(targetCompId)) {
      sendJson(res, 404, { error: 'Company not found' });
      return true;
    }
    const updated = CompanyService.updateCompanyStatus(
      targetCompId,
      body.status,
      { userId: auth.userId, userName: auth.fullName }
    );
    sendJson(res, 200, updated);
    return true;
  }

  if (pathname.match(/^\/api\/platform\/companies\/([A-Za-z0-9_-]+)$/) && method === 'DELETE') {
    if (!auth.isSuperAdmin) {
      sendJson(res, 403, { error: 'Platform Administrator access required' });
      return true;
    }
    const targetCompId = pathname.split('/')[4];
    try {
      CompanyService.deleteCompany(targetCompId, {
        userId: auth.userId,
        userName: auth.fullName,
        isSuperAdmin: true
      });
      sendJson(res, 200, { success: true, message: 'Company workspace deleted successfully' });
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/companies\/([A-Za-z0-9_-]+)$/) && method === 'DELETE') {
    const targetCompId = pathname.split('/')[3];
    try {
      CompanyService.deleteCompany(targetCompId, {
        userId: auth.userId,
        userName: auth.fullName,
        isSuperAdmin: auth.isSuperAdmin
      });
      sendJson(res, 200, { success: true, message: 'Company workspace deleted successfully' });
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  // --- 4. COMPANY PROFILE & SETTINGS ---
  if (pathname === '/api/company' && method === 'GET') {
    const company = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    sendJson(res, 200, company);
    return true;
  }

  if (pathname === '/api/company' && method === 'PUT') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Company Administrators can modify company settings' });
      return true;
    }
    try {
      const body = await parseBody(req);
      execute(
        `UPDATE companies SET
          name = COALESCE(?, name),
          business_registration_number = COALESCE(?, business_registration_number),
          tax_identification_number = COALESCE(?, tax_identification_number),
          address = COALESCE(?, address),
          country = COALESCE(?, country),
          city = COALESCE(?, city),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          website = COALESCE(?, website),
          primary_color = COALESCE(?, primary_color),
          secondary_color = COALESCE(?, secondary_color),
          invoice_theme = COALESCE(?, invoice_theme),
          invoice_prefix = COALESCE(?, invoice_prefix),
          payment_instructions = COALESCE(?, payment_instructions),
          default_payment_terms = COALESCE(?, default_payment_terms),
          bank_details = COALESCE(?, bank_details),
          updated_at = datetime('now')
         WHERE id = ?`,
        [
          body.name ?? null,
          body.business_registration_number ?? null,
          body.tax_identification_number ?? null,
          body.address ?? null,
          body.country ?? null,
          body.city ?? null,
          body.phone ?? null,
          body.email ?? null,
          body.website ?? null,
          body.primary_color ?? null,
          body.secondary_color ?? null,
          body.invoice_theme ?? null,
          body.invoice_prefix ?? null,
          body.payment_instructions ?? null,
          body.default_payment_terms ?? null,
          body.bank_details ?? null,
          companyId
        ]
      );
      const updated = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);
      AuditService.log({
        companyId,
        userId: auth.userId,
        userName: auth.fullName,
        userRole: auth.role,
        action: 'COMPANY_SETTINGS_UPDATED',
        entityType: 'COMPANY',
        entityId: companyId,
        newValue: updated
      });
      sendJson(res, 200, updated);
      return true;
    } catch (e: any) {
      sendServerError(res, e);
      return true;
    }
  }

  // --- 5. CURRENCIES & EXCHANGE RATES ---
  if (pathname === '/api/currencies' && method === 'GET') {
    const currencies = CurrencyService.getCurrencies(companyId);
    const baseCurrency = CurrencyService.getBaseCurrency(companyId);
    sendJson(res, 200, { currencies, baseCurrency });
    return true;
  }

  if (pathname === '/api/currencies' && method === 'POST') {
    if (!hasRole(auth, ['Administrator', 'Finance Manager'])) {
      sendJson(res, 403, { error: 'Permission denied: Finance access required' });
      return true;
    }
    try {
      const body = await parseBody(req);
      const curr = CurrencyService.createCurrency(companyId, body);
      sendJson(res, 201, curr);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/currencies\/([A-Za-z0-9_-]+)\/base$/) && method === 'PUT') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Administrators can change company base currency' });
      return true;
    }
    const code = pathname.split('/')[3];
    try {
      CurrencyService.setBaseCurrency(companyId, code);
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
    AuditService.log({
      companyId,
      userId: auth.userId,
      userName: auth.fullName,
      userRole: auth.role,
      action: 'BASE_CURRENCY_CHANGED',
      entityType: 'CURRENCY',
      entityId: code,
      newValue: { baseCurrency: code }
    });
    sendJson(res, 200, { success: true, baseCurrency: code });
    return true;
  }

  if (pathname.match(/^\/api\/currencies\/([A-Za-z0-9_-]+)\/toggle$/) && method === 'PUT') {
    if (!hasRole(auth, ['Administrator', 'Finance Manager'])) {
      sendJson(res, 403, { error: 'Permission denied' });
      return true;
    }
    const code = pathname.split('/')[3];
    const body = await parseBody(req);
    CurrencyService.toggleCurrencyStatus(companyId, code, body.isActive !== false);
    sendJson(res, 200, { success: true, code, isActive: body.isActive !== false });
    return true;
  }

  if (pathname === '/api/exchange-rates' && method === 'GET') {
    const rates = CurrencyService.getExchangeRatesHistory(companyId);
    sendJson(res, 200, rates);
    return true;
  }

  if (pathname === '/api/exchange-rates' && method === 'POST') {
    if (!hasRole(auth, ['Administrator', 'Finance Manager'])) {
      sendJson(res, 403, { error: 'Permission denied' });
      return true;
    }
    try {
      const body = await parseBody(req);
      const rate = CurrencyService.addExchangeRate(companyId, {
        from_currency: body.from_currency,
        to_currency: body.to_currency,
        rate: Number(body.rate),
        effective_date: body.effective_date,
        source: body.source || 'Manual Admin Update'
      });
      AuditService.log({
        companyId,
        userId: auth.userId,
        userName: auth.fullName,
        userRole: auth.role,
        action: 'EXCHANGE_RATE_ADDED',
        entityType: 'EXCHANGE_RATE',
        entityId: rate.id,
        newValue: rate
      });
      sendJson(res, 201, rate);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  // --- 6. TAX RATES ---
  if (pathname === '/api/tax-rates' && method === 'GET') {
    sendJson(res, 200, TaxService.getTaxRates(companyId));
    return true;
  }

  if (pathname === '/api/tax-rates' && method === 'POST') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Administrators can configure tax rates' });
      return true;
    }
    try {
      const body = await parseBody(req);
      const tax = TaxService.createTaxRate(companyId, body);
      sendJson(res, 201, tax);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  // --- 7. CLIENTS ---
  if (pathname === '/api/clients' && method === 'GET') {
    const clients = ClientService.getClients(companyId, query.search as string, query.status as string);
    sendJson(res, 200, clients);
    return true;
  }

  if (pathname === '/api/clients' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const client = ClientService.createClient(companyId, body, auth.userId, auth.fullName);
      sendJson(res, 201, client);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/clients\/([A-Za-z0-9_-]+)$/) && method === 'GET') {
    const id = pathname.split('/')[3];
    const profile = ClientService.getClientProfile(companyId, id);
    if (!profile) {
      sendJson(res, 404, { error: 'Client not found' });
      return true;
    }
    sendJson(res, 200, profile);
    return true;
  }

  if (pathname.match(/^\/api\/clients\/([A-Za-z0-9_-]+)$/) && method === 'PUT') {
    const id = pathname.split('/')[3];
    try {
      const body = await parseBody(req);
      const updated = ClientService.updateClient(companyId, id, body, auth.userId, auth.fullName);
      if (!updated) {
        sendJson(res, 404, { error: 'Client not found' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/clients\/([A-Za-z0-9_-]+)$/) && method === 'DELETE') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Administrators can delete or archive client accounts' });
      return true;
    }
    const id = pathname.split('/')[3];
    try {
      const result = ClientService.deleteClient(companyId, id, auth.userId, auth.fullName);
      sendJson(res, 200, result);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  // --- 8. INVOICES ---
  if (pathname === '/api/invoices' && method === 'GET') {
    const invoices = InvoiceService.getInvoices(companyId, {
      status: query.status as string,
      clientId: query.clientId as string,
      currency: query.currency as string,
      search: query.search as string,
      startDate: query.startDate as string,
      endDate: query.endDate as string
    });
    sendJson(res, 200, invoices);
    return true;
  }

  if (pathname === '/api/invoices' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const inv = InvoiceService.createInvoice({
        ...body,
        company_id: companyId,
        user_id: auth.userId,
        user_name: auth.fullName
      });
      sendJson(res, 201, inv);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/invoices\/([A-Za-z0-9_-]+)$/) && method === 'GET') {
    const id = pathname.split('/')[3];
    const inv = InvoiceService.getInvoiceById(companyId, id);
    if (!inv) {
      sendJson(res, 404, { error: 'Invoice not found' });
      return true;
    }
    sendJson(res, 200, inv);
    return true;
  }

  if (pathname.match(/^\/api\/invoices\/([A-Za-z0-9_-]+)\/status$/) && method === 'PUT') {
    if (!hasRole(auth, ['Administrator', 'Finance Manager'])) {
      sendJson(res, 403, { error: 'Only Administrators or Finance Managers can change invoice status' });
      return true;
    }
    const id = pathname.split('/')[3];
    try {
      const body = await parseBody(req);
      const updated = InvoiceService.updateInvoiceStatus(companyId, id, body.status, auth.userId, auth.fullName);
      if (!updated) {
        sendJson(res, 404, { error: 'Invoice not found' });
        return true;
      }
      sendJson(res, 200, updated);
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
    }
    return true;
  }

  if (pathname.match(/^\/api\/invoices\/([A-Za-z0-9_-]+)\/send$/) && method === 'POST') {
    const id = pathname.split('/')[3];
    const inv = InvoiceService.markAsSent(companyId, id, auth.userId, auth.fullName);
    if (inv && inv.client_email) {
      EmailService.sendInvoiceEmail(companyId, inv, inv.client_email);
    }
    sendJson(res, 200, { success: true, invoice: inv });
    return true;
  }

  if (pathname.match(/^\/api\/invoices\/([A-Za-z0-9_-]+)\/pdf$/) && method === 'GET') {
    const id = pathname.split('/')[3];
    let targetCompanyId = companyId;
    let inv = InvoiceService.getInvoiceById(targetCompanyId, id);

    if (!inv) {
      const foundInvoice = queryOne<{ company_id: string }>(`SELECT company_id FROM invoices WHERE id = ?`, [id]);
      if (foundInvoice) {
        const hasAccess = auth.isSuperAdmin || queryOne(
          `SELECT 1 FROM company_users WHERE user_id = ? AND company_id = ? AND is_active = 1`,
          [auth.userId, foundInvoice.company_id]
        );
        if (hasAccess) {
          targetCompanyId = foundInvoice.company_id;
          inv = InvoiceService.getInvoiceById(targetCompanyId, id);
        }
      }
    }

    if (!inv) {
      sendJson(res, 404, { error: 'Invoice not found or access denied' });
      return true;
    }
    try {
      const pdfPath = await PdfService.generateInvoicePdf(targetCompanyId, id);
      const stat = fs.statSync(pdfPath);
      const isDownload = query.download === 'true' || query.download === '1';
      const disposition = isDownload ? 'attachment' : 'inline';
      const filename = `invoice_${inv.invoice_number || id}.pdf`;
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': stat.size,
        'Content-Disposition': `${disposition}; filename="${filename}"`
      });
      const stream = fs.createReadStream(pdfPath);
      stream.pipe(res);
      return true;
    } catch (e: any) {
      sendServerError(res, e, 'PDF generation failed');
      return true;
    }
  }

  // --- 9. PAYMENTS ---
  if (pathname === '/api/payments' && method === 'GET') {
    const payments = PaymentService.getPayments(companyId, {
      clientId: query.clientId as string,
      invoiceId: query.invoiceId as string,
      status: query.status as string,
      search: query.search as string,
      startDate: query.startDate as string,
      endDate: query.endDate as string
    });
    sendJson(res, 200, payments);
    return true;
  }

  if (pathname === '/api/payments' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const payment = PaymentService.recordPayment({
        ...body,
        company_id: companyId,
        user_id: auth.userId,
        user_name: auth.fullName,
        user_role: auth.role
      });
      sendJson(res, 201, payment);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/payments\/([A-Za-z0-9_-]+)$/) && method === 'GET') {
    const id = pathname.split('/')[3];
    const p = PaymentService.getPaymentById(companyId, id);
    if (!p) {
      sendJson(res, 404, { error: 'Payment not found' });
      return true;
    }
    sendJson(res, 200, p);
    return true;
  }

  if (pathname.match(/^\/api\/payments\/([A-Za-z0-9_-]+)\/reverse$/) && method === 'POST') {
    if (!hasRole(auth, ['Administrator', 'Finance Manager'])) {
      sendJson(res, 403, { error: 'Only Administrators or Finance Managers can reverse payments' });
      return true;
    }
    const id = pathname.split('/')[3];
    try {
      const body = await parseBody(req);
      const reversed = PaymentService.reversePayment(
        companyId,
        id,
        body.reason || 'Reversal requested by user',
        auth.userId,
        auth.fullName,
        auth.role
      );
      sendJson(res, 200, reversed);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/payments\/([A-Za-z0-9_-]+)\/(pdf|receipt|receipt\/html)$/) && method === 'GET') {
    const parts = pathname.split('/');
    const id = parts[3];
    const isHtmlMode = pathname.endsWith('/receipt/html') || query.format === 'html';
    let targetCompanyId = companyId;
    let p = PaymentService.getPaymentById(targetCompanyId, id);

    if (!p) {
      const foundPayment = queryOne<{ company_id: string }>(`SELECT company_id FROM payments WHERE id = ?`, [id]);
      if (foundPayment) {
        const hasAccess = auth.isSuperAdmin || queryOne(
          `SELECT 1 FROM company_users WHERE user_id = ? AND company_id = ? AND is_active = 1`,
          [auth.userId, foundPayment.company_id]
        );
        if (hasAccess) {
          targetCompanyId = foundPayment.company_id;
          p = PaymentService.getPaymentById(targetCompanyId, id);
        }
      }
    }

    if (!p) {
      sendJson(res, 404, { error: 'Payment not found or access denied' });
      return true;
    }

    if (isHtmlMode) {
      try {
        const html = PdfService.renderReceiptHtml(targetCompanyId, id);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          // No scripts at all: receipt markup is static, and this page is served from the app origin
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(html);
        return true;
      } catch (e: any) {
        sendServerError(res, e, 'Receipt render failed');
        return true;
      }
    }

    try {
      const pdfPath = await PdfService.generateReceiptPdf(targetCompanyId, id);
      const stat = fs.statSync(pdfPath);
      const isDownload = query.download === 'true' || query.download === '1';
      const disposition = isDownload ? 'attachment' : 'inline';
      const filename = `receipt_${p.payment_number || id}.pdf`;
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': stat.size,
        'Content-Disposition': `${disposition}; filename="${filename}"`
      });
      const stream = fs.createReadStream(pdfPath);
      stream.pipe(res);
      return true;
    } catch (e: any) {
      sendServerError(res, e, 'Receipt generation failed');
      return true;
    }
  }

  // --- 10. EXPENSES ---
  if (pathname === '/api/expenses' && method === 'GET') {
    const expenses = ExpenseService.getExpenses(companyId, {
      categoryId: query.categoryId as string,
      search: query.search as string,
      startDate: query.startDate as string,
      endDate: query.endDate as string
    });
    sendJson(res, 200, expenses);
    return true;
  }

  if (pathname === '/api/expenses' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const exp = ExpenseService.createExpense({
        ...body,
        company_id: companyId,
        user_id: auth.userId,
        user_name: auth.fullName
      });
      sendJson(res, 201, exp);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/expenses\/([A-Za-z0-9_-]+)$/) && method === 'DELETE') {
    if (!hasRole(auth, ['Administrator', 'Finance Manager'])) {
      sendJson(res, 403, { error: 'Permission denied to delete expenses' });
      return true;
    }
    const id = pathname.split('/')[3];
    const success = ExpenseService.deleteExpense(companyId, id, auth.userId, auth.fullName);
    sendJson(res, 200, { success });
    return true;
  }

  if (pathname === '/api/expenses/categories' && method === 'GET') {
    sendJson(res, 200, ExpenseService.getCategories(companyId));
    return true;
  }

  if (pathname === '/api/expenses/categories' && method === 'POST') {
    const body = await parseBody(req);
    const cat = ExpenseService.createCategory(companyId, body.name, body.description);
    sendJson(res, 201, cat);
    return true;
  }

  // --- 11. REVENUE ---
  if (pathname === '/api/revenue' && method === 'GET') {
    const breakdown = RevenueService.getRevenueBreakdown(companyId, {
      startDate: query.startDate as string,
      endDate: query.endDate as string,
      currency: query.currency as string
    });
    const transactions = RevenueService.getRevenueTransactions(companyId, 50);
    sendJson(res, 200, { breakdown, transactions });
    return true;
  }

  // --- 12. DASHBOARD ---
  if (pathname === '/api/dashboard' && method === 'GET') {
    const data = DashboardService.getDashboardMetrics(companyId, {
      period: (query.period as any) || 'this_month',
      startDate: query.startDate as string,
      endDate: query.endDate as string,
      currencyMode: (query.currencyMode as any) || 'all',
      selectedCurrency: query.selectedCurrency as string
    });
    sendJson(res, 200, data);
    return true;
  }

  // --- 13. REPORTS ---
  if (pathname === '/api/reports/pnl' && method === 'GET') {
    const pnl = ReportService.getProfitAndLoss(companyId, query.startDate as string, query.endDate as string, query.currency as string);
    sendJson(res, 200, pnl);
    return true;
  }

  if (pathname === '/api/reports/cash-flow' && method === 'GET') {
    const cf = ReportService.getCashFlow(companyId, query.startDate as string, query.endDate as string, query.currency as string);
    sendJson(res, 200, cf);
    return true;
  }

  if (pathname === '/api/reports/ar-aging' && method === 'GET') {
    const ar = ReportService.getAccountsReceivableAging(companyId, query.currency as string);
    sendJson(res, 200, ar);
    return true;
  }

  if (pathname === '/api/reports/client-statement' && method === 'GET') {
    const clientId = query.clientId as string;
    if (!clientId) {
      sendJson(res, 400, { error: 'clientId parameter required' });
      return true;
    }
    const stmt = ReportService.getClientStatement(companyId, clientId, query.startDate as string, query.endDate as string, query.currency as string);
    sendJson(res, 200, stmt);
    return true;
  }

  if (pathname === '/api/reports/taxes' && method === 'GET') {
    sendJson(res, 200, ReportService.getTaxReport(companyId, query.startDate as string, query.endDate as string));
    return true;
  }

  if (pathname === '/api/reports/currencies' && method === 'GET') {
    sendJson(res, 200, ReportService.getCurrencyReport(companyId));
    return true;
  }

  // --- 14. INVOICE TEMPLATES ---
  if (pathname === '/api/templates' && method === 'GET') {
    sendJson(res, 200, TemplateService.getTemplates(companyId));
    return true;
  }

  if (pathname === '/api/templates' && method === 'POST') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Administrators can create or update templates' });
      return true;
    }
    try {
      const body = await parseBody(req);
      const tmpl = TemplateService.createTemplate(companyId, body);
      sendJson(res, 201, tmpl);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/templates\/([A-Za-z0-9_-]+)\/default$/) && method === 'PUT') {
    if (!hasRole(auth, ['Administrator'])) {
      sendJson(res, 403, { error: 'Only Administrators can set default templates' });
      return true;
    }
    const id = pathname.split('/')[3];
    try {
      TemplateService.setDefault(companyId, id);
      sendJson(res, 200, { success: true });
    } catch (e: any) {
      sendJson(res, 404, { error: e.message });
    }
    return true;
  }

  // --- 15. NOTIFICATIONS ---
  if (pathname === '/api/notifications' && method === 'GET') {
    sendJson(res, 200, NotificationService.getNotifications(companyId));
    return true;
  }

  if (pathname.match(/^\/api\/notifications\/([A-Za-z0-9_-]+)\/read$/) && method === 'PUT') {
    const id = pathname.split('/')[3];
    NotificationService.markAsRead(id, companyId);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (pathname === '/api/notifications/read-all' && method === 'PUT') {
    NotificationService.markAllAsRead(companyId);
    sendJson(res, 200, { success: true });
    return true;
  }

  // --- 16. AUDIT LOGS ---
  if (pathname === '/api/audit-logs' && method === 'GET') {
    const logs = AuditService.getLogs(companyId, 100, query.entityType as string);
    sendJson(res, 200, logs);
    return true;
  }

  // --- 17. GLOBAL SEARCH ---
  if (pathname === '/api/search' && method === 'GET') {
    const q = (query.q as string) || '';
    sendJson(res, 200, SearchService.globalSearch(companyId, q));
    return true;
  }

  // --- 18. PAYMENT NOTE TEMPLATES & PRESETS ---
  if (pathname === '/api/payment-notes' && method === 'GET') {
    sendJson(res, 200, PaymentNoteService.getNotes(companyId));
    return true;
  }

  if (pathname === '/api/payment-notes' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const note = PaymentNoteService.createNote(companyId, body);
      sendJson(res, 201, note);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/payment-notes\/([A-Za-z0-9_-]+)$/) && method === 'DELETE') {
    const noteId = pathname.split('/')[3];
    try {
      PaymentNoteService.deleteNote(companyId, noteId);
      sendJson(res, 200, { success: true, message: 'Payment note template deleted' });
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  // Route not handled by API
  return false;
}
