import { queryAll, queryOne, execute } from '../db/database.ts';
import { randomUUID } from 'crypto';

export interface PaymentNoteTemplate {
  id: string;
  company_id: string;
  title: string;
  content: string;
  split_ratio?: number | null;
  is_system?: number | boolean;
  created_at?: string;
}

const DEFAULT_TEMPLATES = [
  {
    title: '50% Half Payment',
    content: '50% installment payment against invoice balance',
    split_ratio: 0.5,
    is_system: 1
  },
  {
    title: 'Partial Installment',
    content: 'Partial installment payment against balance',
    split_ratio: null,
    is_system: 1
  },
  {
    title: 'Milestone Progress',
    content: 'Milestone progress payment as per project agreement',
    split_ratio: null,
    is_system: 1
  },
  {
    title: 'Full Settlement',
    content: 'Final settlement of full outstanding invoice balance',
    split_ratio: 1.0,
    is_system: 1
  },
  {
    title: 'Bank Remittance',
    content: 'Direct bank transfer wire remittance',
    split_ratio: null,
    is_system: 1
  },
  {
    title: 'MoMo Transfer',
    content: 'Mobile Money (MoMo) transfer remittance',
    split_ratio: null,
    is_system: 1
  }
];

export class PaymentNoteService {
  public static ensureDefaults(companyId: string): void {
    const existing = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM payment_note_templates WHERE company_id = ?`,
      [companyId]
    );
    if (!existing || existing.count === 0) {
      for (const t of DEFAULT_TEMPLATES) {
        const id = 'pnt_' + randomUUID().slice(0, 8);
        execute(
          `INSERT INTO payment_note_templates (id, company_id, title, content, split_ratio, is_system)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, companyId, t.title, t.content, t.split_ratio ?? null, 1]
        );
      }
    }
  }

  public static getNotes(companyId: string): PaymentNoteTemplate[] {
    this.ensureDefaults(companyId);
    return queryAll<PaymentNoteTemplate>(
      `SELECT * FROM payment_note_templates WHERE company_id = ? ORDER BY is_system ASC, created_at DESC`,
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
