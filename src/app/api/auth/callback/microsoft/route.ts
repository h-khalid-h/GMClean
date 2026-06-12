import { type NextRequest, NextResponse } from 'next/server';
import { encryptSession, decryptSession } from '@/lib/crypto';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const stateStr = searchParams.get('state');

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/callback/microsoft`;

  if (error) {
    return NextResponse.redirect(`${origin}?error=${encodeURIComponent('OAuth error: ' + error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}?error=No+authorization+code+provided`);
  }

  let clientId = process.env.MICROSOFT_CLIENT_ID || '';
  let clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';

  // Try to decrypt credentials from state if passed from client settings
  if (stateStr) {
    try {
      const decrypted = decryptSession<{ clientId?: string; clientSecret?: string }>(stateStr);
      if (decrypted) {
        if (decrypted.clientId) clientId = decrypted.clientId;
        if (decrypted.clientSecret) clientSecret = decrypted.clientSecret;
      }
    } catch (e) {
      console.warn('Could not parse Microsoft OAuth state:', e);
    }
  }

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}?error=Missing+Microsoft+OAuth+credentials.+Configure+them+in+Settings.`);
  }

  try {
    // 1. Exchange code for token
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
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
      throw new Error(`Microsoft token exchange failed: ${errText}`);
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;

    // 2. Fetch user's email address using Microsoft Graph API
    const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!meResponse.ok) {
      throw new Error('Failed to retrieve Microsoft user profile info');
    }

    const meData = await meResponse.json();
    const userEmail = meData.mail || meData.userPrincipalName;

    if (!userEmail) {
      throw new Error('No email address returned from Microsoft Graph API');
    }

    // 3. Create the session object
    const sessionData = {
      host: 'outlook.office365.com',
      port: 993,
      secure: true,
      user: userEmail,
      accessToken: accessToken,
    };

    // Encrypt the session config
    const encryptedCookie = encryptSession(sessionData);

    const response = NextResponse.redirect(origin);
    
    // Set HTTP-only secure cookie for the session
    response.cookies.set('gmclean_session', encryptedCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('Microsoft OAuth callback handler error:', err);
    const errMsg = err instanceof Error ? err.message : 'OAuth authentication failed';
    return NextResponse.redirect(`${origin}?error=${encodeURIComponent(errMsg)}`);
  }
}
