/**
 * ApexFinance SaaS — Modern Frontend Application
 */

const state = {
  user: null,
  company: null,
  currencies: [],
  baseCurrency: { code: 'GHS', symbol: 'GH₵' },
  taxRates: [],
  clients: [],
  invoices: [],
  payments: [],
  expenses: [],
  notifications: [],
  activeNav: 'dashboard',
  dashboardPeriod: 'this_month',
  dashboardCurrencyMode: 'all',
  dashboardSelectedCurrency: 'GHS',
  currentInvoiceFilter: 'all',
  currentPaymentFilter: 'all',
  activeReportTab: 'pnl',
  selectedStatementClient: null,
  activeTemplateId: null,
  reversingPaymentId: null
};

// API Helper
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Currency formatter
function formatMoney(amount, currencyCode = 'GHS', precision = 2) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  const curr = state.currencies.find(c => c.code === currencyCode) || { symbol: currencyCode + ' ' };
  return `${curr.symbol} ${num.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })}`;
}

// Safe formatting for base currency
function formatBase(amount) {
  return formatMoney(amount, state.baseCurrency.code);
}

// ============================================================================
// Initialization & Real-Time Sync
// ============================================================================
async function initApp() {
  try {
    // 1. Load initial user and company profile
    const authData = await api('/auth/me');
    state.user = authData.user;
    state.company = authData.company;

    document.getElementById('sidebar-user-name').innerText = state.user.fullName;
    document.getElementById('sidebar-user-role').innerText = `${state.user.role} • ${state.company?.default_currency || 'GHS'} Base`;

    // 2. Load core lookups
    const [currData, taxes] = await Promise.all([
      api('/currencies'),
      api('/tax-rates')
    ]);

    state.currencies = currData.currencies;
    state.baseCurrency = currData.baseCurrency;
    state.taxRates = taxes;
    state.dashboardSelectedCurrency = state.baseCurrency.code;

    // 3. Connect Real-time SSE
    setupSSE();

    // 4. Setup Global Search
    setupSearch();

    // 5. Setup Nav & Modal handlers
    setupEventListeners();

    // 6. Initial Route Render
    await navigate('dashboard');
    loadNotifications();

  } catch (err) {
    console.error('Init error:', err);
    showToast('Failed to connect to backend: ' + err.message, 'error');
  }
}

// Real-Time Server-Sent Events (SSE) Listener
function setupSSE() {
  const evtSource = new EventSource('/api/events');

  evtSource.addEventListener('connected', (e) => {
    console.log('[SSE] Real-time channel active');
  });

  evtSource.addEventListener('notification', (e) => {
    const notif = JSON.parse(e.data);
    showToast(`🔔 ${notif.title}: ${notif.message}`, 'info');
    loadNotifications();
  });

  evtSource.addEventListener('invoice_created', (e) => {
    if (state.activeNav === 'dashboard' || state.activeNav === 'invoices') {
      renderCurrentView();
    }
  });

  evtSource.addEventListener('payment_recorded', (e) => {
    const data = JSON.parse(e.data);
    showToast(`Payment ${data.paymentNumber} recorded successfully!`, 'success');
    renderCurrentView();
  });

  evtSource.addEventListener('payment_reversed', (e) => {
    showToast(`Payment reversal completed`, 'info');
    renderCurrentView();
  });

  evtSource.addEventListener('expense_recorded', (e) => {
    if (state.activeNav === 'dashboard' || state.activeNav === 'expenses') {
      renderCurrentView();
    }
  });
}

// ============================================================================
// Router & View Rendering
// ============================================================================
async function navigate(nav) {
  state.activeNav = nav;
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === nav);
  });
  await renderCurrentView();
}

async function renderCurrentView() {
  const container = document.getElementById('app-view');
  container.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">Loading data...</div>';

  try {
    switch (state.activeNav) {
      case 'dashboard':
        await renderDashboard(container);
        break;
      case 'invoices':
        await renderInvoices(container);
        break;
      case 'payments':
        await renderPayments(container);
        break;
      case 'clients':
        await renderClients(container);
        break;
      case 'expenses':
        await renderExpenses(container);
        break;
      case 'revenue':
        await renderRevenue(container);
        break;
      case 'reports':
        await renderReports(container);
        break;
      case 'templates':
        await renderTemplates(container);
        break;
      case 'audit':
        await renderAuditLogs(container);
        break;
      case 'settings':
        await renderSettings(container);
        break;
      default:
        await renderDashboard(container);
    }
  } catch (err) {
    container.innerHTML = `<div style="padding: 30px; background: #fee2e2; border-radius: 12px; color: #b91c1c;">Error loading view: ${err.message}</div>`;
  }
}

// ============================================================================
// 1. DASHBOARD VIEW
// ============================================================================
async function renderDashboard(container) {
  const data = await api(`/dashboard?period=${state.dashboardPeriod}&currencyMode=${state.dashboardCurrencyMode}&selectedCurrency=${state.dashboardSelectedCurrency}`);
  const s = data.summary;
  const p = data.period;

  const renderTrend = (stat) => {
    if (!stat || stat.changePercent === undefined) return '';
    const isUp = stat.changePercent >= 0;
    const badgeClass = stat.isPositive ? 'trend-positive' : 'trend-negative';
    const arrow = isUp ? '↑' : '↓';
    return `<span class="trend-badge ${badgeClass}">${arrow} ${Math.abs(stat.changePercent)}%</span> <span style="color:#64748b;">vs previous period</span>`;
  };

  container.innerHTML = `
    <!-- Dashboard Filter Bar -->
    <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px;">
      <div>
        <h1 style="font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em;">Financial Overview</h1>
        <p style="font-size: 13px; color: #64748b; margin-top: 2px;">
          ${data.conversionNote}
        </p>
      </div>

      <!-- Controls: Period + Currency Filter -->
      <div style="display: flex; align-items: center; gap: 10px;">
        <select id="dash-period-select" class="form-control" style="width: 160px; font-size: 13px; font-weight: 600;">
          <option value="today" ${state.dashboardPeriod === 'today' ? 'selected' : ''}>Today</option>
          <option value="this_week" ${state.dashboardPeriod === 'this_week' ? 'selected' : ''}>This Week</option>
          <option value="this_month" ${state.dashboardPeriod === 'this_month' ? 'selected' : ''}>This Month</option>
          <option value="last_month" ${state.dashboardPeriod === 'last_month' ? 'selected' : ''}>Last Month</option>
          <option value="this_quarter" ${state.dashboardPeriod === 'this_quarter' ? 'selected' : ''}>This Quarter</option>
          <option value="this_year" ${state.dashboardPeriod === 'this_year' ? 'selected' : ''}>This Year</option>
          <option value="previous_year" ${state.dashboardPeriod === 'previous_year' ? 'selected' : ''}>Previous Year</option>
        </select>

        <select id="dash-currency-select" class="form-control" style="width: 170px; font-size: 13px; font-weight: 600;">
          <option value="${state.baseCurrency.code}" ${state.dashboardSelectedCurrency === state.baseCurrency.code ? 'selected' : ''}>Base: ${state.baseCurrency.code} (${state.baseCurrency.symbol})</option>
          ${state.currencies.filter(c => c.code !== state.baseCurrency.code).map(c => `
            <option value="${c.code}" ${state.dashboardSelectedCurrency === c.code ? 'selected' : ''}>Currency: ${c.code} (${c.symbol})</option>
          `).join('')}
        </select>
      </div>
    </div>

    ${data.isConverted ? `
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 12px 18px; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: #1e40af;">
        <span style="font-size: 16px;">ℹ️</span>
        <span>Multi-currency consolidated view: Values converted into <strong>${data.reportingCurrency}</strong> using recorded exchange rates. Historical transaction amounts remain unaltered.</span>
      </div>
    ` : ''}

    <!-- Stat Cards Grid (8 Core Business Indicators) -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 28px;">
      
      <!-- 1. Collected Revenue -->
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-title">Collected Revenue</span>
          <div class="stat-icon" style="background: #f0fdf4; color: #16a34a;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
        </div>
        <div class="stat-value" style="color: #16a34a;">${formatMoney(s.totalRevenue.value, data.reportingCurrency)}</div>
        <div class="stat-footer">${renderTrend(s.totalRevenue)}</div>
      </div>

      <!-- 2. Invoiced Revenue (Billed) -->
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-title">Invoiced Revenue</span>
          <div class="stat-icon" style="background: #f0f9ff; color: #0284c7;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
        </div>
        <div class="stat-value">${formatMoney(s.invoicedRevenue.value, data.reportingCurrency)}</div>
        <div class="stat-footer">${renderTrend(s.invoicedRevenue)}</div>
      </div>

      <!-- 3. Total Expenses -->
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-title">Total Expenses</span>
          <div class="stat-icon" style="background: #fef2f2; color: #dc2626;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
        </div>
        <div class="stat-value" style="color: #dc2626;">${formatMoney(s.totalExpenses.value, data.reportingCurrency)}</div>
        <div class="stat-footer">${renderTrend(s.totalExpenses)}</div>
      </div>

      <!-- 4. Net Profit -->
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-title">Net Operating Profit</span>
          <div class="stat-icon" style="background: #faf5ff; color: #9333ea;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
        </div>
        <div class="stat-value" style="color: ${s.netProfit.value >= 0 ? '#16a34a' : '#dc2626'};">${formatMoney(s.netProfit.value, data.reportingCurrency)}</div>
        <div class="stat-footer">${renderTrend(s.netProfit)}</div>
      </div>

      <!-- 5. Outstanding Receivables -->
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-title">Accounts Receivable</span>
          <div class="stat-icon" style="background: #fffbeb; color: #d97706;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
        </div>
        <div class="stat-value" style="color: #d97706;">${formatMoney(s.outstandingReceivables.value, data.reportingCurrency)}</div>
        <div class="stat-footer" style="color: #64748b; font-size: 11px;">Total uncollected invoice balances</div>
      </div>

      <!-- 6. Overdue Amount -->
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-title">Overdue Amount</span>
          <div class="stat-icon" style="background: #fee2e2; color: #b91c1c;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
        </div>
        <div class="stat-value" style="color: #b91c1c;">${formatMoney(s.overdueAmount.value, data.reportingCurrency)}</div>
        <div class="stat-footer" style="color: #b91c1c; font-size: 11px; font-weight: 600;">Requires immediate collection</div>
      </div>

      <!-- 7. Active Clients -->
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-title">Active Clients</span>
          <div class="stat-icon" style="background: #f1f5f9; color: #475569;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
        </div>
        <div class="stat-value">${s.clientCount}</div>
        <div class="stat-footer" style="color: #64748b; font-size: 11px;">Registered client accounts</div>
      </div>

      <!-- 8. Outstanding Invoices -->
      <div class="stat-card">
        <div class="stat-header">
          <span class="stat-title">Unsettled Invoices</span>
          <div class="stat-icon" style="background: #f1f5f9; color: #475569;">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
          </div>
        </div>
        <div class="stat-value">${s.outstandingInvoicesCount}</div>
        <div class="stat-footer" style="color: #64748b; font-size: 11px;">Awaiting partial or full settlement</div>
      </div>
    </div>

    <!-- Charts Section -->
    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 28px;">
      <!-- Chart 1: Revenue vs Expenses Trends -->
      <div class="table-container" style="padding: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div>
            <h3 style="font-size: 16px; font-weight: 700; color: #0f172a;">Revenue vs Expenses Trend</h3>
            <p style="font-size: 12px; color: #64748b;">Monthly cash inflow vs outflows (${data.reportingCurrency})</p>
          </div>
          <div style="display: flex; gap: 14px; font-size: 12px; font-weight: 600;">
            <span style="display: flex; align-items: center; gap: 6px;"><span style="width: 10px; height: 10px; background: #0284c7; border-radius: 2px;"></span> Revenue</span>
            <span style="display: flex; align-items: center; gap: 6px;"><span style="width: 10px; height: 10px; background: #ef4444; border-radius: 2px;"></span> Expenses</span>
          </div>
        </div>
        ${renderBarChartSvg(data.charts.monthlyTrends, data.reportingCurrency)}
      </div>

      <!-- Chart 2: Expense Breakdown -->
      <div class="table-container" style="padding: 24px;">
        <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">Expense Categories</h3>
        <p style="font-size: 12px; color: #64748b; margin-bottom: 18px;">Spending distribution</p>
        <div>
          ${data.charts.expenseBreakdown.length === 0 ? '<div style="color:#94a3b8; padding: 20px 0; text-align: center;">No expenses recorded yet</div>' :
            data.charts.expenseBreakdown.map(cat => {
              const maxVal = Math.max(...data.charts.expenseBreakdown.map(b => b.value), 1);
              const pct = Math.round((cat.value / maxVal) * 100);
              return `
                <div style="margin-bottom: 14px;">
                  <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                    <span style="font-weight: 600; color: #334155;">${cat.name}</span>
                    <span style="font-weight: 700; color: #0f172a;">${formatMoney(cat.value, data.reportingCurrency)}</span>
                  </div>
                  <div class="progress-bar-wrap">
                    <div class="progress-bar-fill" style="width: ${pct}%; background: #ef4444;"></div>
                  </div>
                </div>
              `;
            }).join('')
          }
        </div>
      </div>
    </div>

    <!-- Bottom Grids: Top Clients & Currency Exposure -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
      <!-- Top Revenue by Client -->
      <div class="table-container" style="padding: 24px;">
        <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">Top Revenue by Client</h3>
        <p style="font-size: 12px; color: #64748b; margin-bottom: 16px;">Leading revenue contributors</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>Client</th>
              <th style="text-align: right;">Total Paid (${data.reportingCurrency})</th>
            </tr>
          </thead>
          <tbody>
            ${data.charts.revenueByClient.length === 0 ? '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">No client payments recorded</td></tr>' :
              data.charts.revenueByClient.map(c => `
                <tr>
                  <td style="font-weight: 600; color: #0f172a;">${c.name}</td>
                  <td style="text-align: right; font-weight: 700; color: #16a34a;">${formatMoney(c.value, data.reportingCurrency)}</td>
                </tr>
              `).join('')
            }
          </tbody>
        </table>
      </div>

      <!-- Currency Exposure Table -->
      <div class="table-container" style="padding: 24px;">
        <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">Multi-Currency Volume</h3>
        <p style="font-size: 12px; color: #64748b; margin-bottom: 16px;">Historical transaction currency distribution</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>Currency</th>
              <th>Transactions</th>
              <th style="text-align: right;">Original Amount</th>
            </tr>
          </thead>
          <tbody>
            ${data.charts.revenueByCurrency.map(c => `
              <tr>
                <td><span class="badge badge-unpaid">${c.currency}</span></td>
                <td>${c.count} payments</td>
                <td style="text-align: right; font-weight: 700;">${formatMoney(c.original_amount, c.currency)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach Filter Listeners
  document.getElementById('dash-period-select').addEventListener('change', (e) => {
    state.dashboardPeriod = e.target.value;
    renderDashboard(container);
  });

  document.getElementById('dash-currency-select').addEventListener('change', (e) => {
    state.dashboardSelectedCurrency = e.target.value;
    renderDashboard(container);
  });
}

// Render dynamic SVG bar chart for Revenue vs Expenses
function renderBarChartSvg(trends, currencyCode) {
  if (!trends || trends.length === 0) return '<div style="color:#94a3b8; text-align:center; padding: 40px 0;">No trend data available</div>';

  const maxVal = Math.max(...trends.map(t => Math.max(t.revenue, t.expenses)), 1000);
  const chartHeight = 180;
  const barWidth = 24;
  const gap = 16;
  const groupWidth = barWidth * 2 + gap;
  const svgWidth = Math.max(500, trends.length * (groupWidth + 30) + 40);

  const bars = trends.map((t, i) => {
    const x = 40 + i * (groupWidth + 30);
    const revH = (t.revenue / maxVal) * chartHeight;
    const expH = (t.expenses / maxVal) * chartHeight;
    const revY = chartHeight - revH + 20;
    const expY = chartHeight - expH + 20;

    return `
      <g>
        <!-- Revenue Bar -->
        <rect x="${x}" y="${revY}" width="${barWidth}" height="${revH}" rx="4" fill="#0284c7">
          <title>${t.month} Revenue: ${formatMoney(t.revenue, currencyCode)}</title>
        </rect>
        <!-- Expense Bar -->
        <rect x="${x + barWidth + 4}" y="${expY}" width="${barWidth}" height="${expH}" rx="4" fill="#ef4444">
          <title>${t.month} Expenses: ${formatMoney(t.expenses, currencyCode)}</title>
        </rect>
        <!-- Label -->
        <text x="${x + barWidth}" y="${chartHeight + 36}" font-size="11" fill="#64748b" text-anchor="middle" font-family="sans-serif">${t.month}</text>
      </g>
    `;
  }).join('');

  return `
    <div style="overflow-x: auto; width: 100%;">
      <svg width="100%" height="220" viewBox="0 0 ${svgWidth} 220" style="min-width: 450px;">
        <line x1="30" y1="20" x2="${svgWidth - 20}" y2="20" stroke="#f1f5f9" stroke-width="1"/>
        <line x1="30" y1="110" x2="${svgWidth - 20}" y2="110" stroke="#f1f5f9" stroke-width="1"/>
        <line x1="30" y1="${chartHeight + 20}" x2="${svgWidth - 20}" y2="${chartHeight + 20}" stroke="#e2e8f0" stroke-width="1"/>
        ${bars}
      </svg>
    </div>
  `;
}

// ============================================================================
// 2. INVOICE MANAGEMENT VIEW
// ============================================================================
async function renderInvoices(container) {
  const invoices = await api(`/invoices?status=${state.currentInvoiceFilter}`);
  state.invoices = invoices;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">Invoices</h1>
        <p style="font-size: 13px; color: #64748b;">Manage customer billing, partial settlements, and PDF exports</p>
      </div>
      <button id="btn-create-invoice" class="btn btn-primary">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Create Invoice</span>
      </button>
    </div>

    <!-- Status Tabs -->
    <div style="display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 12px; overflow-x: auto;">
      ${['all', 'Unpaid', 'Partially Paid', 'Paid', 'Overdue', 'Draft'].map(st => `
        <button class="btn btn-sm ${state.currentInvoiceFilter === st ? 'btn-primary' : 'btn-secondary'}" data-inv-filter="${st}">
          ${st.charAt(0).toUpperCase() + st.slice(1)}
        </button>
      `).join('')}
    </div>

    <!-- Invoice Data Table -->
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Client</th>
            <th>Issue / Due</th>
            <th>Total Amount</th>
            <th>Settlement Progress</th>
            <th>Balance Due</th>
            <th>Status</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${invoices.length === 0 ? `
            <tr>
              <td colspan="8" style="text-align: center; padding: 40px; color: #94a3b8;">
                No invoices found matching criteria. Click "+ Create Invoice" to generate one.
              </td>
            </tr>
          ` : invoices.map(inv => `
            <tr>
              <td>
                <div style="font-weight: 700; color: #0284c7;">${inv.invoice_number}</div>
                <div style="font-size: 11px; color: #94a3b8;">Rate: ${inv.exchange_rate} to base</div>
              </td>
              <td>
                <div style="font-weight: 600; color: #0f172a;">${inv.client_name}</div>
                <div style="font-size: 11px; color: #64748b;">${inv.client_email || ''}</div>
              </td>
              <td>
                <div>${inv.issue_date}</div>
                <div style="font-size: 11px; color: ${inv.status === 'Overdue' ? '#dc2626' : '#64748b'}; font-weight: ${inv.status === 'Overdue' ? '700' : 'normal'};">
                  Due: ${inv.due_date}
                </div>
              </td>
              <td>
                <div style="font-weight: 700; color: #0f172a;">${formatMoney(inv.total_amount, inv.currency)}</div>
                ${inv.currency !== inv.base_currency ? `<div style="font-size: 11px; color: #64748b;">≈ ${formatMoney(inv.base_currency_total, inv.base_currency)}</div>` : ''}
              </td>
              <td style="min-width: 140px;">
                <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; font-weight: 600;">
                  <span>${inv.payment_percentage}% Paid</span>
                  <span>${formatMoney(inv.amount_paid, inv.currency)}</span>
                </div>
                <div class="progress-bar-wrap">
                  <div class="progress-bar-fill" style="width: ${inv.payment_percentage}%;"></div>
                </div>
              </td>
              <td>
                <div style="font-weight: 700; color: ${inv.balance_due > 0 ? '#dc2626' : '#16a34a'};">
                  ${formatMoney(inv.balance_due, inv.currency)}
                </div>
              </td>
              <td>
                <span class="badge badge-${inv.status.toLowerCase().replace(/\s+/g, '-')}">${inv.status}</span>
              </td>
              <td style="text-align: right;">
                <div style="display: inline-flex; gap: 6px;">
                  ${inv.balance_due > 0 ? `
                    <button class="btn btn-success btn-sm btn-pay-invoice" data-id="${inv.id}" data-client-id="${inv.client_id}" title="Record Partial or Full Payment">
                      Pay
                    </button>
                  ` : ''}
                  <a href="/api/invoices/${inv.id}/pdf" target="_blank" class="btn btn-secondary btn-sm" title="Download PDF Invoice">
                    PDF
                  </a>
                  ${inv.status === 'Draft' ? `
                    <button class="btn btn-secondary btn-sm btn-send-invoice" data-id="${inv.id}" title="Mark Sent & Dispatch Email">
                      Send
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Attach Listeners
  document.getElementById('btn-create-invoice').addEventListener('click', openCreateInvoiceModal);

  document.querySelectorAll('[data-inv-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentInvoiceFilter = btn.dataset.invFilter;
      renderInvoices(container);
    });
  });

  document.querySelectorAll('.btn-pay-invoice').forEach(btn => {
    btn.addEventListener('click', () => {
      openRecordPaymentModal({ invoiceId: btn.dataset.id, clientId: btn.dataset.clientId });
    });
  });

  document.querySelectorAll('.btn-send-invoice').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/invoices/${btn.dataset.id}/send`, { method: 'POST' });
        showToast('Invoice marked as sent and email dispatched!', 'success');
        renderInvoices(container);
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });
}

// ============================================================================
// 3. PAYMENT MANAGEMENT VIEW (Dedicated Module)
// ============================================================================
async function renderPayments(container) {
  const payments = await api('/payments');
  state.payments = payments;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">Payments & Collections</h1>
        <p style="font-size: 13px; color: #64748b;">Record, allocate, reverse, and issue payment receipts</p>
      </div>
      <button id="btn-record-payment" class="btn btn-success">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Record Payment</span>
      </button>
    </div>

    <!-- Payments Table -->
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Payment #</th>
            <th>Date</th>
            <th>Client</th>
            <th>Applied Invoice</th>
            <th>Method</th>
            <th>Original Amount</th>
            <th>Base Currency Amount</th>
            <th>Status</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${payments.length === 0 ? `
            <tr>
              <td colspan="9" style="text-align: center; padding: 40px; color: #94a3b8;">
                No payment transactions recorded yet.
              </td>
            </tr>
          ` : payments.map(p => `
            <tr>
              <td style="font-weight: 700; color: #16a34a;">${p.payment_number}</td>
              <td style="color: #64748b;">${p.payment_date}</td>
              <td style="font-weight: 600; color: #0f172a;">${p.client_name}</td>
              <td>
                ${p.invoice_number ? `<span style="font-weight: 600; color: #0284c7;">${p.invoice_number}</span>` : '<span style="color:#94a3b8;">Account Credit</span>'}
              </td>
              <td><span class="badge badge-unpaid">${p.payment_method}</span></td>
              <td style="font-weight: 700; color: #0f172a;">${formatMoney(p.amount, p.currency)}</td>
              <td style="font-weight: 600; color: #64748b;">${formatBase(p.base_currency_amount)}</td>
              <td>
                <span class="badge badge-${p.status.toLowerCase()}">${p.status}</span>
              </td>
              <td style="text-align: right;">
                <div style="display: inline-flex; gap: 6px;">
                  <a href="/api/payments/${p.id}/pdf" target="_blank" class="btn btn-secondary btn-sm" title="Download Official Receipt">
                    Receipt
                  </a>
                  ${p.status === 'Completed' ? `
                    <button class="btn btn-danger btn-sm btn-reverse-payment" data-id="${p.id}" title="Reverse Payment">
                      Reverse
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-record-payment').addEventListener('click', () => openRecordPaymentModal());

  document.querySelectorAll('.btn-reverse-payment').forEach(btn => {
    btn.addEventListener('click', () => {
      state.reversingPaymentId = btn.dataset.id;
      document.getElementById('modal-reverse').classList.add('open');
    });
  });
}

// ============================================================================
// 4. CLIENT MANAGEMENT VIEW
// ============================================================================
async function renderClients(container) {
  const clients = await api('/clients');
  state.clients = clients;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">Client Profiles</h1>
        <p style="font-size: 13px; color: #64748b;">Manage customer directories, currencies, and account statements</p>
      </div>
      <button id="btn-add-client" class="btn btn-primary">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Add Client</span>
      </button>
    </div>

    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Company / Name</th>
            <th>Contact Person</th>
            <th>Preferred Currency</th>
            <th>Total Invoiced</th>
            <th>Total Paid</th>
            <th>Outstanding Balance</th>
            <th>Overdue Balance</th>
            <th style="text-align: right;">Statement</th>
          </tr>
        </thead>
        <tbody>
          ${clients.map(c => `
            <tr>
              <td>
                <div style="font-weight: 700; color: #0f172a;">${c.company_name}</div>
                <div style="font-size: 11px; color: #64748b;">${c.email || ''} &bull; ${c.phone || ''}</div>
              </td>
              <td>${c.contact_person || '—'}</td>
              <td><span class="badge badge-unpaid">${c.preferred_currency}</span></td>
              <td style="font-weight: 600;">${formatBase(c.total_invoiced)}</td>
              <td style="font-weight: 600; color: #16a34a;">${formatBase(c.total_paid)}</td>
              <td style="font-weight: 700; color: ${c.outstanding_balance > 0 ? '#d97706' : '#64748b'};">
                ${formatBase(c.outstanding_balance)}
              </td>
              <td style="font-weight: 700; color: ${c.overdue_balance > 0 ? '#dc2626' : '#64748b'};">
                ${formatBase(c.overdue_balance)}
              </td>
              <td style="text-align: right;">
                <div style="display: inline-flex; gap: 6px;">
                  <button class="btn btn-secondary btn-sm btn-view-statement" data-id="${c.id}">
                    Statement
                  </button>
                  <button class="btn btn-danger btn-sm btn-delete-client" data-id="${c.id}" data-name="${c.company_name.replace(/"/g, '&quot;')}" title="Delete Client Profile">
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-add-client').addEventListener('click', openAddClientModal);

  document.querySelectorAll('.btn-view-statement').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedStatementClient = btn.dataset.id;
      state.activeReportTab = 'statement';
      navigate('reports');
    });
  });

  document.querySelectorAll('.btn-delete-client').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteClientModal(btn.dataset.id, btn.dataset.name);
    });
  });
}

// ============================================================================
// 5. EXPENSE MANAGEMENT VIEW
// ============================================================================
async function renderExpenses(container) {
  const expenses = await api('/expenses');
  state.expenses = expenses;

  const totalExpenseBase = expenses.reduce((sum, e) => sum + (e.base_currency_amount || 0), 0);

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">Business Expenses</h1>
        <p style="font-size: 13px; color: #64748b;">Track operational outlays, vendors, and multi-currency expenses</p>
      </div>
      <button id="btn-add-expense" class="btn btn-primary">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Add Expense</span>
      </button>
    </div>

    <!-- Summary Box -->
    <div style="background: #ffffff; border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
      <div>
        <span style="font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 700;">Total Recorded Expenses</span>
        <div style="font-size: 26px; font-weight: 800; color: #dc2626; margin-top: 4px;">${formatBase(totalExpenseBase)}</div>
      </div>
      <div style="font-size: 13px; color: #64748b;">
        ${expenses.length} expense transactions in ledger
      </div>
    </div>

    <!-- Expenses Table -->
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Vendor</th>
            <th>Category</th>
            <th>Description</th>
            <th>Method</th>
            <th>Original Amount</th>
            <th>Base Value</th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${expenses.length === 0 ? `
            <tr><td colspan="8" style="text-align: center; padding: 40px; color: #94a3b8;">No expenses recorded yet.</td></tr>
          ` : expenses.map(e => `
            <tr>
              <td style="color: #64748b;">${e.expense_date}</td>
              <td style="font-weight: 700; color: #0f172a;">${e.vendor}</td>
              <td><span class="badge badge-draft">${e.category_name || 'General'}</span></td>
              <td style="color: #475569;">${e.description}</td>
              <td><span class="badge badge-unpaid">${e.payment_method}</span></td>
              <td style="font-weight: 700; color: #dc2626;">${formatMoney(e.amount, e.currency)}</td>
              <td style="font-weight: 600; color: #64748b;">${formatBase(e.base_currency_amount)}</td>
              <td style="text-align: right;">
                <button class="btn btn-danger btn-sm btn-delete-expense" data-id="${e.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-add-expense').addEventListener('click', openAddExpenseModal);

  document.querySelectorAll('.btn-delete-expense').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete this expense entry?')) {
        await api(`/expenses/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Expense removed', 'info');
        renderExpenses(container);
      }
    });
  });
}

// ============================================================================
// 6. REVENUE STREAMS VIEW
// ============================================================================
async function renderRevenue(container) {
  const data = await api('/revenue');
  const b = data.breakdown;

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">Revenue Analysis</h1>
      <p style="font-size: 13px; color: #64748b;">Clear segregation of Billed vs Collected vs Outstanding revenue</p>
    </div>

    <!-- 3 Core Revenue Pillars -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 28px;">
      
      <div class="stat-card" style="border-top: 4px solid #0284c7;">
        <span class="stat-title">Invoiced Revenue (Billed)</span>
        <div class="stat-value" style="color: #0284c7; margin: 10px 0;">${formatBase(b.invoiced.amountBase)}</div>
        <p style="font-size: 12px; color: #64748b;">Total nominal value of all valid invoices billed across all clients.</p>
      </div>

      <div class="stat-card" style="border-top: 4px solid #16a34a;">
        <span class="stat-title">Collected Revenue (Received)</span>
        <div class="stat-value" style="color: #16a34a; margin: 10px 0;">${formatBase(b.collected.amountBase)}</div>
        <p style="font-size: 12px; color: #64748b;">Actual liquid funds settled into company bank accounts and mobile wallets.</p>
      </div>

      <div class="stat-card" style="border-top: 4px solid #d97706;">
        <span class="stat-title">Outstanding Receivables</span>
        <div class="stat-value" style="color: #d97706; margin: 10px 0;">${formatBase(b.outstanding.amountBase)}</div>
        <p style="font-size: 12px; color: #64748b;">Owed capital currently awaiting client partial or full payment.</p>
      </div>
    </div>

    <!-- Transactions Log -->
    <div class="table-container" style="padding: 24px;">
      <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 16px;">Collected Revenue Transactions</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Client</th>
            <th>Description</th>
            <th>Invoice</th>
            <th>Method</th>
            <th style="text-align: right;">Amount (${state.baseCurrency.code})</th>
          </tr>
        </thead>
        <tbody>
          ${data.transactions.map(r => `
            <tr>
              <td style="color: #64748b;">${r.revenue_date}</td>
              <td style="font-weight: 600; color: #0f172a;">${r.client_name || 'Direct'}</td>
              <td>${r.description}</td>
              <td>${r.invoice_number ? `<span style="color:#0284c7; font-weight:600;">${r.invoice_number}</span>` : '—'}</td>
              <td><span class="badge badge-unpaid">${r.payment_method}</span></td>
              <td style="text-align: right; font-weight: 700; color: #16a34a;">${formatBase(r.base_currency_amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 7. FINANCIAL REPORTS (P&L, Cash Flow, AR Aging, Statements, Taxes)
// ============================================================================
async function renderReports(container) {
  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">Financial Reports</h1>
      <p style="font-size: 13px; color: #64748b;">Audit-grade financial statements, Aging distributions, and Tax calculations</p>
    </div>

    <!-- Report Tabs -->
    <div style="display: flex; gap: 8px; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 12px; overflow-x: auto;">
      <button class="btn btn-sm ${state.activeReportTab === 'pnl' ? 'btn-primary' : 'btn-secondary'}" data-report-tab="pnl">Profit & Loss</button>
      <button class="btn btn-sm ${state.activeReportTab === 'cash-flow' ? 'btn-primary' : 'btn-secondary'}" data-report-tab="cash-flow">Cash Flow</button>
      <button class="btn btn-sm ${state.activeReportTab === 'ar-aging' ? 'btn-primary' : 'btn-secondary'}" data-report-tab="ar-aging">AR Aging</button>
      <button class="btn btn-sm ${state.activeReportTab === 'statement' ? 'btn-primary' : 'btn-secondary'}" data-report-tab="statement">Client Statement</button>
      <button class="btn btn-sm ${state.activeReportTab === 'taxes' ? 'btn-primary' : 'btn-secondary'}" data-report-tab="taxes">Tax Report</button>
      <button class="btn btn-sm ${state.activeReportTab === 'currencies' ? 'btn-primary' : 'btn-secondary'}" data-report-tab="currencies">Currency Report</button>
    </div>

    <div id="report-content-body"></div>
  `;

  document.querySelectorAll('[data-report-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeReportTab = btn.dataset.reportTab;
      renderReports(container);
    });
  });

  const body = document.getElementById('report-content-body');
  switch (state.activeReportTab) {
    case 'pnl':
      await renderReportPnL(body);
      break;
    case 'cash-flow':
      await renderReportCashFlow(body);
      break;
    case 'ar-aging':
      await renderReportArAging(body);
      break;
    case 'statement':
      await renderReportClientStatement(body);
      break;
    case 'taxes':
      await renderReportTaxes(body);
      break;
    case 'currencies':
      await renderReportCurrencies(body);
      break;
  }
}

// 7a. Profit & Loss Statement
async function renderReportPnL(container) {
  const pnl = await api('/reports/pnl');
  container.innerHTML = `
    <div class="table-container" style="padding: 32px; max-width: 900px;">
      <div style="border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: #0f172a;">PROFIT & LOSS STATEMENT</h2>
          <div style="font-size: 12px; color: #64748b;">${state.company?.name || 'Apex Finance'} &bull; Base Currency: ${pnl.reportingCurrency}</div>
        </div>
        <button onclick="window.print()" class="btn btn-secondary btn-sm">Print P&L</button>
      </div>

      <div style="margin-bottom: 28px;">
        <h3 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #16a34a; margin-bottom: 12px;">Operating Revenue</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          ${Object.entries(pnl.revenueBySource).map(([src, val]) => `
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #334155;">${src}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">${formatMoney(val, pnl.reportingCurrency)}</td>
            </tr>
          `).join('')}
          <tr style="font-size: 15px; font-weight: 700; color: #16a34a; border-top: 2px solid #e2e8f0;">
            <td style="padding: 12px 0;">Total Revenue</td>
            <td style="padding: 12px 0; text-align: right;">${formatMoney(pnl.totalRevenue, pnl.reportingCurrency)}</td>
          </tr>
        </table>
      </div>

      <div style="margin-bottom: 28px;">
        <h3 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #dc2626; margin-bottom: 12px;">Operating Expenses</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          ${Object.entries(pnl.expenseByCategory).map(([cat, val]) => `
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #334155;">${cat}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">${formatMoney(val, pnl.reportingCurrency)}</td>
            </tr>
          `).join('')}
          <tr style="font-size: 15px; font-weight: 700; color: #dc2626; border-top: 2px solid #e2e8f0;">
            <td style="padding: 12px 0;">Total Expenses</td>
            <td style="padding: 12px 0; text-align: right;">${formatMoney(pnl.totalExpense, pnl.reportingCurrency)}</td>
          </tr>
        </table>
      </div>

      <div style="background: #f8fafc; border: 2px solid #0284c7; border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 16px; font-weight: 800; color: #0f172a;">NET PROFIT</div>
          <div style="font-size: 12px; color: #64748b;">Operating Margin: ${pnl.profitMargin}%</div>
        </div>
        <div style="font-size: 24px; font-weight: 800; color: ${pnl.netProfit >= 0 ? '#16a34a' : '#dc2626'};">
          ${formatMoney(pnl.netProfit, pnl.reportingCurrency)}
        </div>
      </div>
    </div>
  `;
}

// 7b. Cash Flow Statement
async function renderReportCashFlow(container) {
  const cf = await api('/reports/cash-flow');
  container.innerHTML = `
    <div class="table-container" style="padding: 32px; max-width: 900px;">
      <h2 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 20px;">CASH FLOW STATEMENT</h2>
      
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px;">
          <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #16a34a;">Cash Inflow (Money In)</div>
          <div style="font-size: 22px; font-weight: 800; color: #16a34a; margin-top: 6px;">${formatMoney(cf.moneyIn, cf.reportingCurrency)}</div>
        </div>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 18px;">
          <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #dc2626;">Cash Outflow (Money Out)</div>
          <div style="font-size: 22px; font-weight: 800; color: #dc2626; margin-top: 6px;">${formatMoney(cf.moneyOut, cf.reportingCurrency)}</div>
        </div>
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px;">
          <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #0284c7;">Net Cash Flow</div>
          <div style="font-size: 22px; font-weight: 800; color: ${cf.netCashFlow >= 0 ? '#16a34a' : '#dc2626'}; margin-top: 6px;">${formatMoney(cf.netCashFlow, cf.reportingCurrency)}</div>
        </div>
      </div>
    </div>
  `;
}

// 7c. Accounts Receivable Aging
async function renderReportArAging(container) {
  const ar = await api('/reports/ar-aging');
  const b = ar.buckets;

  container.innerHTML = `
    <div class="table-container" style="padding: 32px;">
      <h2 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 20px;">ACCOUNTS RECEIVABLE AGING</h2>

      <!-- 5 Aging Buckets -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 28px;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #15803d;">CURRENT</div>
          <div style="font-size: 18px; font-weight: 800; color: #15803d; margin-top: 4px;">${formatBase(b.current)}</div>
        </div>
        <div style="background: #fefce8; border: 1px solid #fef08a; border-radius: 8px; padding: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #854d0e;">1–30 DAYS</div>
          <div style="font-size: 18px; font-weight: 800; color: #854d0e; margin-top: 4px;">${formatBase(b.days_1_30)}</div>
        </div>
        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #9a3412;">31–60 DAYS</div>
          <div style="font-size: 18px; font-weight: 800; color: #9a3412; margin-top: 4px;">${formatBase(b.days_31_60)}</div>
        </div>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #b91c1c;">61–90 DAYS</div>
          <div style="font-size: 18px; font-weight: 800; color: #b91c1c; margin-top: 4px;">${formatBase(b.days_61_90)}</div>
        </div>
        <div style="background: #450a0a; color: white; border-radius: 8px; padding: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #fca5a5;">90+ DAYS OVERDUE</div>
          <div style="font-size: 18px; font-weight: 800; color: #ffffff; margin-top: 4px;">${formatBase(b.days_90_plus)}</div>
        </div>
      </div>

      <!-- Invoices Breakdown Table -->
      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Client</th>
            <th>Due Date</th>
            <th>Days Overdue</th>
            <th>Aging Bucket</th>
            <th style="text-align: right;">Original Balance</th>
            <th style="text-align: right;">Base Value (${ar.reportingCurrency})</th>
          </tr>
        </thead>
        <tbody>
          ${ar.invoices.map(inv => `
            <tr>
              <td style="font-weight: 700; color: #0284c7;">${inv.invoiceNumber}</td>
              <td style="font-weight: 600;">${inv.clientName}</td>
              <td>${inv.dueDate}</td>
              <td style="font-weight: 700; color: ${inv.daysOverdue > 0 ? '#dc2626' : '#16a34a'};">${inv.daysOverdue} days</td>
              <td><span class="badge badge-${inv.daysOverdue > 0 ? 'overdue' : 'unpaid'}">${inv.bucket}</span></td>
              <td style="text-align: right; font-weight: 600;">${formatMoney(inv.balanceDueOriginal, inv.originalCurrency)}</td>
              <td style="text-align: right; font-weight: 700; color: #0f172a;">${formatMoney(inv.balanceDueReporting, ar.reportingCurrency)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 7d. Client Statement Generator
async function renderReportClientStatement(container) {
  if (!state.selectedStatementClient && state.clients.length > 0) {
    state.selectedStatementClient = state.clients[0].id;
  }

  container.innerHTML = `
    <div style="background: #ffffff; border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="flex: 1;">
          <label class="form-label">Select Client</label>
          <select id="stmt-client-select" class="form-control">
            ${state.clients.map(c => `
              <option value="${c.id}" ${state.selectedStatementClient === c.id ? 'selected' : ''}>${c.company_name} (${c.preferred_currency})</option>
            `).join('')}
          </select>
        </div>
        <button id="btn-generate-statement" class="btn btn-primary" style="margin-top: 22px;">Generate Statement</button>
      </div>
    </div>

    <div id="statement-output"></div>
  `;

  document.getElementById('stmt-client-select').addEventListener('change', (e) => {
    state.selectedStatementClient = e.target.value;
  });

  document.getElementById('btn-generate-statement').addEventListener('click', () => loadStatementData());

  loadStatementData();
}

async function loadStatementData() {
  const output = document.getElementById('statement-output');
  if (!state.selectedStatementClient) return;

  const stmt = await api(`/reports/client-statement?clientId=${state.selectedStatementClient}`);
  output.innerHTML = `
    <div class="table-container" style="padding: 32px;">
      <div style="border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between;">
        <div>
          <h2 style="font-size: 22px; font-weight: 800; color: #0f172a;">ACCOUNT STATEMENT</h2>
          <div style="font-size: 13px; color: #475569; margin-top: 4px;">Client: <strong>${stmt.client.company_name}</strong> &bull; Currency: <strong>${stmt.targetCurrency}</strong></div>
        </div>
        <button onclick="window.print()" class="btn btn-secondary btn-sm">Print Statement</button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
        <div style="background: #f8fafc; padding: 14px; border-radius: 8px;">
          <div style="font-size: 11px; color: #64748b; font-weight: 700;">OPENING BALANCE</div>
          <div style="font-size: 18px; font-weight: 800; color: #0f172a;">${formatBase(stmt.openingBalance)}</div>
        </div>
        <div style="background: #f0fdf4; padding: 14px; border-radius: 8px;">
          <div style="font-size: 11px; color: #16a34a; font-weight: 700;">TOTAL SETTLED</div>
          <div style="font-size: 18px; font-weight: 800; color: #16a34a;">${formatBase(stmt.totalPaid)}</div>
        </div>
        <div style="background: #fef2f2; padding: 14px; border-radius: 8px;">
          <div style="font-size: 11px; color: #dc2626; font-weight: 700;">CLOSING OUTSTANDING BALANCE</div>
          <div style="font-size: 18px; font-weight: 800; color: ${stmt.closingBalance > 0 ? '#dc2626' : '#16a34a'};">${formatBase(stmt.closingBalance)}</div>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Reference</th>
            <th>Description</th>
            <th style="text-align: right;">Amount</th>
            <th style="text-align: right;">Running Balance (${state.baseCurrency.code})</th>
          </tr>
        </thead>
        <tbody>
          ${stmt.ledger.map(row => `
            <tr>
              <td>${row.date}</td>
              <td><span class="badge badge-${row.type === 'INVOICE' ? 'unpaid' : 'completed'}">${row.type}</span></td>
              <td style="font-weight: 600;">${row.reference}</td>
              <td>${row.description}</td>
              <td style="text-align: right; font-weight: 700; color: ${row.amount > 0 ? '#dc2626' : '#16a34a'};">
                ${formatMoney(row.amount, row.currency)}
              </td>
              <td style="text-align: right; font-weight: 700; color: #0f172a;">
                ${formatBase(row.runningBalanceBase)}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 7e. Taxes Report
async function renderReportTaxes(container) {
  const tax = await api('/reports/taxes');
  container.innerHTML = `
    <div class="table-container" style="padding: 32px;">
      <h2 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 20px;">TAX COLLECTION REPORT</h2>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px;">
          <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #16a34a;">Output Tax (Collected on Invoices)</div>
          <div style="font-size: 26px; font-weight: 800; color: #16a34a; margin-top: 6px;">${formatBase(tax.totalTaxCollectedBase)}</div>
        </div>
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 20px;">
          <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #0284c7;">Input Tax (Paid on Expenses)</div>
          <div style="font-size: 26px; font-weight: 800; color: #0284c7; margin-top: 6px;">${formatBase(tax.totalExpenseTaxBase)}</div>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Tax Code</th>
            <th>Tax Name</th>
            <th>Rate (%)</th>
            <th style="text-align: right;">Total Tax Collected (${state.baseCurrency.code})</th>
          </tr>
        </thead>
        <tbody>
          ${tax.collectedTaxes.map(t => `
            <tr>
              <td><span class="badge badge-unpaid">${t.tax_code || 'STANDARD'}</span></td>
              <td style="font-weight: 600;">${t.tax_name || 'Standard Tax'}</td>
              <td>${t.percentage}%</td>
              <td style="text-align: right; font-weight: 700; color: #16a34a;">${formatBase(t.total_tax_collected_base)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 7f. Currency Report
async function renderReportCurrencies(container) {
  const curr = await api('/reports/currencies');
  container.innerHTML = `
    <div class="table-container" style="padding: 32px;">
      <h2 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 20px;">MULTI-CURRENCY EXPOSURE REPORT</h2>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div>
          <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">Invoiced by Currency</h3>
          <table class="data-table">
            <thead>
              <tr><th>Currency</th><th>Invoices</th><th style="text-align: right;">Nominal Amount</th></tr>
            </thead>
            <tbody>
              ${curr.invoicesByCurrency.map(c => `
                <tr>
                  <td><span class="badge badge-unpaid">${c.currency}</span></td>
                  <td>${c.count}</td>
                  <td style="text-align: right; font-weight: 700;">${formatMoney(c.total_original, c.currency)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div>
          <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">Collected by Currency</h3>
          <table class="data-table">
            <thead>
              <tr><th>Currency</th><th>Payments</th><th style="text-align: right;">Nominal Amount</th></tr>
            </thead>
            <tbody>
              ${curr.paymentsByCurrency.map(c => `
                <tr>
                  <td><span class="badge badge-completed">${c.currency}</span></td>
                  <td>${c.count}</td>
                  <td style="text-align: right; font-weight: 700; color: #16a34a;">${formatMoney(c.total_original, c.currency)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// 8. INVOICE TEMPLATE BUILDER & LIVE PREVIEW
// ============================================================================
async function renderTemplates(container) {
  const templates = await api('/templates');

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">Invoice Templates & Branding</h1>
      <p style="font-size: 13px; color: #64748b;">Customize styling, layout schemes, colors, and live render previews</p>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
      <!-- Template Editor Controls -->
      <div class="table-container" style="padding: 24px;">
        <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 18px;">Customize Template</h3>
        
        <div class="form-group">
          <label class="form-label">Select Active Template</label>
          <select id="tpl-select" class="form-control">
            ${templates.map(t => `<option value="${t.id}">${t.name} ${t.is_default ? '(Default)' : ''}</option>`).join('')}
          </select>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Primary Color</label>
            <input type="color" id="tpl-primary" class="form-control" style="height: 42px; padding: 2px;" value="#0284c7">
          </div>
          <div class="form-group">
            <label class="form-label">Secondary Color</label>
            <input type="color" id="tpl-secondary" class="form-control" style="height: 42px; padding: 2px;" value="#0f172a">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Font Family</label>
            <select id="tpl-font" class="form-control">
              <option value="Inter, sans-serif">Inter (Modern Clean)</option>
              <option value="'Plus Jakarta Sans', sans-serif">Plus Jakarta Sans</option>
              <option value="'Roboto', sans-serif">Roboto (Corporate)</option>
              <option value="'Georgia', serif">Georgia (Classic Serif)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Layout Style</label>
            <select id="tpl-layout" class="form-control">
              <option value="modern">Modern Executive</option>
              <option value="corporate">Corporate Dense</option>
              <option value="minimalist">Minimalist Clean</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Payment Instructions Note</label>
          <textarea id="tpl-instructions" class="form-control" rows="2">Please wire funds directly to our Standard Chartered account or Mobile Money merchant ID.</textarea>
        </div>

        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button id="btn-save-tpl" class="btn btn-primary">Save Template</button>
          <button id="btn-set-default-tpl" class="btn btn-secondary">Set as Default</button>
        </div>
      </div>

      <!-- Live Preview Container -->
      <div class="table-container" style="padding: 24px; background: #f8fafc;">
        <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">Live Invoice Preview</h3>
        <div id="live-preview-box" style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); font-size: 12px;">
          <!-- Live Preview Simulated Box -->
          <div id="live-preview-content"></div>
        </div>
      </div>
    </div>
  `;

  updateLivePreview();

  document.getElementById('tpl-primary').addEventListener('input', updateLivePreview);
  document.getElementById('tpl-secondary').addEventListener('input', updateLivePreview);
  document.getElementById('tpl-font').addEventListener('change', updateLivePreview);
  document.getElementById('tpl-instructions').addEventListener('input', updateLivePreview);

  document.getElementById('btn-save-tpl').addEventListener('click', async () => {
    try {
      await api('/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Custom Theme ' + new Date().toLocaleTimeString(),
          primary_color: document.getElementById('tpl-primary').value,
          secondary_color: document.getElementById('tpl-secondary').value,
          font_family: document.getElementById('tpl-font').value,
          layout_style: document.getElementById('tpl-layout').value,
          payment_instructions: document.getElementById('tpl-instructions').value
        })
      });
      showToast('Template saved successfully!', 'success');
      renderTemplates(container);
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

function updateLivePreview() {
  const primary = document.getElementById('tpl-primary')?.value || '#0284c7';
  const secondary = document.getElementById('tpl-secondary')?.value || '#0f172a';
  const font = document.getElementById('tpl-font')?.value || 'Inter, sans-serif';
  const instructions = document.getElementById('tpl-instructions')?.value || '';

  const preview = document.getElementById('live-preview-content');
  if (!preview) return;

  preview.style.fontFamily = font;
  preview.innerHTML = `
    <div style="display: flex; justify-content: space-between; border-bottom: 2px solid ${primary}; padding-bottom: 12px; margin-bottom: 14px;">
      <div>
        <div style="font-size: 18px; font-weight: 800; color: ${secondary};">Apex<span style="color:${primary};">Finance</span></div>
        <div style="font-size: 10px; color: #64748b;">Independence Ave, Accra, Ghana</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 18px; font-weight: 800; color: ${primary};">INVOICE</div>
        <div style="font-size: 10px; color: #64748b;">INV-2026-0099</div>
      </div>
    </div>
    <div style="background: #f8fafc; padding: 10px; border-radius: 6px; margin-bottom: 14px; font-size: 11px;">
      <strong>Billed to:</strong> Atlas Cloud Systems Ltd (USD)
    </div>
    <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px;">
      <tr style="background: #f1f5f9; font-weight: 600;">
        <td style="padding: 6px;">Description</td>
        <td style="padding: 6px; text-align: right;">Amount</td>
      </tr>
      <tr>
        <td style="padding: 6px; border-bottom: 1px solid #f1f5f9;">Enterprise Cloud Retainer</td>
        <td style="padding: 6px; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: 600;">$10,000.00</td>
      </tr>
      <tr style="font-weight: 800; font-size: 13px; color: ${primary};">
        <td style="padding: 8px 6px;">Total Due:</td>
        <td style="padding: 8px 6px; text-align: right;">$10,000.00</td>
      </tr>
    </table>
    <div style="font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px;">
      <strong>Payment Instructions:</strong> ${instructions}
    </div>
  `;
}

// ============================================================================
// 9. AUDIT LOGS VIEW
// ============================================================================
async function renderAuditLogs(container) {
  const logs = await api('/audit-logs');

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">Financial Audit Trail</h1>
      <p style="font-size: 13px; color: #64748b;">Immutable ledger tracking user modifications and financial entries</p>
    </div>

    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Entity Type</th>
            <th>Entity ID</th>
            <th>Audit Snapshot</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td style="color: #64748b; white-space: nowrap;">${l.created_at}</td>
              <td>
                <div style="font-weight: 600; color: #0f172a;">${l.user_name || 'System'}</div>
                <div style="font-size: 11px; color: #64748b;">${l.user_role || 'Admin'}</div>
              </td>
              <td><span class="badge badge-unpaid">${l.action}</span></td>
              <td style="font-weight: 600;">${l.entity_type}</td>
              <td style="font-family: monospace; font-size: 11px; color: #64748b;">${l.entity_id}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="alert(JSON.stringify(${JSON.stringify(l.new_value || l.previous_value).replace(/"/g, '&quot;')}, null, 2))">
                  View Diff
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 10. SYSTEM SETTINGS VIEW
// ============================================================================
async function renderSettings(container) {
  const company = await api('/company');
  const currData = await api('/currencies');
  const taxes = await api('/tax-rates');

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 24px; font-weight: 800; color: #0f172a;">System Settings</h1>
      <p style="font-size: 13px; color: #64748b;">Configure company details, multi-currency engine, and tax policies</p>
    </div>

    <!-- Company Settings Form -->
    <div class="table-container" style="padding: 28px; margin-bottom: 28px;">
      <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 18px;">Company Profile & Branding</h3>
      <form id="form-company-settings">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Company Name *</label>
            <input type="text" class="form-control" id="set-company-name" value="${company.name || ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Tax ID / TIN</label>
            <input type="text" class="form-control" id="set-company-tax" value="${company.tax_identification_number || ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Official Email</label>
            <input type="email" class="form-control" id="set-company-email" value="${company.email || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="text" class="form-control" id="set-company-phone" value="${company.phone || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Invoice Prefix</label>
            <input type="text" class="form-control" id="set-company-prefix" value="${company.invoice_prefix || 'INV-'}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-control" id="set-company-address" value="${company.address || ''}">
        </div>

        <div class="form-group">
          <label class="form-label">Payment Instructions (Wire & Mobile Money Details)</label>
          <textarea class="form-control" id="set-company-instructions" rows="2">${company.payment_instructions || ''}</textarea>
        </div>

        <button type="submit" class="btn btn-primary">Save Company Profile</button>
      </form>
    </div>

    <!-- Currency Management Table -->
    <div class="table-container" style="padding: 28px; margin-bottom: 28px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div>
          <h3 style="font-size: 16px; font-weight: 700; color: #0f172a;">Currencies System</h3>
          <p style="font-size: 12px; color: #64748b;">Set your default/base reporting currency and toggle active currencies</p>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Symbol</th>
            <th>Status</th>
            <th>Role</th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${currData.currencies.map(c => `
            <tr>
              <td style="font-weight: 700; color: #0f172a;">${c.code}</td>
              <td>${c.name}</td>
              <td style="font-weight: 700;">${c.symbol}</td>
              <td>
                <span class="badge ${c.is_active ? 'badge-completed' : 'badge-draft'}">${c.is_active ? 'Active' : 'Disabled'}</span>
              </td>
              <td>
                ${c.is_base ? '<span class="badge badge-paid">Base Currency</span>' : '<span style="color:#64748b; font-size:12px;">Supported</span>'}
              </td>
              <td style="text-align: right;">
                ${!c.is_base ? `
                  <button class="btn btn-secondary btn-sm btn-set-base" data-code="${c.code}">Set as Base</button>
                ` : '<span style="font-size: 11px; color:#16a34a; font-weight:700;">Default</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Tax Rates Table -->
    <div class="table-container" style="padding: 28px;">
      <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">Configurable Taxes</h3>
      <p style="font-size: 12px; color: #64748b; margin-bottom: 16px;">Applied flexibly across individual invoice line items</p>

      <table class="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Tax Name</th>
            <th>Percentage</th>
            <th>Description</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${taxes.map(t => `
            <tr>
              <td><span class="badge badge-unpaid">${t.code}</span></td>
              <td style="font-weight: 600; color: #0f172a;">${t.name}</td>
              <td style="font-weight: 700;">${t.percentage}%</td>
              <td style="color: #64748b;">${t.description}</td>
              <td><span class="badge badge-completed">Active</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('form-company-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/company', {
        method: 'PUT',
        body: JSON.stringify({
          name: document.getElementById('set-company-name').value,
          tax_identification_number: document.getElementById('set-company-tax').value,
          email: document.getElementById('set-company-email').value,
          phone: document.getElementById('set-company-phone').value,
          invoice_prefix: document.getElementById('set-company-prefix').value,
          address: document.getElementById('set-company-address').value,
          payment_instructions: document.getElementById('set-company-instructions').value
        })
      });
      showToast('Company profile updated!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.querySelectorAll('.btn-set-base').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/currencies/${btn.dataset.code}/base`, { method: 'PUT' });
        showToast(`Default base currency updated to ${btn.dataset.code}`, 'success');
        const currData = await api('/currencies');
        state.currencies = currData.currencies;
        state.baseCurrency = currData.baseCurrency;
        renderSettings(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

// ============================================================================
// MODAL CONTROLLERS & FORM LOGIC
// ============================================================================

// 1. Create Invoice Modal
async function openCreateInvoiceModal() {
  const [clients, currData, templates] = await Promise.all([
    api('/clients'),
    api('/currencies'),
    api('/templates')
  ]);
  state.clients = clients;

  // Populate Clients
  const clientSel = document.getElementById('inv-client');
  clientSel.innerHTML = clients.map(c => `<option value="${c.id}" data-currency="${c.preferred_currency}">${c.company_name} (${c.preferred_currency})</option>`).join('');

  // Populate Currencies
  const currSel = document.getElementById('inv-currency');
  currSel.innerHTML = currData.currencies.map(c => `<option value="${c.code}" ${c.code === 'USD' ? 'selected' : ''}>${c.code} — ${c.name}</option>`).join('');

  // Populate Templates
  const tplSel = document.getElementById('inv-template');
  tplSel.innerHTML = templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

  // Set default dates
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  document.getElementById('inv-issue-date').value = today;
  document.getElementById('inv-due-date').value = due;

  // Default Line item
  const container = document.getElementById('invoice-items-container');
  container.innerHTML = '';
  addInvoiceLineItem();

  // Exchange rate lookup
  updateInvoiceExchangeRate();
  clientSel.onchange = () => {
    const selected = clientSel.options[clientSel.selectedIndex];
    const preferred = selected.dataset.currency;
    if (preferred) {
      currSel.value = preferred;
      updateInvoiceExchangeRate();
    }
  };
  currSel.onchange = updateInvoiceExchangeRate;

  // Recalculate summary on discount changes
  document.getElementById('inv-discount-type').onchange = recalculateInvoiceSummary;
  document.getElementById('inv-discount-val').oninput = recalculateInvoiceSummary;

  document.getElementById('modal-invoice').classList.add('open');
}

function updateInvoiceExchangeRate() {
  const code = document.getElementById('inv-currency').value;
  const rateInput = document.getElementById('inv-rate');

  if (code === state.baseCurrency.code) {
    rateInput.value = '1.0';
  } else if (code === 'USD') {
    rateInput.value = '15.20';
  } else if (code === 'EUR') {
    rateInput.value = '16.50';
  } else if (code === 'GBP') {
    rateInput.value = '19.30';
  } else if (code === 'NGN') {
    rateInput.value = '0.010';
  } else if (code === 'CAD') {
    rateInput.value = '11.10';
  } else {
    rateInput.value = '1.0';
  }

  recalculateInvoiceSummary();
}

function addInvoiceLineItem(desc = '', qty = 1, price = 0, taxId = '') {
  const container = document.getElementById('invoice-items-container');
  const index = container.children.length;
  const div = document.createElement('div');
  div.className = 'invoice-line-row';
  div.style.cssText = 'display: grid; grid-template-columns: 3fr 1fr 1.5fr 1.5fr 1fr 30px; gap: 8px; margin-bottom: 10px; align-items: center;';

  div.innerHTML = `
    <input type="text" class="form-control item-desc" placeholder="Service / Item Description" value="${desc}" required>
    <input type="number" step="0.01" class="form-control item-qty" placeholder="Qty" value="${qty}" required min="0.01">
    <input type="number" step="0.01" class="form-control item-price" placeholder="Unit Price" value="${price}" required min="0">
    <select class="form-control item-tax">
      <option value="">No Tax (0%)</option>
      ${state.taxRates.map(t => `<option value="${t.id}" data-pct="${t.percentage}">${t.name} (${t.percentage}%)</option>`).join('')}
    </select>
    <input type="text" class="form-control item-line-total" style="background: #f1f5f9; font-weight: 700; text-align: right;" readonly value="$0.00">
    <button type="button" class="btn btn-secondary btn-sm btn-remove-item" style="padding: 4px 8px; color: #dc2626;">&times;</button>
  `;

  container.appendChild(div);

  div.querySelectorAll('input, select').forEach(el => el.addEventListener('input', recalculateInvoiceSummary));
  div.querySelector('.btn-remove-item').addEventListener('click', () => {
    div.remove();
    recalculateInvoiceSummary();
  });

  recalculateInvoiceSummary();
}

document.getElementById('btn-add-line-item').addEventListener('click', () => addInvoiceLineItem());

function recalculateInvoiceSummary() {
  const currencyCode = document.getElementById('inv-currency')?.value || 'USD';
  const exchangeRate = parseFloat(document.getElementById('inv-rate')?.value) || 1.0;
  const rows = document.querySelectorAll('.invoice-line-row');

  let subtotal = 0;
  let totalTax = 0;

  rows.forEach(row => {
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const taxSelect = row.querySelector('.item-tax');
    const taxPct = taxSelect.selectedIndex > 0 ? parseFloat(taxSelect.options[taxSelect.selectedIndex].dataset.pct) || 0 : 0;

    const lineRaw = qty * price;
    const lineTax = (lineRaw * taxPct) / 100;
    const lineTotal = lineRaw + lineTax;

    row.querySelector('.item-line-total').value = formatMoney(lineTotal, currencyCode);

    subtotal += lineRaw;
    totalTax += lineTax;
  });

  const discType = document.getElementById('inv-discount-type').value;
  const discVal = parseFloat(document.getElementById('inv-discount-val').value) || 0;
  let discountAmount = 0;

  if (discType === 'percent' && discVal > 0) {
    discountAmount = (subtotal * discVal) / 100;
  } else if (discType === 'fixed' && discVal > 0) {
    discountAmount = Math.min(discVal, subtotal);
  }

  const grandTotal = Math.max(0, subtotal - discountAmount + totalTax);
  const baseTotal = grandTotal * exchangeRate;

  document.getElementById('summary-subtotal').innerText = formatMoney(subtotal, currencyCode);
  document.getElementById('summary-tax').innerText = formatMoney(totalTax, currencyCode);
  document.getElementById('summary-discount').innerText = `-${formatMoney(discountAmount, currencyCode)}`;
  document.getElementById('summary-total').innerText = formatMoney(grandTotal, currencyCode);
  document.getElementById('summary-base-total').innerText = formatBase(baseTotal);
}

// Form Submit: Invoice
document.getElementById('form-invoice').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const clientId = document.getElementById('inv-client').value;
    const currency = document.getElementById('inv-currency').value;
    const exchangeRate = parseFloat(document.getElementById('inv-rate').value);
    const issueDate = document.getElementById('inv-issue-date').value;
    const dueDate = document.getElementById('inv-due-date').value;
    const templateId = document.getElementById('inv-template').value;
    const discountType = document.getElementById('inv-discount-type').value;
    const discountValue = parseFloat(document.getElementById('inv-discount-val').value) || 0;
    const notes = document.getElementById('inv-notes').value;
    const terms = document.getElementById('inv-terms').value;

    const items = [];
    document.querySelectorAll('.invoice-line-row').forEach((row, i) => {
      items.push({
        description: row.querySelector('.item-desc').value,
        quantity: parseFloat(row.querySelector('.item-qty').value),
        unit_price: parseFloat(row.querySelector('.item-price').value),
        tax_rate_id: row.querySelector('.item-tax').value || undefined,
        line_order: i
      });
    });

    if (items.length === 0) throw new Error('At least one line item is required');

    await api('/invoices', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        currency,
        exchange_rate: exchangeRate,
        issue_date: issueDate,
        due_date: dueDate,
        template_id: templateId,
        discount_type: discountType,
        discount_value: discountValue,
        notes,
        terms,
        items
      })
    });

    showToast('Invoice generated successfully!', 'success');
    document.getElementById('modal-invoice').classList.remove('open');
    if (state.activeNav === 'invoices') renderInvoices(document.getElementById('app-view'));
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// 2. Record Payment Modal
async function openRecordPaymentModal(options = {}) {
  const [clients, invoices] = await Promise.all([
    api('/clients'),
    api('/invoices?status=all')
  ]);
  state.clients = clients;
  state.invoices = invoices;

  const clientSel = document.getElementById('pay-client');
  clientSel.innerHTML = clients.map(c => `<option value="${c.id}">${c.company_name}</option>`).join('');

  if (options.clientId) clientSel.value = options.clientId;

  const filterInvoicesForClient = () => {
    const cId = clientSel.value;
    const invSel = document.getElementById('pay-invoice');
    const eligible = state.invoices.filter(i => i.client_id === cId && i.balance_due > 0);

    if (eligible.length === 0) {
      invSel.innerHTML = '<option value="">No outstanding invoices for this client</option>';
      document.getElementById('pay-invoice-info').style.display = 'none';
      return;
    }

    invSel.innerHTML = eligible.map(i => `
      <option value="${i.id}" data-total="${i.total_amount}" data-balance="${i.balance_due}" data-paid="${i.amount_paid}" data-currency="${i.currency}" data-due="${i.due_date}">
        ${i.invoice_number} — Total: ${formatMoney(i.total_amount, i.currency)} | Balance Due: ${formatMoney(i.balance_due, i.currency)}
      </option>
    `).join('');

    if (options.invoiceId) invSel.value = options.invoiceId;
    updatePaymentInvoiceInfo();
  };

  clientSel.onchange = filterInvoicesForClient;
  document.getElementById('pay-invoice').onchange = updatePaymentInvoiceInfo;
  document.getElementById('pay-amount').oninput = updatePaymentProgressSimulation;

  filterInvoicesForClient();

  document.getElementById('pay-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('modal-payment').classList.add('open');
}

function updatePaymentInvoiceInfo() {
  const invSel = document.getElementById('pay-invoice');
  const infoBox = document.getElementById('pay-invoice-info');
  const currInput = document.getElementById('pay-currency');
  const amountInput = document.getElementById('pay-amount');

  if (!invSel.value) {
    infoBox.style.display = 'none';
    currInput.value = '';
    return;
  }

  const opt = invSel.options[invSel.selectedIndex];
  const balance = parseFloat(opt.dataset.balance);
  const total = parseFloat(opt.dataset.total);
  const paid = parseFloat(opt.dataset.paid);
  const curr = opt.dataset.currency;

  currInput.value = curr;
  amountInput.value = balance.toFixed(2); // Pre-fill with remaining balance due

  infoBox.style.display = 'block';
  infoBox.innerHTML = `
    <div style="display: flex; justify-content: space-between; font-weight: 700;">
      <span>Total: ${formatMoney(total, curr)}</span>
      <span>Already Settled: ${formatMoney(paid, curr)}</span>
      <span>Remaining Due: ${formatMoney(balance, curr)}</span>
    </div>
  `;

  updatePaymentProgressSimulation();
}

function updatePaymentProgressSimulation() {
  const invSel = document.getElementById('pay-invoice');
  const opt = invSel.options[invSel.selectedIndex];
  if (!opt || !opt.dataset.total) return;

  const total = parseFloat(opt.dataset.total);
  const alreadyPaid = parseFloat(opt.dataset.paid) || 0;
  const balance = parseFloat(opt.dataset.balance);
  const enteredAmount = parseFloat(document.getElementById('pay-amount').value) || 0;
  const curr = opt.dataset.currency;

  const newTotalPaid = alreadyPaid + enteredAmount;
  const pct = Math.min(100, Math.max(0, Math.round((newTotalPaid / total) * 100)));
  const newBalance = Math.max(0, total - newTotalPaid);

  const preview = document.getElementById('pay-progress-preview');
  preview.style.display = 'block';
  document.getElementById('pay-progress-fill').style.width = `${pct}%`;
  document.getElementById('pay-percent-text').innerText = `${pct}% Settled`;
  document.getElementById('pay-remaining-note').innerText = `After this payment: ${formatMoney(newTotalPaid, curr)} Paid / Remaining Balance: ${formatMoney(newBalance, curr)}`;

  // Overpayment Warning check
  const warning = document.getElementById('overpayment-warning');
  if (enteredAmount > balance + 0.001) {
    warning.style.display = 'block';
  } else {
    warning.style.display = 'none';
    document.getElementById('pay-allow-overpayment').checked = false;
  }
}

// Form Submit: Payment
document.getElementById('form-payment').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const clientId = document.getElementById('pay-client').value;
    const invoiceId = document.getElementById('pay-invoice').value;
    const amount = parseFloat(document.getElementById('pay-amount').value);
    const currency = document.getElementById('pay-currency').value;
    const paymentDate = document.getElementById('pay-date').value;
    const paymentMethod = document.getElementById('pay-method').value;
    const referenceNumber = document.getElementById('pay-ref').value;
    const notes = document.getElementById('pay-notes').value;
    const allowOverpayment = document.getElementById('pay-allow-overpayment').checked;

    await api('/payments', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        invoice_id: invoiceId || undefined,
        amount,
        currency,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        notes,
        allow_overpayment: allowOverpayment
      })
    });

    showToast('Payment recorded successfully!', 'success');
    document.getElementById('modal-payment').classList.remove('open');
    renderCurrentView();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// 3. Payment Reversal Confirm Handler
document.getElementById('btn-confirm-reversal').addEventListener('click', async () => {
  const reason = document.getElementById('reverse-reason').value;
  if (!reason.trim()) {
    alert('Please enter a reversal reason');
    return;
  }

  try {
    await api(`/payments/${state.reversingPaymentId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    showToast('Payment successfully reversed and balances restored', 'info');
    document.getElementById('modal-reverse').classList.remove('open');
    renderCurrentView();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// 4. Add Client Modal
async function openAddClientModal() {
  const currSel = document.getElementById('client-currency');
  currSel.innerHTML = state.currencies.map(c => `<option value="${c.code}" ${c.code === 'USD' ? 'selected' : ''}>${c.code} (${c.symbol})</option>`).join('');
  document.getElementById('modal-client').classList.add('open');
}

document.getElementById('form-client').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/clients', {
      method: 'POST',
      body: JSON.stringify({
        company_name: document.getElementById('client-name').value,
        contact_person: document.getElementById('client-contact').value,
        email: document.getElementById('client-email').value,
        phone: document.getElementById('client-phone').value,
        preferred_currency: document.getElementById('client-currency').value,
        payment_terms: parseInt(document.getElementById('client-terms').value, 10),
        tax_id: document.getElementById('client-tax-id').value,
        address: document.getElementById('client-address').value
      })
    });
    showToast('Client created successfully!', 'success');
    document.getElementById('modal-client').classList.remove('open');
    if (state.activeNav === 'clients') renderClients(document.getElementById('app-view'));
  } catch (err) {
    showToast(err.message, 'error');
  }
});

let deletingClientId = null;
function openDeleteClientModal(id, name) {
  deletingClientId = id;
  document.getElementById('delete-client-name').innerText = name;
  document.getElementById('modal-delete-client').classList.add('open');
}

document.getElementById('btn-confirm-delete-client').addEventListener('click', async () => {
  if (!deletingClientId) return;
  try {
    const res = await api(`/clients/${deletingClientId}`, { method: 'DELETE' });
    showToast(res.message || 'Client profile updated successfully', 'success');
    document.getElementById('modal-delete-client').classList.remove('open');
    deletingClientId = null;
    if (state.activeNav === 'clients') renderClients(document.getElementById('app-view'));
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// 5. Add Expense Modal
async function openAddExpenseModal() {
  const catSel = document.getElementById('exp-category');
  const categories = await api('/expenses/categories');
  catSel.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const currSel = document.getElementById('exp-currency');
  currSel.innerHTML = state.currencies.map(c => `<option value="${c.code}" ${c.code === state.baseCurrency.code ? 'selected' : ''}>${c.code} (${c.symbol})</option>`).join('');

  document.getElementById('exp-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('modal-expense').classList.add('open');
}

document.getElementById('form-expense').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({
        vendor: document.getElementById('exp-vendor').value,
        category_id: document.getElementById('exp-category').value,
        description: document.getElementById('exp-description').value,
        amount: parseFloat(document.getElementById('exp-amount').value),
        currency: document.getElementById('exp-currency').value,
        expense_date: document.getElementById('exp-date').value,
        payment_method: document.getElementById('exp-method').value,
        reference_number: document.getElementById('exp-ref').value
      })
    });
    showToast('Expense recorded!', 'success');
    document.getElementById('modal-expense').classList.remove('open');
    if (state.activeNav === 'expenses') renderExpenses(document.getElementById('app-view'));
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ============================================================================
// Global Search, Notifications & Navigation Setup
// ============================================================================
function setupSearch() {
  const searchInput = document.getElementById('global-search');
  const dropdown = document.getElementById('search-results-dropdown');
  let timeout = null;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(timeout);
    const query = e.target.value.trim();
    if (!query) {
      dropdown.style.display = 'none';
      return;
    }

    timeout = setTimeout(async () => {
      try {
        const data = await api(`/search?q=${encodeURIComponent(query)}`);
        if (data.results.length === 0) {
          dropdown.innerHTML = '<div style="padding: 16px; font-size: 13px; color: #94a3b8; text-align: center;">No matches found</div>';
        } else {
          dropdown.innerHTML = data.results.map(r => `
            <div class="search-item" data-type="${r.type}" data-id="${r.id}" style="padding: 10px 16px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
              <div>
                <div style="font-weight: 600; font-size: 13px; color: #0f172a;">${r.title}</div>
                <div style="font-size: 11px; color: #64748b;">${r.subtitle || ''}</div>
              </div>
              <span class="badge badge-unpaid">${r.type}</span>
            </div>
          `).join('');

          dropdown.querySelectorAll('.search-item').forEach(el => {
            el.addEventListener('click', () => {
              dropdown.style.display = 'none';
              searchInput.value = '';
              const type = el.dataset.type;
              if (type === 'client') navigate('clients');
              else if (type === 'invoice') navigate('invoices');
              else if (type === 'payment') navigate('payments');
              else if (type === 'expense') navigate('expenses');
            });
          });
        }
        dropdown.style.display = 'block';
      } catch (err) {
        console.error(err);
      }
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

async function loadNotifications() {
  try {
    const notifications = await api('/notifications');
    state.notifications = notifications;
    const unread = notifications.filter(n => !n.is_read);

    const badge = document.getElementById('notif-badge');
    if (unread.length > 0) {
      badge.style.display = 'flex';
      badge.innerText = unread.length;
    } else {
      badge.style.display = 'none';
    }

    const list = document.getElementById('notif-list');
    list.innerHTML = notifications.length === 0 
      ? '<div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 12px;">No notifications</div>'
      : notifications.map(n => `
        <div style="padding: 12px 16px; border-bottom: 1px solid #f1f5f9; ${n.is_read ? 'opacity: 0.6;' : 'background: #f8fafc;'}; font-size: 12px;">
          <div style="font-weight: 700; color: #0f172a;">${n.title}</div>
          <div style="color: #475569; margin-top: 2px;">${n.message}</div>
          <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">${n.created_at}</div>
        </div>
      `).join('');
  } catch (err) {
    console.error(err);
  }
}

function setupEventListeners() {
  // Sidebar navigation clicks
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });

  // Quick Action Buttons
  document.getElementById('btn-quick-invoice').addEventListener('click', openCreateInvoiceModal);
  document.getElementById('btn-quick-payment').addEventListener('click', () => openRecordPaymentModal());

  // Notifications Bell toggle
  const btnNotif = document.getElementById('btn-notifications');
  const dropdownNotif = document.getElementById('notif-dropdown');
  btnNotif.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownNotif.style.display = dropdownNotif.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', () => {
    dropdownNotif.style.display = 'none';
  });

  document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
    await api('/notifications/read-all', { method: 'PUT' });
    loadNotifications();
  });

  // Close modals
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Logout Handlers
  const handleLogout = () => {
    localStorage.clear();
    sessionStorage.clear();
    showToast('Logged out successfully', 'info');
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);

  const btnHeaderLogout = document.getElementById('btn-header-logout');
  if (btnHeaderLogout) btnHeaderLogout.addEventListener('click', handleLogout);
}

// Start application
window.addEventListener('DOMContentLoaded', initApp);
