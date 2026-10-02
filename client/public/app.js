/**
 * ApexFinance SaaS — Modern Frontend Application
 */

const state = {
  user: null,
  company: null,
  myCompanies: [],
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
  reversingPaymentId: null,
  sseConnection: null
};

let listenersInitialized = false;

// API Helper with Multi-Tenant Bearer Authentication
async function api(path, options = {}) {
  const token = localStorage.getItem('apex_token');
  const headers = { 
    'Content-Type': 'application/json', 
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}) 
  };
  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401) {
    showAuthOverlay();
    throw new Error('Authentication required. Please sign in.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

function showAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function hideAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'none';
}

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
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

// Sidebar User Profile Updates
function updateSidebarUser() {
  if (!state.user) return;
  const initials = state.user.fullName ? state.user.fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'US';
  const avatarEl = document.getElementById('sidebar-user-avatar');
  if (avatarEl) avatarEl.innerText = initials;
  const nameEl = document.getElementById('sidebar-user-name');
  if (nameEl) nameEl.innerText = state.user.fullName;
  const roleEl = document.getElementById('sidebar-user-role');
  if (roleEl) {
    roleEl.innerText = `${state.user.role} • ${state.company?.default_currency || state.baseCurrency?.code || 'GHS'} Base`;
  }
}

// Header Company Switcher Updates
function updateCompanySwitcher() {
  const comp = state.company;
  if (!comp) return;

  const avatar = document.getElementById('header-company-avatar');
  if (avatar) {
    const initials = comp.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    avatar.innerText = initials;
  }

  const nameEl = document.getElementById('header-company-name');
  if (nameEl) nameEl.innerText = comp.name;

  const currBadge = document.getElementById('header-currency-badge');
  if (currBadge) currBadge.innerText = comp.default_currency || 'GHS';

  const countBadge = document.getElementById('company-count-badge');
  if (countBadge) countBadge.innerText = state.myCompanies.length;

  const listEl = document.getElementById('company-switcher-list');
  if (listEl) {
    listEl.innerHTML = state.myCompanies.map(c => {
      const isActive = c.id === comp.id;
      const initials = c.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      return `
        <div class="company-switch-item ${isActive ? 'active' : ''}" data-company-id="${c.id}" style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background 0.15s ease; ${isActive ? 'background: #f0fdf4;' : ''}">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <div style="width: 28px; height: 28px; border-radius: 6px; background: ${isActive ? '#16a34a' : '#0284c7'}; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; flex-shrink: 0;">
              ${initials}
            </div>
            <div style="min-width: 0;">
              <div style="font-weight: 600; font-size: 13px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
                ${c.name}
              </div>
              <div style="font-size: 11px; color: #64748b;">
                ${c.role_name || 'Member'} &bull; <span style="font-weight: 600; color: #0284c7;">${c.default_currency || 'USD'}</span>
              </div>
            </div>
          </div>
          <div>
            ${isActive ? '<span style="color: #16a34a; font-weight: 800; font-size: 14px;">✓</span>' : '<span style="font-size: 11px; color: #94a3b8;">Switch &rarr;</span>'}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.company-switch-item').forEach(item => {
      item.addEventListener('click', async () => {
        const targetId = item.dataset.companyId;
        const dropdown = document.getElementById('company-switcher-dropdown');
        if (dropdown) dropdown.style.display = 'none';
        await switchCompany(targetId);
      });
    });
  }
}

// Switch Company Functionality
async function switchCompany(targetCompanyId) {
  if (state.company && state.company.id === targetCompanyId) return;
  try {
    const res = await api('/auth/switch-company', {
      method: 'POST',
      body: JSON.stringify({ companyId: targetCompanyId })
    });
    localStorage.setItem('apex_token', res.token);
    state.company = res.company;
    state.user.role = res.role;
    state.user.companyId = res.companyId;
    state.user.companyName = res.companyName;

    // Refresh lookups for the new company
    const [currData, taxes, myComps] = await Promise.all([
      api('/currencies'),
      api('/tax-rates'),
      api('/companies/my-companies')
    ]);
    state.currencies = currData.currencies;
    state.baseCurrency = currData.baseCurrency;
    state.taxRates = taxes;
    state.dashboardSelectedCurrency = state.baseCurrency.code;
    state.myCompanies = myComps;

    // SSE reconnect to company event stream
    setupSSE();

    // UI Updates
    updateSidebarUser();
    updateCompanySwitcher();
    showToast(`Switched active workspace to ${res.companyName}`, 'success');

    // Re-render active view
    await renderCurrentView();
    loadNotifications();
  } catch (err) {
    showToast('Failed to switch company: ' + err.message, 'error');
  }
}

// Real-Time Server-Sent Events (SSE) Listener with Tenant Token
function setupSSE() {
  if (state.sseConnection) {
    try { state.sseConnection.close(); } catch {}
  }
  const token = localStorage.getItem('apex_token');
  const sseUrl = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
  const evtSource = new EventSource(sseUrl);
  state.sseConnection = evtSource;

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
// Initialization & Real-Time Sync
// ============================================================================
async function initApp() {
  try {
    const token = localStorage.getItem('apex_token');
    // If no token exists, attempt auto-login demo admin or show auth modal
    if (!token) {
      showAuthOverlay();
      if (!listenersInitialized) {
        setupEventListeners();
        listenersInitialized = true;
      }
      return;
    }

    // 1. Load initial user and company profile
    const authData = await api('/auth/me');
    state.user = authData.user;
    state.company = authData.company;
    state.myCompanies = authData.myCompanies || [];

    hideAuthOverlay();
    updateSidebarUser();
    updateCompanySwitcher();

    // Show/Hide Platform Admin link
    document.querySelectorAll('.platform-only-item').forEach(el => {
      el.style.display = state.user.isSuperAdmin ? 'flex' : 'none';
    });

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
    if (!listenersInitialized) {
      setupEventListeners();
      listenersInitialized = true;
    }

    // 6. Initial Route Render
    await navigate(state.activeNav || 'dashboard');
    loadNotifications();

  } catch (err) {
    console.error('Init error:', err);
    if (err.message && (err.message.includes('Authentication') || err.message.includes('token') || err.message.includes('401'))) {
      localStorage.removeItem('apex_token');
      showAuthOverlay();
      if (!listenersInitialized) {
        setupEventListeners();
        listenersInitialized = true;
      }
    } else {
      showToast('Failed to connect to backend: ' + err.message, 'error');
    }
  }
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
      case 'team':
        await renderTeam(container);
        break;
      case 'platform':
        await renderPlatform(container);
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
          ` : invoices.map(inv => {
            const tokenParam = localStorage.getItem('apex_token') ? `?token=${encodeURIComponent(localStorage.getItem('apex_token'))}` : '';
            return `
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
                  <a href="/api/invoices/${inv.id}/pdf${tokenParam}" target="_blank" class="btn btn-secondary btn-sm" title="View PDF Invoice in Browser">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>View</span>
                  </a>
                  <a href="/api/invoices/${inv.id}/pdf${tokenParam ? tokenParam + '&download=true' : '?download=true'}" target="_blank" class="btn btn-secondary btn-sm" title="Download PDF Invoice">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </a>
                  ${inv.status === 'Draft' ? `
                    <button class="btn btn-secondary btn-sm btn-send-invoice" data-id="${inv.id}" title="Mark Sent & Dispatch Email">
                      Send
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
          }).join('')}
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
          ` : payments.map(p => {
            const tokenParam = localStorage.getItem('apex_token') ? `?token=${encodeURIComponent(localStorage.getItem('apex_token'))}` : '';
            return `
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
                  <a href="/api/payments/${p.id}/pdf${tokenParam}" target="_blank" class="btn btn-secondary btn-sm" title="View Official Receipt in Browser">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>Receipt</span>
                  </a>
                  <a href="/api/payments/${p.id}/pdf${tokenParam ? tokenParam + '&download=true' : '?download=true'}" target="_blank" class="btn btn-secondary btn-sm" title="Download Official Receipt">
                    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </a>
                  ${p.status === 'Completed' ? `
                    <button class="btn btn-danger btn-sm btn-reverse-payment" data-id="${p.id}" title="Reverse Payment">
                      Reverse
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
          }).join('')}
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

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Country</label>
            <select class="form-control" id="set-company-country">
              ${['Ghana', 'Nigeria', 'Kenya', 'South Africa', 'United States', 'United Kingdom', 'Canada', 'Germany', 'France', 'United Arab Emirates', 'Other'].map(cn => `
                <option value="${cn}" ${(company.country || 'Ghana') === cn ? 'selected' : ''}>${cn}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Address</label>
            <input type="text" class="form-control" id="set-company-address" value="${company.address || ''}">
          </div>
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
    <div class="table-container" style="padding: 28px; margin-bottom: 28px;">
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

    <!-- Danger Zone: Delete Workspace -->
    ${(state.user.role === 'Administrator' || state.user.isSuperAdmin) ? `
      <div class="table-container" style="padding: 28px; border: 1px solid #fecaca; background: #fffafb;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap;">
          <div>
            <h3 style="font-size: 16px; font-weight: 700; color: #dc2626; margin-bottom: 4px;">Danger Zone: Delete Workspace</h3>
            <p style="font-size: 12px; color: #64748b; line-height: 1.5; max-width: 600px;">
              Permanently delete <strong>${company.name}</strong>, including all its invoices, payments, client records, and audit history. This action is irreversible.
            </p>
          </div>
          <button id="btn-delete-workspace" class="btn btn-secondary" style="color: #dc2626; border-color: #fca5a5; background: #fee2e2; font-weight: 700;">
            Delete Company Workspace
          </button>
        </div>
      </div>
    ` : ''}
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
          country: document.getElementById('set-company-country').value,
          address: document.getElementById('set-company-address').value,
          payment_instructions: document.getElementById('set-company-instructions').value
        })
      });
      if (state.company) {
        state.company.country = document.getElementById('set-company-country').value;
      }
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
        if (state.company) {
          state.company.default_currency = btn.dataset.code;
        }
        updateSidebarUser();
        updateCompanySwitcher();
        renderSettings(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  const btnDelWorkspace = document.getElementById('btn-delete-workspace');
  if (btnDelWorkspace) {
    btnDelWorkspace.addEventListener('click', async () => {
      const confirmInput = prompt(`⚠️ WARNING: This will permanently delete the entire company workspace "${company.name}", all invoices, payments, and accounting records.\n\nTo confirm, type the exact company name below:`);
      if (confirmInput !== company.name) {
        if (confirmInput !== null) {
          showToast('Company name did not match. Workspace deletion cancelled.', 'info');
        }
        return;
      }

      try {
        await api(`/companies/${company.id}`, { method: 'DELETE' });
        showToast(`Workspace "${company.name}" has been deleted.`, 'success');
        const myComps = await api('/companies/my-companies');
        state.myCompanies = myComps;
        if (myComps.length > 0) {
          await switchCompany(myComps[0].id);
        } else {
          localStorage.clear();
          sessionStorage.clear();
          window.location.reload();
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}

// ============================================================================
// 11. COMPANY TEAM MANAGEMENT VIEW
// ============================================================================
async function renderTeam(container) {
  const members = await api('/companies/members');
  const isAdmin = state.user.role === 'Administrator' || state.user.isSuperAdmin;

  container.innerHTML = `
    <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px;">
      <div>
        <h1 style="font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em;">Company Team & Access</h1>
        <p style="font-size: 13px; color: #64748b; margin-top: 2px;">
          Manage team members, roles, and invitation status for ${state.company?.name || 'this company'}
        </p>
      </div>
      <div>
        ${isAdmin ? `
          <button id="btn-open-invite-modal" class="btn btn-primary" style="gap: 8px;">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            <span>+ Invite Member</span>
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Team Members Table -->
    <div class="table-container" style="padding: 24px;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined / Invited</th>
            ${isAdmin ? '<th style="text-align: right;">Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${members.map(m => {
            const isSelf = m.id === state.user.id;
            const initials = m.full_name ? m.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'MB';
            return `
              <tr>
                <td>
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: #0284c7; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex-shrink: 0;">
                      ${initials}
                    </div>
                    <div>
                      <div style="font-weight: 600; color: #0f172a;">${m.full_name} ${isSelf ? '<span class="badge badge-paid" style="font-size: 10px; margin-left: 4px;">You</span>' : ''}</div>
                      <div style="font-size: 11px; color: #64748b;">${m.invitation_status === 'invited' ? 'Invitation pending' : 'Active team member'}</div>
                    </div>
                  </div>
                </td>
                <td>${m.email}</td>
                <td>
                  ${isAdmin && !isSelf ? `
                    <select class="form-control change-role-select" data-user-id="${m.id}" style="width: 160px; font-size: 12px; padding: 4px 8px;">
                      <option value="Administrator" ${m.role_name === 'Administrator' ? 'selected' : ''}>Administrator</option>
                      <option value="Finance Manager" ${m.role_name === 'Finance Manager' ? 'selected' : ''}>Finance Manager</option>
                      <option value="Staff" ${m.role_name === 'Staff' ? 'selected' : ''}>Staff</option>
                    </select>
                  ` : `
                    <span class="badge ${m.role_name === 'Administrator' ? 'badge-overdue' : m.role_name === 'Finance Manager' ? 'badge-completed' : 'badge-draft'}">
                      ${m.role_name}
                    </span>
                  `}
                </td>
                <td>
                  <span class="badge ${m.invitation_status === 'accepted' ? 'badge-completed' : 'badge-draft'}">
                    ${m.invitation_status === 'accepted' ? 'Active' : 'Invited'}
                  </span>
                </td>
                <td style="font-size: 12px; color: #64748b;">
                  ${m.joined_at ? new Date(m.joined_at).toLocaleDateString() : 'Pending'}
                </td>
                ${isAdmin ? `
                  <td style="text-align: right;">
                    ${!isSelf ? `
                      <button class="btn btn-secondary btn-sm btn-remove-member" data-user-id="${m.id}" style="color: #ef4444; border-color: #fecaca;" title="Remove Member">
                        Remove
                      </button>
                    ` : '<span style="font-size: 11px; color: #94a3b8;">Workspace Owner</span>'}
                  </td>
                ` : ''}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Invite button trigger
  const btnInvite = document.getElementById('btn-open-invite-modal');
  if (btnInvite) {
    btnInvite.addEventListener('click', () => {
      document.getElementById('modal-invite-member').classList.add('open');
    });
  }

  // Change role listeners
  container.querySelectorAll('.change-role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const targetUserId = sel.dataset.userId;
      const newRole = sel.value;
      try {
        await api(`/companies/members/${targetUserId}/role`, {
          method: 'PUT',
          body: JSON.stringify({ roleName: newRole })
        });
        showToast(`Member role updated to ${newRole}`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
        renderTeam(container);
      }
    });
  });

  // Remove member listeners
  container.querySelectorAll('.btn-remove-member').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to remove this member from the company?')) return;
      const targetUserId = btn.dataset.userId;
      try {
        await api(`/companies/members/${targetUserId}`, { method: 'DELETE' });
        showToast('Member removed from company', 'info');
        renderTeam(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

// ============================================================================
// 12. PLATFORM ADMINISTRATION VIEW (SUPERADMINS)
// ============================================================================
async function renderPlatform(container) {
  if (!state.user.isSuperAdmin) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; background: #fee2e2; border-radius: 12px; color: #b91c1c;">
        <h3>Access Restricted</h3>
        <p style="margin-top: 8px;">Platform Administration is restricted to Superadministrators only.</p>
      </div>
    `;
    return;
  }

  const companies = await api('/platform/companies');
  const activeCount = companies.filter(c => c.status === 'active').length;
  const suspendedCount = companies.filter(c => c.status === 'suspended').length;

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em;">Platform Administration</h1>
      <p style="font-size: 13px; color: #64748b; margin-top: 2px;">
        Global multi-tenant governance, company activation states, and cross-tenant management
      </p>
    </div>

    <!-- Platform Stats Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
      <div class="stat-card" style="background: white; border: 1px solid var(--border); border-radius: 12px; padding: 20px;">
        <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Total Tenants</div>
        <div style="font-size: 28px; font-weight: 800; color: #0f172a; margin-top: 6px;">${companies.length}</div>
      </div>
      <div class="stat-card" style="background: white; border: 1px solid var(--border); border-radius: 12px; padding: 20px;">
        <div style="font-size: 12px; font-weight: 700; color: #16a34a; text-transform: uppercase;">Active Companies</div>
        <div style="font-size: 28px; font-weight: 800; color: #16a34a; margin-top: 6px;">${activeCount}</div>
      </div>
      <div class="stat-card" style="background: white; border: 1px solid var(--border); border-radius: 12px; padding: 20px;">
        <div style="font-size: 12px; font-weight: 700; color: #ef4444; text-transform: uppercase;">Suspended Companies</div>
        <div style="font-size: 28px; font-weight: 800; color: #ef4444; margin-top: 6px;">${suspendedCount}</div>
      </div>
    </div>

    <!-- Companies Table -->
    <div class="table-container" style="padding: 24px;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Company Name</th>
            <th>Legal Name</th>
            <th>Currency</th>
            <th>Plan</th>
            <th>Status</th>
            <th>Members</th>
            <th>Invoices</th>
            <th style="text-align: right;">Tenant Actions</th>
          </tr>
        </thead>
        <tbody>
          ${companies.map(c => `
            <tr>
              <td>
                <div style="font-weight: 700; color: #0f172a;">${c.name}</div>
                <div style="font-size: 11px; color: #64748b; font-family: monospace;">${c.id}</div>
              </td>
              <td>${c.legal_name || '—'}</td>
              <td><span class="badge badge-unpaid">${c.default_currency}</span></td>
              <td><span class="badge badge-draft" style="text-transform: capitalize;">${c.subscription_plan || 'standard'}</span></td>
              <td>
                <span class="badge ${c.status === 'active' ? 'badge-completed' : 'badge-overdue'}">
                  ${c.status}
                </span>
              </td>
              <td style="font-weight: 600;">${c.member_count || 1}</td>
              <td style="font-weight: 600;">${c.invoice_count || 0}</td>
              <td style="text-align: right;">
                <div style="display: inline-flex; gap: 8px;">
                  <button class="btn btn-secondary btn-sm btn-platform-switch" data-company-id="${c.id}" title="Switch context to this company">
                    Enter &rarr;
                  </button>
                  <button class="btn btn-secondary btn-sm btn-toggle-status" data-company-id="${c.id}" data-current-status="${c.status}" style="color: ${c.status === 'active' ? '#ef4444' : '#16a34a'}; border-color: ${c.status === 'active' ? '#fecaca' : '#bbf7d0'};">
                    ${c.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                  <button class="btn btn-secondary btn-sm btn-delete-platform-company" data-company-id="${c.id}" data-name="${c.name}" style="color: #dc2626; border-color: #fca5a5; background: #fee2e2;" title="Permanently delete company">
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

  // Enter company
  container.querySelectorAll('.btn-platform-switch').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.companyId;
      await switchCompany(cid);
      navigate('dashboard');
    });
  });

  // Toggle company status
  container.querySelectorAll('.btn-toggle-status').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.companyId;
      const currentStatus = btn.dataset.currentStatus;
      const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
      if (!confirm(`Are you sure you want to set company ${cid} status to "${newStatus}"?`)) return;
      try {
        await api(`/platform/companies/${cid}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: newStatus })
        });
        showToast(`Company status updated to ${newStatus}`, 'success');
        renderPlatform(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Permanently delete company (Platform Superadmin)
  container.querySelectorAll('.btn-delete-platform-company').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.companyId;
      const cname = btn.dataset.name;
      if (!confirm(`⚠️ Are you sure you want to permanently DELETE company "${cname}" (${cid})?\n\nThis will purge all invoices, payments, client records, and transaction history. This cannot be undone.`)) return;
      try {
        await api(`/platform/companies/${cid}`, { method: 'DELETE' });
        showToast(`Company "${cname}" deleted successfully`, 'success');
        if (state.company && state.company.id === cid) {
          const myComps = await api('/companies/my-companies');
          state.myCompanies = myComps;
          if (myComps.length > 0) {
            await switchCompany(myComps[0].id);
          } else {
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload();
            return;
          }
        }
        await renderPlatform(container);
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

  // Default currency: Company base currency or selected client's preferred currency
  const baseDefault = state.company?.default_currency || state.baseCurrency?.code || 'GHS';
  const initialPreferred = clients[0]?.preferred_currency || baseDefault;

  // Populate Currencies
  const currSel = document.getElementById('inv-currency');
  currSel.innerHTML = currData.currencies.map(c => `<option value="${c.code}" ${c.code === initialPreferred ? 'selected' : ''}>${c.code} — ${c.name}</option>`).join('');

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
    const preferred = selected?.dataset?.currency;
    currSel.value = preferred || (state.company?.default_currency || state.baseCurrency?.code || 'GHS');
    updateInvoiceExchangeRate();
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

// Payment Note Presets & Custom Note Templates
async function loadPaymentNotes() {
  const container = document.getElementById('pay-notes-chips-container');
  const select = document.getElementById('pay-notes-template-select');
  if (!container || !select) return;

  try {
    const notes = await api('/payment-notes');
    state.paymentNotes = notes;

    select.innerHTML = '<option value="">-- Load Saved Note --</option>' +
      notes.map(n => `<option value="${n.id}" data-content="${encodeURIComponent(n.content)}" data-split="${n.split_ratio ?? ''}">${!n.is_system ? '⭐ ' : ''}${n.title}</option>`).join('');

    container.innerHTML = notes.map(n => {
      const isCustom = !n.is_system;
      const splitBadge = n.split_ratio ? `(${Math.round(n.split_ratio * 100)}%) ` : '';
      return `
        <span class="btn-pay-preset-wrap" style="display: inline-flex; align-items: center; border-radius: 12px; background: ${isCustom ? '#ecfdf5' : 'rgba(99,102,241,0.08)'}; border: 1px solid ${isCustom ? '#a7f3d0' : 'rgba(99,102,241,0.2)'}; padding: 2px 8px; font-size: 11px;">
          <button type="button" class="btn-pay-preset-action" data-note="${encodeURIComponent(n.content)}" data-split="${n.split_ratio ?? ''}" style="background: none; border: none; padding: 0; color: ${isCustom ? '#047857' : '#4f46e5'}; font-weight: 600; cursor: pointer; font-size: 11px;">
            ${isCustom ? '⭐ ' : '⚡ '}${splitBadge}${n.title}
          </button>
          ${isCustom ? `<span class="btn-delete-saved-note" data-id="${n.id}" data-title="${n.title}" title="Delete this custom preset" style="margin-left: 6px; cursor: pointer; color: #ef4444; font-weight: bold; font-size: 13px; line-height: 1;">&times;</span>` : ''}
        </span>
      `;
    }).join('');

    // Attach click events on chips
    container.querySelectorAll('.btn-pay-preset-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const note = decodeURIComponent(btn.dataset.note);
        const split = btn.dataset.split ? parseFloat(btn.dataset.split) : null;
        applyPaymentNote(note, split);
      });
    });

    // Attach delete events for custom notes
    container.querySelectorAll('.btn-delete-saved-note').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const title = btn.dataset.title;
        if (!confirm(`Delete saved note preset "${title}"?`)) return;
        try {
          await api(`/payment-notes/${id}`, { method: 'DELETE' });
          showToast(`Saved note "${title}" deleted`, 'info');
          await loadPaymentNotes();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

  } catch (err) {
    console.error('Failed to load payment notes', err);
  }
}

function applyPaymentNote(noteText, splitRatio = null) {
  const noteEl = document.getElementById('pay-notes');
  if (noteEl) {
    noteEl.value = noteText;
  }
  if (splitRatio !== null && !isNaN(splitRatio)) {
    const invSel = document.getElementById('pay-invoice');
    const opt = invSel?.options[invSel.selectedIndex];
    if (opt && opt.dataset.balance) {
      const balance = parseFloat(opt.dataset.balance) || 0;
      const targetAmount = Math.max(0, balance * splitRatio);
      const amtEl = document.getElementById('pay-amount');
      if (amtEl) {
        amtEl.value = targetAmount.toFixed(2);
        updatePaymentProgressSimulation();
      }
    }
  }
}

// 2. Record Payment Modal
async function openRecordPaymentModal(options = {}) {
  const [clients, invoices] = await Promise.all([
    api('/clients'),
    api('/invoices?status=all')
  ]);
  state.clients = clients;
  state.invoices = invoices;

  // Load custom and default payment note presets
  await loadPaymentNotes();

  const clientSel = document.getElementById('pay-client');
  clientSel.innerHTML = clients.map(c => `<option value="${c.id}">${c.company_name}</option>`).join('');

  if (options.clientId) clientSel.value = options.clientId;

  const filterInvoicesForClient = () => {
    const cId = clientSel.value;
    const invSel = document.getElementById('pay-invoice');
    const eligible = state.invoices.filter(i => i.client_id === cId && i.balance_due > 0);

    const baseFallback = state.company?.default_currency || state.baseCurrency?.code || 'GHS';
    if (eligible.length === 0) {
      invSel.innerHTML = '<option value="">No outstanding invoices for this client</option>';
      document.getElementById('pay-invoice-info').style.display = 'none';
      document.getElementById('pay-currency').value = baseFallback;
      document.getElementById('pay-amount').value = '0.00';
      const preview = document.getElementById('pay-progress-preview');
      if (preview) preview.style.display = 'none';
      return;
    }

    invSel.innerHTML = eligible.map(i => `
      <option value="${i.id}" data-total="${i.total_amount}" data-balance="${i.balance_due}" data-paid="${i.amount_paid}" data-currency="${i.currency || baseFallback}" data-due="${i.due_date}">
        ${i.invoice_number} — Total: ${formatMoney(i.total_amount, i.currency || baseFallback)} | Balance Due: ${formatMoney(i.balance_due, i.currency || baseFallback)}
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
  const baseFallback = state.company?.default_currency || state.baseCurrency?.code || 'GHS';

  if (!invSel.value) {
    infoBox.style.display = 'none';
    currInput.value = baseFallback;
    return;
  }

  const opt = invSel.options[invSel.selectedIndex];
  if (!opt) {
    currInput.value = baseFallback;
    return;
  }
  const balance = parseFloat(opt.dataset.balance) || 0;
  const total = parseFloat(opt.dataset.total) || 0;
  const paid = parseFloat(opt.dataset.paid) || 0;
  const curr = opt.dataset.currency || baseFallback;

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
  const baseDefault = state.company?.default_currency || state.baseCurrency?.code || 'GHS';
  currSel.innerHTML = state.currencies.map(c => `<option value="${c.code}" ${c.code === baseDefault ? 'selected' : ''}>${c.code} (${c.symbol})</option>`).join('');
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
        country: document.getElementById('client-country')?.value || 'Ghana',
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

  // Payment Note Template Selector
  const selNote = document.getElementById('pay-notes-template-select');
  if (selNote) {
    selNote.addEventListener('change', () => {
      const opt = selNote.options[selNote.selectedIndex];
      if (!opt || !opt.value) return;
      const content = decodeURIComponent(opt.dataset.content || '');
      const split = opt.dataset.split ? parseFloat(opt.dataset.split) : null;
      applyPaymentNote(content, split);
    });
  }

  // Button: Save Current Note As Preset
  const btnSaveCustomNote = document.getElementById('btn-save-custom-note');
  if (btnSaveCustomNote) {
    btnSaveCustomNote.addEventListener('click', async () => {
      const content = document.getElementById('pay-notes')?.value?.trim();
      if (!content) {
        showToast('Please type a note in the remarks box first to save it', 'warning');
        return;
      }
      const defaultTitle = content.slice(0, 24) + (content.length > 24 ? '...' : '');
      const title = prompt('Enter a short name/label for this saved note preset:', defaultTitle);
      if (!title || !title.trim()) return;

      try {
        await api('/payment-notes', {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(),
            content: content
          })
        });
        showToast(`Saved note "${title.trim()}"!`, 'success');
        await loadPaymentNotes();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

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

  // Company Switcher Dropdown
  const btnSwitcher = document.getElementById('btn-company-switcher');
  const dropdownSwitcher = document.getElementById('company-switcher-dropdown');
  if (btnSwitcher && dropdownSwitcher) {
    btnSwitcher.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownSwitcher.style.display = dropdownSwitcher.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', (e) => {
      if (!dropdownSwitcher.contains(e.target) && !btnSwitcher.contains(e.target)) {
        dropdownSwitcher.style.display = 'none';
      }
    });
  }

  // Onboard Company Modal Trigger & Form Submit
  const btnOpenOnboard = document.getElementById('btn-open-onboard-modal');
  if (btnOpenOnboard) {
    btnOpenOnboard.addEventListener('click', () => {
      if (dropdownSwitcher) dropdownSwitcher.style.display = 'none';
      document.getElementById('modal-onboard').classList.add('open');
    });
  }

  const formOnboard = document.getElementById('form-onboard');
  if (formOnboard) {
    formOnboard.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const companyName = document.getElementById('onboard-name')?.value?.trim();
        if (!companyName) {
          showToast('Company name is required', 'error');
          return;
        }

        const payload = {
          name: companyName,
          legal_name: companyName,
          country: document.getElementById('onboard-country')?.value?.trim() || 'United States',
          default_currency: document.getElementById('onboard-currency')?.value || 'USD',
          invoice_prefix: document.getElementById('onboard-prefix')?.value?.trim() || 'INV-',
          tax_identification_number: document.getElementById('onboard-tax-id')?.value?.trim() || '',
          business_registration_number: document.getElementById('onboard-reg-num')?.value?.trim() || '',
          email: document.getElementById('onboard-email')?.value?.trim() || '',
          phone: document.getElementById('onboard-phone')?.value?.trim() || '',
          address: document.getElementById('onboard-address')?.value?.trim() || '',
          default_payment_terms_days: parseInt(document.getElementById('onboard-terms')?.value, 10) || 30,
          primary_color: document.getElementById('onboard-color')?.value || '#0284c7',
          payment_instructions: document.getElementById('onboard-instructions')?.value?.trim() || ''
        };

        const res = await api('/companies/onboard', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        const newCompany = res.company || res;
        const newCompId = newCompany.id;
        const newCompName = newCompany.name || companyName;

        document.getElementById('modal-onboard').classList.remove('open');
        formOnboard.reset();
        showToast(`Company "${newCompName}" successfully created!`, 'success');

        // Refresh user companies and switch to new company
        const myComps = await api('/companies/my-companies');
        state.myCompanies = myComps;
        if (newCompId) {
          await switchCompany(newCompId);
        }
      } catch (err) {
        showToast('Onboarding failed: ' + err.message, 'error');
      }
    });
  }

  // Invite Team Member Form Submit
  const formInvite = document.getElementById('form-invite-member');
  if (formInvite) {
    formInvite.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const email = document.getElementById('invite-email').value.trim();
        const fullName = document.getElementById('invite-name').value.trim();
        const roleName = document.getElementById('invite-role').value;

        await api('/companies/members/invite', {
          method: 'POST',
          body: JSON.stringify({ email, fullName, roleName })
        });

        document.getElementById('modal-invite-member').classList.remove('open');
        formInvite.reset();
        showToast(`Invitation sent to ${email}!`, 'success');

        if (state.activeNav === 'team') {
          const container = document.getElementById('app-view');
          renderTeam(container);
        }
      } catch (err) {
        showToast('Failed to invite member: ' + err.message, 'error');
      }
    });
  }

  // Auth Form & Demo Accounts Handlers
  async function performLogin(email, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      localStorage.setItem('apex_token', data.token);
      hideAuthOverlay();
      showToast(`Welcome back, ${data.user.fullName}!`, 'success');
      await initApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const pass = document.getElementById('login-password').value;
      await performLogin(email, pass);
    });
  }

  document.querySelectorAll('.demo-account-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const email = chip.dataset.email;
      const pass = chip.dataset.pass;
      document.getElementById('login-email').value = email;
      document.getElementById('login-password').value = pass;
      await performLogin(email, pass);
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
