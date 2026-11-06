import * as crypto from 'node:crypto';

const DEV_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');
let warnedAboutSecret = false;

/**
 * Resolve the JWT signing secret.
 * Production refuses to run without a strong JWT_SECRET. Development uses a random
 * per-process secret (tokens stop working on restart) instead of a value shipped in source.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to at least 32 characters when NODE_ENV=production');
  }
  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    console.warn('[Security] JWT_SECRET missing or shorter than 32 chars; using a random development secret.');
  }
  return DEV_FALLBACK_SECRET;
}

export interface TokenPayload {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  companyId: string;
  companyName: string;
  isSuperAdmin?: boolean;
}

/**
 * Hash password with secure random salt using PBKDF2 with 100,000 iterations
 */
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

/**
 * Verify password against salt and hash
 */
export function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  const stored = Buffer.from(storedHash || '', 'hex');
  if (stored.length !== hash.length) return false;
  return crypto.timingSafeEqual(hash, stored);
}

/**
 * Create a signed JWT token
 */
export function createToken(payload: TokenPayload, expiresInHours: number = 24): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  const fullPayload = { ...payload, exp, iat: Math.floor(Date.now() / 1000) };

  const encode = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerEncoded = encode(header);
  const payloadEncoded = encode(fullPayload);
  const data = `${headerEncoded}.${payloadEncoded}`;

  const signature = crypto.createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sig] = parts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256') return null;
    const expectedSig = crypto.createHmac('sha256', getJwtSecret()).update(`${headerB64}.${payloadB64}`).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload as TokenPayload;
  } catch {
    return null;
  }
}
