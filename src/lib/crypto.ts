import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

// Use ENCRYPTION_SECRET from env, falling back to a dev-only default.
// In production deployments, ALWAYS set ENCRYPTION_SECRET for security.
const SECRET = (() => {
  if (process.env.ENCRYPTION_SECRET) return process.env.ENCRYPTION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '⚠️  WARNING: ENCRYPTION_SECRET is not set! Sessions are encrypted with a known default key. ' +
      'Set ENCRYPTION_SECRET in your environment for production. Generate one with: openssl rand -base64 32'
    );
  }
  return 'gmclean-default-development-secret-key-32-chars';
})();
const KEY = crypto.createHash('sha256').update(SECRET).digest();

export function encryptSession(data: object): string {
  const text = JSON.stringify(data);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decryptSession<T>(encryptedText: string): T | null {
  try {
    const separatorIndex = encryptedText.indexOf(':');
    if (separatorIndex === -1) return null;
    const ivHex = encryptedText.substring(0, separatorIndex);
    const encryptedHex = encryptedText.substring(separatorIndex + 1);
    if (!ivHex || !encryptedHex) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted) as T;
  } catch (error) {
    console.error('Failed to decrypt session:', error);
    return null;
  }
}
