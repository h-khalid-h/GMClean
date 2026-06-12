import { type NextRequest, NextResponse } from 'next/server';
import { encryptSession, decryptSession } from '@/lib/crypto';
import { nextAvailableIndex, sessionCookieName, SESSION_COOKIE_OPTIONS } from '@/lib/session';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const stateStr = searchParams.get('state');

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/callback/google`;

  if (error) {
    return NextResponse.redirect(`${origin}?error=${encodeURIComponent('OAuth error: ' + error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}?error=No+authorization+code+provided`);
  }

  let clientId = process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  // Try to decrypt credentials from state if they were passed from client settings
  if (stateStr) {
    try {
      // Decode base64 encrypted state
      const decrypted = decryptSession<{ clientId?: string; clientSecret?: string }>(stateStr);
      if (decrypted) {
        if (decrypted.clientId) clientId = decrypted.clientId;
        if (decrypted.clientSecret) clientSecret = decrypted.clientSecret;
      }
    } catch (e) {
      console.warn('Could not parse OAuth state:', e);
    }
  }

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}?error=Missing+Google+OAuth+credentials.+Configure+them+in+Settings.`);
  }

  try {
    // 1. Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;

    // 2. Fetch user's email address to configure IMAP username
    const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userinfoResponse.ok) {
      throw new Error('Failed to retrieve user profile information');
    }

    const userInfo = await userinfoResponse.json();
    const userEmail = userInfo.email;

    if (!userEmail) {
      throw new Error('No email address returned from Google OAuth');
    }

    // 3. Create the session object
    const sessionData = {
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      user: userEmail,
      accessToken: accessToken,
      refreshToken: tokens.refresh_token || undefined,
      clientId,
      clientSecret,
      tokenExpiry: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : undefined,
    };

    // Encrypt the session config
    const encryptedCookie = encryptSession(sessionData);

    const response = NextResponse.redirect(origin);
    
    // Set HTTP-only secure cookie for the session in the next available slot
    const idx = nextAvailableIndex(request);
    if (idx >= 0) {
      response.cookies.set(sessionCookieName(idx), encryptedCookie, SESSION_COOKIE_OPTIONS);
      response.cookies.set('gmclean_active', String(idx), { ...SESSION_COOKIE_OPTIONS, httpOnly: false });
    }

    return response;
  } catch (err) {
    console.error('Google OAuth callback handler error:', err);
    const errMsg = err instanceof Error ? err.message : 'OAuth authentication failed';
    return NextResponse.redirect(`${origin}?error=${encodeURIComponent(errMsg)}`);
  }
}
