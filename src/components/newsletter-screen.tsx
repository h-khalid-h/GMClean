'use client';

import React, { useState, useEffect } from 'react';
import { Mail, Check, Trash2, Link, ExternalLink, RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/db';
import styles from '@/app/page.module.css';

interface NewsletterScreenProps {
  userEmail: string;
}

interface GroupedSender {
  senderEmail: string;
  senderName: string;
  count: number;
  lastReceived: Date;
  unsubscribeLink?: string;
  uids: number[];
  unsubscribed: boolean;
  unsubscribedAt: number; // timestamp ms
  stillSending: boolean; // true if emails received after unsubscribe
}

export default function NewsletterScreen({ userEmail }: NewsletterScreenProps) {
  const [senders, setSenders] = useState<GroupedSender[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [manualLink, setManualLink] = useState<{ url: string; sender: string } | null>(null);

  const loadNewsletters = async () => {
    setLoading(true);
    try {
      // Fetch only non-deleted newsletters for this user email
      const records = await db.emails
        .where('mailbox').equals(userEmail)
        .and(item => item.category === 'newsletter' && item.deleted === 0)
        .toArray();

      // Group records by senderEmail
      const groups: { [email: string]: GroupedSender } = {};
      
      records.forEach(email => {
        const emailLower = (email.senderEmail || '').toLowerCase();
        if (!groups[emailLower]) {
          groups[emailLower] = {
            senderEmail: email.senderEmail || 'unknown@unknown.com',
            senderName: email.senderName || 'Unknown',
            count: 0,
            lastReceived: email.date,
            unsubscribeLink: email.unsubscribeLink,
            uids: [],
            unsubscribed: email.unsubscribed === 1,
            unsubscribedAt: email.unsubscribedAt || 0,
            stillSending: false,
          };
        }

        const group = groups[emailLower];
        group.count += 1;
        group.uids.push(email.uid);

        // Track newest received date
        const emailTime = new Date(email.date).getTime();
        if (emailTime > new Date(group.lastReceived).getTime()) {
          group.lastReceived = email.date;
        }
        
        // Preserve unsubscribe link if found
        if (!group.unsubscribeLink && email.unsubscribeLink) {
          group.unsubscribeLink = email.unsubscribeLink;
        }

        // Track unsubscribe timestamp (use latest across all emails)
        if (email.unsubscribedAt && email.unsubscribedAt > group.unsubscribedAt) {
          group.unsubscribedAt = email.unsubscribedAt;
        }

        // If at least one email is marked unsubscribed, mark the group
        if (email.unsubscribed === 1) {
          group.unsubscribed = true;
        }

        // Detect if sender kept emailing after unsubscribe
        if (group.unsubscribedAt > 0 && emailTime > group.unsubscribedAt) {
          group.stillSending = true;
        }
      });

      // Convert groups object to sorted array (highest count first)
      const sortedSenders = Object.values(groups).sort((a, b) => b.count - a.count);
      setSenders(sortedSenders);
    } catch (err) {
      console.error('Failed to group newsletters:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTimeout(() => {
      loadNewsletters();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  // Unsubscribe action
  const handleUnsubscribe = async (sender: GroupedSender) => {
    if (!sender.unsubscribeLink) return;
    
    setActionLoadingId(`unsub-${sender.senderEmail}`);
    setAlert(null);

    try {
      const response = await fetch('/api/mail/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'unsubscribe', 
          link: sender.unsubscribeLink,
          senderEmail: sender.senderEmail
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to request unsubscribe.');
      }

      // Handle mailto links
      if (data.protocol === 'mailto') {
        window.open(data.link, '_self'); // Opens local email client
        setAlert({ type: 'success', message: `Local mail composer opened to send unsubscribe mail to ${sender.senderName}.` });
      } else if (!data.success && data.manualLink) {
        // Safe fallback if server fails to ping URL
        setManualLink({ url: data.manualLink, sender: sender.senderName });
      } else {
        setAlert({ type: 'success', message: `Successfully requested unsubscribe from ${sender.senderName}!` });
      }

      // Update state in local IndexedDB using compound primary key — store timestamp
      const now = Date.now();
      await Promise.all(
        sender.uids.map(uid => db.emails.update([userEmail, uid], { unsubscribed: 1, unsubscribedAt: now }))
      );

      // Reload local data
      await loadNewsletters();

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unsubscribe request failed.';
      setAlert({ type: 'error', message: errMsg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Bulk delete action (Deletes all newsletters from this sender)
  const handleDeleteAll = async (sender: GroupedSender) => {
    if (sender.uids.length === 0) return;
    
    const confirmDelete = window.confirm(`Are you sure you want to delete all ${sender.count} emails from ${sender.senderName}? This will permanently remove them from your mail server.`);
    if (!confirmDelete) return;

    setActionLoadingId(`del-${sender.senderEmail}`);
    setAlert(null);

    try {
      const response = await fetch('/api/mail/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'delete', 
          uids: sender.uids 
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Bulk delete failed.');
      }

      // Update records in local IndexedDB (mark as deleted) using compound primary key
      await Promise.all(
        sender.uids.map(uid => db.emails.update([userEmail, uid], { deleted: 1 }))
      );

      setAlert({ type: 'success', message: `Bulk deleted ${sender.count} emails from ${sender.senderName}.` });
      
      // Reload local data
      await loadNewsletters();

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Bulk deletion failed.';
      setAlert({ type: 'error', message: errMsg });
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div style={{ width: '100%' }}>
      {alert && (
        <div 
          className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
          onClick={() => setAlert(null)}
        >
          <span>{alert.message} (Click to dismiss)</span>
        </div>
      )}

      {/* Manual Link Modal Fallback */}
      {manualLink && (
        <div className={styles.overlay} onClick={() => setManualLink(null)}>
          <div className={styles.connectCard} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', padding: '2rem' }}>
            <div style={{ display: 'inline-flex', padding: '10px', background: 'var(--warning-bg)', borderRadius: '12px', color: 'var(--warning)', marginBottom: '1rem' }}>
              <AlertTriangle size={24} />
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff', marginBottom: '0.5rem' }}>Manual Unsubscribe Required</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-light)', marginBottom: '1.5rem' }}>
              The email sender {manualLink.sender} requires visiting a web portal to confirm your unsubscription. Click the button below to open their unsubscribe page.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <a
                href={manualLink.url.startsWith('http://') || manualLink.url.startsWith('https://') ? manualLink.url : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => setManualLink(null)}
                style={{ flex: 1 }}
              >
                <ExternalLink size={14} /> Open Portal
              </a>
              <button 
                type="button" 
                className={`${styles.btn} ${styles.btnSecondary}`} 
                onClick={() => setManualLink(null)}
                style={{ width: 'auto' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.topBar}>
        <div>
          <h1 className={styles.pageTitle}>Subscription Manager</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Grouped by active senders who send newsletter/promotional emails</p>
        </div>
        <button 
          className={`${styles.btn} ${styles.btnSecondary}`} 
          onClick={loadNewsletters}
          style={{ width: 'auto' }}
        >
          <RefreshCw size={16} /> Refresh Senders
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '5rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', color: 'var(--muted)' }}>
          <RefreshCw size={36} className={styles.loader} />
          <p>Analyzing local newsletter database...</p>
        </div>
      ) : senders.length === 0 ? (
        <div className={styles.tableCard} style={{ padding: '4rem', textAlign: 'center', color: 'var(--muted)' }}>
          <Mail size={44} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <h3>No newsletter subscriptions detected.</h3>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Ensure you have scanned your mailbox folders from the main dashboard tab.</p>
        </div>
      ) : (
        <div className={styles.senderGrid}>
          {senders.map(sender => (
            <div key={sender.senderEmail} className={styles.senderCard}>
              <div className={styles.senderCardHeader}>
                <div className={styles.senderCardInfo}>
                  <div className={styles.senderName}>{sender.senderName}</div>
                  <div className={styles.senderEmail}>{sender.senderEmail}</div>
                </div>
                <div className={styles.emailCount}>
                  {sender.count} {sender.count === 1 ? 'mail' : 'mails'}
                </div>
              </div>
              
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span>Last received:</span>
                <span>{new Date(sender.lastReceived).toLocaleDateString()}</span>
                {sender.stillSending && (
                  <span className={styles.stillSendingBadge}>
                    <ShieldAlert size={10} /> Still Sending
                  </span>
                )}
              </div>

              <div className={styles.senderCardActions}>
                {sender.unsubscribeLink ? (
                  sender.unsubscribed ? (
                    <button
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      disabled
                      style={{ padding: '6px 8px', fontSize: '0.75rem', color: 'var(--success)', background: 'var(--success-bg)', border: '1px solid rgba(16, 185, 129, 0.15)' }}
                    >
                      <Check size={12} /> Unsubscribed
                    </button>
                  ) : (
                    <button
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={() => handleUnsubscribe(sender)}
                      disabled={actionLoadingId === `unsub-${sender.senderEmail}`}
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    >
                      {actionLoadingId === `unsub-${sender.senderEmail}` ? (
                        <RefreshCw size={12} className={styles.loader} />
                      ) : (
                        <Link size={12} />
                      )}
                      Unsubscribe
                    </button>
                  )
                ) : (
                  <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    disabled
                    style={{ padding: '6px 8px', fontSize: '0.75rem', opacity: 0.4 }}
                  >
                    No Header Link
                  </button>
                )}

                <button
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() => handleDeleteAll(sender)}
                  disabled={actionLoadingId === `del-${sender.senderEmail}`}
                  style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                >
                  {actionLoadingId === `del-${sender.senderEmail}` ? (
                    <RefreshCw size={12} className={styles.loader} />
                  ) : (
                    <Trash2 size={12} />
                  )}
                  Delete All
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
