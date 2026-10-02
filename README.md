# ApexFinance SaaS — Modern Enterprise Financial Management & Invoicing

ApexFinance is a modern, production-grade, full-stack financial management and multi-currency invoicing web platform engineered for growing commercial businesses. Built with a scalable architecture, ApexFinance is ready to serve a single company today while natively supporting seamless evolution into a multi-tenant, multi-company SaaS platform without structural rewrites.

---

## Key Highlights & Architectural Foundations

* **Multi-Tenant Foundation (`company_id`)**: Every business-related database model (`clients`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `expenses`, `revenues`, `transactions`, `tax_rates`, `invoice_templates`, `audit_logs`) includes an indexed `company_id` for strict data isolation.
* **Multi-Currency System & Historical Rate Preservation**:
  * Original transaction amounts and currencies are preserved indefinitely.
  * Every record stores: `amount`, `currency`, `exchange_rate`, `base_currency_amount`, `base_currency`, and timestamp.
  * Subsequent exchange rate changes never overwrite historical conversions.
  * Extensible `IExchangeRateProvider` abstraction for manual admin entries and future live external rate APIs (ECB, Fixer, OpenExchangeRates).
* **Safe Financial Mathematics Engine (`SafeMoney`)**:
  * Eliminates IEEE-754 JavaScript floating-point inaccuracies using scaled BigInt/integer arithmetic (scale 10,000 for amounts, scale 1,000,000 for exchange rates).
  * Backend validation and recalculation for line items, discounts, composite taxes, and balances.
* **Unlimited Partial Payment Engine**:
  * Real-time settlement progress bars (`65% Paid — USD 6,500 / USD 10,000`).
  * Overpayment protection (guards against payments exceeding balance due unless explicit Administrator override is provided).
  * Payment reversal with automatic atomic restoration of invoice balance, client metrics, and audit logs.
  * Extensible `IPaymentProvider` interface prepared for Stripe, PayPal, Mobile Money, and bank gateways.
* **Automatic Invoice Status Calculation**:
  * Paid = 0 and due date not passed $\rightarrow$ `Unpaid`
  * Paid > 0 and Paid < Total $\rightarrow$ `Partially Paid`
  * Paid $\ge$ Total $\rightarrow$ `Paid`
  * Due date passed and Balance > 0 $\rightarrow$ `Overdue`
* **Server-Side Vector PDF Generation**:
  * High-fidelity, pixel-perfect PDF invoices, receipts, and client statements generated server-side via Chrome Headless (`chrome-headless-shell`).
* **Real-Time Event Stream**:
  * Server-Sent Events (SSE) push channel (`/api/events`) immediately updates dashboard metrics, invoice statuses, and client balances across open tabs without manual refresh.
* **Financial Reporting & Statements**:
  * **Profit & Loss Statement**: Operating revenue by source, expenses by category, net operating profit, and profit margin.
  * **Cash Flow Statement**: Cash Inflow, Cash Outflow, and Net Cash Flow.
  * **Accounts Receivable (AR) Aging**: Five standard aging buckets (`Current`, `1–30 Days`, `31–60 Days`, `61–90 Days`, `90+ Days Overdue`).
  * **Client Statement Generator**: Chronological running balance ledger with opening and closing balances.
  * **Tax Collection Report**: Output taxes collected vs input taxes paid on expenses.
  * **Currency Exposure Report**: Distribution of volumes across currencies.

---

## Directory Structure

```text
/apex-finance
├── server/
│   └── src/
│       ├── config.ts
│       ├── index.ts                     # HTTP Server & SPA static file router
│       ├── db/
│       │   ├── schema.postgresql.sql    # Production PostgreSQL Multi-Tenant DDL
│       │   ├── database.ts              # SQLite/ACID transaction engine
│       │   └── seed.ts                  # Realistic multi-currency demo dataset
│       ├── utils/
│       │   ├── financialMath.ts         # SafeMoney BigInt precision math engine
│       │   └── security.ts              # PBKDF2 hashing & JWT authentication
│       ├── services/
│       │   ├── currencyService.ts       # Currencies, rates, and provider abstraction
│       │   ├── taxService.ts            # Line-item tax rate calculations
│       │   ├── clientService.ts         # Client 360 profiles & balance reconciliation
│       │   ├── invoiceService.ts        # Invoicing, line items, automatic status rules
│       │   ├── paymentService.ts        # Atomic payment recording & overpayment protection
│       │   ├── expenseService.ts        # Categorized operational expenses
│       │   ├── revenueService.ts        # Invoiced vs Collected vs Outstanding revenue
│       │   ├── dashboardService.ts      # Multi-period & multi-currency dashboard analytics
│       │   ├── reportService.ts         # P&L, Cash Flow, AR Aging, Statements
│       │   ├── templateService.ts       # Live invoice template customization
│       │   ├── pdfService.ts            # Server-side Chrome headless PDF engine
│       │   ├── emailService.ts          # Email automation provider abstraction
│       │   ├── auditService.ts          # Immutable audit trail logger
│       │   ├── searchService.ts         # Global full-text search
│       │   └── sseService.ts            # Real-time Server-Sent Events broadcast
│       └── routes/
│           └── api.ts                   # REST API routing layer
├── client/
│   └── public/
│       ├── index.html                   # SaaS application shell
│       ├── app.css                      # Modern responsive Tailwind-inspired stylesheet
│       └── app.js                       # Single-page application logic & chart engine
├── storage/
│   ├── apexfinance.sqlite               # Local database
│   ├── invoices/                        # Generated PDF invoices
│   └── receipts/                        # Generated payment receipt PDFs
└── tests/
    ├── test_scenario_39.ts              # Section 39 critical test scenario validation
    └── e2e_full_suite.ts                # Full REST API & Headless Chrome test suite
```

---

## Critical Test Scenario (Section 39) Verification

The application was verified against the scenario specified in Requirement 39:

1. **Client Created**: `ABC Company` (Preferred currency: `USD`).
2. **Invoice Created**: Nominal value `USD 10,000` (Exchange rate: `1 USD = 15.20 GHS`, Base total: `GH₵ 152,000`).
   * Initial Status: `Unpaid` | Amount Paid: `USD 0.00` | Balance: `USD 10,000.00`
3. **First Partial Payment Recorded**: `USD 2,500`
   * Amount Paid: `USD 2,500.00` | Balance: `USD 7,500.00` | Status: `Partially Paid` | Progress: `25%`
4. **Second Partial Payment Recorded**: `USD 3,500`
   * Amount Paid: `USD 6,000.00` | Balance: `USD 4,000.00` | Status: `Partially Paid` | Progress: `60%`
5. **Overpayment Guard Verified**:
   * Attempted payment of `USD 5,000` when remaining balance was `USD 4,000`.
   * Rejected with error: `Payment amount exceeds invoice balance. Overpayment not permitted without Administrator approval.`
6. **Final Payment Recorded**: `USD 4,000`
   * Amount Paid: `USD 10,000.00` | Balance: `USD 0.00` | Status: `Paid` | Progress: `100%`
7. **System-wide Assertions**:
   * Client outstanding balance updated to `0.00`.
   * Collected revenue increased by `USD 10,000` (`GH₵ 152,000`).
   * Client statement recorded 1 invoice and 3 payments with closing balance `0.00`.
   * Audit trail logged `INVOICE_CREATED` and 3 `PAYMENT_RECORDED` entries.

To run this test scenario at any time:

```bash
source /tmp/env.sh
$TSX tests/test_scenario_39.ts
```

---

## Starting the Application

To run the application server:

```bash
source /tmp/env.sh
$TSX server/src/index.ts
```

Open a web browser at `http://localhost:3000`.

### Default Demo Credentials

* **Administrator**: `admin@apexfin.com` / `admin123`
* **Finance Manager**: `finance@apexfin.com` / `finance123`
* **Staff**: `staff@apexfin.com` / `staff123`
