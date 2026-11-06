/**
 * Consistent online backup of the SQLite database.
 *
 * Uses `VACUUM INTO`, which writes a transactionally consistent, compacted copy
 * while the app keeps running. Keeps the newest BACKUP_KEEP files (default 14).
 *
 *   npm run backup
 *   docker compose exec app npm run backup
 *
 * Env: DATABASE_PATH (default storage/apexfinance.sqlite), BACKUP_DIR (default storage/backups),
 *      BACKUP_KEEP (default 14).
 * Copy BACKUP_DIR off the server (rclone, rsync, provider snapshots) — a backup on the
 * same disk does not survive losing that disk.
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'storage', 'apexfinance.sqlite');
const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP || '14', 10) || 14);

if (!fs.existsSync(dbPath)) {
  console.error(`[Backup] Database not found at ${dbPath}`);
  process.exit(1);
}
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const target = path.join(backupDir, `apexfinance-${stamp}.sqlite`);

const db = new DatabaseSync(dbPath);
try {
  db.exec('PRAGMA busy_timeout = 10000;');
  db.prepare('VACUUM INTO ?').run(target);
} finally {
  db.close();
}

// Verify the copy opens and passes an integrity check before trusting it
const check = new DatabaseSync(target, { readOnly: true });
const result = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
check.close();
if (result !== 'ok') {
  console.error(`[Backup] Integrity check failed for ${target}: ${result}`);
  process.exit(1);
}

const size = (fs.statSync(target).size / 1024).toFixed(0);
console.log(`[Backup] Wrote ${target} (${size} KB, integrity ok)`);

// Retention: delete the oldest backups beyond `keep`
const backups = fs.readdirSync(backupDir)
  .filter(f => /^apexfinance-.*\.sqlite$/.test(f))
  .sort();
for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
  fs.rmSync(path.join(backupDir, old));
  console.log(`[Backup] Removed old backup ${old}`);
}
