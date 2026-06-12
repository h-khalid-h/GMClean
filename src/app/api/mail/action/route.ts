import { type NextRequest, NextResponse } from 'next/server';
import { deleteEmailsByUid } from '@/lib/imap';
import { getActiveSession } from '@/lib/session';
import dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

interface ActionPayload {
  action: 'delete' | 'unsubscribe';
  uids?: number[];
  folder?: string;
  link?: string;
  senderEmail?: string;
}

export async function POST(request: NextRequest) {
  // CSRF protection: verify request origin
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && !origin.includes(host)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const config = getActiveSession(request);
  if (!config) {
    return NextResponse.json({ error: 'Session expired or not authenticated.' }, { status: 401 });
  }

  try {
    let body: ActionPayload;
    try {
      body = await request.json() as ActionPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid or missing JSON payload.' }, { status: 400 });
    }
    
    const { action } = body;

    // 1. ACTION: BULK DELETE
    if (action === 'delete') {
      const { uids } = body;
      if (!Array.isArray(uids) || uids.length === 0) {
        return NextResponse.json({ error: 'No UIDs provided for deletion.' }, { status: 400 });
      }

      // Safety limit to prevent OOM on extremely large batches
      if (uids.length > 1000) {
        return NextResponse.json({ error: 'Cannot delete more than 1000 emails at once. Please try in smaller batches.' }, { status: 400 });
      }

      // Convert UIDs to numbers defensively
      const numericUids = uids.map(uid => Number(uid)).filter(uid => !isNaN(uid));
      await deleteEmailsByUid(config, numericUids, body.folder || 'INBOX');

      return NextResponse.json({ success: true, message: `Successfully deleted ${numericUids.length} emails.` });
    }

    // 2. ACTION: UNSUBSCRIBE
    if (action === 'unsubscribe') {
      const { link } = body;
      if (!link || typeof link !== 'string') {
        return NextResponse.json({ error: 'No unsubscribe link provided or invalid format.' }, { status: 400 });
      }

      // If mailto:, let the frontend trigger it locally (safest UX for mailto links)
      if (link.toLowerCase().startsWith('mailto:')) {
        return NextResponse.json({ 
          success: true, 
          protocol: 'mailto', 
          link 
        });
      }

      // If HTTP/HTTPS link, perform server-side fetch
      if (link.toLowerCase().startsWith('http')) {
        // SSRF protection: block requests to private/internal networks
        try {
          const url = new URL(link);
          const hostname = url.hostname.toLowerCase();
          const blockedPatterns = [
            'localhost', '127.0.0.1', '0.0.0.0', '::1',
            '169.254.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
            '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
            '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
            '192.168.',
          ];
          if (blockedPatterns.some(p => hostname.startsWith(p) || hostname === p)) {
            return NextResponse.json({ error: 'Unsubscribe links to internal/private networks are blocked.' }, { status: 400 });
          }

          // DNS resolution check for SSRF bypass via DNS rebinding
          try {
            const resolved = await dnsLookup(url.hostname);
            const ip = resolved.address;
            if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') ||
                ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') ||
                ip === '::1' || ip === '0.0.0.0' || ip.startsWith('169.254.') ||
                ip.startsWith('fc00:') || ip.startsWith('fe80:')) {
              return NextResponse.json({ error: 'Unsubscribe links resolving to private networks are blocked.' }, { status: 400 });
            }
          } catch {
            // DNS resolution failed — proceed with caution, link may be offline
          }
        } catch {
          return NextResponse.json({ error: 'Invalid unsubscribe URL.' }, { status: 400 });
        }
        try {
          // RFC 8058: Attempt one-click unsubscribe via POST with body 'List-Unsubscribe=One-Click'
          let response = await fetch(link, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GMClean Email Optimizer',
            },
            body: 'List-Unsubscribe=One-Click',
            signal: AbortSignal.timeout(10000), // 10s timeout
          });

          // If POST fails or isn't supported, fall back to a standard GET request
          if (!response.ok) {
            console.warn(`Unsubscribe POST failed for ${link}, falling back to GET.`);
            response = await fetch(link, {
              method: 'GET',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GMClean Email Optimizer',
              },
              signal: AbortSignal.timeout(10000), // 10s timeout
            });
          }

          return NextResponse.json({ 
            success: true, 
            protocol: 'http', 
            status: response.status,
            message: 'Unsubscribe request sent successfully.'
          });
        } catch {
          // Return the link back so the client can click it manually as a fallback
          return NextResponse.json({ 
            success: false, 
            error: 'Server-side request failed. Please unsubscribe manually.', 
            manualLink: link 
          }, { status: 200 }); // Status 200 so we don't throw an error alert, just show manual link in UI
        }
      }

      return NextResponse.json({ error: 'Unsupported unsubscribe protocol.' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Invalid action requested.' }, { status: 400 });
  } catch (err) {
    console.error('Mail action endpoint error:', err);
    const errMsg = err instanceof Error ? err.message : 'Failed to complete action.';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
