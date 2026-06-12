import { type NextRequest, NextResponse } from 'next/server';
import { encryptSession } from '@/lib/crypto';
import { fetchEmailsChunk, refreshAccessToken, type ImapConfig } from '@/lib/imap';
import { getActiveSession, getActiveIndex, sessionCookieName, listAccounts, nextAvailableIndex, SESSION_COOKIE_OPTIONS } from '@/lib/session';

// GET: Check active session status + list all accounts
export async function GET(request: NextRequest) {
  const session = getActiveSession(request);
  const accounts = listAccounts(request);
  const activeIndex = getActiveIndex(request);
  
  if (!session) {
    return NextResponse.json({ authenticated: false, accounts, activeIndex }, { status: 200 });
  }

  return NextResponse.json({ 
    authenticated: true, 
    user: session.user,
    host: session.host,
    accounts,
    activeIndex,
  });
}

// POST: Sync email chunk or handle new login
export async function POST(request: NextRequest) {
  // CSRF protection: verify request origin
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && !origin.includes(host)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  let config: ImapConfig | null = getActiveSession(request);
  let isNewLogin = false;

  try {
    // If no existing session, check the body (new login)
    if (!config) {
      try {
        const body = await request.json();
        if (body && body.host && body.port && body.user && (body.pass || body.accessToken)) {
          config = {
            host: body.host,
            port: parseInt(body.port),
            secure: body.secure !== false,
            user: body.user,
            pass: body.pass || undefined,
            accessToken: body.accessToken || undefined,
          };
          isNewLogin = true;
        }
      } catch {
        // Request body was empty or invalid JSON
      }
    }

    if (!config) {
      return NextResponse.json({ error: 'No connection configuration provided or session expired.' }, { status: 400 });
    }

    // Extract pagination parameters
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100', 10) || 100;
    const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;

    // Refresh access token if needed
    let tokenRefreshed = false;
    if (config.accessToken && config.refreshToken) {
      const oldToken = config.accessToken;
      await refreshAccessToken(config);
      tokenRefreshed = config.accessToken !== oldToken;
    }

    // Fetch the email chunk
    const result = await fetchEmailsChunk(config, limit, offset);

    // Build response and set cookie if it's a new login or token was refreshed
    const response = NextResponse.json({
      emails: result.emails,
      total: result.total,
      user: config.user,
      host: config.host
    });

    if (isNewLogin || tokenRefreshed) {
      const encryptedCookie = encryptSession(config);
      // For new logins, find the next available slot
      const idx = isNewLogin ? nextAvailableIndex(request) : getActiveIndex(request);
      if (idx >= 0) {
        response.cookies.set(sessionCookieName(idx), encryptedCookie, SESSION_COOKIE_OPTIONS);
        response.cookies.set('gmclean_active', String(idx), { ...SESSION_COOKIE_OPTIONS, httpOnly: false });
      }
    }

    return response;
  } catch (err) {
    console.error('Mail sync endpoint error:', err);
    const errMsg = err instanceof Error ? err.message : 'Failed to sync with mailbox.';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// DELETE: Clear session (Logout current account)
export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ success: true, message: 'Logged out successfully.' });
  const idx = getActiveIndex(request);
  response.cookies.delete(sessionCookieName(idx));
  // Also clean up legacy cookie
  response.cookies.delete('gmclean_session');
  // Reset active to 0
  response.cookies.set('gmclean_active', '0', { ...SESSION_COOKIE_OPTIONS, httpOnly: false });
  return response;
}

// PATCH: Switch active account
export async function PATCH(request: NextRequest) {
  try {
    const { index } = await request.json();
    if (typeof index !== 'number' || index < 0 || index > 9) {
      return NextResponse.json({ error: 'Invalid account index.' }, { status: 400 });
    }

    const cookieName = sessionCookieName(index);
    const cookie = request.cookies.get(cookieName)?.value;
    if (!cookie) {
      return NextResponse.json({ error: 'No session at that index.' }, { status: 404 });
    }

    const response = NextResponse.json({ success: true, index });
    response.cookies.set('gmclean_active', String(index), { ...SESSION_COOKIE_OPTIONS, httpOnly: false });
    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
}
