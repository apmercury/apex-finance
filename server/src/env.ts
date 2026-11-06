import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Load environment variables from .env (if present) before any other module reads them.
 * Variables already set in the real environment take precedence over the file.
 * Import this module first in every entry point.
 */
const envPath = process.env.ENV_FILE || path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
