import { execute, queryAll, sanitizeFk } from '../db/database.ts';
import * as crypto from 'node:crypto';

export interface AuditEntry {
  companyId: string;
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: any;
  newValue?: any;
  ipAddress?: string;
}

export class AuditService {
  public static log(entry: AuditEntry): void {
    const id = crypto.randomUUID();
    const validUserId = sanitizeFk('users', entry.userId);
    execute(
      `INSERT INTO audit_logs 
      (id, company_id, user_id, user_name, user_role, action, entity_type, entity_id, previous_value, new_value, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        id,
        entry.companyId,
        validUserId,
        entry.userName || 'System',
        entry.userRole || 'Admin',
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.previousValue ? JSON.stringify(entry.previousValue) : null,
        entry.newValue ? JSON.stringify(entry.newValue) : null,
        entry.ipAddress || '127.0.0.1'
      ]
    );
  }

  public static getLogs(companyId: string, limit: number = 100, entityType?: string): any[] {
    let sql = `SELECT * FROM audit_logs WHERE company_id = ?`;
    const params: any[] = [companyId];
    if (entityType) {
      sql += ` AND entity_type = ?`;
      params.push(entityType);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    return queryAll(sql, params).map(log => ({
      ...log,
      previous_value: log.previous_value ? JSON.parse(log.previous_value) : null,
      new_value: log.new_value ? JSON.parse(log.new_value) : null
    }));
  }
}
