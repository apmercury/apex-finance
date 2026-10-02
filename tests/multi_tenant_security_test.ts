import { server } from '../server/src/index.ts';
import { queryOne, execute } from '../server/src/db/database.ts';
import { createToken } from '../server/src/utils/security.ts';

const PORT = 3000;
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
    await new Promise(r => server.once('listening', r));
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
