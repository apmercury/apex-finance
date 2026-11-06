import { server } from '../server/src/index.ts';
import { queryOne, execute } from '../server/src/db/database.ts';
import { createToken } from '../server/src/utils/security.ts';
import * as crypto from 'node:crypto';
import { CompanyService } from '../server/src/services/companyService.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function request(path: string, options: any = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

async function runTests() {
  console.log('================================================================');
  console.log('🔒 RUNNING MULTI-TENANT ISOLATION & RBAC SECURITY TEST SUITE');
  console.log('================================================================\n');

  if (!server.listening) {
    try {
      await fetch(BASE_URL);
    } catch {
      await new Promise(r => server.once('listening', r));
    }
  }

  // 1. Fetch Company IDs and Users from DB
  const comp1 = queryOne(`SELECT * FROM companies WHERE id = 'comp_apex_01'`);
  const comp2 = queryOne(`SELECT * FROM companies WHERE id = 'comp_stellar_02'`);
  assert(Boolean(comp1 && comp2), 'Both demo companies exist in database');

  const adminUser = queryOne(`SELECT * FROM users WHERE email = 'admin@apexfin.com'`);
  const staffUser = queryOne(`SELECT * FROM users WHERE email = 'staff@apexfin.com'`);
  const sarahUser = queryOne(`SELECT * FROM users WHERE email = 'sarah@stellarmaritime.com'`);

  // Tokens:
  // Admin in Company 1 (Apex Commercial)
  const tokenAdminComp1 = createToken({
    userId: adminUser.id,
    email: adminUser.email,
    fullName: adminUser.full_name,
    role: 'Administrator',
    companyId: comp1.id,
    companyName: comp1.name,
    isSuperAdmin: true
  });

  // Staff in Company 1 (Ama Osei)
  const tokenStaffComp1 = createToken({
    userId: staffUser.id,
    email: staffUser.email,
    fullName: staffUser.full_name,
    role: 'Staff',
    companyId: comp1.id,
    companyName: comp1.name,
    isSuperAdmin: false
  });

  // Sarah in Company 2 (Administrator in Stellar Maritime, NO membership in Company 1)
  const tokenSarahComp2 = createToken({
    userId: sarahUser.id,
    email: sarahUser.email,
    fullName: sarahUser.full_name,
    role: 'Administrator',
    companyId: comp2.id,
    companyName: comp2.name,
    isSuperAdmin: false
  });

  // -------------------------------------------------------------------------
  // TEST 0: Unauthenticated & forged requests are rejected (regression)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 0: Authentication Required ---');
  const noToken = await request(`/api/auth/me`);
  assert(noToken.status === 401, `Request without a token is REJECTED with 401 (Status: ${noToken.status})`);

  const garbageToken = await request(`/api/platform/companies`, { headers: { Authorization: 'Bearer garbage' } });
  assert(garbageToken.status === 401, `Request with an invalid token is REJECTED with 401 (Status: ${garbageToken.status})`);

  const noTokenSse = await fetch(`${BASE_URL}/api/events`);
  assert(noTokenSse.status === 401, `Event stream without a token is REJECTED with 401 (Status: ${noTokenSse.status})`);

  // A token signed with the secret that used to be hard-coded in the source must not verify
  const legacySecret = 'apex-finance-enterprise-secret-key-2026-safe-production';
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const forgedData = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    userId: adminUser.id, email: adminUser.email, fullName: 'Forged', role: 'Platform Admin',
    companyId: comp1.id, companyName: comp1.name, isSuperAdmin: true, exp: Math.floor(Date.now() / 1000) + 3600
  })}`;
  const forgedSig = crypto.createHmac('sha256', legacySecret).update(forgedData).digest('base64url');
  const forged = await request(`/api/platform/companies`, { headers: { Authorization: `Bearer ${forgedData}.${forgedSig}` } });
  assert(forged.status === 401, `Token forged with the legacy default secret is REJECTED with 401 (Status: ${forged.status})`);

  // -------------------------------------------------------------------------
  // TEST 1: Tenant Data Isolation on Invoices
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 1: Tenant Isolation on Invoices ---');
  // Fetch an invoice belonging to Company 2
  const comp2Invoice = queryOne(`SELECT * FROM invoices WHERE company_id = ? LIMIT 1`, [comp2.id]);
  assert(Boolean(comp2Invoice), 'Company 2 has an invoice in database');

  // Staff from Company 1 attempts to access Company 2 invoice via direct ID
  const leakAttempt1 = await request(`/api/invoices/${comp2Invoice.id}`, {
    headers: { Authorization: `Bearer ${tokenStaffComp1}` }
  });
  assert(leakAttempt1.status === 404, `Staff from Company 1 receives 404 when querying Company 2 invoice (Status: ${leakAttempt1.status})`);

  // Sarah (Company 2 Admin) accesses Company 2 invoice -> SUCCESS
  const sarahInvoiceReq = await request(`/api/invoices/${comp2Invoice.id}`, {
    headers: { Authorization: `Bearer ${tokenSarahComp2}` }
  });
  assert(sarahInvoiceReq.status === 200, `Company 2 user receives 200 for their own invoice (Status: ${sarahInvoiceReq.status})`);
  assert(sarahInvoiceReq.data.id === comp2Invoice.id, 'Invoice data matches Company 2 invoice');

  // Sarah attempts to access Company 1 invoice
  const comp1Invoice = queryOne(`SELECT * FROM invoices WHERE company_id = ? LIMIT 1`, [comp1.id]);
  const leakAttempt2 = await request(`/api/invoices/${comp1Invoice.id}`, {
    headers: { Authorization: `Bearer ${tokenSarahComp2}` }
  });
  assert(leakAttempt2.status === 404, `Company 2 user receives 404 when attempting to view Company 1 invoice (Status: ${leakAttempt2.status})`);

  // -------------------------------------------------------------------------
  // TEST 2: Tenant Isolation on Clients & Payments
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Tenant Isolation on Clients & Payments ---');
  const comp2Client = queryOne(`SELECT * FROM clients WHERE company_id = ? LIMIT 1`, [comp2.id]);
  assert(Boolean(comp2Client), 'Company 2 has a client in database');

  const clientLeakAttempt = await request(`/api/clients/${comp2Client.id}`, {
    headers: { Authorization: `Bearer ${tokenStaffComp1}` }
  });
  assert(clientLeakAttempt.status === 404, `Company 1 user receives 404 for Company 2 client (Status: ${clientLeakAttempt.status})`);

  // Sarah accesses Company 2 client -> SUCCESS
  const clientValidReq = await request(`/api/clients/${comp2Client.id}`, {
    headers: { Authorization: `Bearer ${tokenSarahComp2}` }
  });
  assert(clientValidReq.status === 200, 'Company 2 user can access their own client profile');

  // -------------------------------------------------------------------------
  // TEST 3: Attempting Query Parameter Bypass (?companyId=...)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Preventing Query Parameter Manipulation ---');
  // Staff from Company 1 queries invoices passing ?companyId=comp_stellar_02
  const spoofAttempt = await request(`/api/invoices?companyId=${comp2.id}`, {
    headers: { Authorization: `Bearer ${tokenStaffComp1}` }
  });
  assert(spoofAttempt.status === 200, 'Request returns 200');
  // Check that all returned invoices belong strictly to Company 1, NOT Company 2!
  const hasComp2Invoice = Array.isArray(spoofAttempt.data) && spoofAttempt.data.some((inv: any) => inv.company_id === comp2.id);
  assert(!hasComp2Invoice, 'Backend strictly ignored ?companyId spoofing and returned ONLY Company 1 invoices');

  // -------------------------------------------------------------------------
  // TEST 4: Unauthorized Company Switching Prevention
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Unauthorized Company Switching ---');
  // Sarah has NO membership in Company 1. She attempts to switch to Company 1
  const illegalSwitch = await request(`/api/auth/switch-company`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSarahComp2}` },
    body: JSON.stringify({ companyId: comp1.id })
  });
  assert(illegalSwitch.status === 403, `Sarah switching into unauthorized Company 1 is REJECTED with 403 (Status: ${illegalSwitch.status})`);

  // -------------------------------------------------------------------------
  // TEST 5: Legitimate Multi-Company Switching for Alexander Vance
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Legitimate Multi-Company Switching ---');
  // Alexander Vance belongs to Company 1 (as Admin) AND Company 2 (as Finance Manager)
  const legalSwitch = await request(`/api/auth/switch-company`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({ companyId: comp2.id })
  });
  assert(legalSwitch.status === 200, `Alexander Vance switching into Company 2 is APPROVED with 200 (Status: ${legalSwitch.status})`);
  assert(legalSwitch.data.token, 'New JWT token received for Company 2');
  assert(legalSwitch.data.user.companyId === comp2.id, 'User context companyId is now Company 2');

  // Now use the switched token to query Company 2 invoices
  const comp2SwitchedReq = await request(`/api/invoices`, {
    headers: { Authorization: `Bearer ${legalSwitch.data.token}` }
  });
  assert(comp2SwitchedReq.status === 200, 'Can query Company 2 invoices using switched token');
  const allComp2Invoices = comp2SwitchedReq.data.every((inv: any) => inv.company_id === comp2.id);
  assert(allComp2Invoices, 'All returned invoices belong strictly to Company 2');

  // -------------------------------------------------------------------------
  // TEST 6: RBAC Permission Enforcement
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: Role-Based Access Control (RBAC) ---');
  // Staff user attempts to modify company settings
  const rbacSettingsAttempt = await request(`/api/company`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenStaffComp1}` },
    body: JSON.stringify({ name: 'Hacked Company Name' })
  });
  assert(rbacSettingsAttempt.status === 403, `Staff member modifying company settings is REJECTED with 403 (Status: ${rbacSettingsAttempt.status})`);

  // Staff member attempts to delete a client
  const comp1Client = queryOne(`SELECT * FROM clients WHERE company_id = ? LIMIT 1`, [comp1.id]);
  const rbacDeleteClient = await request(`/api/clients/${comp1Client.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenStaffComp1}` }
  });
  assert(rbacDeleteClient.status === 403, `Staff member deleting a client is REJECTED with 403 (Status: ${rbacDeleteClient.status})`);

  // -------------------------------------------------------------------------
  // TEST 6b: Invoice status cannot be forced (regression)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6b: Invoice Status Integrity ---');
  const unpaidInv = queryOne(
    `SELECT * FROM invoices WHERE company_id = ? AND balance_due > 0 AND status NOT IN ('Cancelled', 'Draft') LIMIT 1`,
    [comp1.id]
  );
  assert(Boolean(unpaidInv), 'Company 1 has an invoice with an outstanding balance');

  const staffForcePaid = await request(`/api/invoices/${unpaidInv.id}/status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenStaffComp1}` },
    body: JSON.stringify({ status: 'Paid' })
  });
  assert(staffForcePaid.status === 403, `Staff member changing invoice status is REJECTED with 403 (Status: ${staffForcePaid.status})`);

  const adminForcePaid = await request(`/api/invoices/${unpaidInv.id}/status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({ status: 'Paid' })
  });
  assert(adminForcePaid.status === 400, `Marking an invoice Paid without payments is REJECTED with 400 (Status: ${adminForcePaid.status})`);

  const adminBogusStatus = await request(`/api/invoices/${unpaidInv.id}/status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({ status: '<b>whatever</b>' })
  });
  assert(adminBogusStatus.status === 400, `Arbitrary status strings are REJECTED with 400 (Status: ${adminBogusStatus.status})`);
  const statusAfter = queryOne(`SELECT status FROM invoices WHERE id = ?`, [unpaidInv.id]);
  assert(statusAfter.status === unpaidInv.status, `Invoice status unchanged after rejected attempts (${statusAfter.status})`);

  // -------------------------------------------------------------------------
  // TEST 6c: Stored data is HTML-escaped in rendered receipts (regression)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6c: Stored XSS in Receipt Rendering ---');
  const xssPayload = '<img src=x onerror=alert(1)>';
  const xssClient = await request(`/api/clients`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({ company_name: xssPayload, preferred_currency: 'GHS', email: 'xss@example.com' })
  });
  assert(xssClient.status === 201, 'Client with HTML in its name can be stored');
  const xssPayment = await request(`/api/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({
      client_id: xssClient.data.id,
      amount: 10,
      currency: 'GHS',
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: 'Cash',
      notes: '<script>alert(2)</script>'
    })
  });
  assert(xssPayment.status === 201, 'Payment for that client recorded');
  const receiptHtml = await request(`/api/payments/${xssPayment.data.id}/receipt/html`, {
    headers: { Authorization: `Bearer ${tokenAdminComp1}` }
  });
  assert(receiptHtml.status === 200, 'Receipt HTML rendered');
  assert(!String(receiptHtml.data).includes(xssPayload), 'Raw <img onerror> payload is NOT present in receipt HTML');
  assert(!String(receiptHtml.data).includes('<script>alert(2)'), 'Raw <script> payload is NOT present in receipt HTML');
  assert(String(receiptHtml.data).includes('&lt;img src=x onerror=alert(1)&gt;'), 'Payload is rendered as escaped text');

  // Clean up the test data (reverse payment first so ledgers stay consistent)
  await request(`/api/payments/${xssPayment.data.id}/reverse`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({ reason: 'Security test cleanup' })
  });

  // -------------------------------------------------------------------------
  // TEST 7: Company Onboarding Flow & Creator Admin Role
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: Dynamic Company Onboarding Flow ---');
  const onboardRes = await request(`/api/companies/onboard`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({
      name: 'Nordic Clean Energy Ltd',
      country: 'Norway',
      default_currency: 'EUR',
      invoice_prefix: 'NCE-',
      default_payment_terms: 14
    })
  });
  assert(onboardRes.status === 201, `Company onboarding succeeded with 201 (Status: ${onboardRes.status})`);
  assert(onboardRes.data.company.default_currency === 'EUR', 'New company has EUR base currency');
  assert(onboardRes.data.token, 'Onboarding issued active token for new company');

  // Query members of the new company -> creator should be Administrator
  const newCompMembers = await request(`/api/companies/members`, {
    headers: { Authorization: `Bearer ${onboardRes.data.token}` }
  });
  assert(newCompMembers.status === 200, 'Member list retrieved for new company');
  const creatorMember = newCompMembers.data.find((m: any) => m.email === adminUser.email);
  assert(Boolean(creatorMember), 'Creator is a member of the new company');
  assert(creatorMember.role_name === 'Administrator', 'Creator was automatically assigned Administrator role');

  const demoteOnlyAdmin = await request(`/api/companies/members/${adminUser.id}/role`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${onboardRes.data.token}` },
    body: JSON.stringify({ roleName: 'Staff' })
  });
  assert(demoteOnlyAdmin.status === 400, `Demoting the only Administrator is REJECTED with 400 (Status: ${demoteOnlyAdmin.status})`);

  // -------------------------------------------------------------------------
  // TEST 8: Cross-tenant references in request bodies (regression)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 8: Cross-Tenant References ---');
  const comp2ClientRow = queryOne(`SELECT * FROM clients WHERE company_id = ? LIMIT 1`, [comp2.id]);
  const today = new Date().toISOString().slice(0, 10);
  const crossInvoice = await request(`/api/invoices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({
      client_id: comp2ClientRow.id, currency: 'GHS', issue_date: today, due_date: today,
      items: [{ description: 'x', quantity: 1, unit_price: 1 }]
    })
  });
  assert(crossInvoice.status === 400, `Invoice for another tenant's client is REJECTED with 400 (Status: ${crossInvoice.status})`);

  const crossPayment = await request(`/api/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({ client_id: comp2ClientRow.id, amount: 1, currency: 'GHS', payment_date: today, payment_method: 'Cash' })
  });
  assert(crossPayment.status === 400, `Payment for another tenant's client is REJECTED with 400 (Status: ${crossPayment.status})`);

  const comp1Clients = queryOne(`SELECT COUNT(*) AS n FROM clients WHERE company_id = ?`, [comp1.id]);
  const otherClient = queryOne(`SELECT * FROM clients WHERE company_id = ? AND id != ? LIMIT 1`, [comp1.id, unpaidInv.client_id]);
  if (comp1Clients.n > 1 && otherClient) {
    const mismatched = await request(`/api/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenAdminComp1}` },
      body: JSON.stringify({ client_id: otherClient.id, invoice_id: unpaidInv.id, amount: 1, currency: unpaidInv.currency, payment_date: today, payment_method: 'Cash' })
    });
    assert(mismatched.status === 400, `Payment whose client differs from the invoice client is REJECTED with 400 (Status: ${mismatched.status})`);
  }

  // -------------------------------------------------------------------------
  // TEST 9: Invites, temporary passwords & forced password change (regression)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 9: Invites & Temporary Passwords ---');
  const bogusRole = await request(`/api/companies/members/invite`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminComp1}` },
    body: JSON.stringify({ email: `role-${Date.now()}@example.com`, fullName: 'Role Test', roleName: 'Supreme Overlord' })
  });
  assert(bogusRole.status === 400, `Inviting with a non-existent role is REJECTED with 400 (Status: ${bogusRole.status})`);
  assert(!queryOne(`SELECT 1 FROM roles WHERE name = 'Supreme Overlord'`), 'No role was created from request input');

  const inviteeEmail = `invitee-${Date.now()}@example.com`;
  const { temporaryPassword } = CompanyService.inviteMember(
    comp1.id, { userId: adminUser.id, userName: adminUser.full_name },
    { email: inviteeEmail, fullName: 'New Invitee', roleName: 'Staff' }
  );
  assert(Boolean(temporaryPassword) && temporaryPassword !== 'welcome123' && temporaryPassword!.length >= 16, 'New invitee receives a unique random temporary password');

  const loginShared = await request(`/api/auth/login`, { method: 'POST', body: JSON.stringify({ email: inviteeEmail, password: 'welcome123' }) });
  assert(loginShared.status === 401, `The old shared password "welcome123" does NOT work (Status: ${loginShared.status})`);

  const loginTemp = await request(`/api/auth/login`, { method: 'POST', body: JSON.stringify({ email: inviteeEmail, password: temporaryPassword }) });
  assert(loginTemp.status === 200 && loginTemp.data.user.mustChangePassword === true, 'Login with temporary password flags mustChangePassword');

  const blocked = await request(`/api/invoices`, { headers: { Authorization: `Bearer ${loginTemp.data.token}` } });
  assert(blocked.status === 403 && blocked.data.code === 'PASSWORD_CHANGE_REQUIRED', `API access is blocked until the password is changed (Status: ${blocked.status})`);

  const weakChange = await request(`/api/auth/change-password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginTemp.data.token}` },
    body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: 'short' })
  });
  assert(weakChange.status === 400, 'Too-short new password is REJECTED');

  const goodChange = await request(`/api/auth/change-password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginTemp.data.token}` },
    body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: 'a-much-better-password' })
  });
  assert(goodChange.status === 200, `Password change succeeds (Status: ${goodChange.status})`);

  const unblocked = await request(`/api/invoices`, { headers: { Authorization: `Bearer ${loginTemp.data.token}` } });
  assert(unblocked.status === 200, `API access restored after password change (Status: ${unblocked.status})`);

  // -------------------------------------------------------------------------
  // TEST 10: Login brute-force protection, CORS, unknown routes (regression)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 10: Login Rate Limiting, CORS & 404s ---');
  const victim = `bruteforce-${Date.now()}@example.com`;
  let lastStatus = 0;
  for (let i = 0; i < 6; i++) {
    const r = await request(`/api/auth/login`, { method: 'POST', body: JSON.stringify({ email: victim, password: `guess-${i}` }) });
    lastStatus = r.status;
  }
  assert(lastStatus === 429, `6th consecutive failed login is throttled with 429 (Status: ${lastStatus})`);

  const corsRes = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${tokenAdminComp1}` } });
  assert(!corsRes.headers.get('access-control-allow-origin'), 'API does not grant cross-origin access by default');

  const unknownRoute = await request(`/api/does-not-exist`, { headers: { Authorization: `Bearer ${tokenAdminComp1}` } });
  assert(unknownRoute.status === 404, `Unknown API route returns 404 (Status: ${unknownRoute.status})`);

  const badJson = await fetch(`${BASE_URL}/api/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdminComp1}` },
    body: '{not json'
  });
  assert(badJson.status === 400, `Malformed JSON returns 400 (Status: ${badJson.status})`);

  console.log('\n================================================================');
  console.log('🎯 ALL MULTI-TENANT ISOLATION & RBAC SECURITY TESTS PASSED 100%!');
  console.log('================================================================\n');

  server.close();
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  server.close();
  process.exit(1);
});
