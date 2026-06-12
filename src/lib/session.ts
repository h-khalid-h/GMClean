import { type NextRequest } from 'next/server';
import { decryptSession } from '@/lib/crypto';
import { type ImapConfig } from '@/lib/imap';

/**
 * Multi-account session management.
 * 
 * Sessions are stored in indexed cookies:
 *   gmclean_session_0, gmclean_session_1, ...
 * 
 * The active account index is in:
 *   gmclean_active (defaults to "0")
 * 
 * Legacy single-cookie (gmclean_session) is auto-migrated
 * to gmclean_session_0 on first read.
 */

/** Cookie options shared across all session cookies */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

/** Get the active account index */
export function getActiveIndex(request: NextRequest): number {
  const active = request.cookies.get('gmclean_active')?.value;
  return active ? parseInt(active, 10) || 0 : 0;
}

/** Get the cookie name for a given account index */
export function sessionCookieName(index: number): string {
  return `gmclean_session_${index}`;
}

/** Read the active session's encrypted cookie value, with legacy fallback */
export function getActiveSessionCookie(request: NextRequest): string | undefined {
  const idx = getActiveIndex(request);
  const indexed = request.cookies.get(sessionCookieName(idx))?.value;
  if (indexed) return indexed;

  // Legacy fallback: old single-cookie installs
  if (idx === 0) {
    return request.cookies.get('gmclean_session')?.value;
  }
  return undefined;
}

/** Decrypt the active session into an ImapConfig */
export function getActiveSession(request: NextRequest): ImapConfig | null {
  const value = getActiveSessionCookie(request);
  if (!value) return null;
  return decryptSession<ImapConfig>(value);
}

/** List all stored accounts (index + user/host metadata) */
export function listAccounts(request: NextRequest): { index: number; user: string; host: string }[] {
  const accounts: { index: number; user: string; host: string }[] = [];

  // Check indexed cookies 0-9 (max 10 accounts)
  for (let i = 0; i < 10; i++) {
    const cookie = request.cookies.get(sessionCookieName(i))?.value;
    if (cookie) {
      const config = decryptSession<ImapConfig>(cookie);
      if (config) {
        accounts.push({ index: i, user: config.user, host: config.host });
      }
    }
  }

  // Legacy fallback
  if (accounts.length === 0) {
    const legacy = request.cookies.get('gmclean_session')?.value;
    if (legacy) {
      const config = decryptSession<ImapConfig>(legacy);
      if (config) {
        accounts.push({ index: 0, user: config.user, host: config.host });
      }
    }
  }

  return accounts;
}

/** Find the next available session index */
export function nextAvailableIndex(request: NextRequest): number {
  for (let i = 0; i < 10; i++) {
    if (!request.cookies.get(sessionCookieName(i))?.value) {
      return i;
    }
  }
  return -1; // All 10 slots full
}
