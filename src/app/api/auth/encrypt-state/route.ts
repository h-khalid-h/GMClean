import { type NextRequest, NextResponse } from 'next/server';
import { encryptSession } from '@/lib/crypto';

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid or missing JSON payload.' }, { status: 400 });
    }

    // Limit payload size to prevent abuse (OAuth credentials should be small)
    const bodyStr = JSON.stringify(body);
    if (bodyStr.length > 2048) {
      return NextResponse.json({ error: 'Payload too large.' }, { status: 400 });
    }

    const encrypted = encryptSession(body);
    return NextResponse.json({ state: encrypted });
  } catch (err) {
    console.error('State encryption endpoint error:', err);
    return NextResponse.json({ error: 'Failed to encrypt state parameter' }, { status: 500 });
  }
}
