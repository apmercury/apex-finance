import { InvoiceService } from './invoiceService.ts';
import { TemplateService, type InvoiceTemplate } from './templateService.ts';
import { SafeMoney } from '../utils/financialMath.ts';
import { queryOne } from '../db/database.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

function getChromeExecutablePath(): string {
  // 1. Check environment variable first
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  // 2. Fallback paths depending on OS
  const candidatePaths: string[] = [];

  if (process.platform === 'darwin') {
    // macOS
    candidatePaths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else if (process.platform === 'win32') {
    // Windows
    candidatePaths.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    );
  } else {
    // Linux
    candidatePaths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/local/lib/chrome-headless-shell/chrome-headless-shell'
    );
  }

  const foundPath = candidatePaths.find((p) => fs.existsSync(p));

  if (!foundPath) {
    throw new Error(
      `Chrome executable not found. Please set CHROME_BIN environment variable to your Chrome/Chromium installation path.`
    );
  }

  return foundPath;
}

// Dynamically resolved at runtime
const CHROME_PATH = getChromeExecutablePath();
export class PdfService {
  /**
   * Render HTML for an Invoice with branding and selected template
   */
  public static renderInvoiceHtml(companyId: string, invoiceId: string): string {
    const inv = InvoiceService.getInvoiceById(companyId, invoiceId);
    if (!inv) throw new Error('Invoice not found');

    const company = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]) || {
      name: 'Apex Finance Ltd',
      email: 'finance@apexfin.com',
      phone: '+233 30 200 1234',
      address: 'Financial District, Accra, Ghana',
      tax_identification_number: 'C001298402',
      primary_color: '#0284c7',
      secondary_color: '#0f172a'
    };

    const template: InvoiceTemplate = inv.template_id
      ? (queryOne(`SELECT * FROM invoice_templates WHERE id = ?`, [inv.template_id]) || TemplateService.getDefaultTemplate(companyId))
      : TemplateService.getDefaultTemplate(companyId);

    const primary = template.primary_color || company.primary_color || '#0284c7';
    const secondary = template.secondary_color || company.secondary_color || '#0f172a';
    const currency = inv.currency;
    const progress = Math.min(100, Math.max(0, inv.payment_percentage || 0));

    const itemRows = inv.items.map((item: any) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px 16px; font-weight: 500; color: #1e293b;">${item.description}</td>
        <td style="padding: 12px 16px; text-align: center; color: #475569;">${item.quantity}</td>
        <td style="padding: 12px 16px; text-align: right; color: #475569;">${SafeMoney.format(item.unit_price, currency + ' ')}</td>
        ${template.show_tax_breakdown ? `<td style="padding: 12px 16px; text-align: right; color: #64748b;">${item.tax_rate_percentage}%</td>` : ''}
        <td style="padding: 12px 16px; text-align: right; font-weight: 600; color: #0f172a;">${SafeMoney.format(item.line_total, currency + ' ')}</td>
      </tr>
    `).join('');

    const paymentsRows = inv.payments.length > 0 ? `
      <div style="margin-top: 24px;">
        <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 8px;">Payment History</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #475569;">
              <th style="padding: 8px 12px; text-align: left;">Payment #</th>
              <th style="padding: 8px 12px; text-align: left;">Date</th>
              <th style="padding: 8px 12px; text-align: left;">Method</th>
              <th style="padding: 8px 12px; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${inv.payments.map((p: any) => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 12px; font-weight: 500;">${p.payment_number}</td>
                <td style="padding: 8px 12px; color: #64748b;">${p.payment_date}</td>
                <td style="padding: 8px 12px; color: #64748b;">${p.payment_method}</td>
                <td style="padding: 8px 12px; text-align: right; font-weight: 600; color: #16a34a;">${SafeMoney.format(p.amount, currency + ' ')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice ${inv.invoice_number}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: ${template.font_family}; background: #ffffff; color: #0f172a; line-height: 1.5; padding: 40px; font-size: 13px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 3px solid ${primary}; padding-bottom: 24px; }
          .company-logo-text { font-size: 26px; font-weight: 800; color: ${secondary}; letter-spacing: -0.03em; }
          .company-logo-text span { color: ${primary}; }
          .company-info { font-size: 12px; color: #64748b; margin-top: 6px; line-height: 1.4; }
          .invoice-title { font-size: 28px; font-weight: 800; color: ${primary}; text-align: right; text-transform: uppercase; letter-spacing: 0.05em; }
          .invoice-meta { font-size: 12px; color: #475569; text-align: right; margin-top: 6px; }
          .invoice-meta strong { color: #0f172a; }
          .billing-grid { display: flex; justify-content: space-between; margin-bottom: 28px; background: #f8fafc; border-radius: 8px; padding: 18px 24px; }
          .bill-to h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 6px; }
          .client-name { font-size: 15px; font-weight: 700; color: #0f172a; }
          .client-details { font-size: 12px; color: #475569; margin-top: 4px; line-height: 1.4; }
          .status-badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
          .status-Paid { background: #dcfce7; color: #15803d; }
          .status-Partially-Paid { background: #fef3c7; color: #b45309; }
          .status-Unpaid { background: #e0f2fe; color: #0369a1; }
          .status-Overdue { background: #fee2e2; color: #b91c1c; }
          .status-Draft { background: #f1f5f9; color: #475569; }
          table.items { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          table.items th { background: #f1f5f9; color: #475569; font-weight: 600; text-align: left; padding: 10px 16px; font-size: 12px; border-bottom: 1px solid #cbd5e1; }
          .totals-section { display: flex; justify-content: flex-end; margin-bottom: 28px; }
          .totals-table { width: 320px; font-size: 13px; }
          .totals-table tr td { padding: 6px 0; }
          .totals-table tr td:last-child { text-align: right; font-weight: 600; }
          .grand-total-row { border-top: 2px solid ${primary}; border-bottom: 2px solid ${primary}; font-size: 16px; font-weight: 800; color: ${primary}; }
          .progress-container { margin: 16px 0; background: #e2e8f0; border-radius: 9999px; height: 10px; overflow: hidden; }
          .progress-bar { background: #16a34a; height: 100%; width: ${progress}%; }
          .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; line-height: 1.6; }
          ${template.custom_css || ''}
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="company-logo-text">${company.name.split(' ')[0]}<span>${company.name.split(' ').slice(1).join(' ') || 'Finance'}</span></div>
            <div class="company-info">
              ${company.address ? `<div>${company.address}</div>` : ''}
              ${company.phone ? `<div>Phone: ${company.phone}</div>` : ''}
              ${company.email ? `<div>Email: ${company.email}</div>` : ''}
              ${company.tax_identification_number ? `<div>Tax ID: ${company.tax_identification_number}</div>` : ''}
            </div>
          </div>
          <div>
            <div class="invoice-title">INVOICE</div>
            <div class="invoice-meta">
              <div>Invoice #: <strong>${inv.invoice_number}</strong></div>
              <div>Issue Date: <strong>${inv.issue_date}</strong></div>
              <div>Due Date: <strong>${inv.due_date}</strong></div>
              <div style="margin-top: 6px;">
                <span class="status-badge status-${inv.status.replace(/\s+/g, '-')}">${inv.status}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="billing-grid">
          <div class="bill-to">
            <h4>Billed To:</h4>
            <div class="client-name">${inv.client_name}</div>
            <div class="client-details">
              ${inv.client_contact ? `<div>Attn: ${inv.client_contact}</div>` : ''}
              ${inv.client_email ? `<div>${inv.client_email}</div>` : ''}
              ${inv.client_phone ? `<div>${inv.client_phone}</div>` : ''}
              ${inv.client_address ? `<div>${inv.client_address}</div>` : ''}
              ${inv.client_tax_id ? `<div>Tax ID: ${inv.client_tax_id}</div>` : ''}
            </div>
          </div>
          <div style="text-align: right; max-width: 250px;">
            <h4>Payment Status:</h4>
            <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 4px;">
              ${SafeMoney.format(inv.amount_paid, currency + ' ')} / ${SafeMoney.format(inv.total_amount, currency + ' ')}
            </div>
            <div class="progress-container">
              <div class="progress-bar"></div>
            </div>
            <div style="font-size: 11px; color: #64748b; font-weight: 600;">${progress}% Settled &bull; Balance Due: ${SafeMoney.format(inv.balance_due, currency + ' ')}</div>
          </div>
        </div>

        <table class="items">
          <thead>
            <tr>
              <th style="width: 45%;">Description</th>
              <th style="width: 15%; text-align: center;">Quantity</th>
              <th style="width: 15%; text-align: right;">Unit Price</th>
              ${template.show_tax_breakdown ? `<th style="width: 10%; text-align: right;">Tax</th>` : ''}
              <th style="width: 15%; text-align: right;">Line Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <div class="totals-section">
          <table class="totals-table">
            <tr>
              <td style="color: #64748b;">Subtotal:</td>
              <td>${SafeMoney.format(inv.subtotal, currency + ' ')}</td>
            </tr>
            ${inv.discount_amount > 0 ? `
              <tr>
                <td style="color: #64748b;">Discount:</td>
                <td style="color: #dc2626;">-${SafeMoney.format(inv.discount_amount, currency + ' ')}</td>
              </tr>
            ` : ''}
            ${inv.tax_amount > 0 ? `
              <tr>
                <td style="color: #64748b;">Tax Amount:</td>
                <td>${SafeMoney.format(inv.tax_amount, currency + ' ')}</td>
              </tr>
            ` : ''}
            <tr class="grand-total-row">
              <td style="padding: 10px 0;">Total Amount:</td>
              <td style="padding: 10px 0;">${SafeMoney.format(inv.total_amount, currency + ' ')}</td>
            </tr>
            <tr>
              <td style="color: #16a34a; padding-top: 8px;">Amount Paid:</td>
              <td style="color: #16a34a; padding-top: 8px;">${SafeMoney.format(inv.amount_paid, currency + ' ')}</td>
            </tr>
            <tr style="border-top: 1px solid #cbd5e1;">
              <td style="font-size: 14px; font-weight: 700; color: #0f172a; padding: 8px 0;">Remaining Balance:</td>
              <td style="font-size: 14px; font-weight: 700; color: ${inv.balance_due > 0 ? '#dc2626' : '#16a34a'}; padding: 8px 0;">
                ${SafeMoney.format(inv.balance_due, currency + ' ')}
              </td>
            </tr>
            ${inv.currency !== inv.base_currency ? `
              <tr>
                <td colspan="2" style="font-size: 11px; color: #64748b; padding-top: 4px; text-align: right;">
                  Base Currency Value: ${SafeMoney.format(inv.base_currency_total, inv.base_currency + ' ')} (Rate: 1 ${currency} = ${inv.exchange_rate} ${inv.base_currency})
                </td>
              </tr>
            ` : ''}
          </table>
        </div>

        ${paymentsRows}

        <div class="footer">
          <div style="font-weight: 600; color: #0f172a; margin-bottom: 4px;">Payment Instructions & Bank Details:</div>
          <div>${template.payment_instructions || company.payment_instructions || 'Please remit payment to our registered company account.'}</div>
          ${template.custom_notes || inv.notes ? `<div style="margin-top: 8px; font-style: italic;">Note: ${template.custom_notes || inv.notes}</div>` : ''}
          ${inv.terms ? `<div style="margin-top: 4px; color: #94a3b8;">Terms: ${inv.terms}</div>` : ''}
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Render HTML for Payment Receipt
   */
  public static renderReceiptHtml(companyId: string, paymentId: string): string {
    const payment = queryOne(
      `SELECT p.*, c.company_name, c.email as client_email, c.phone as client_phone, c.address as client_address, c.tax_id as client_tax_id,
              i.invoice_number, i.total_amount as invoice_total, i.balance_due as invoice_balance, i.currency as invoice_currency, i.issue_date as invoice_date
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       LEFT JOIN invoices i ON p.invoice_id = i.id
       WHERE p.id = ? AND p.company_id = ?`,
      [paymentId, companyId]
    );
    if (!payment) throw new Error('Payment not found');

    const company = queryOne(`SELECT * FROM companies WHERE id = ?`, [companyId]) || {
      name: 'Apex Finance Ltd',
      email: 'finance@apexfin.com',
      phone: '+233 30 200 1234',
      address: 'Financial District, Accra, Ghana',
      tax_identification_number: 'C001298402',
      primary_color: '#0284c7'
    };

    const primaryColor = company.primary_color || '#0284c7';
    const formattedAmount = SafeMoney.format(payment.amount, payment.currency + ' ');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Payment Receipt — ${payment.payment_number}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          @media print {
            .no-print { display: none !important; }
            body { padding: 0 !important; background: white !important; }
            .receipt-container { box-shadow: none !important; border: 1px solid #e2e8f0 !important; }
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #f8fafc;
            color: #0f172a;
            padding: 30px 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .receipt-container {
            width: 100%;
            max-width: 720px;
            background: #ffffff;
            border-radius: 14px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);
            padding: 36px 40px;
          }
          .print-bar {
            width: 100%;
            max-width: 720px;
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-bottom: 16px;
          }
          .btn-print {
            background: #0f172a;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
          }
          .receipt-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid ${primaryColor};
            padding-bottom: 20px;
            margin-bottom: 24px;
          }
          .company-name {
            font-size: 20px;
            font-weight: 800;
            color: #0f172a;
          }
          .company-sub {
            font-size: 12px;
            color: #64748b;
            margin-top: 3px;
            line-height: 1.4;
          }
          .receipt-tag {
            text-align: right;
          }
          .receipt-title {
            font-size: 16px;
            font-weight: 800;
            letter-spacing: 1px;
            color: ${primaryColor};
            text-transform: uppercase;
          }
          .receipt-num {
            font-size: 14px;
            font-weight: 700;
            color: #0f172a;
            margin-top: 4px;
          }
          .receipt-date {
            font-size: 12px;
            color: #64748b;
            margin-top: 2px;
          }
          .hero-amount-card {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 12px;
            padding: 20px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
          }
          .hero-amount {
            font-size: 28px;
            font-weight: 800;
            color: #15803d;
          }
          .badge-paid {
            background: #dcfce7;
            color: #15803d;
            font-size: 11px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 20px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 24px;
          }
          .section-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 16px 18px;
          }
          .section-title {
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 6px;
          }
          .data-row {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            padding: 4px 0;
            color: #334155;
          }
          .data-label {
            color: #64748b;
          }
          .data-val {
            font-weight: 600;
            text-align: right;
            color: #0f172a;
          }
          .notes-box {
            background: #fffbeb;
            border: 1px solid #fef3c7;
            border-radius: 10px;
            padding: 14px 18px;
            margin-bottom: 24px;
          }
          .notes-label {
            font-size: 11px;
            font-weight: 700;
            color: #b45309;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .notes-text {
            font-size: 13px;
            color: #92400e;
            line-height: 1.4;
          }
          .receipt-footer {
            border-top: 1px solid #e2e8f0;
            padding-top: 18px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            color: #94a3b8;
          }
        </style>
      </head>
      <body>
        <div class="print-bar no-print">
          <button class="btn-print" onclick="window.print()">🖨️ Print Receipt</button>
        </div>

        <div class="receipt-container">
          <div class="receipt-header">
            <div>
              <div class="company-name">${company.name || 'Apex Finance Ltd'}</div>
              <div class="company-sub">
                ${company.address ? `<div>${company.address}</div>` : ''}
                ${company.email ? `<div>Email: ${company.email}</div>` : ''}
                ${company.phone ? `<div>Phone: ${company.phone}</div>` : ''}
                ${company.tax_identification_number ? `<div>Tax ID / TIN: ${company.tax_identification_number}</div>` : ''}
              </div>
            </div>
            <div class="receipt-tag">
              <div class="receipt-title">Official Receipt</div>
              <div class="receipt-num">${payment.payment_number}</div>
              <div class="receipt-date">Date: ${payment.payment_date}</div>
            </div>
          </div>

          <div class="hero-amount-card">
            <div>
              <div style="font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase;">Amount Received</div>
              <div class="hero-amount">${formattedAmount}</div>
            </div>
            <div>
              <span class="badge-paid">✓ ${payment.status || 'Completed'}</span>
            </div>
          </div>

          <div class="grid-2">
            <div class="section-card">
              <div class="section-title">Received From (Client)</div>
              <div class="data-row">
                <span class="data-label">Client Name:</span>
                <span class="data-val">${payment.company_name}</span>
              </div>
              ${payment.client_email ? `
                <div class="data-row">
                  <span class="data-label">Email:</span>
                  <span class="data-val">${payment.client_email}</span>
                </div>
              ` : ''}
              ${payment.client_phone ? `
                <div class="data-row">
                  <span class="data-label">Phone:</span>
                  <span class="data-val">${payment.client_phone}</span>
                </div>
              ` : ''}
              ${payment.client_address ? `
                <div class="data-row">
                  <span class="data-label">Address:</span>
                  <span class="data-val">${payment.client_address}</span>
                </div>
              ` : ''}
              ${payment.client_tax_id ? `
                <div class="data-row">
                  <span class="data-label">Tax ID:</span>
                  <span class="data-val">${payment.client_tax_id}</span>
                </div>
              ` : ''}
            </div>

            <div class="section-card">
              <div class="section-title">Payment Breakdown</div>
              <div class="data-row">
                <span class="data-label">Payment Method:</span>
                <span class="data-val">${payment.payment_method || 'Bank Transfer'}</span>
              </div>
              ${payment.reference_number ? `
                <div class="data-row">
                  <span class="data-label">Reference / Txn #:</span>
                  <span class="data-val">${payment.reference_number}</span>
                </div>
              ` : ''}
              ${payment.invoice_number ? `
                <div class="data-row">
                  <span class="data-label">Applied To Invoice:</span>
                  <span class="data-val">${payment.invoice_number}</span>
                </div>
                <div class="data-row">
                  <span class="data-label">Invoice Total:</span>
                  <span class="data-val">${SafeMoney.format(payment.invoice_total, (payment.invoice_currency || payment.currency) + ' ')}</span>
                </div>
                <div class="data-row">
                  <span class="data-label">Remaining Balance:</span>
                  <span class="data-val" style="color: ${payment.invoice_balance > 0 ? '#b45309' : '#15803d'};">
                    ${SafeMoney.format(payment.invoice_balance || 0, (payment.invoice_currency || payment.currency) + ' ')}
                  </span>
                </div>
              ` : `
                <div class="data-row">
                  <span class="data-label">Allocation:</span>
                  <span class="data-val">General Account Credit</span>
                </div>
              `}
            </div>
          </div>

          ${payment.notes ? `
            <div class="notes-box">
              <div class="notes-label">Payment Remarks / Notes</div>
              <div class="notes-text">${payment.notes}</div>
            </div>
          ` : ''}

          <div class="receipt-footer">
            <div>Official automated receipt generated by ${company.name || 'Apex Finance SaaS'}.</div>
            <div style="font-family: monospace;">TXID-${payment.id.slice(0, 8).toUpperCase()}</div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Convert any HTML string into a PDF file using Chrome Headless via Puppeteer or CLI fallback
   */
  public static async generatePdfFromHtml(html: string, outputPath: string): Promise<string> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // 1. Primary: Use Puppeteer for reliable, ultra-fast vector PDF rendering (~800ms)
    try {
      const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        args: [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check'
        ]
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.pdf({
          path: outputPath,
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
        });
        return outputPath;
      } finally {
        await browser.close();
      }
    } catch (puppeteerErr: any) {
      console.warn('[PDF] Puppeteer engine notice, falling back to CLI:', puppeteerErr?.message || puppeteerErr);
    }

    // 2. Secondary Fallback: Isolated CLI execution with dedicated temp user data directory
    const tempHtmlPath = path.join('/tmp', `pdf_${Date.now()}_${Math.random().toString(36).substring(7)}.html`);
    const tempUserDataDir = fs.mkdtempSync('/tmp/chrome_pdf_');
    fs.writeFileSync(tempHtmlPath, html, 'utf8');

    try {
      execFileSync(CHROME_PATH, [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        `--user-data-dir=${tempUserDataDir}`,
        '--print-to-pdf-no-header',
        `--print-to-pdf=${outputPath}`,
        tempHtmlPath
      ], { timeout: 15000 });
    } finally {
      if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
      try { fs.rmSync(tempUserDataDir, { recursive: true, force: true }); } catch {}
    }

    return outputPath;
  }

  public static async generateInvoicePdf(companyId: string, invoiceId: string): Promise<string> {
    const html = this.renderInvoiceHtml(companyId, invoiceId);
    const outputPath = path.join(process.cwd(), 'storage', companyId, 'invoices', `invoice_${invoiceId}.pdf`);
    return this.generatePdfFromHtml(html, outputPath);
  }

  public static async generateReceiptPdf(companyId: string, paymentId: string): Promise<string> {
    const html = this.renderReceiptHtml(companyId, paymentId);
    const outputPath = path.join(process.cwd(), 'storage', companyId, 'receipts', `receipt_${paymentId}.pdf`);
    return this.generatePdfFromHtml(html, outputPath);
  }
}
