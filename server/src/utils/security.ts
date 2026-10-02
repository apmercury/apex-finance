import * as crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'apex-finance-enterprise-secret-key-2026-safe-production';

export interface TokenPayload {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  companyId: string;
  companyName: string;
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
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
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

  const signature = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
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
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
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
