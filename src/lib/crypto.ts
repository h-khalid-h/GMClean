import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

// Lazily resolve the encryption key — deferred so it doesn't throw during build
let _key: Buffer | null = null;
function getKey(): Buffer {
  if (_key) return _key;
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL: ENCRYPTION_SECRET environment variable is not set. ' +
        'Refusing to run in production with a default key. ' +
        'Generate one with: openssl rand -base64 32'
      );
    }
    console.warn('⚠️  WARNING: ENCRYPTION_SECRET is not set! Using dev-only default key.');
    _key = crypto.createHash('sha256').update('gmclean-default-development-secret-key-32-chars').digest();
  } else {
    _key = crypto.createHash('sha256').update(secret).digest();
  }
  return _key;
}

export function encryptSession(data: object): string {
  const text = JSON.stringify(data);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
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
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted) as T;
  } catch (error) {
    console.error('Failed to decrypt session:', error);
    return null;
  }
}
