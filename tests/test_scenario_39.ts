import { ClientService } from '../server/src/services/clientService.ts';
import { InvoiceService } from '../server/src/services/invoiceService.ts';
import { PaymentService } from '../server/src/services/paymentService.ts';
import { DashboardService } from '../server/src/services/dashboardService.ts';
import { ReportService } from '../server/src/services/reportService.ts';
import { AuditService } from '../server/src/services/auditService.ts';
import { SafeMoney } from '../server/src/utils/financialMath.ts';
import { queryOne } from '../server/src/db/database.ts';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

const companyId = 'comp_apex_01';
console.log('=== RUNNING SECTION 39 CRITICAL TEST SCENARIO ===\n');

// 1. Create client: ABC Company, Preferred currency: USD
console.log('1. Creating Client: ABC Company (USD)');
const client = ClientService.createClient(companyId, {
  company_name: 'ABC Company',
  contact_person: 'John Doe',
  email: 'john@abccompany.com',
  preferred_currency: 'USD',
  country: 'United States',
  payment_terms: 30
});
assert(client.company_name === 'ABC Company', 'Client name is ABC Company');
assert(client.preferred_currency === 'USD', 'Client preferred currency is USD');

// 2. Create invoice: USD 10,000
console.log('\n2. Creating Invoice: USD 10,000');
const invoice = InvoiceService.createInvoice({
  company_id: companyId,
  client_id: client.id,
  issue_date: new Date().toISOString().slice(0, 10),
  due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  currency: 'USD',
  exchange_rate: 15.20,
  items: [
    { description: 'Enterprise Software Implementation & Licensing', quantity: 1, unit_price: 10000 }
  ]
});

assert(invoice.total_amount === 10000, 'Invoice total is exactly USD 10,000');
assert(invoice.amount_paid === 0, 'Initial amount paid is 0');
assert(invoice.balance_due === 10000, 'Initial balance due is 10,000');
assert(invoice.status === 'Unpaid', 'Initial invoice status is Unpaid');

// 3. Record payment 1: USD 2,500
console.log('\n3. Recording First Payment: USD 2,500');
const p1 = PaymentService.recordPayment({
  company_id: companyId,
  client_id: client.id,
  invoice_id: invoice.id,
  amount: 2500,
  currency: 'USD',
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'Bank Transfer',
  reference_number: 'WIRE-TEST-001'
});

const invAfterP1 = InvoiceService.getInvoiceById(companyId, invoice.id);
console.log(`After Payment 1 -> Paid: ${invAfterP1.amount_paid}, Balance: ${invAfterP1.balance_due}, Status: ${invAfterP1.status}, Progress: ${invAfterP1.payment_percentage}%`);
assert(invAfterP1.amount_paid === 2500, 'Paid = USD 2,500');
assert(invAfterP1.balance_due === 7500, 'Balance = USD 7,500');
assert(invAfterP1.status === 'Partially Paid', 'Status = Partially Paid');
assert(invAfterP1.payment_percentage === 25, 'Progress = 25%');

// 4. Record payment 2: USD 3,500
console.log('\n4. Recording Second Payment: USD 3,500');
const p2 = PaymentService.recordPayment({
  company_id: companyId,
  client_id: client.id,
  invoice_id: invoice.id,
  amount: 3500,
  currency: 'USD',
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'Card',
  reference_number: 'CARD-TEST-002'
});

const invAfterP2 = InvoiceService.getInvoiceById(companyId, invoice.id);
console.log(`After Payment 2 -> Paid: ${invAfterP2.amount_paid}, Balance: ${invAfterP2.balance_due}, Status: ${invAfterP2.status}, Progress: ${invAfterP2.payment_percentage}%`);
assert(invAfterP2.amount_paid === 6000, 'Paid = USD 6,000');
assert(invAfterP2.balance_due === 4000, 'Balance = USD 4,000');
assert(invAfterP2.status === 'Partially Paid', 'Status = Partially Paid');
assert(invAfterP2.payment_percentage === 60, 'Progress = 60%');

// 5. Test Overpayment Guard (Try paying USD 5,000 when only USD 4,000 is due)
console.log('\n5. Testing Overpayment Guard (Attempt USD 5,000 when balance is USD 4,000)');
try {
  PaymentService.recordPayment({
    company_id: companyId,
    client_id: client.id,
    invoice_id: invoice.id,
    amount: 5000,
    currency: 'USD',
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'Bank Transfer',
    user_role: 'Staff'
  });
  assert(false, 'Should have rejected overpayment!');
} catch (err: any) {
  assert(err.message.includes('exceeds invoice balance'), `Overpayment correctly rejected: "${err.message}"`);
}

// 6. Record final payment: USD 4,000
console.log('\n6. Recording Final Payment: USD 4,000');
const p3 = PaymentService.recordPayment({
  company_id: companyId,
  client_id: client.id,
  invoice_id: invoice.id,
  amount: 4000,
  currency: 'USD',
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'Bank Transfer',
  reference_number: 'WIRE-TEST-003'
});

const invAfterP3 = InvoiceService.getInvoiceById(companyId, invoice.id);
console.log(`After Payment 3 -> Paid: ${invAfterP3.amount_paid}, Balance: ${invAfterP3.balance_due}, Status: ${invAfterP3.status}, Progress: ${invAfterP3.payment_percentage}%`);
assert(invAfterP3.amount_paid === 10000, 'Paid = USD 10,000');
assert(invAfterP3.balance_due === 0, 'Balance = USD 0');
assert(invAfterP3.status === 'Paid', 'Status = Paid');
assert(invAfterP3.payment_percentage === 100, 'Progress = 100%');
assert(invAfterP3.payments.length === 3, 'Invoice has exactly 3 recorded payments in history');

// 7. Verify Client Balance Updates
console.log('\n7. Verifying Client Profile & Balances');
const clientProfile = ClientService.getClientProfile(companyId, client.id);
console.log('Client Stats:', clientProfile.stats);
assert(clientProfile.stats.outstandingBalance === 0, 'Client outstanding balance is 0');
assert(clientProfile.stats.totalPaid > 0, 'Client total paid is recorded');
assert(clientProfile.stats.paidInvoicesCount >= 1, 'Client has at least 1 paid invoice');

// 8. Verify Audit Logs
console.log('\n8. Verifying Audit Log Records');
const auditLogs = AuditService.getLogs(companyId, 10);
const hasPaymentLogs = auditLogs.some(l => l.action === 'PAYMENT_RECORDED');
const hasInvoiceLog = auditLogs.some(l => l.action === 'INVOICE_CREATED');
assert(hasPaymentLogs, 'Audit trail logged payment actions');
assert(hasInvoiceLog, 'Audit trail logged invoice creation');

// 9. Verify Client Statement
console.log('\n9. Verifying Client Statement');
const statement = ReportService.getClientStatement(companyId, client.id);
console.log(`Statement Ledger entries: ${statement.ledger.length}, Closing Balance: ${statement.closingBalance}`);
assert(statement.ledger.length >= 4, 'Statement reflects 1 invoice and 3 payments');
assert(statement.closingBalance === 0, 'Statement closing balance is 0.00');

// 10. Verify Dashboard Updates
console.log('\n10. Verifying Dashboard Metrics');
const dash = DashboardService.getDashboardMetrics(companyId);
assert(dash.summary.totalRevenue.value > 0, 'Dashboard total revenue is populated');
console.log('Dashboard Total Revenue:', dash.summary.totalRevenue.value);

console.log('\n>>> CRITICAL TEST SCENARIO 39 PASSED COMPLETELY AND FLAWLESSLY! <<<');
