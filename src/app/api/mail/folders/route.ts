import { type NextRequest } from 'next/server';
import { listFolders } from '@/lib/imap';
import { getActiveSession } from '@/lib/session';

// GET: List all available IMAP folders
export async function GET(request: NextRequest) {
  const config = getActiveSession(request);

  if (!config) {
    return new Response(
      JSON.stringify({ error: 'No connection configuration provided or session expired.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const folders = await listFolders(config);
    return Response.json({ folders });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Failed to list folders.';
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
