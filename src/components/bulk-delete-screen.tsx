'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { ExternalLink, Mail, RefreshCw, Search, Trash2 } from 'lucide-react';
import { db, type EmailRecord } from '@/lib/db';
import { folderBatches, groupEmails, type GroupingMode } from '@/lib/sender-groups';
import { safeUnsubscribeLink } from '@/lib/unsubscribe';
import styles from '@/app/page.module.css';

export default function BulkDeleteScreen({ userEmail }: { userEmail: string }) {
  const [records, setRecords] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [grouping, setGrouping] = useState<GroupingMode>('sender');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [notice, setNotice] = useState<{ error?: boolean; text: string } | null>(null);

  useEffect(() => {
    const subscription = liveQuery(() => db.emails.where('mailbox').equals(userEmail).and(email => email.deleted === 0).toArray())
      .subscribe({
        next: emails => { setRecords(emails); setLoading(false); },
        error: () => { setNotice({ error: true, text: 'Could not load local emails. Reload to try again.' }); setLoading(false); },
      });
    return () => subscription.unsubscribe();
  }, [userEmail]);

  const groups = useMemo(() => groupEmails(records, grouping), [records, grouping]);
  const visible = groups.filter(group => {
    const matchesSearch = `${group.name} ${group.address} ${group.senders.map(sender => `${sender.name} ${sender.address}`).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesSearch && (filter === 'all' || (filter === 'link' ? !!group.link : !group.link));
  });

  async function run(action: 'delete' | 'check-unsubscribe', emails: EmailRecord[], label: string) {
    if (running.current || !emails.length) return;
    const permanent = localStorage.getItem('gmclean_permanent_delete') === '1';
    // Safe mode is a single click. Irreversible deletion requires confirmation.
    if (action === 'delete' && permanent && !window.confirm(`Permanently delete ${emails.length} emails from ${label}? This cannot be undone.`)) return;
    running.current = true;
    setBusy(true);
    let completed = 0;
    try {
      for (const batch of folderBatches(emails, action === 'delete' ? 500 : 25)) {
        setNotice({ text: `${action === 'delete' ? 'Deleting' : 'Checking unsubscribe links'}: ${completed} / ${emails.length} emails…` });
        const response = await fetch('/api/mail/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, mailbox: userEmail, folder: batch[0].folder, uids: batch.map(email => email.uid), permanent }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Request failed.');
        if (action === 'delete') {
          await db.transaction('rw', db.emails, async () => {
            for (const email of batch) await db.emails.update([userEmail, email.folder, email.uid], { deleted: 1 });
          });
          completed += batch.length;
        } else {
          const results = data.results as { uid: number; unsubscribeLink?: string }[];
          await db.transaction('rw', db.emails, async () => {
            for (const result of results) {
              const email = batch.find(email => email.uid === result.uid);
              if (!email) continue;
              const link = result.unsubscribeLink && safeUnsubscribeLink(result.unsubscribeLink);
              await db.emails.update([userEmail, email.folder, email.uid], {
                unsubscribeCheckedAt: Date.now(),
                ...(link ? { unsubscribeLink: link, category: 'newsletter' as const } : {}),
              });
            }
          });
          completed += results.length;
        }
      }
      setNotice({ text: action === 'delete'
        ? `${completed} emails ${permanent ? 'permanently deleted' : 'moved to Trash'}.`
        : `Checked ${completed} of ${emails.length} emails. Detected unsubscribe links are shown below and in Subscriptions.${completed < emails.length ? ' Some messages are no longer available on the server.' : ''}` });
    } catch (error) {
      setNotice({ error: true, text: `${completed} of ${emails.length} emails processed. ${error instanceof Error ? error.message : 'Request failed.'} Remaining emails can be retried.` });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <div className={styles.topBar}>
        <div>
          <h1 className={styles.pageTitle}>Bulk-delete</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{groups.length} {grouping === 'domain' ? 'groups' : 'senders'} · {records.length.toLocaleString()} emails · All categories</p>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        All scanned emails, grouped by {grouping} across folders. Scan additional folders in Overview to include older emails and spam.
        Delete all moves the entire group’s scanned emails to Trash, unless permanent deletion is enabled in Settings.
      </p>
      {notice && <div role="status" aria-live="polite" className={`${styles.alert} ${notice.error ? styles.alertError : styles.alertSuccess}`}>{busy && <RefreshCw size={14} className={styles.loader} />} {notice.text}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <select className={styles.select} style={{ width: 'auto' }} aria-label="Group emails by" value={grouping} disabled={busy} onChange={event => setGrouping(event.target.value as GroupingMode)}>
          <option value="sender">By sender</option>
          <option value="domain">By domain</option>
        </select>
        <input className={styles.input} style={{ flex: '1 1 220px' }} aria-label="Search senders" placeholder="Search name, email or domain…" value={query} onChange={event => setQuery(event.target.value)} />
        <select className={styles.select} style={{ width: 'auto' }} aria-label="Filter unsubscribe detection" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All groups</option>
          <option value="link">Unsubscribe link found</option>
          <option value="none">No link detected yet</option>
        </select>
      </div>
      {loading ? <p role="status">Loading emails…</p> : visible.length === 0 ? (
        <div className={styles.tableCard} style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
          <Mail size={36} />
          <p>{groups.length ? 'No groups match your filters.' : 'No scanned emails. Scan your mailbox in Overview first.'}</p>
        </div>
      ) : <div className={styles.senderGrid}>
        {visible.map(group => {
          const link = group.link && safeUnsubscribeLink(group.link);
          return <div className={styles.senderCard} key={group.address}>
            <div className={styles.senderCardHeader}>
              <div className={styles.senderCardInfo}>
                <div className={styles.senderName}>{group.name}</div>
                <div className={styles.senderEmail}>{grouping === 'domain' ? `${group.senders.length} senders` : group.address || 'Unknown sender'}</div>
              </div>
              <div className={styles.emailCount}>{group.emails.length.toLocaleString()} mails</div>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
              Last received: {new Date(group.latest).toLocaleDateString()} · {new Set(group.emails.map(email => email.folder)).size} folders
            </p>
            <p style={{ color: link ? 'var(--success)' : 'var(--muted)', fontSize: '0.8rem' }}>
              {link ? (grouping === 'domain' ? `Unsubscribe links found for ${group.senders.filter(sender => sender.link).length} of ${group.senders.length} senders` : 'Unsubscribe link found') : group.checked === group.emails.length ? 'No unsubscribe link found' : `Body check: ${group.checked} / ${group.emails.length} emails checked`}
            </p>
            {grouping === 'domain' && <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>View {group.senders.length} senders and unsubscribe links</summary>
              <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
                {group.senders.map(sender => {
                  const senderLink = sender.link && safeUnsubscribeLink(sender.link);
                  return <div key={sender.address} style={{ borderTop: '1px solid var(--card-border)', paddingTop: '0.5rem', overflowWrap: 'anywhere' }}>
                    <div style={{ fontSize: '0.85rem' }}>{sender.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{sender.address} · {sender.emails.length} mails</div>
                    {senderLink ? <a href={senderLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--primary)' }} aria-label={`Open unsubscribe for ${sender.address}`}>
                      Open unsubscribe <ExternalLink size={12} />
                    </a> : <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                      {sender.checked === sender.emails.length ? 'No unsubscribe link found' : `Body check: ${sender.checked} / ${sender.emails.length} emails checked`}
                    </span>}
                  </div>;
                })}
              </div>
            </details>}
            <div className={styles.senderCardActions} style={{ flexWrap: 'wrap' }}>
              <button className={`${styles.btn} ${styles.btnSecondary}`} disabled={busy} onClick={() => run('check-unsubscribe', group.emails, group.address)}>
                <Search size={14} /> {grouping === 'domain' ? 'Check group unsubscribe' : 'Check unsubscribe'}
              </button>
              {link && grouping === 'sender' && <a className={`${styles.btn} ${styles.btnSecondary}`} href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open unsubscribe</a>}
              <button className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => run('delete', group.emails, group.address)} aria-label={`Delete all ${group.emails.length} emails from ${group.address}`}>
                <Trash2 size={14} /> Delete all ({group.emails.length})
              </button>
            </div>
          </div>;
        })}
      </div>}
    </div>
  );
}
