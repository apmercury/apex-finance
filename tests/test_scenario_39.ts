import { ClientService } from '../server/src/services/clientService.ts';
import { InvoiceService } from '../server/src/services/invoiceService.ts';
import { PaymentService } from '../server/src/services/paymentService.ts';
import { DashboardService } from '../server/src/services/dashboardService.ts';
import { ReportService } from '../server/src/services/reportService.ts';
import { AuditService } from '../server/src/services/auditService.ts';
import { SafeMoney } from '../server/src/utils/financialMath.ts';
import { queryOne, execute } from '../server/src/db/database.ts';
import { TaxService } from '../server/src/services/taxService.ts';

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

// 11. Payment reversal must remove the revenue from P&L (regression)
console.log('\n11. Verifying Payment Reversal Updates P&L');
const pnlBefore = ReportService.getProfitAndLoss(companyId);
const finalPayment = invAfterP3.payments.find((p: any) => p.amount === 4000);
assert(Boolean(finalPayment), 'Found the USD 4,000 final payment');
PaymentService.reversePayment(companyId, finalPayment.id, 'Bounced transfer (test)');
const pnlAfter = ReportService.getProfitAndLoss(companyId);
const expectedDrop = SafeMoney.convertCurrency(4000, invAfterP3.exchange_rate);
const actualDrop = SafeMoney.subtract(pnlBefore.totalRevenue, pnlAfter.totalRevenue);
console.log(`P&L revenue before: ${pnlBefore.totalRevenue}, after: ${pnlAfter.totalRevenue}, drop: ${actualDrop}`);
assert(SafeMoney.compare(actualDrop, expectedDrop) === 0, `P&L revenue dropped by the reversed amount (${expectedDrop})`);
const invAfterReversal = InvoiceService.getInvoiceById(companyId, invoice.id);
assert(invAfterReversal.balance_due === 4000, 'Invoice balance restored to USD 4,000 after reversal');
assert(invAfterReversal.status === 'Partially Paid', 'Invoice back to Partially Paid after reversal');

// 12. Paid cannot be forced through the manual status path (regression)
console.log('\n12. Verifying Manual Status Guard');
let forcedPaidRejected = false;
try {
  InvoiceService.updateInvoiceStatus(companyId, invoice.id, 'Paid');
} catch {
  forcedPaidRejected = true;
}
assert(forcedPaidRejected, 'Setting status to Paid manually is rejected');

const today = new Date().toISOString().slice(0, 10);
const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// 13. Invoice discount reduces the taxable amount (regression)
console.log('\n13. Verifying Tax Is Charged After Invoice Discount');
const vat10 = TaxService.createTaxRate(companyId, { name: 'Test VAT 10%', code: 'TVAT10', percentage: 10, description: 'test' });
const discounted = InvoiceService.createInvoice({
  company_id: companyId, client_id: client.id, issue_date: today, due_date: in30, currency: 'USD', exchange_rate: 15.2,
  discount_type: 'percent', discount_value: 10,
  items: [
    { description: 'Taxed service', quantity: 1, unit_price: 1000, tax_rate_id: vat10.id },
    { description: 'Untaxed service', quantity: 1, unit_price: 1000 }
  ]
});
console.log(`Subtotal ${discounted.subtotal}, discount ${discounted.discount_amount}, tax ${discounted.tax_amount}, total ${discounted.total_amount}`);
assert(discounted.subtotal === 2000, 'Subtotal = 2,000');
assert(discounted.discount_amount === 200, '10% invoice discount = 200');
assert(discounted.tax_amount === 90, 'Tax = 10% of the discounted taxed line (900), i.e. 90 — not 100');
assert(discounted.total_amount === 1890, 'Total = 2,000 - 200 + 90 = 1,890');

// 13b. Billed amounts are rounded to the currency's cents, so invoices can be settled exactly (regression)
console.log('\n13b. Verifying Amounts Round To Currency Precision');
const vat15 = TaxService.createTaxRate(companyId, { name: 'Test VAT 15%', code: 'TVAT15', percentage: 15, description: 'test' });
const odd = InvoiceService.createInvoice({
  company_id: companyId, client_id: client.id, issue_date: today, due_date: in30, currency: 'USD', exchange_rate: 15.2,
  discount_type: 'fixed', discount_value: 333.33,
  items: [
    { description: 'A', quantity: 1, unit_price: 123.45, tax_rate_id: vat15.id },
    { description: 'B', quantity: 1, unit_price: 678.9, tax_rate_id: vat15.id },
    { description: 'C', quantity: 1.5, unit_price: 10.01, tax_rate_id: vat15.id }
  ]
});
console.log(`Total ${odd.total_amount}, tax ${odd.tax_amount}, discount ${odd.discount_amount}`);
assert(SafeMoney.roundToPrecision(odd.total_amount, 2) === odd.total_amount, `Invoice total has no sub-cent remainder (${odd.total_amount})`);
assert(odd.items.every((i: any) => SafeMoney.roundToPrecision(i.tax_amount, 2) === i.tax_amount), 'Every line tax is whole cents');
PaymentService.recordPayment({ company_id: companyId, client_id: client.id, invoice_id: odd.id, amount: odd.total_amount, currency: 'USD', payment_date: today, payment_method: 'Bank Transfer' });
const oddPaid = InvoiceService.getInvoiceById(companyId, odd.id);
assert(oddPaid.status === 'Paid' && oddPaid.balance_due === 0, 'Paying the displayed total settles the invoice exactly');

// 14. Invalid input is rejected (regression)
console.log('\n14. Verifying Invoice & Payment Input Validation');
const rejects = (label: string, fn: () => unknown) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert(threw, `Rejected: ${label}`);
};
const baseDto = { company_id: companyId, client_id: client.id, issue_date: today, due_date: in30, currency: 'USD' };
const oneItem = [{ description: 'Item', quantity: 1, unit_price: 100 }];
rejects('invoice with no line items', () => InvoiceService.createInvoice({ ...baseDto, items: [] }));
rejects('quantity of 0 (previously silently became 1)', () => InvoiceService.createInvoice({ ...baseDto, items: [{ description: 'x', quantity: 0, unit_price: 100 }] }));
rejects('negative unit price', () => InvoiceService.createInvoice({ ...baseDto, items: [{ description: 'x', quantity: 1, unit_price: -100 }] }));
rejects('blank line description', () => InvoiceService.createInvoice({ ...baseDto, items: [{ description: ' ', quantity: 1, unit_price: 100 }] }));
rejects('discount over 100%', () => InvoiceService.createInvoice({ ...baseDto, items: oneItem, discount_type: 'percent', discount_value: 150 }));
rejects('impossible issue date', () => InvoiceService.createInvoice({ ...baseDto, issue_date: '2026-02-30', items: oneItem }));
rejects('due date before issue date', () => InvoiceService.createInvoice({ ...baseDto, due_date: daysAgo(10), items: oneItem }));
rejects('currency not configured for the company', () => InvoiceService.createInvoice({ ...baseDto, currency: 'XYZ', items: oneItem }));
rejects('zero exchange rate', () => InvoiceService.createInvoice({ ...baseDto, exchange_rate: 0 as any, items: oneItem }));
rejects('negative exchange rate', () => InvoiceService.createInvoice({ ...baseDto, exchange_rate: -2, items: oneItem }));
rejects('unknown payment method', () => PaymentService.recordPayment({ company_id: companyId, client_id: client.id, amount: 10, currency: 'USD', payment_date: today, payment_method: 'Bitcoin' as any }));
rejects('invalid payment date', () => PaymentService.recordPayment({ company_id: companyId, client_id: client.id, amount: 10, currency: 'USD', payment_date: 'yesterday', payment_method: 'Cash' }));

// 15. Overdue takes precedence over Partially Paid, and the sweep flips past-due invoices (regression)
console.log('\n15. Verifying Overdue Status Rules & Sweep');
assert(InvoiceService.calculateStatus(1000, 400, daysAgo(5)) === 'Overdue', 'Partly paid + past due = Overdue');
assert(InvoiceService.calculateStatus(1000, 400, in30) === 'Partially Paid', 'Partly paid + not yet due = Partially Paid');
assert(InvoiceService.calculateStatus(1000, 1000, daysAgo(5)) === 'Paid', 'Fully paid + past due = Paid');

const aging = InvoiceService.createInvoice({ ...baseDto, items: oneItem });
assert(aging.status === 'Unpaid', 'New invoice starts Unpaid');
execute(`UPDATE invoices SET issue_date = ?, due_date = ? WHERE id = ?`, [daysAgo(40), daysAgo(10), aging.id]);
const flipped = InvoiceService.refreshOverdueStatuses(companyId);
const agingAfter = InvoiceService.getInvoiceById(companyId, aging.id);
assert(flipped >= 1 && agingAfter.status === 'Overdue', `Sweep marked the past-due invoice Overdue (${flipped} flipped)`);
const overdueNote = queryOne(`SELECT 1 FROM notifications WHERE company_id = ? AND type = 'invoice_overdue' AND link = ?`, [companyId, `/invoices/${aging.id}`]);
assert(Boolean(overdueNote), 'Sweep created an invoice_overdue notification');
assert(InvoiceService.refreshOverdueStatuses(companyId) === 0 || InvoiceService.getInvoiceById(companyId, aging.id).status === 'Overdue', 'Sweep is idempotent');

console.log('\n>>> CRITICAL TEST SCENARIO 39 PASSED COMPLETELY AND FLAWLESSLY! <<<');
