import { type NextRequest, NextResponse } from 'next/server';
import { decryptSession, encryptSession } from '@/lib/crypto';
import { fetchEmailsChunk, type ImapConfig } from '@/lib/imap';

// GET: Check active session status
export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('gmclean_session');
  
  if (!sessionCookie?.value) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  const session = decryptSession<ImapConfig>(sessionCookie.value);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  return NextResponse.json({ 
    authenticated: true, 
    user: session.user,
    host: session.host
  });
}

// POST: Sync email chunk
export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get('gmclean_session');
  let config: ImapConfig | null = null;
  let isNewLogin = false;

  try {
    // 1. Try to read from session cookie first
    if (sessionCookie?.value) {
      config = decryptSession<ImapConfig>(sessionCookie.value);
    }

    // 2. If no cookie, check the body (new login)
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

    // 3. Extract pagination parameters
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    // 4. Fetch the email chunk
    const result = await fetchEmailsChunk(config, limit, offset);

    // 5. Build response and set cookie if it's a new login
    const response = NextResponse.json({
      emails: result.emails,
      total: result.total,
      user: config.user,
      host: config.host
    });

    if (isNewLogin) {
      const encryptedCookie = encryptSession(config);
      response.cookies.set('gmclean_session', encryptedCookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 1 week
        path: '/',
      });
    }

    return response;
  } catch (err) {
    console.error('Mail sync endpoint error:', err);
    const errMsg = err instanceof Error ? err.message : 'Failed to sync with mailbox.';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// DELETE: Clear session (Logout)
export async function DELETE() {
  const response = NextResponse.json({ success: true, message: 'Logged out successfully.' });
  response.cookies.delete('gmclean_session');
  return response;
}
