// Only expose actionable links; a keyword by itself is not an unsubscribe function.
const unsubscribeWords = /unsubscribe|abbestellen|abmelden|opt[\s_-]?out|cancel\s+subscription/i;

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    if (entity[1] !== '#') return named[entity.toLowerCase()] || entity;
    const hex = entity[2].toLowerCase() === 'x';
    const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

export function safeUnsubscribeLink(value: string): string | undefined {
  const decoded = decodeEntities(value).trim();
  try {
    const url = new URL(decoded);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return decoded;
  } catch { /* Relative and malformed links cannot be opened safely. */ }
}

export function findUnsubscribeLink(header: string = '', html: string = '', text: string = ''): string | undefined {
  const headerLinks = [...header.matchAll(/<([^>]+)>/g)].map(match => match[1]);
  if (!headerLinks.length && header) headerLinks.push(header);
  const safeHeaders = headerLinks.map(safeUnsubscribeLink).filter((link): link is string => !!link);
  if (safeHeaders.length) return safeHeaders.find(link => /^https?:/i.test(link)) || safeHeaders[0];

  // Inspect anchor labels as well as URLs, including opaque tracking URLs.
  const content = html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1>/gi, '');
  for (const anchor of content.matchAll(/<a\b([^>]*?)>([^]*?)<\/a\s*>/gi)) {
    const href = anchor[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) continue;
    const link = safeUnsubscribeLink(href[1] ?? href[2] ?? href[3]);
    const label = decodeEntities(anchor[2].replace(/<[^>]*>/g, ''));
    if (link && (unsubscribeWords.test(label) || unsubscribeWords.test(link))) return link;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!unsubscribeWords.test(line)) continue;
    for (const match of line.matchAll(/(?:https?:\/\/|mailto:)[^\s<>"']+/gi)) {
      const link = safeUnsubscribeLink(match[0].replace(/[),.;]+$/, ''));
      if (link) return link;
    }
  }
}
