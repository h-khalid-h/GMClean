import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenExpiry?: number;
}

export interface ParsedEmail {
  uid: number;
  messageId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  date: Date;
  category: 'newsletter' | 'transaction' | 'social' | 'personal';
  unsubscribeLink?: string;
}

// Helper to create an ImapFlow client instance
export function createImapClient(config: ImapConfig): ImapFlow {
  const authOptions: { user: string; pass?: string; accessToken?: string } = {
    user: config.user,
  };

  if (config.accessToken) {
    authOptions.accessToken = config.accessToken;
  } else {
    authOptions.pass = config.pass;
  }

  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: authOptions,
    logger: false, // Keep logs clean
  });
}

// Refresh an OAuth access token if it's expired or about to expire (within 60s)
export async function refreshAccessToken(config: ImapConfig): Promise<string | null> {
  // If no refresh token or no expiry info, return existing token as-is
  if (!config.refreshToken || !config.tokenExpiry) {
    return config.accessToken || null;
  }

  // Check if token is still valid (with 60s buffer)
  if (Date.now() < config.tokenExpiry - 60000) {
    return config.accessToken || null;
  }

  if (!config.clientId || !config.clientSecret) {
    return config.accessToken || null;
  }

  // Google
  if (config.host === 'imap.gmail.com') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: config.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      config.accessToken = data.access_token;
      config.tokenExpiry = Date.now() + (data.expires_in * 1000);
      return data.access_token as string;
    }
  }

  // Microsoft
  if (config.host === 'outlook.office365.com') {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: config.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      config.accessToken = data.access_token;
      config.tokenExpiry = Date.now() + (data.expires_in * 1000);
      return data.access_token as string;
    }
  }

  // Refresh failed — return existing token (may be expired)
  return config.accessToken || null;
}

// List all selectable IMAP folders
export async function listFolders(config: ImapConfig): Promise<string[]> {
  const client = createImapClient(config);
  await client.connect();

  try {
    const mailboxes = await client.list();
    return mailboxes
      .filter(mb => !mb.flags.has('\\Noselect'))
      .map(mb => mb.path);
  } finally {
    await client.logout();
  }
}

// Heuristic-based classification
function classifyEmail(
  subject: string,
  senderEmail: string,
  hasUnsubscribe: boolean,
  headers: Map<string, string>
): 'newsletter' | 'transaction' | 'social' | 'personal' {
  const sub = subject.toLowerCase();
  const sender = senderEmail.toLowerCase();

  // 1. Newsletters / Promotional
  const listId = headers.get('list-id');
  const precedence = headers.get('precedence');
  if (
    hasUnsubscribe || 
    listId || 
    precedence === 'bulk' || 
    precedence === 'list' ||
    sender.includes('newsletter') || 
    sender.includes('promo') ||
    sub.includes('newsletter') ||
    sub.includes('offerte') ||
    sub.includes('deal')
  ) {
    return 'newsletter';
  }

  // 2. Social Media
  const socialDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com', 'pinterest.com', 'youtube.com', 'x.com', 'reddit.com', 'medium.com'];
  if (
    socialDomains.some(domain => sender.includes(domain)) ||
    sub.includes('notification') ||
    sub.includes('friend request') ||
    sub.includes('new follower')
  ) {
    return 'social';
  }

  // 3. Transactions / Receipts / Account Alerts
  const transactionalKeywords = [
    'order', 'receipt', 'invoice', 'payment', 'bill', 'confirm', 'purchase', 
    'shipping', 'track', 'transaction', 'fattura', 'ricevuta', 'ordine',
    'security alert', 'password reset', 'reset your password', 'verification code',
    'security key', 'sign-in alert', 'login alert', 'account alert', 'avviso di sicurezza',
    'recover your account', 'verification'
  ];
  if (
    transactionalKeywords.some(keyword => sub.includes(keyword)) ||
    sender.includes('billing') ||
    sender.includes('accounts.google.com') ||
    (sender.includes('no-reply') || sender.includes('noreply')) && (
      sub.includes('verify') || 
      sub.includes('otp') || 
      sub.includes('login') || 
      sub.includes('alert') || 
      sub.includes('security') || 
      sub.includes('reset')
    )
  ) {
    return 'transaction';
  }

  // 4. Personal / Other
  return 'personal';
}

// Fetch a chunk of emails from the INBOX
export async function fetchEmailsChunk(
  config: ImapConfig,
  limit: number,
  offset: number
): Promise<{ emails: ParsedEmail[]; total: number }> {
  const client = createImapClient(config);
  await client.connect();

  const lock = await client.getMailboxLock('INBOX');
  const parsedEmails: ParsedEmail[] = [];
  let totalEmails = 0;

  try {
    totalEmails = client.mailbox ? client.mailbox.exists : 0;

    if (totalEmails === 0 || offset >= totalEmails) {
      return { emails: [], total: totalEmails };
    }

    // Determine fetch range (fetching latest first)
    const end = Math.max(1, totalEmails - offset);
    const start = Math.max(1, totalEmails - offset - limit + 1);

    if (end < start) {
      return { emails: [], total: totalEmails };
    }

    const range = `${start}:${end}`;
    
    // Fetch envelope and headers list-unsubscribe, precedence, list-id
    const messages = client.fetch(range, {
      uid: true,
      envelope: true,
      headers: ['list-unsubscribe', 'precedence', 'list-id'],
    });

    for await (const message of messages) {
      const envelope = message.envelope;
      if (!envelope) continue;

      const uid = message.uid;
      const messageId = envelope.messageId || `local-uid-${uid}`;
      const subject = envelope.subject || '(No Subject)';
      
      const fromObj = envelope.from && envelope.from[0];
      const senderName = fromObj?.name || fromObj?.address?.split('@')[0] || 'Unknown';
      const senderEmail = fromObj?.address || 'unknown@unknown.com';
      const date = envelope.date || new Date();

      // Parse headers buffer to get list-unsubscribe details
      let hasUnsubscribe = false;
      let unsubscribeLink = '';
      const headersMap = new Map<string, string>();

      if (message.headers) {
        try {
          const parsedHeaders = await simpleParser(message.headers);
          
          // Find List-Unsubscribe from header lines (mailparser groups headers starting with list- under 'list')
          const listUnsubscribeHeader = parsedHeaders.headerLines.find(h => h.key === 'list-unsubscribe');
          if (listUnsubscribeHeader) {
            hasUnsubscribe = true;
            const val = listUnsubscribeHeader.line.slice(listUnsubscribeHeader.line.indexOf(':') + 1).trim();
            
            // Extract HTTP or mailto link from inside angle brackets e.g. <https://...>
            const matches = val.match(/<([^>]+)>/g);
            if (matches && matches.length > 0) {
              // Prefer HTTP URLs, then mailto URIs
              const urls = matches.map(m => m.slice(1, -1));
              const httpUrl = urls.find(url => url.startsWith('http'));
              const mailtoUrl = urls.find(url => url.startsWith('mailto'));
              unsubscribeLink = httpUrl || mailtoUrl || urls[0];
            } else {
              unsubscribeLink = val;
            }
          }

          const precedenceHeader = parsedHeaders.headerLines.find(h => h.key === 'precedence');
          if (precedenceHeader) {
            const val = precedenceHeader.line.slice(precedenceHeader.line.indexOf(':') + 1).trim();
            headersMap.set('precedence', val.toLowerCase());
          }

          const listIdHeader = parsedHeaders.headerLines.find(h => h.key === 'list-id');
          if (listIdHeader) {
            const val = listIdHeader.line.slice(listIdHeader.line.indexOf(':') + 1).trim();
            headersMap.set('list-id', val.toLowerCase());
          }

        } catch (e) {
          console.error(`Failed parsing headers for UID ${uid}:`, e);
        }
      }

      const category = classifyEmail(subject, senderEmail, hasUnsubscribe, headersMap);

      parsedEmails.push({
        uid,
        messageId,
        senderName,
        senderEmail,
        subject,
        date,
        category,
        unsubscribeLink: unsubscribeLink || undefined,
      });
    }
  } finally {
    lock.release();
    await client.logout();
  }

  // Return in descending order (newest first)
  parsedEmails.sort((a, b) => b.uid - a.uid);

  return {
    emails: parsedEmails,
    total: totalEmails,
  };
}

// Bulk delete messages by UID
export async function deleteEmailsByUid(config: ImapConfig, uids: number[], folder: string = 'INBOX'): Promise<boolean> {
  if (uids.length === 0) return true;

  const client = createImapClient(config);
  await client.connect();

  const lock = await client.getMailboxLock(folder);

  try {
    // Delete messages and expunge them
    await client.messageDelete(uids, { uid: true });
    return true;
  } finally {
    lock.release();
    await client.logout();
  }
}

// Streaming fetch: opens ONE IMAP connection, fetches in chunks, and calls onChunk after each
export async function fetchEmailsStreaming(
  config: ImapConfig,
  totalLimit: number,
  chunkSize: number,
  onChunk: (emails: ParsedEmail[], progress: { fetched: number; total: number }) => void | Promise<void>,
  folder: string = 'INBOX'
): Promise<{ total: number; fetched: number }> {
  const client = createImapClient(config);
  await client.connect();

  const lock = await client.getMailboxLock(folder);
  let totalEmails = 0;
  let totalFetched = 0;

  try {
    totalEmails = client.mailbox ? client.mailbox.exists : 0;

    if (totalEmails === 0) {
      return { total: 0, fetched: 0 };
    }

    // Cap at totalLimit or total available
    const maxToFetch = Math.min(totalLimit, totalEmails);
    let offset = 0;

    while (offset < maxToFetch) {
      const currentChunkSize = Math.min(chunkSize, maxToFetch - offset);

      // Determine fetch range (fetching latest first)
      const end = Math.max(1, totalEmails - offset);
      const start = Math.max(1, totalEmails - offset - currentChunkSize + 1);

      if (end < start) break;

      const range = `${start}:${end}`;

      // Fetch envelope and headers list-unsubscribe, precedence, list-id
      const messages = client.fetch(range, {
        uid: true,
        envelope: true,
        headers: ['list-unsubscribe', 'precedence', 'list-id'],
      });

      const chunkEmails: ParsedEmail[] = [];

      for await (const message of messages) {
        const envelope = message.envelope;
        if (!envelope) continue;

        const uid = message.uid;
        const messageId = envelope.messageId || `local-uid-${uid}`;
        const subject = envelope.subject || '(No Subject)';

        const fromObj = envelope.from && envelope.from[0];
        const senderName = fromObj?.name || fromObj?.address?.split('@')[0] || 'Unknown';
        const senderEmail = fromObj?.address || 'unknown@unknown.com';
        const date = envelope.date || new Date();

        // Parse headers buffer to get list-unsubscribe details
        let hasUnsubscribe = false;
        let unsubscribeLink = '';
        const headersMap = new Map<string, string>();

        if (message.headers) {
          try {
            const parsedHeaders = await simpleParser(message.headers);

            const listUnsubscribeHeader = parsedHeaders.headerLines.find(h => h.key === 'list-unsubscribe');
            if (listUnsubscribeHeader) {
              hasUnsubscribe = true;
              const val = listUnsubscribeHeader.line.slice(listUnsubscribeHeader.line.indexOf(':') + 1).trim();

              const matches = val.match(/<([^>]+)>/g);
              if (matches && matches.length > 0) {
                const urls = matches.map(m => m.slice(1, -1));
                const httpUrl = urls.find(url => url.startsWith('http'));
                const mailtoUrl = urls.find(url => url.startsWith('mailto'));
                unsubscribeLink = httpUrl || mailtoUrl || urls[0];
              } else {
                unsubscribeLink = val;
              }
            }

            const precedenceHeader = parsedHeaders.headerLines.find(h => h.key === 'precedence');
            if (precedenceHeader) {
              const val = precedenceHeader.line.slice(precedenceHeader.line.indexOf(':') + 1).trim();
              headersMap.set('precedence', val.toLowerCase());
            }

            const listIdHeader = parsedHeaders.headerLines.find(h => h.key === 'list-id');
            if (listIdHeader) {
              const val = listIdHeader.line.slice(listIdHeader.line.indexOf(':') + 1).trim();
              headersMap.set('list-id', val.toLowerCase());
            }
          } catch (e) {
            console.error(`Failed parsing headers for UID ${uid}:`, e);
          }
        }

        const category = classifyEmail(subject, senderEmail, hasUnsubscribe, headersMap);

        chunkEmails.push({
          uid,
          messageId,
          senderName,
          senderEmail,
          subject,
          date,
          category,
          unsubscribeLink: unsubscribeLink || undefined,
        });
      }

      // Sort chunk in descending order (newest first)
      chunkEmails.sort((a, b) => b.uid - a.uid);

      totalFetched += chunkEmails.length;
      offset += currentChunkSize;

      // Notify caller with this chunk's results
      await onChunk(chunkEmails, { fetched: totalFetched, total: totalEmails });

      // Stop if we got fewer emails than requested (no more to fetch)
      if (chunkEmails.length < currentChunkSize) break;
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return { total: totalEmails, fetched: totalFetched };
}
