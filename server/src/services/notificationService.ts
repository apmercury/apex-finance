import { execute, queryAll, sanitizeFk } from '../db/database.ts';
import { sseService } from './sseService.ts';
import * as crypto from 'node:crypto';

export interface CreateNotificationDTO {
  companyId: string;
  userId?: string;
  type: 'invoice_created' | 'invoice_sent' | 'payment_received' | 'partial_payment' | 'invoice_overdue' | 'invoice_paid' | 'expense_created' | 'client_created';
  title: string;
  message: string;
  link?: string;
}

export class NotificationService {
  public static create(dto: CreateNotificationDTO): any {
    const id = crypto.randomUUID();
    const validUserId = sanitizeFk('users', dto.userId);
    execute(
      `INSERT INTO notifications (id, company_id, user_id, type, title, message, link, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
      [id, dto.companyId, validUserId, dto.type, dto.title, dto.message, dto.link || '']
    );

    const notification = {
      id,
      company_id: dto.companyId,
      user_id: validUserId,
      type: dto.type,
      title: dto.title,
      message: dto.message,
      link: dto.link,
      is_read: 0,
      created_at: new Date().toISOString()
    };

    // Real-time broadcast to company users
    sseService.broadcast(dto.companyId, 'notification', notification);
    return notification;
  }

  public static getNotifications(companyId: string, limit: number = 50): any[] {
    return queryAll(
      `SELECT * FROM notifications WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`,
      [companyId, limit]
    );
  }

  public static markAsRead(id: string, companyId: string): void {
    execute(`UPDATE notifications SET is_read = 1 WHERE id = ? AND company_id = ?`, [id, companyId]);
  }

  public static markAllAsRead(companyId: string): void {
    execute(`UPDATE notifications SET is_read = 1 WHERE company_id = ?`, [companyId]);
  }
}
