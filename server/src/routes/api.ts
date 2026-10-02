import { IncomingMessage, ServerResponse } from 'node:http';
import * as url from 'node:url';
import * as fs from 'node:fs';
import { verifyToken, hashPassword, verifyPassword, createToken, TokenPayload } from '../utils/security.ts';
import { queryAll, queryOne, execute } from '../db/database.ts';
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
import { PdfService } from '../services/pdfService.ts';
import { NotificationService } from '../services/notificationService.ts';
import { AuditService } from '../services/auditService.ts';
import { SearchService } from '../services/searchService.ts';
import { sseService } from '../services/sseService.ts';
import { EmailService } from '../services/emailService.ts';

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

// JSON response helper
function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// Authenticate request
function authenticate(req: IncomingMessage): TokenPayload | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyToken(token);
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsedUrl = url.parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '';
  const method = req.method?.toUpperCase() || 'GET';
  const query = parsedUrl.query;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    res.end();
    return true;
  }

  // Real-time SSE Endpoint
  if (pathname === '/api/events') {
    const authUser = authenticate(req);
    const companyId = (query.companyId as string) || authUser?.companyId || 'comp_apex_01';
    const clientId = Math.random().toString(36).substring(7);
    sseService.registerClient(clientId, companyId, authUser?.userId, res);
    return true;
  }

  // --- 1. AUTHENTICATION ROUTES ---
  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { email, password } = body;
      if (!email || !password) {
        sendJson(res, 400, { error: 'Email and password required' });
        return true;
      }

      const user = queryOne(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase().trim()]);
      if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
        sendJson(res, 401, { error: 'Invalid credentials' });
        return true;
      }

      // Fetch company membership and role
      const membership = queryOne(
        `SELECT cu.*, r.name as role_name, c.name as company_name 
         FROM company_users cu
         JOIN roles r ON cu.role_id = r.id
         JOIN companies c ON cu.company_id = c.id
         WHERE cu.user_id = ? AND cu.is_active = 1 LIMIT 1`,
        [user.id]
      );

      const companyId = membership?.company_id || 'comp_apex_01';
      const roleName = membership?.role_name || (user.is_superadmin ? 'Administrator' : 'Staff');
      const companyName = membership?.company_name || 'Apex Commercial Technologies';

      const token = createToken({
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        role: roleName,
        companyId,
        companyName
      });

      sendJson(res, 200, {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: roleName,
          companyId,
          companyName
        }
      });
      return true;
    } catch (e: any) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // Public/Protected boundary check
  // For easy SaaS demo testing, if Authorization is omitted, default to Admin user of company 'comp_apex_01'
  const fallbackAdmin = queryOne(`SELECT id, email, full_name FROM users WHERE email = 'admin@apexfin.com'`) || queryOne(`SELECT id, email, full_name FROM users LIMIT 1`);

  const user = authenticate(req) || {
    userId: fallbackAdmin?.id || 'u_admin_default',
    email: fallbackAdmin?.email || 'admin@apexfin.com',
    fullName: fallbackAdmin?.full_name || 'Alexander Vance (Admin)',
    role: 'Administrator',
    companyId: 'comp_apex_01',
    companyName: 'Apex Commercial Technologies Ltd'
  };

  const companyId = (query.companyId as string) || user.companyId || 'comp_apex_01';

  // Current authenticated user info
  if (pathname === '/api/auth/me' && method === 'GET') {
    const comp = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    sendJson(res, 200, { user, company: comp });
    return true;
  }

  // --- 2. COMPANY PROFILE & SETTINGS ---
  if (pathname === '/api/company' && method === 'GET') {
    const company = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);
    sendJson(res, 200, company);
    return true;
  }

  if (pathname === '/api/company' && method === 'PUT') {
    try {
      const body = await parseBody(req);
      execute(
        `UPDATE companies SET
          name = COALESCE(?, name),
          business_registration_number = COALESCE(?, business_registration_number),
          tax_identification_number = COALESCE(?, tax_identification_number),
          address = COALESCE(?, address),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          website = COALESCE(?, website),
          primary_color = COALESCE(?, primary_color),
          secondary_color = COALESCE(?, secondary_color),
          invoice_theme = COALESCE(?, invoice_theme),
          invoice_prefix = COALESCE(?, invoice_prefix),
          payment_instructions = COALESCE(?, payment_instructions),
          updated_at = datetime('now')
         WHERE id = ?`,
        [
          body.name ?? null,
          body.business_registration_number ?? null,
          body.tax_identification_number ?? null,
          body.address ?? null,
          body.phone ?? null,
          body.email ?? null,
          body.website ?? null,
          body.primary_color ?? null,
          body.secondary_color ?? null,
          body.invoice_theme ?? null,
          body.invoice_prefix ?? null,
          body.payment_instructions ?? null,
          companyId
        ]
      );
      const updated = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]);
      AuditService.log({
        companyId,
        userId: user.userId,
        userName: user.fullName,
        action: 'COMPANY_SETTINGS_UPDATED',
        entityType: 'COMPANY',
        entityId: companyId,
        newValue: updated
      });
      sendJson(res, 200, updated);
      return true;
    } catch (e: any) {
      sendJson(res, 500, { error: e.message });
      return true;
    }
  }

  // --- 3. CURRENCIES & EXCHANGE RATES ---
  if (pathname === '/api/currencies' && method === 'GET') {
    const currencies = CurrencyService.getCurrencies(companyId);
    const baseCurrency = CurrencyService.getBaseCurrency(companyId);
    sendJson(res, 200, { currencies, baseCurrency });
    return true;
  }

  if (pathname === '/api/currencies' && method === 'POST') {
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
    const code = pathname.split('/')[3];
    CurrencyService.setBaseCurrency(companyId, code);
    AuditService.log({
      companyId,
      userId: user.userId,
      userName: user.fullName,
      action: 'BASE_CURRENCY_CHANGED',
      entityType: 'CURRENCY',
      entityId: code,
      newValue: { baseCurrency: code }
    });
    sendJson(res, 200, { success: true, baseCurrency: code });
    return true;
  }

  if (pathname.match(/^\/api\/currencies\/([A-Za-z0-9_-]+)\/toggle$/) && method === 'PUT') {
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
        userId: user.userId,
        userName: user.fullName,
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

  // --- 4. TAX RATES ---
  if (pathname === '/api/tax-rates' && method === 'GET') {
    sendJson(res, 200, TaxService.getTaxRates(companyId));
    return true;
  }

  if (pathname === '/api/tax-rates' && method === 'POST') {
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

  // --- 5. CLIENTS ---
  if (pathname === '/api/clients' && method === 'GET') {
    const clients = ClientService.getClients(companyId, query.search as string, query.status as string);
    sendJson(res, 200, clients);
    return true;
  }

  if (pathname === '/api/clients' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const client = ClientService.createClient(companyId, body, user.userId, user.fullName);
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
      const updated = ClientService.updateClient(companyId, id, body, user.userId, user.fullName);
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
    const id = pathname.split('/')[3];
    try {
      const result = ClientService.deleteClient(companyId, id, user.userId, user.fullName);
      sendJson(res, 200, result);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  // --- 6. INVOICES ---
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
        user_id: user.userId,
        user_name: user.fullName
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
    const id = pathname.split('/')[3];
    const body = await parseBody(req);
    const updated = InvoiceService.updateInvoiceStatus(companyId, id, body.status, user.userId, user.fullName);
    sendJson(res, 200, updated);
    return true;
  }

  if (pathname.match(/^\/api\/invoices\/([A-Za-z0-9_-]+)\/send$/) && method === 'POST') {
    const id = pathname.split('/')[3];
    const inv = InvoiceService.markAsSent(companyId, id, user.userId, user.fullName);
    // Send email in background
    if (inv && inv.client_email) {
      EmailService.sendInvoiceEmail(companyId, inv, inv.client_email);
    }
    sendJson(res, 200, { success: true, invoice: inv });
    return true;
  }

  if (pathname.match(/^\/api\/invoices\/([A-Za-z0-9_-]+)\/pdf$/) && method === 'GET') {
    const id = pathname.split('/')[3];
    try {
      const pdfPath = PdfService.generateInvoicePdf(companyId, id);
      const stat = fs.statSync(pdfPath);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="invoice_${id}.pdf"`
      });
      const stream = fs.createReadStream(pdfPath);
      stream.pipe(res);
      return true;
    } catch (e: any) {
      sendJson(res, 500, { error: 'PDF generation failed: ' + e.message });
      return true;
    }
  }

  // --- 7. PAYMENTS ---
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
        user_id: user.userId,
        user_name: user.fullName,
        user_role: user.role
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
    const id = pathname.split('/')[3];
    try {
      const body = await parseBody(req);
      const reversed = PaymentService.reversePayment(companyId, id, body.reason || 'Reversal requested by user', user.userId, user.fullName, user.role);
      sendJson(res, 200, reversed);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/payments\/([A-Za-z0-9_-]+)\/pdf$/) && method === 'GET') {
    const id = pathname.split('/')[3];
    try {
      const pdfPath = PdfService.generateReceiptPdf(companyId, id);
      const stat = fs.statSync(pdfPath);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="receipt_${id}.pdf"`
      });
      const stream = fs.createReadStream(pdfPath);
      stream.pipe(res);
      return true;
    } catch (e: any) {
      sendJson(res, 500, { error: 'Receipt generation failed: ' + e.message });
      return true;
    }
  }

  // --- 8. EXPENSES ---
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
        user_id: user.userId,
        user_name: user.fullName
      });
      sendJson(res, 201, exp);
      return true;
    } catch (e: any) {
      sendJson(res, 400, { error: e.message });
      return true;
    }
  }

  if (pathname.match(/^\/api\/expenses\/([A-Za-z0-9_-]+)$/) && method === 'DELETE') {
    const id = pathname.split('/')[3];
    const success = ExpenseService.deleteExpense(companyId, id, user.userId, user.fullName);
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

  // --- 9. REVENUE ---
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

  // --- 10. DASHBOARD ---
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

  // --- 11. REPORTS ---
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

  // --- 12. INVOICE TEMPLATES ---
  if (pathname === '/api/templates' && method === 'GET') {
    sendJson(res, 200, TemplateService.getTemplates(companyId));
    return true;
  }

  if (pathname === '/api/templates' && method === 'POST') {
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
    const id = pathname.split('/')[3];
    TemplateService.setDefault(companyId, id);
    sendJson(res, 200, { success: true });
    return true;
  }

  // --- 13. NOTIFICATIONS ---
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

  // --- 14. AUDIT LOGS ---
  if (pathname === '/api/audit-logs' && method === 'GET') {
    const logs = AuditService.getLogs(companyId, 100, query.entityType as string);
    sendJson(res, 200, logs);
    return true;
  }

  // --- 15. GLOBAL SEARCH ---
  if (pathname === '/api/search' && method === 'GET') {
    const q = (query.q as string) || '';
    sendJson(res, 200, SearchService.globalSearch(companyId, q));
    return true;
  }

  // Route not handled by API
  return false;
}
