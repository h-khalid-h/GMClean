import type { EmailRecord } from './db';

export function groupBySender(records: EmailRecord[]) {
  const groups = new Map<string, EmailRecord[]>();
  for (const record of records) {
    if (record.deleted) continue;
    const key = record.senderEmail.trim().toLowerCase();
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([address, emails]) => ({
    address,
    name: emails[0].senderName || address || 'Unknown sender',
    emails,
    link: emails.find(email => email.unsubscribeLink)?.unsubscribeLink,
    checked: emails.filter(email => email.unsubscribeCheckedAt).length,
    latest: emails.reduce((latest, email) => Math.max(latest, new Date(email.date).getTime()), 0),
  })).sort((a, b) => b.emails.length - a.emails.length);
}

// UIDs are only unique within one mailbox and folder.
export function folderBatches(records: EmailRecord[], size: number) {
  const folders = new Map<string, EmailRecord[]>();
  for (const record of records) {
    const group = folders.get(record.folder) || [];
    group.push(record);
    folders.set(record.folder, group);
  }
  return [...folders.values()].flatMap(records => {
    const batches: EmailRecord[][] = [];
    for (let i = 0; i < records.length; i += size) batches.push(records.slice(i, i + size));
    return batches;
  });
}

export type GroupingMode = 'sender' | 'domain';

export function groupEmails(records: EmailRecord[], mode: GroupingMode = 'sender') {
  const senders = groupBySender(records);
  if (mode === 'sender') return senders.map(sender => ({ ...sender, senders: [sender] }));

  const domains = new Map<string, typeof senders>();
  for (const sender of senders) {
    // Group exact domains only: subdomains and unrelated missing addresses stay separate.
    const match = sender.address.match(/^[^@\s]+@([^@\s]+)$/);
    const key = match ? `@${match[1]}` : sender.address;
    const members = domains.get(key) || [];
    members.push(sender);
    domains.set(key, members);
  }
  return [...domains.entries()].map(([address, members]) => ({
    address,
    name: address || 'Unknown sender',
    emails: members.flatMap(sender => sender.emails),
    link: members.find(sender => sender.link)?.link,
    checked: members.reduce((count, sender) => count + sender.checked, 0),
    latest: members.reduce((latest, sender) => Math.max(latest, sender.latest), 0),
    senders: members,
  })).sort((a, b) => b.emails.length - a.emails.length);
}
