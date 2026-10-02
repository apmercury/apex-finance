import { queryAll, queryOne, execute } from '../db/database.ts';
import { randomUUID } from 'crypto';

export interface PaymentNoteTemplate {
  id: string;
  company_id: string;
  title: string;
  content: string;
  split_ratio?: number | null;
  created_at?: string;
}

export class PaymentNoteService {
  /**
   * Return only user-created saved notes for this company.
   */
  public static getNotes(companyId: string): PaymentNoteTemplate[] {
    return queryAll<PaymentNoteTemplate>(
      `SELECT id, company_id, title, content, split_ratio, created_at 
       FROM payment_note_templates 
       WHERE company_id = ? AND (is_system IS NULL OR is_system = 0) 
       ORDER BY created_at DESC`,
      [companyId]
    );
  }

  public static createNote(
    companyId: string,
    data: { title: string; content: string; split_ratio?: number | null }
  ): PaymentNoteTemplate {
    if (!data.title || !data.title.trim()) {
      throw new Error('Note title is required');
    }
    if (!data.content || !data.content.trim()) {
      throw new Error('Note content is required');
    }
    const id = 'pnt_' + randomUUID().slice(0, 8);
    execute(
      `INSERT INTO payment_note_templates (id, company_id, title, content, split_ratio, is_system)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [id, companyId, data.title.trim(), data.content.trim(), data.split_ratio ?? null]
    );
    return queryOne<PaymentNoteTemplate>(`SELECT * FROM payment_note_templates WHERE id = ?`, [id])!;
  }

  public static deleteNote(companyId: string, id: string): boolean {
    const note = queryOne<PaymentNoteTemplate>(
      `SELECT * FROM payment_note_templates WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );
    if (!note) {
      throw new Error('Payment note template not found');
    }
    execute(`DELETE FROM payment_note_templates WHERE id = ? AND company_id = ?`, [id, companyId]);
    return true;
  }
}
