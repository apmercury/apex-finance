import { queryOne } from '../db/database.ts';
import { SafeMoney } from '../utils/financialMath.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; path: string }[];
}

export interface IEmailProvider {
  name: string;
  sendEmail(msg: EmailMessage): Promise<boolean>;
}

export class MockEmailProvider implements IEmailProvider {
  name = 'Built-in Transactional Email Logger';
  async sendEmail(msg: EmailMessage): Promise<boolean> {
    console.log(`[EMAIL DISPATCHED] To: ${msg.to} | Subject: ${msg.subject}`);
    return true;
  }
}

export class EmailService {
  private static provider: IEmailProvider = new MockEmailProvider();

  public static setProvider(newProvider: IEmailProvider) {
    this.provider = newProvider;
  }

  public static async sendInvoiceEmail(companyId: string, invoice: any, recipientEmail: string, pdfPath?: string): Promise<boolean> {
    const company = queryOne(`SELECT name FROM companies WHERE id = ?`, [companyId]);
    const companyName = company?.name || 'Apex Finance';

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <h2 style="color: #0284c7;">Invoice from ${companyName}</h2>
        <p>Dear Valued Client,</p>
        <p>Please find attached invoice <strong>${invoice.invoice_number}</strong> for <strong>${SafeMoney.format(invoice.total_amount, invoice.currency + ' ')}</strong>.</p>
        <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 4px 0;"><strong>Invoice Number:</strong> ${invoice.invoice_number}</p>
          <p style="margin: 4px 0;"><strong>Due Date:</strong> ${invoice.due_date}</p>
          <p style="margin: 4px 0;"><strong>Balance Due:</strong> ${SafeMoney.format(invoice.balance_due, invoice.currency + ' ')}</p>
        </div>
        <p>Thank you for your business!</p>
        <p style="font-size: 12px; color: #64748b;">${companyName}</p>
      </div>
    `;

    return this.provider.sendEmail({
      to: recipientEmail,
      subject: `Invoice ${invoice.invoice_number} from ${companyName}`,
      html,
      attachments: pdfPath ? [{ filename: `${invoice.invoice_number}.pdf`, path: pdfPath }] : undefined
    });
  }

  public static async sendPaymentReceiptEmail(companyId: string, payment: any, recipientEmail: string, pdfPath?: string): Promise<boolean> {
    const company = queryOne(`SELECT name FROM companies WHERE id = ?`, [companyId]);
    const companyName = company?.name || 'Apex Finance';

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <h2 style="color: #16a34a;">Payment Receipt - ${payment.payment_number}</h2>
        <p>Thank you for your payment!</p>
        <p>We have successfully received and processed your payment of <strong>${SafeMoney.format(payment.amount, payment.currency + ' ')}</strong>.</p>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 4px 0;"><strong>Receipt #:</strong> ${payment.payment_number}</p>
          <p style="margin: 4px 0;"><strong>Date:</strong> ${payment.payment_date}</p>
          <p style="margin: 4px 0;"><strong>Method:</strong> ${payment.payment_method}</p>
        </div>
        <p style="font-size: 12px; color: #64748b;">${companyName}</p>
      </div>
    `;

    return this.provider.sendEmail({
      to: recipientEmail,
      subject: `Payment Receipt: ${payment.payment_number} from ${companyName}`,
      html,
      attachments: pdfPath ? [{ filename: `${payment.payment_number}.pdf`, path: pdfPath }] : undefined
    });
  }
}
