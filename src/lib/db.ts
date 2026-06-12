import Dexie, { type Table } from 'dexie';

export interface EmailRecord {
  id?: number; // Kept for compatibility
  uid: number;
  mailbox: string; // The username/email of the mailbox (to support multiple accounts)
  messageId?: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  date: Date;
  category: 'newsletter' | 'transaction' | 'social' | 'personal';
  unsubscribeLink?: string;
  unsubscribed: number; // 0 = false, 1 = true
  unsubscribedAt: number; // timestamp (ms) when unsubscribed, or 0
  folder: string; // IMAP folder the email was fetched from
  deleted: number; // 0 = false, 1 = true
}

export class GMCleanDatabase extends Dexie {
  emails!: Table<EmailRecord, [string, string, number]>; // Primary key is [mailbox, folder, uid]

  constructor() {
    super('GMCleanDatabase');

    // Start at v2 directly — compound key [mailbox+uid] is the primary key
    this.version(2).stores({
      emails: '[mailbox+uid], uid, mailbox, senderEmail, category, date, unsubscribed, deleted'
    });

    // v3: add folder + unsubscribedAt fields and indices
    this.version(3).stores({
      emails: '[mailbox+uid], uid, mailbox, senderEmail, category, date, folder, unsubscribed, unsubscribedAt, deleted'
    }).upgrade(tx => {
      return tx.table('emails').toCollection().modify(email => {
        if (!email.folder) email.folder = 'INBOX';
        if (email.unsubscribedAt === undefined) email.unsubscribedAt = 0;
      });
    });

    // v4: change compound key to [mailbox+folder+uid] to fix UID collision across folders.
    // IMAP UIDs are unique per-folder, not per-mailbox. Without folder in the key,
    // syncing INBOX and Spam would overwrite records with the same UID.
    this.version(4).stores({
      emails: '[mailbox+folder+uid], uid, mailbox, senderEmail, category, date, folder, unsubscribed, unsubscribedAt, deleted'
    });
  }
}

export const db = new GMCleanDatabase();
