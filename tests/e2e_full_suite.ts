import { server } from '../server/src/index.ts';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function testEndpoint(name: string, urlPath: string, expectedStatus: number = 200) {
  try {
    const res = await fetch(`${BASE_URL}${urlPath}`);
    if (res.status !== expectedStatus) {
      throw new Error(`Expected status ${expectedStatus} but got ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      console.log(`PASS [${res.status}]: ${name} ->`, Array.isArray(json) ? `${json.length} items` : 'Object ok');
      return json;
    } else {
      const buf = await res.arrayBuffer();
      console.log(`PASS [${res.status}]: ${name} -> Binary buffer (${buf.byteLength} bytes)`);
      return buf;
    }
  } catch (err: any) {
    console.error(`FAIL: ${name} ->`, err.message);
    throw err;
  }
}

async function runSuite() {
  console.log('=== STARTING FULL END-TO-END VERIFICATION SUITE ===\n');

  if (!server.listening) {
    await new Promise(r => server.once('listening', r));
  }
  console.log('Server confirmed listening on port', PORT);

  // 1. Static Web App shell
  await testEndpoint('Frontend SPA index.html', '/');
  await testEndpoint('Frontend CSS', '/app.css');
  await testEndpoint('Frontend JS', '/app.js');

  // 2. Auth & Company
  await testEndpoint('Auth Profile', '/api/auth/me');
  await testEndpoint('Company Profile', '/api/company');

  // 3. Multi-Currency & Taxes
  await testEndpoint('Currencies List', '/api/currencies');
  await testEndpoint('Exchange Rates', '/api/exchange-rates');
  await testEndpoint('Tax Rates', '/api/tax-rates');

  // 4. Clients & Invoices
  const clients = await testEndpoint('Clients List', '/api/clients');
  const invoices = await testEndpoint('Invoices List', '/api/invoices');

  // 5. Payments & Expenses
  const payments = await testEndpoint('Payments List', '/api/payments');
  const expenses = await testEndpoint('Expenses List', '/api/expenses');

  // 6. Revenue & Analytics Dashboard
  await testEndpoint('Revenue Breakdown', '/api/revenue');
  await testEndpoint('Dashboard Metrics (Base GHS)', '/api/dashboard?period=this_month&currencyMode=base');
  await testEndpoint('Dashboard Metrics (Converted USD)', '/api/dashboard?period=this_month&currencyMode=all&selectedCurrency=USD');

  // 7. Reports
  await testEndpoint('Profit & Loss Report', '/api/reports/pnl');
  await testEndpoint('Cash Flow Report', '/api/reports/cash-flow');
  await testEndpoint('Accounts Receivable Aging', '/api/reports/ar-aging');
  if (clients.length > 0) {
    await testEndpoint('Client Statement Report', `/api/reports/client-statement?clientId=${clients[0].id}`);
  }
  await testEndpoint('Tax Report', '/api/reports/taxes');
  await testEndpoint('Currency Exposure Report', '/api/reports/currencies');

  // 8. Templates & Audit
  await testEndpoint('Invoice Templates', '/api/templates');
  await testEndpoint('Audit Logs', '/api/audit-logs');
  await testEndpoint('Global Search', '/api/search?q=ABC');

  // 9. PDF Generation Endpoints
  if (invoices.length > 0) {
    const pdfBuf = await testEndpoint('Server-side Invoice PDF Stream', `/api/invoices/${invoices[0].id}/pdf`);
    if (pdfBuf.byteLength < 5000) {
      throw new Error('PDF output is unexpectedly small');
    }
  }

  if (payments.length > 0) {
    const receiptBuf = await testEndpoint('Server-side Receipt PDF Stream', `/api/payments/${payments[0].id}/pdf`);
    if (receiptBuf.byteLength < 5000) {
      throw new Error('Receipt PDF output is unexpectedly small');
    }
  }

  // 10. Headless Chrome UI Render Test & Full-Page Screenshot
  console.log('\nTesting Headless Chrome UI Rendering & Taking Screenshot...');
  const shotPath = '/apex-finance/storage/dashboard_rendered.png';
  execFileSync(process.env.CHROME_BIN || '/usr/local/lib/chrome-headless-shell/chrome-headless-shell', [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1440,900',
    `--screenshot=${shotPath}`,
    BASE_URL
  ]);

  if (fs.existsSync(shotPath) && fs.statSync(shotPath).size > 10000) {
    console.log(`PASS: Rendered UI screenshot captured at ${shotPath} (${fs.statSync(shotPath).size} bytes)`);
  } else {
    throw new Error('Screenshot failed or is empty');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL INTEGRATION & END-TO-END TESTS PASSED 100% 🎉');
  console.log('======================================================');

  server.close();
  process.exit(0);
}

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  server.close();
  process.exit(1);
});
