import { execute, queryAll, queryOne } from '../db/database.ts';
import * as crypto from 'node:crypto';

export interface InvoiceTemplate {
  id: string;
  company_id: string;
  name: string;
  is_default: number;
  primary_color: string;
  secondary_color: string;
  font_family: string;
  layout_style: 'modern' | 'classic' | 'minimalist' | 'corporate';
  show_logo: number;
  show_tax_breakdown: number;
  payment_instructions: string;
  custom_notes: string;
  custom_css: string;
  created_at: string;
}

export class TemplateService {
  public static getTemplates(companyId: string): InvoiceTemplate[] {
    return queryAll<InvoiceTemplate>(
      `SELECT * FROM invoice_templates WHERE company_id = ? ORDER BY is_default DESC, name ASC`,
      [companyId]
    );
  }

  public static getDefaultTemplate(companyId: string): InvoiceTemplate {
    const tmpl = queryOne<InvoiceTemplate>(
      `SELECT * FROM invoice_templates WHERE company_id = ? AND is_default = 1 LIMIT 1`,
      [companyId]
    );
    if (tmpl) return tmpl;

    // Fallback template
    return {
      id: 'default',
      company_id: companyId,
      name: 'Modern Executive (Default)',
      is_default: 1,
      primary_color: '#0284c7',
      secondary_color: '#0f172a',
      font_family: 'Inter, sans-serif',
      layout_style: 'modern',
      show_logo: 1,
      show_tax_breakdown: 1,
      payment_instructions: 'Payment is due within payment terms. Electronic bank transfer preferred.',
      custom_notes: 'Thank you for your business!',
      custom_css: '',
      created_at: new Date().toISOString()
    };
  }

  public static createTemplate(companyId: string, data: any): InvoiceTemplate {
    const id = crypto.randomUUID();
    const isDefault = data.is_default ? 1 : 0;

    if (isDefault) {
      execute(`UPDATE invoice_templates SET is_default = 0 WHERE company_id = ?`, [companyId]);
    }

    execute(
      `INSERT INTO invoice_templates (
        id, company_id, name, is_default, primary_color, secondary_color,
        font_family, layout_style, show_logo, show_tax_breakdown, payment_instructions,
        custom_notes, custom_css, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        id,
        companyId,
        data.name,
        isDefault,
        data.primary_color || '#0284c7',
        data.secondary_color || '#0f172a',
        data.font_family || 'Inter, sans-serif',
        data.layout_style || 'modern',
        data.show_logo !== false ? 1 : 0,
        data.show_tax_breakdown !== false ? 1 : 0,
        data.payment_instructions || '',
        data.custom_notes || '',
        data.custom_css || ''
      ]
    );

    return queryOne<InvoiceTemplate>(`SELECT * FROM invoice_templates WHERE id = ?`, [id])!;
  }

  public static setDefault(companyId: string, templateId: string): void {
    execute(`UPDATE invoice_templates SET is_default = 0 WHERE company_id = ?`, [companyId]);
    execute(`UPDATE invoice_templates SET is_default = 1 WHERE id = ? AND company_id = ?`, [templateId, companyId]);
  }
}
