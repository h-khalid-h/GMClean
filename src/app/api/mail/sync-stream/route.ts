import { type NextRequest } from 'next/server';
import { fetchEmailsStreaming, refreshAccessToken } from '@/lib/imap';
import { getActiveSession } from '@/lib/session';

// POST: Stream sync chunks via Server-Sent Events
export async function POST(request: NextRequest) {
  const config = getActiveSession(request);

  if (!config) {
    return new Response(
      JSON.stringify({ error: 'No connection configuration provided or session expired.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Refresh access token if needed
  if (config.accessToken && config.refreshToken) {
    await refreshAccessToken(config);
  }

  // Extract parameters from query string
  const url = new URL(request.url);
  const totalLimit = parseInt(url.searchParams.get('totalLimit') || '500', 10) || 500;
  const chunkSize = parseInt(url.searchParams.get('chunkSize') || '100', 10) || 100;
  const folder = url.searchParams.get('folder') || 'INBOX';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await fetchEmailsStreaming(config!, totalLimit, chunkSize, async (emails, progress) => {
          const event = {
            type: 'chunk' as const,
            emails,
            progress,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }, folder);

        // Send completion event
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Streaming sync failed.';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
