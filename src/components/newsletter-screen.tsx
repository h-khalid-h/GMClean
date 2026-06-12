'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mail, Check, Trash2, Link, ExternalLink, RefreshCw, AlertTriangle, ShieldAlert, CheckSquare, Square, X, Ban, Download } from 'lucide-react';
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

interface BulkResult {
  senderName: string;
  status: 'success' | 'failed' | 'skipped';
  reason?: string;
}

type BulkOperation = {
  type: 'unsubscribe' | 'delete';
  totalSteps: number;
  currentStep: number;
  message: string;
  results: BulkResult[];
  cancelled: boolean;
} | null;

export default function NewsletterScreen({ userEmail }: NewsletterScreenProps) {
  const [senders, setSenders] = useState<GroupedSender[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [manualLink, setManualLink] = useState<{ url: string; sender: string } | null>(null);

  // Selection state
  const [selectedSenders, setSelectedSenders] = useState<Set<string>>(new Set());

  // Bulk operation progress
  const [bulkOp, setBulkOp] = useState<BulkOperation>(null);
  const cancelRef = useRef(false);

  const loadNewsletters = useCallback(async () => {
    setLoading(true);
    try {
      const records = await db.emails
        .where('mailbox').equals(userEmail)
        .and(item => item.category === 'newsletter' && item.deleted === 0)
        .toArray();

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

        const emailTime = new Date(email.date).getTime();
        if (emailTime > new Date(group.lastReceived).getTime()) {
          group.lastReceived = email.date;
        }
        
        if (!group.unsubscribeLink && email.unsubscribeLink) {
          group.unsubscribeLink = email.unsubscribeLink;
        }

        if (email.unsubscribedAt && email.unsubscribedAt > group.unsubscribedAt) {
          group.unsubscribedAt = email.unsubscribedAt;
        }

        if (email.unsubscribed === 1) {
          group.unsubscribed = true;
        }

        if (group.unsubscribedAt > 0 && emailTime > group.unsubscribedAt) {
          group.stillSending = true;
        }
      });

      const sortedSenders = Object.values(groups).sort((a, b) => b.count - a.count);
      setSenders(sortedSenders);
    } catch (err) {
      console.error('Failed to group newsletters:', err);
    } finally {
      setLoading(false);
    }
  }, [userEmail]);

  useEffect(() => {
    setTimeout(() => { loadNewsletters(); }, 0);
  }, [loadNewsletters]);

  // ── Selection helpers ──
  const toggleSelect = (senderEmail: string) => {
    setSelectedSenders(prev => {
      const next = new Set(prev);
      if (next.has(senderEmail)) {
        next.delete(senderEmail);
      } else {
        next.add(senderEmail);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedSenders(new Set(senders.map(s => s.senderEmail)));
  };

  const deselectAll = () => {
    setSelectedSenders(new Set());
  };

  const allSelected = senders.length > 0 && selectedSenders.size === senders.length;

  // Get selected sender objects
  const getSelectedSenderObjects = (): GroupedSender[] => {
    return senders.filter(s => selectedSenders.has(s.senderEmail));
  };

  // Count of selected that have unsubscribe links & aren't already unsubscribed
  const unsubscribableCount = getSelectedSenderObjects().filter(
    s => s.unsubscribeLink && !s.unsubscribed
  ).length;

  // Total email count across all selected
  const selectedEmailCount = getSelectedSenderObjects().reduce((sum, s) => sum + s.count, 0);

  // ── Single unsubscribe (existing) ──
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

      if (data.protocol === 'mailto') {
        window.open(data.link, '_self');
        setAlert({ type: 'success', message: `Local mail composer opened to send unsubscribe mail to ${sender.senderName}.` });
      } else if (!data.success && data.manualLink) {
        setManualLink({ url: data.manualLink, sender: sender.senderName });
      } else {
        setAlert({ type: 'success', message: `Successfully requested unsubscribe from ${sender.senderName}!` });
      }

      const now = Date.now();
      await Promise.all(
        sender.uids.map(uid => db.emails.update([userEmail, uid], { unsubscribed: 1, unsubscribedAt: now }))
      );

      await loadNewsletters();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unsubscribe request failed.';
      setAlert({ type: 'error', message: errMsg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // ── Single delete (existing) ──
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

      await Promise.all(
        sender.uids.map(uid => db.emails.update([userEmail, uid], { deleted: 1 }))
      );

      setAlert({ type: 'success', message: `Bulk deleted ${sender.count} emails from ${sender.senderName}.` });
      await loadNewsletters();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Bulk deletion failed.';
      setAlert({ type: 'error', message: errMsg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // ── Bulk unsubscribe (multi-select) ──
  const handleBulkUnsubscribe = async () => {
    const selected = getSelectedSenderObjects();
    const actionable = selected.filter(s => s.unsubscribeLink && !s.unsubscribed);
    const skipped = selected.filter(s => !s.unsubscribeLink || s.unsubscribed);

    if (actionable.length === 0) {
      setAlert({ type: 'error', message: 'No selected senders have actionable unsubscribe links.' });
      return;
    }

    const confirm = window.confirm(
      `Unsubscribe from ${actionable.length} sender${actionable.length > 1 ? 's' : ''}?` +
      (skipped.length > 0 ? ` (${skipped.length} will be skipped — no link or already unsubscribed)` : '')
    );
    if (!confirm) return;

    cancelRef.current = false;
    const results: BulkResult[] = [];

    // Pre-fill skipped
    skipped.forEach(s => {
      results.push({
        senderName: s.senderName,
        status: 'skipped',
        reason: s.unsubscribed ? 'Already unsubscribed' : 'No unsubscribe link',
      });
    });

    setBulkOp({
      type: 'unsubscribe',
      totalSteps: actionable.length,
      currentStep: 0,
      message: 'Starting bulk unsubscribe...',
      results: [...results],
      cancelled: false,
    });

    for (let i = 0; i < actionable.length; i++) {
      if (cancelRef.current) {
        setBulkOp(prev => prev ? { ...prev, cancelled: true, message: 'Cancelled by user.' } : null);
        break;
      }

      const sender = actionable[i];
      setBulkOp(prev => prev ? {
        ...prev,
        currentStep: i,
        message: `Unsubscribing from ${sender.senderName} (${i + 1} of ${actionable.length})...`,
      } : null);

      try {
        const response = await fetch('/api/mail/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'unsubscribe',
            link: sender.unsubscribeLink,
            senderEmail: sender.senderEmail,
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        // Mark in IndexedDB
        const now = Date.now();
        await Promise.all(
          sender.uids.map(uid => db.emails.update([userEmail, uid], { unsubscribed: 1, unsubscribedAt: now }))
        );

        results.push({ senderName: sender.senderName, status: 'success' });
      } catch (err) {
        results.push({
          senderName: sender.senderName,
          status: 'failed',
          reason: err instanceof Error ? err.message : 'Request failed',
        });
      }

      setBulkOp(prev => prev ? { ...prev, currentStep: i + 1, results: [...results] } : null);
    }

    // Final state — show results
    setBulkOp(prev => prev ? {
      ...prev,
      currentStep: actionable.length,
      message: cancelRef.current ? 'Operation cancelled.' : 'Bulk unsubscribe complete!',
    } : null);

    await loadNewsletters();
    setSelectedSenders(new Set());
  };

  // ── Bulk delete (multi-select, batched) ──
  const handleBulkDelete = async () => {
    const selected = getSelectedSenderObjects();
    const totalEmails = selected.reduce((sum, s) => sum + s.uids.length, 0);

    if (totalEmails === 0) return;

    const confirm = window.confirm(
      `Permanently delete ${totalEmails.toLocaleString()} emails from ${selected.length} sender${selected.length > 1 ? 's' : ''}?\n\nThis will remove them from your mail server and cannot be undone.`
    );
    if (!confirm) return;

    cancelRef.current = false;

    // Collect all UIDs and batch into chunks of 500
    const allUids = selected.flatMap(s => s.uids);
    const BATCH_SIZE = 500;
    const batches: number[][] = [];
    for (let i = 0; i < allUids.length; i += BATCH_SIZE) {
      batches.push(allUids.slice(i, i + BATCH_SIZE));
    }

    setBulkOp({
      type: 'delete',
      totalSteps: batches.length,
      currentStep: 0,
      message: `Deleting ${totalEmails.toLocaleString()} emails in ${batches.length} batch${batches.length > 1 ? 'es' : ''}...`,
      results: [],
      cancelled: false,
    });

    let deletedCount = 0;
    const results: BulkResult[] = [];

    for (let i = 0; i < batches.length; i++) {
      if (cancelRef.current) {
        setBulkOp(prev => prev ? { ...prev, cancelled: true, message: 'Cancelled by user.' } : null);
        break;
      }

      const batch = batches[i];
      setBulkOp(prev => prev ? {
        ...prev,
        currentStep: i,
        message: `Deleting batch ${i + 1} of ${batches.length} (${deletedCount.toLocaleString()} of ${totalEmails.toLocaleString()} emails)...`,
      } : null);

      try {
        const response = await fetch('/api/mail/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', uids: batch }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Batch delete failed');
        }

        // Mark deleted in IndexedDB
        await Promise.all(
          batch.map(uid => db.emails.update([userEmail, uid], { deleted: 1 }))
        );

        deletedCount += batch.length;
        results.push({ senderName: `Batch ${i + 1}`, status: 'success' });
      } catch (err) {
        results.push({
          senderName: `Batch ${i + 1}`,
          status: 'failed',
          reason: err instanceof Error ? err.message : 'Request failed',
        });
      }

      setBulkOp(prev => prev ? { ...prev, currentStep: i + 1, results: [...results] } : null);
    }

    setBulkOp(prev => prev ? {
      ...prev,
      currentStep: batches.length,
      message: cancelRef.current
        ? `Cancelled. ${deletedCount.toLocaleString()} of ${totalEmails.toLocaleString()} emails deleted.`
        : `Deleted ${deletedCount.toLocaleString()} emails from ${selected.length} sender${selected.length > 1 ? 's' : ''}.`,
    } : null);

    await loadNewsletters();
    setSelectedSenders(new Set());
  };

  const closeBulkOp = () => {
    setBulkOp(null);
    cancelRef.current = false;
  };

  // ── Export selected subscriptions ──
  const handleExportSelected = () => {
    const selected = getSelectedSenderObjects();
    if (selected.length === 0) return;

    const escapeCSV = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const headers = ['Sender Name', 'Sender Email', 'Email Count', 'Last Received', 'Unsubscribe Link', 'Status', 'Unsubscribed Date'];
    const rows = selected.map(s => [
      escapeCSV(s.senderName),
      escapeCSV(s.senderEmail),
      s.count.toString(),
      new Date(s.lastReceived).toISOString().split('T')[0],
      escapeCSV(s.unsubscribeLink || ''),
      s.unsubscribed ? 'Unsubscribed' : 'Active',
      s.unsubscribedAt ? new Date(s.unsubscribedAt).toISOString().split('T')[0] : '',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gmclean-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    setAlert({ type: 'success', message: `Exported ${selected.length} subscription${selected.length > 1 ? 's' : ''} to CSV.` });
  };

  const cancelBulkOp = () => {
    cancelRef.current = true;
  };

  // ── Render ──
  return (
    <div style={{ width: '100%', paddingBottom: selectedSenders.size > 0 ? '70px' : 0 }}>
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

      {/* Bulk Operation Progress Modal */}
      {bulkOp && (
        <div className={styles.progressOverlay}>
          <div className={styles.progressCard}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
              {bulkOp.type === 'unsubscribe' ? 'Bulk Unsubscribe' : 'Bulk Delete'}
            </h3>
            
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-light)', margin: 0 }}>
              {bulkOp.message}
            </p>

            {/* Progress bar */}
            <div className={styles.progressBarTrack}>
              <div
                className={styles.progressBarFill}
                style={{ width: `${bulkOp.totalSteps > 0 ? (bulkOp.currentStep / bulkOp.totalSteps) * 100 : 0}%` }}
              />
            </div>

            {/* Results list (shown after completion or partial) */}
            {bulkOp.results.length > 0 && bulkOp.currentStep >= bulkOp.totalSteps && (
              <div className={styles.resultsList}>
                {bulkOp.results.map((r, idx) => (
                  <div key={idx} className={styles.resultItem}>
                    {r.status === 'success' && <Check size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />}
                    {r.status === 'failed' && <X size={14} style={{ color: '#ef4444', flexShrink: 0 }} />}
                    {r.status === 'skipped' && <Ban size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
                    <span style={{ color: r.status === 'success' ? 'var(--success)' : r.status === 'failed' ? '#ef4444' : 'var(--muted)' }}>
                      {r.senderName}
                    </span>
                    {r.reason && <span style={{ color: 'var(--muted)', marginLeft: 'auto', fontSize: '0.75rem' }}>({r.reason})</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              {bulkOp.currentStep < bulkOp.totalSteps && !bulkOp.cancelled ? (
                <button
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={cancelBulkOp}
                  style={{ width: 'auto', padding: '8px 16px', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
              ) : (
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={closeBulkOp}
                  style={{ width: 'auto', padding: '8px 16px', fontSize: '0.85rem' }}
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div className={styles.topBar}>
        <div>
          <h1 className={styles.pageTitle}>Subscription Manager</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Grouped by active senders who send newsletter/promotional emails</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {senders.length > 0 && (
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={allSelected ? deselectAll : selectAll}
              style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
              aria-label={allSelected ? 'Deselect all senders' : 'Select all senders'}
            >
              {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          )}
          <button 
            className={`${styles.btn} ${styles.btnSecondary}`} 
            onClick={() => { loadNewsletters(); deselectAll(); }}
            style={{ width: 'auto' }}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
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
          {senders.map(sender => {
            const isSelected = selectedSenders.has(sender.senderEmail);
            return (
              <div
                key={sender.senderEmail}
                className={`${styles.senderCard} ${isSelected ? styles.senderCardSelected : ''}`}
                style={{ paddingLeft: '2.5rem' }}
              >
                {/* Selection checkbox */}
                <button
                  type="button"
                  className={`${styles.selectionCheckbox} ${isSelected ? styles.selectionCheckboxChecked : ''}`}
                  onClick={() => toggleSelect(sender.senderEmail)}
                  aria-label={`Select ${sender.senderName}`}
                >
                  {isSelected && <Check size={13} color="#fff" strokeWidth={3} />}
                </button>

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
            );
          })}
        </div>
      )}

      {/* Floating Selection Bar */}
      {selectedSenders.size > 0 && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionBarCount}>
            {selectedSenders.size} sender{selectedSenders.size > 1 ? 's' : ''} selected
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.8rem', marginLeft: '0.4rem' }}>
              ({selectedEmailCount.toLocaleString()} emails)
            </span>
          </span>
          <div className={styles.selectionBarActions}>
            {unsubscribableCount > 0 && (
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={handleBulkUnsubscribe}
                style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
              >
                <Link size={14} /> Unsubscribe ({unsubscribableCount})
              </button>
            )}
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={handleExportSelected}
              style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
            >
              <Download size={14} /> Export
            </button>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={handleBulkDelete}
              style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
            >
              <Trash2 size={14} /> Delete All ({selectedEmailCount.toLocaleString()})
            </button>
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={deselectAll}
              style={{ width: 'auto', padding: '6px 14px', fontSize: '0.8rem' }}
            >
              <X size={14} /> Deselect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
