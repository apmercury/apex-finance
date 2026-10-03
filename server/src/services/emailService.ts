import nodemailer from 'nodemailer';

export interface InvitationEmailOptions {
  toEmail: string;
  fullName: string;
  companyName: string;
  inviterName: string;
  roleName: string;
  temporaryPassword?: string;
  appUrl?: string;
}

export interface InvoiceEmailOptions {
  toEmail: string;
  clientName: string;
  companyName: string;
  invoiceNumber: string;
  totalAmount: string;
  dueDate: string;
  appUrl?: string;
}

export class EmailService {
  private static transporter: nodemailer.Transporter | null = null;

  /**
   * Check if SMTP settings are defined in environment
   */
  public static isConfigured(): boolean {
    return Boolean(
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    );
  }

  /**
   * Get or initialize nodemailer transporter with Namecheap / cPanel SMTP settings
   */
  private static getTransporter(): nodemailer.Transporter | null {
    if (!this.isConfigured()) {
      return null;
    }

    if (!this.transporter) {
      const port = parseInt(process.env.SMTP_PORT || '465', 10);
      const isSecure = process.env.SMTP_SECURE === 'true' || port === 465;

      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: port,
        secure: isSecure, // true for 465, false for 587
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        tls: {
          // Do not fail on invalid certs for self-signed cPanel certificates if needed
          rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
        }
      });
    }

    return this.transporter;
  }

  /**
   * Send Team Member Invitation Email
   */
  public static async sendInvitationEmail(options: InvitationEmailOptions): Promise<{ success: boolean; simulated?: boolean; error?: string }> {
    const {
      toEmail,
      fullName,
      companyName,
      inviterName,
      roleName,
      temporaryPassword = 'welcome123',
      appUrl = process.env.APP_URL || 'http://localhost:3000'
    } = options;

    const fromAddress = process.env.SMTP_FROM || `"${companyName} via ApexFinance" <${process.env.SMTP_USER || 'noreply@apexfinance.io'}>`;
    const loginUrl = `${appUrl.replace(/\/$/, '')}/`;

    const subject = `You've been invited to join ${companyName} on ApexFinance`;

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to ${escapeHtml(companyName)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0;">
          
          <!-- Header Branding -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px; text-align: center;">
              <div style="display: inline-block; background: rgba(99, 102, 241, 0.2); border-radius: 8px; padding: 8px 14px; margin-bottom: 12px; border: 1px solid rgba(99, 102, 241, 0.3);">
                <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">⚡ ApexFinance</span>
              </div>
              <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 0; padding: 0;">Team Invitation</h1>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <p style="font-size: 16px; margin: 0 0 16px; color: #334155;">
                Hello <strong>${escapeHtml(fullName)}</strong>,
              </p>
              <p style="font-size: 15px; margin: 0 0 24px; color: #475569;">
                <strong>${escapeHtml(inviterName)}</strong> has invited you to collaborate with <strong>${escapeHtml(companyName)}</strong> on ApexFinance as a team <strong>${escapeHtml(roleName)}</strong>.
              </p>

              <!-- Credentials Box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f1f5f9; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; margin-bottom: 12px;">
                      Your Temporary Login Credentials
                    </div>
                    <div style="font-size: 14px; margin-bottom: 8px; color: #1e293b;">
                      <strong>Email:</strong> <span style="font-family: monospace; color: #4338ca;">${escapeHtml(toEmail)}</span>
                    </div>
                    <div style="font-size: 14px; margin-bottom: 8px; color: #1e293b;">
                      <strong>Temporary Password:</strong> <span style="font-family: monospace; background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; font-weight: 600;">${escapeHtml(temporaryPassword)}</span>
                    </div>
                    <div style="font-size: 14px; color: #1e293b;">
                      <strong>Assigned Role:</strong> <span style="color: #059669; font-weight: 600;">${escapeHtml(roleName)}</span>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Call to Action Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(loginUrl)}" target="_blank" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.3);">
                      Accept Invitation &amp; Log In &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security Notice -->
              <div style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 6px; padding: 12px; font-size: 13px; color: #854d0e; margin-bottom: 20px;">
                🔒 <strong>Security Tip:</strong> For your security, please update your password immediately in your account settings after logging in.
              </div>

              <p style="font-size: 13px; color: #64748b; margin: 0;">
                If the button above does not work, copy and paste this URL into your browser:<br>
                <a href="${escapeHtml(loginUrl)}" style="color: #4f46e5; word-break: break-all;">${escapeHtml(loginUrl)}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8;">
              This invitation was sent by ${escapeHtml(companyName)} via ApexFinance SaaS Financial Suite.<br>
              If you were not expecting this invitation, you can safely ignore this email.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const plainText = `
Hello ${fullName},

${inviterName} has invited you to collaborate with ${companyName} on ApexFinance as a ${roleName}.

Your Login Credentials:
- Email: ${toEmail}
- Temporary Password: ${temporaryPassword}
- Assigned Role: ${roleName}

Log in here: ${loginUrl}

Please update your temporary password after logging in for account security.

Best regards,
${companyName} via ApexFinance
    `.trim();

    const transporter = this.getTransporter();

    if (!transporter) {
      // SMTP not configured yet — log cleanly for local development / inspection
      console.log(`\n================================================================`);
      console.log(`[EmailService] ✉️  SIMULATED INVITATION EMAIL (SMTP not configured)`);
      console.log(`To: ${toEmail}`);
      console.log(`Subject: ${subject}`);
      console.log(`Company: ${companyName} | Role: ${roleName}`);
      console.log(`Temp Password: ${temporaryPassword}`);
      console.log(`Login URL: ${loginUrl}`);
      console.log(`================================================================\n`);
      return { success: true, simulated: true };
    }

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: toEmail,
        subject: subject,
        text: plainText,
        html: htmlBody
      });
      console.log(`[EmailService] ✅ Invitation email successfully sent to ${toEmail}`);
      return { success: true, simulated: false };
    } catch (err: any) {
      console.error(`[EmailService] ❌ Failed to send invitation email to ${toEmail}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
