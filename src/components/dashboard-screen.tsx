'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { RefreshCw, Search, Trash2, ExternalLink, Mail, CheckCircle, AlertCircle, FolderOpen, Download, Activity, ShieldCheck, Lightbulb, TrendingDown, TrendingUp, AlertTriangle, Sparkles, Minus, Timer } from 'lucide-react';
import { db, type EmailRecord } from '@/lib/db';
import styles from '@/app/page.module.css';

interface DashboardScreenProps {
  userEmail: string;
  mailboxHost: string;
  onQuickClean?: (senderEmails: string[]) => void;
}

export default function DashboardScreen({ userEmail, mailboxHost, onQuickClean }: DashboardScreenProps) {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'newsletter' | 'transaction' | 'social' | 'personal'>('all');
  
  // Pagination state
  const ROWS_PER_PAGE = 50;
  const [currentPage, setCurrentPage] = useState(1);

  // Reset pagination when filter or search changes
  const handleFilterChange = (filter: typeof activeFilter) => {
    setActiveFilter(filter);
    setCurrentPage(1);
  };

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncCount, setSyncCount] = useState(0);
  const [syncMessage, setSyncMessage] = useState('');
  const [autoSyncActive, setAutoSyncActive] = useState(false);
  const [nextAutoSync, setNextAutoSync] = useState<string | null>(null);
  const autoSyncRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  
  // Export emails to CSV
  const exportCSV = () => {
    if (emails.length === 0) return;

    const escapeCSV = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const headers = ['Date', 'Sender Name', 'Sender Email', 'Subject', 'Category', 'Folder', 'Has Unsubscribe', 'Unsubscribed'];
    const rows = emails.map(e => [
      new Date(e.date).toISOString().split('T')[0],
      escapeCSV(e.senderName || ''),
      escapeCSV(e.senderEmail || ''),
      escapeCSV(e.subject || ''),
      e.category,
      e.folder || 'INBOX',
      e.unsubscribeLink ? 'Yes' : 'No',
      e.unsubscribed ? 'Yes' : 'No',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gmclean-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    newsletters: 0,
    transactions: 0,
    social: 0,
    personal: 0,
  });

  // Action states
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [actionAlert, setActionAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Folder selection state
  const [folders, setFolders] = useState<string[]>(['INBOX']);
  const [selectedFolder, setSelectedFolder] = useState('__ALL__');
  const [foldersLoading, setFoldersLoading] = useState(false);

  // Load and calculate stats from IndexedDB
  const loadEmails = async () => {
    try {
      const records = await db.emails
        .where('mailbox').equals(userEmail)
        .and(item => item.deleted === 0)
        .toArray();

      // Sort by date descending
      records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      setEmails(records);

      // Calculate statistics
      const newsletterCount = records.filter(e => e.category === 'newsletter').length;
      const transactionCount = records.filter(e => e.category === 'transaction').length;
      const socialCount = records.filter(e => e.category === 'social').length;
      const personalCount = records.filter(e => e.category === 'personal').length;

      setStats({
        total: records.length,
        newsletters: newsletterCount,
        transactions: transactionCount,
        social: socialCount,
        personal: personalCount
      });
    } catch (err) {
      console.error('Failed to load local emails:', err);
    }
  };

  useEffect(() => {
    setTimeout(() => {
      loadEmails();
    }, 0);
    // Fetch available folders
    const fetchFolders = async () => {
      setFoldersLoading(true);
      try {
        const res = await fetch('/api/mail/folders');
        if (res.ok) {
          const data = await res.json();
          if (data.folders && data.folders.length > 0) {
            setFolders(data.folders);
          }
        }
      } catch { /* silently fail — INBOX is the default */ }
      finally { setFoldersLoading(false); }
    };
    fetchFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  // Run AI smart sorting on personal/uncategorized emails
  const runAIClassification = async (apiKey: string) => {
    setSyncMessage('Running AI Smart Boost classification...');
    try {
      const personalEmails = await db.emails
        .where('mailbox').equals(userEmail)
        .and(item => item.category === 'personal' && item.deleted === 0)
        .toArray();

      if (personalEmails.length === 0) {
        return;
      }

      // Sort by date descending and take latest 100 to prevent large token usage
      personalEmails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const targetEmails = personalEmails.slice(0, 100);

      const BATCH_SIZE = 20;
      for (let i = 0; i < targetEmails.length; i += BATCH_SIZE) {
        const batch = targetEmails.slice(i, i + BATCH_SIZE);
        setSyncMessage(`AI Boost: Classifying batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(targetEmails.length / BATCH_SIZE)}...`);

        const response = await fetch('/api/ai/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            emails: batch.map(e => ({ uid: e.uid, sender: `${e.senderName} <${e.senderEmail}>`, subject: e.subject })),
          }),
        });

        if (!response.ok) {
          console.warn(`AI classify batch failed: ${response.status}`);
          continue;
        }

        const resData = await response.json();
        if (!resData.classifications) continue;

        try {
          const classifications = resData.classifications as Array<{ uid: number; category: 'newsletter' | 'transaction' | 'social' | 'personal' }>;
          if (Array.isArray(classifications)) {
            await Promise.all(classifications.map(async (c) => {
              const validCategories = ['newsletter', 'transaction', 'social', 'personal'];
              if (validCategories.includes(c.category)) {
                await db.emails.update([userEmail, c.uid], { category: c.category });
              }
            }));
            await loadEmails();
          }
        } catch (parseErr) {
          console.error('Failed to parse AI classification:', parseErr);
        }
      }
    } catch (err) {
      console.error('AI Classification failed:', err);
    }
  };

  // Sync a single folder using streaming (single IMAP connection)
  const syncFolder = async (folder: string, limitOverride?: number): Promise<number> => {
    const CHUNK_SIZE = 100;
    let storedLimit: string | null = null;
    try { storedLimit = localStorage.getItem('gmclean_sync_limit'); } catch { /* */ }
    const MAX = limitOverride ?? (storedLimit === '0' ? 999999 : (storedLimit ? parseInt(storedLimit, 10) || 500 : 500));
    const res = await fetch(`/api/mail/sync-stream?totalLimit=${MAX}&chunkSize=${CHUNK_SIZE}&folder=${encodeURIComponent(folder)}`, { method: 'POST' });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Streaming sync failed.'); }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response stream available.');
    const decoder = new TextDecoder();
    let buffer = '';
    let cumulativeFetched = 0;
    let chunkCounter = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6);
        type ChunkEmail = { uid: number; messageId: string; senderName: string; senderEmail: string; subject: string; date: string; category: 'newsletter' | 'transaction' | 'social' | 'personal'; unsubscribeLink?: string };
        type SseEvent = { type: 'chunk'; emails: ChunkEmail[]; progress: { fetched: number; total: number } } | { type: 'done' } | { type: 'error'; error: string };
        let event: SseEvent;
        try { event = JSON.parse(jsonStr); } catch { continue; }
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'done') break;
        if (event.type === 'chunk') {
          const fetchedEmails = event.emails;
          const totalInMailbox = event.progress.total;
          setSyncTotal(Math.min(totalInMailbox, MAX));
          setSyncMessage(`Fetching emails ${cumulativeFetched} to ${cumulativeFetched + fetchedEmails.length}...`);
          const existingKeys = fetchedEmails.map(e => [userEmail, e.uid] as [string, number]);
          const existingRecords = await db.emails.bulkGet(existingKeys);
          const existingMap = new Map<number, EmailRecord>();
          existingRecords.forEach(r => { if (r) existingMap.set(r.uid, r); });
          const recordsToSave: EmailRecord[] = fetchedEmails.map((email) => {
            const existing = existingMap.get(email.uid);
            return {
              uid: email.uid, mailbox: userEmail, messageId: email.messageId,
              senderName: email.senderName, senderEmail: email.senderEmail,
              subject: email.subject, date: new Date(email.date),
              category: existing?.category || email.category,
              unsubscribeLink: email.unsubscribeLink,
              unsubscribed: existing?.unsubscribed ?? 0,
              unsubscribedAt: existing?.unsubscribedAt ?? 0,
              folder: folder, deleted: existing?.deleted ?? 0,
            };
          });
          await db.emails.bulkPut(recordsToSave);
          cumulativeFetched = event.progress.fetched;
          setSyncCount(cumulativeFetched);
          chunkCounter++;
          const pct = Math.min(100, Math.round((cumulativeFetched / Math.min(totalInMailbox, MAX)) * 100));
          setSyncProgress(pct);
          if (chunkCounter % 3 === 0) await loadEmails();
        }
      }
    }
    await loadEmails();
    return cumulativeFetched;
  };

  const startSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncProgress(0);
    setSyncCount(0);

    try {
      if (selectedFolder === '__ALL__') {
        // Sync all folders sequentially
        const foldersToSync = folders.filter(f => f !== '__ALL__');
        let totalSynced = 0;
        for (let i = 0; i < foldersToSync.length; i++) {
          const f = foldersToSync[i];
          setSyncMessage(`Syncing folder ${i + 1}/${foldersToSync.length}: ${f}...`);
          setSyncProgress(Math.round((i / foldersToSync.length) * 100));
          try {
            const count = await syncFolder(f);
            totalSynced += count;
            setSyncCount(totalSynced);
          } catch (err) {
            console.warn(`Skipping folder ${f}:`, err);
            // Continue with next folder even if one fails
          }
        }
        setSyncMessage(`All folders synced! ${totalSynced} emails total.`);
      } else {
        setSyncMessage('Establishing connection to mailbox...');
        await syncFolder(selectedFolder);
        setSyncMessage('Sync completed successfully!');
      }

      await loadEmails();

      // Check if Gemini API Key is configured for AI Boost
      const geminiKey = localStorage.getItem('gmclean_gemini_api_key');
      if (geminiKey) {
        await runAIClassification(geminiKey);
        setSyncMessage('AI Classification completed!');
      }

      setTimeout(() => {
        setSyncing(false);
        setSyncProgress(0);
      }, 2000);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Sync failed.';
      setSyncMessage(`Error: ${errMsg}`);
      setSyncing(false);
    }
  };

  // Auto-sync interval
  useEffect(() => {
    // Clean up previous intervals
    if (autoSyncRef.current) { clearInterval(autoSyncRef.current); autoSyncRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    let intervalMinutes = 0;
    try { intervalMinutes = parseInt(localStorage.getItem('gmclean_auto_sync') || '0', 10) || 0; } catch { /* */ }

    if (intervalMinutes > 0) {
      setAutoSyncActive(true);
      const intervalMs = intervalMinutes * 60 * 1000;
      let nextTime = Date.now() + intervalMs;

      const updateCountdown = () => {
        const remaining = Math.max(0, Math.ceil((nextTime - Date.now()) / 1000));
        if (remaining > 60) {
          setNextAutoSync(`${Math.ceil(remaining / 60)}m`);
        } else {
          setNextAutoSync(`${remaining}s`);
        }
      };
      updateCountdown();
      countdownRef.current = setInterval(updateCountdown, 5000);

      autoSyncRef.current = setInterval(() => {
        nextTime = Date.now() + intervalMs;
        startSync();
      }, intervalMs);
    } else {
      setAutoSyncActive(false);
      setNextAutoSync(null);
    }

    return () => {
      if (autoSyncRef.current) clearInterval(autoSyncRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  // Delete an individual email
  const handleDeleteEmail = async (uid: number) => {
    setActionLoadingId(uid);
    setActionAlert(null);

    try {
      const response = await fetch('/api/mail/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', uids: [uid] }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete email.');
      }

      // Mark as deleted in local database using compound primary key
      await db.emails.update([userEmail, uid], { deleted: 1 });
      await loadEmails();
      
      setActionAlert({ type: 'success', message: 'Email deleted successfully from your mailbox.' });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Deletion failed.';
      setActionAlert({ type: 'error', message: errMsg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Reset pagination when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, searchQuery]);

  // Filter & search emails list defensively (memoized to avoid recalc on every render)
  const filteredEmails = useMemo(() => emails.filter(email => {
    const matchesFilter = activeFilter === 'all' || email.category === activeFilter;
    const lowerSearch = searchQuery.toLowerCase();
    const matchesSearch = 
      (email.subject || '').toLowerCase().includes(lowerSearch) ||
      (email.senderName || '').toLowerCase().includes(lowerSearch) ||
      (email.senderEmail || '').toLowerCase().includes(lowerSearch);
    return matchesFilter && matchesSearch;
  }), [emails, activeFilter, searchQuery]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredEmails.length / ROWS_PER_PAGE));
  const paginatedEmails = filteredEmails.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  return (
    <div style={{ width: '100%' }}>
      {/* Sync Progress Alert Overlay */}
      {syncing && (
        <div className={`${styles.alert} ${styles.alertSuccess}`} style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
            <RefreshCw size={16} className={styles.loader} />
            <span>{syncMessage}</span>
          </div>
          <div className={styles.progressContainer}>
            <div className={styles.progressLabelRow}>
              <span>Progress: {syncProgress}%</span>
              <span>{syncCount} / {syncTotal} emails synced</span>
            </div>
            <div className={styles.progressBarBg}>
              <div className={styles.progressBarFill} style={{ width: `${syncProgress}%` }}></div>
            </div>
          </div>
        </div>
      )}

      {actionAlert && (
        <div 
          className={`${styles.alert} ${actionAlert.type === 'success' ? styles.alertSuccess : styles.alertError}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
          onClick={() => setActionAlert(null)}
        >
          {actionAlert.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{actionAlert.message} (Click to dismiss)</span>
        </div>
      )}

      <div className={styles.topBar}>
        <div>
          <h1 className={styles.pageTitle}>Inbox Insights</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Connected as {userEmail} via {mailboxHost}</p>
        </div>
        <div className={styles.syncActions}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FolderOpen size={14} style={{ color: 'var(--muted)' }} />
            <select
              className={styles.folderSelect}
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              disabled={syncing || foldersLoading}
            >
              <option value="__ALL__">All Folders</option>
              {folders.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <button 
            className={`${styles.btn} ${styles.btnPrimary}`} 
            onClick={startSync} 
            disabled={syncing}
            style={{ width: 'auto' }}
          >
            <RefreshCw size={16} className={syncing ? styles.loader : ''} />
            Sync {selectedFolder === '__ALL__' ? 'All Folders' : selectedFolder === 'INBOX' ? 'Inbox' : selectedFolder}
          </button>
          {autoSyncActive && nextAutoSync && !syncing && (
            <span style={{ fontSize: '0.7rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }} title="Auto-sync enabled">
              <Timer size={12} /> Next: {nextAutoSync}
            </span>
          )}
          {emails.length > 0 && (
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={exportCSV}
              style={{ width: 'auto' }}
              title="Export filtered emails to CSV"
              aria-label="Export emails to CSV"
            >
              <Download size={14} /> Export
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className={styles.statsGrid}>
        <div 
          className={`${styles.statCard} ${activeFilter === 'all' ? styles.statCardActive : ''}`} 
          onClick={() => handleFilterChange('all')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFilterChange('all'); } }}
          role="button"
          tabIndex={0}
          aria-pressed={activeFilter === 'all'}
          style={{ cursor: 'pointer', borderLeft: '4px solid #fff' }}
        >
          <span className={styles.statLabel}>Total Scanned</span>
          <span className={styles.statValue}>{stats.total}</span>
        </div>
        <div 
          className={`${styles.statCard} ${styles.statNewsletter} ${activeFilter === 'newsletter' ? styles.statCardActive : ''}`} 
          onClick={() => handleFilterChange('newsletter')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFilterChange('newsletter'); } }}
          role="button"
          tabIndex={0}
          aria-pressed={activeFilter === 'newsletter'}
          style={{ cursor: 'pointer' }}
        >
          <span className={styles.statLabel}>Newsletters</span>
          <span className={styles.statValue} style={{ color: 'var(--category-newsletter)' }}>{stats.newsletters}</span>
        </div>
        <div 
          className={`${styles.statCard} ${styles.statTransaction} ${activeFilter === 'transaction' ? styles.statCardActive : ''}`} 
          onClick={() => handleFilterChange('transaction')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFilterChange('transaction'); } }}
          role="button"
          tabIndex={0}
          aria-pressed={activeFilter === 'transaction'}
          style={{ cursor: 'pointer' }}
        >
          <span className={styles.statLabel}>Transactions</span>
          <span className={styles.statValue} style={{ color: 'var(--category-transaction)' }}>{stats.transactions}</span>
        </div>
        <div 
          className={`${styles.statCard} ${styles.statSocial} ${activeFilter === 'social' ? styles.statCardActive : ''}`} 
          onClick={() => handleFilterChange('social')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFilterChange('social'); } }}
          role="button"
          tabIndex={0}
          aria-pressed={activeFilter === 'social'}
          style={{ cursor: 'pointer' }}
        >
          <span className={styles.statLabel}>Social</span>
          <span className={styles.statValue} style={{ color: 'var(--category-social)' }}>{stats.social}</span>
        </div>
        <div 
          className={`${styles.statCard} ${styles.statPersonal} ${activeFilter === 'personal' ? styles.statCardActive : ''}`} 
          onClick={() => handleFilterChange('personal')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFilterChange('personal'); } }}
          role="button"
          tabIndex={0}
          aria-pressed={activeFilter === 'personal'}
          style={{ cursor: 'pointer' }}
        >
          <span className={styles.statLabel}>Personal / Other</span>
          <span className={styles.statValue} style={{ color: 'var(--category-personal)' }}>{stats.personal}</span>
        </div>
      </div>

      {/* First-run prompt */}
      {stats.total === 0 && !syncing && (
        <div style={{
          padding: '2.5rem', textAlign: 'center', background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: '16px', marginBottom: '1.5rem',
        }}>
          <RefreshCw size={40} style={{ opacity: 0.2, marginBottom: '1rem', color: 'var(--primary)' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>No emails scanned yet</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem', maxWidth: '400px', margin: '0 auto 1.5rem' }}>
            Click &ldquo;Sync All Folders&rdquo; to scan your entire mailbox, or pick a specific folder. Only email headers are fetched &mdash; never the body content.
          </p>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={startSync}
            disabled={syncing}
            style={{ width: 'auto', padding: '10px 24px' }}
          >
            <RefreshCw size={16} /> Sync {selectedFolder === '__ALL__' ? 'All Folders' : selectedFolder === 'INBOX' ? 'Inbox' : selectedFolder} Now
          </button>
        </div>
      )}

      {/* ====== INBOX HEALTH SCORE ====== */}
      {stats.total > 0 && (() => {
        // Compute health score from emails
        const newsletterEmails = emails.filter(e => e.category === 'newsletter' && e.deleted === 0);
        const newsletterRatio = stats.total > 0 ? stats.newsletters / stats.total : 0;

        // Group newsletters by sender
        const nlSenderMap: Record<string, { unsubscribed: boolean; unsubscribedAt: number; lastDate: number; count: number; stillSending: boolean; email: string }> = {};
        newsletterEmails.forEach(e => {
          const key = (e.senderEmail || '').toLowerCase();
          if (!nlSenderMap[key]) {
            nlSenderMap[key] = { unsubscribed: false, unsubscribedAt: 0, lastDate: 0, count: 0, stillSending: false, email: e.senderEmail };
          }
          const g = nlSenderMap[key];
          g.count++;
          const t = new Date(e.date).getTime();
          if (t > g.lastDate) g.lastDate = t;
          if (e.unsubscribed === 1) { g.unsubscribed = true; }
          if (e.unsubscribedAt && e.unsubscribedAt > g.unsubscribedAt) g.unsubscribedAt = e.unsubscribedAt;
        });

        // Detect still-sending
        Object.values(nlSenderMap).forEach(g => {
          if (g.unsubscribedAt > 0 && g.lastDate > g.unsubscribedAt) g.stillSending = true;
        });

        const totalNlSenders = Object.keys(nlSenderMap).length;
        const unsubscribedSenders = Object.values(nlSenderMap).filter(g => g.unsubscribed).length;
        const stillSendingCount = Object.values(nlSenderMap).filter(g => g.stillSending).length;

        // Stale senders: newsletters not received in 90+ days but not unsubscribed
        const now = Date.now();
        const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
        const staleSenders = Object.values(nlSenderMap).filter(g => !g.unsubscribed && (now - g.lastDate) > NINETY_DAYS);

        // Factor 1: Newsletter ratio (25 pts) — lower is better
        const ratioScore = Math.round(25 * Math.max(0, 1 - (newsletterRatio / 0.5)));
        const ratioPenalty = 25 - ratioScore;

        // Factor 2: Unsubscribe action rate (25 pts)
        const unsubRate = totalNlSenders > 0 ? unsubscribedSenders / totalNlSenders : 1;
        const unsubScore = Math.round(25 * unsubRate);
        const unsubPenalty = 25 - unsubScore;

        // Factor 3: Still-sending violators (20 pts)
        const stillSendingScore = Math.round(20 * Math.max(0, 1 - (stillSendingCount / 5)));
        const stillSendingPenalty = 20 - stillSendingScore;

        // Factor 4: Stale subscriptions (15 pts)
        const staleScore = Math.round(15 * Math.max(0, 1 - (staleSenders.length / 15)));
        const stalePenalty = 15 - staleScore;

        // Factor 5: Category diversity (15 pts)
        const personalTransPct = stats.total > 0 ? (stats.personal + stats.transactions) / stats.total : 0;
        const diversityScore = Math.round(15 * Math.min(1, personalTransPct / 0.4));
        const diversityPenalty = 15 - diversityScore;

        const totalScore = ratioScore + unsubScore + stillSendingScore + staleScore + diversityScore;

        // Grade
        const grade = totalScore >= 90 ? { label: 'Excellent', color: '#10b981', bg: 'rgba(16,185,129,0.1)' }
          : totalScore >= 70 ? { label: 'Good', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' }
          : totalScore >= 50 ? { label: 'Fair', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' }
          : { label: 'Needs Work', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };

        // SVG ring
        const circumference = 2 * Math.PI * 56;
        const offset = circumference - (totalScore / 100) * circumference;

        // Factors for display
        const factors = [
          { label: `Newsletter ratio: ${Math.round(newsletterRatio * 100)}%`, pts: ratioPenalty, icon: <Mail size={14} />, good: ratioPenalty === 0 },
          { label: `Unsubscribe rate: ${totalNlSenders > 0 ? Math.round(unsubRate * 100) : 100}%`, pts: unsubPenalty, icon: <ShieldCheck size={14} />, good: unsubPenalty === 0 },
          { label: `Still-sending violators: ${stillSendingCount}`, pts: stillSendingPenalty, icon: <AlertTriangle size={14} />, good: stillSendingPenalty === 0 },
          { label: `Stale subscriptions: ${staleSenders.length}`, pts: stalePenalty, icon: <TrendingDown size={14} />, good: stalePenalty === 0 },
          { label: `Category diversity: ${Math.round(personalTransPct * 100)}% personal/transactional`, pts: diversityPenalty, icon: <Sparkles size={14} />, good: diversityPenalty === 0 },
        ];

        // Recommendations
        const recommendations: { icon: React.ReactNode; text: string; actionable: boolean; senders?: string[] }[] = [];
        if (staleSenders.length > 0) {
          recommendations.push({
            icon: <TrendingDown size={13} className={styles.healthRecIcon} />,
            text: `Unsubscribe from ${staleSenders.length} stale sender${staleSenders.length > 1 ? 's' : ''} (no emails in 90+ days)`,
            actionable: true,
            senders: staleSenders.map(s => s.email),
          });
        }
        if (stillSendingCount > 0) {
          recommendations.push({
            icon: <AlertTriangle size={13} className={styles.healthRecIcon} />,
            text: `${stillSendingCount} sender${stillSendingCount > 1 ? 's' : ''} still emailing after unsubscribe — consider deleting`,
            actionable: false,
          });
        }
        const oldNlCount = newsletterEmails.filter(e => (now - new Date(e.date).getTime()) > 365 * 24 * 60 * 60 * 1000).length;
        if (oldNlCount > 50) {
          recommendations.push({
            icon: <Trash2 size={13} className={styles.healthRecIcon} />,
            text: `${oldNlCount.toLocaleString()} newsletter emails older than 1 year — bulk delete to clean up`,
            actionable: false,
          });
        }
        if (totalNlSenders > 0 && unsubscribedSenders === 0) {
          recommendations.push({
            icon: <Lightbulb size={13} className={styles.healthRecIcon} />,
            text: `You haven't unsubscribed from any of your ${totalNlSenders} newsletter senders yet`,
            actionable: false,
          });
        }

        return (
          <div className={styles.healthCard}>
            <div className={styles.healthHeader}>
              <Activity size={20} style={{ color: grade.color }} />
              Inbox Health Score
            </div>
            <div className={styles.healthBody}>
              <div className={styles.healthRingWrapper}>
                <div className={styles.healthRing}>
                  <svg viewBox="0 0 128 128" width="140" height="140">
                    <circle cx="64" cy="64" r="56" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                    <circle
                      cx="64" cy="64" r="56" fill="none"
                      stroke={grade.color}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      transform="rotate(-90 64 64)"
                      style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
                    />
                  </svg>
                  <div className={styles.healthRingCenter}>
                    <div className={styles.healthScore} style={{ color: grade.color }}>{totalScore}</div>
                    <div className={styles.healthScoreMax}>/100</div>
                  </div>
                </div>
                <span className={styles.healthGrade} style={{ color: grade.color, background: grade.bg }}>
                  {grade.label}
                </span>
              </div>

              <div className={styles.healthRight}>
                <div className={styles.healthFactors}>
                  {factors.map((f, i) => (
                    <div key={i} className={styles.healthFactor}>
                      <span className={styles.healthFactorIcon} style={{ color: f.good ? '#10b981' : f.pts >= 15 ? '#ef4444' : '#f59e0b' }}>
                        {f.icon}
                      </span>
                      <span>{f.label}</span>
                      <span className={styles.healthFactorPoints} style={{
                        color: f.good ? '#10b981' : f.pts >= 15 ? '#ef4444' : '#f59e0b',
                        background: f.good ? 'rgba(16,185,129,0.1)' : f.pts >= 15 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                      }}>
                        {f.good ? '✓' : `-${f.pts} pts`}
                      </span>
                    </div>
                  ))}
                </div>

                {recommendations.length > 0 && (
                  <div className={styles.healthRecommendations}>
                    <div className={styles.healthRecommendationsTitle}>
                      <Lightbulb size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '0.3rem' }} />
                      Recommendations
                    </div>
                    {recommendations.map((rec, i) => (
                      <div key={i} className={styles.healthRec}>
                        {rec.icon}
                        <span>{rec.text}</span>
                        {rec.actionable && rec.senders && onQuickClean && (
                          <button
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            style={{ padding: '3px 10px', fontSize: '0.7rem', width: 'auto', flexShrink: 0, marginLeft: '0.5rem' }}
                            onClick={() => onQuickClean(rec.senders!)}
                          >
                            Quick Clean
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ====== ANALYTICS DASHBOARD ====== */}
      {stats.total > 0 && (() => {
        // Compute analytics from emails array
        const senderCounts: Record<string, { name: string; count: number; firstDate: number; lastDate: number; recentCount: number }> = {};
        let oldestDate: Date | null = null;
        let newestDate: Date | null = null;
        const now = Date.now();
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

        emails.forEach(e => {
          const key = (e.senderEmail || '').toLowerCase();
          const d = new Date(e.date);
          const t = d.getTime();
          if (!senderCounts[key]) senderCounts[key] = { name: e.senderName || key, count: 0, firstDate: t, lastDate: t, recentCount: 0 };
          const s = senderCounts[key];
          s.count += 1;
          if (t < s.firstDate) s.firstDate = t;
          if (t > s.lastDate) s.lastDate = t;
          if ((now - t) < THIRTY_DAYS) s.recentCount += 1;
          if (!oldestDate || d < oldestDate) oldestDate = d;
          if (!newestDate || d > newestDate) newestDate = d;
        });

        const topSenders = Object.entries(senderCounts)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 8);
        const maxSenderCount = topSenders.length > 0 ? topSenders[0][1].count : 1;
        const uniqueSenders = Object.keys(senderCounts).length;
        const newsletterPct = stats.total > 0 ? Math.round((stats.newsletters / stats.total) * 100) : 0;
        const daySpan = oldestDate && newestDate
          ? Math.max(1, Math.round(((newestDate as Date).getTime() - (oldestDate as Date).getTime()) / (1000 * 60 * 60 * 24)))
          : 0;

        // SVG donut chart data
        const categories = [
          { label: 'Newsletters', value: stats.newsletters, color: '#8b5cf6' },
          { label: 'Transactions', value: stats.transactions, color: '#10b981' },
          { label: 'Social', value: stats.social, color: '#3b82f6' },
          { label: 'Personal', value: stats.personal, color: '#f59e0b' },
        ];
        const total = stats.total || 1;
        let cumulativeAngle = 0;
        const arcs = categories.filter(c => c.value > 0).map(c => {
          const pct = c.value / total;
          const startAngle = cumulativeAngle;
          cumulativeAngle += pct * 360;
          return { ...c, pct, startAngle, endAngle: cumulativeAngle };
        });

        const describeArc = (start: number, end: number, r: number) => {
          const rad = (a: number) => (a - 90) * Math.PI / 180;
          const x1 = 90 + r * Math.cos(rad(start));
          const y1 = 90 + r * Math.sin(rad(start));
          const x2 = 90 + r * Math.cos(rad(end - 0.1));
          const y2 = 90 + r * Math.sin(rad(end - 0.1));
          const large = end - start > 180 ? 1 : 0;
          return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
        };

        return (
          <>
            {/* Quick Stats Strip */}
            <div className={styles.quickStatsStrip}>
              <div className={styles.quickStat}>
                <div className={styles.quickStatValue}>{uniqueSenders}</div>
                <div className={styles.quickStatLabel}>Unique Senders</div>
              </div>
              <div className={styles.quickStat}>
                <div className={styles.quickStatValue}>{newsletterPct}%</div>
                <div className={styles.quickStatLabel}>Newsletter Ratio</div>
              </div>
              <div className={styles.quickStat} title={topSenders.length > 0 ? topSenders[0][1].name : undefined}>
                <div className={styles.quickStatValue} style={{ fontSize: '1rem' }}>
                  {topSenders.length > 0 ? topSenders[0][1].name.slice(0, 14) : '—'}
                </div>
                <div className={styles.quickStatLabel}>Top Sender</div>
              </div>
              <div className={styles.quickStat}>
                <div className={styles.quickStatValue}>{daySpan}d</div>
                <div className={styles.quickStatLabel}>Date Range Scanned</div>
              </div>
            </div>

            {/* Charts Row */}
            <div className={styles.analyticsGrid}>
              {/* Donut Chart */}
              <div className={styles.donutCard}>
                <h3>Category Breakdown</h3>
                <div className={styles.donutWrapper}>
                  <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={`Email breakdown: ${stats.newsletters} newsletters, ${stats.transactions} transactions, ${stats.social} social, ${stats.personal} personal`}>
                    {arcs.length === 1 ? (
                      <circle cx="90" cy="90" r="70" fill="none" stroke={arcs[0].color} strokeWidth="20" />
                    ) : (
                      arcs.map((arc, i) => (
                        <path
                          key={i}
                          d={describeArc(arc.startAngle, arc.endAngle, 70)}
                          fill="none"
                          stroke={arc.color}
                          strokeWidth="20"
                          strokeLinecap="butt"
                        />
                      ))
                    )}
                  </svg>
                  <div className={styles.donutCenter}>
                    <div className={styles.donutCenterValue}>{stats.total}</div>
                    <div className={styles.donutCenterLabel}>emails</div>
                  </div>
                </div>
                <div className={styles.donutLegend}>
                  {categories.map(c => (
                    <div key={c.label} className={styles.donutLegendItem}>
                      <span className={styles.donutLegendDot} style={{ background: c.color }} />
                      {c.label} ({c.value})
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Senders — Enhanced */}
              <div className={styles.barChartCard}>
                <h3>Top Senders</h3>
                <div className={styles.barChartList}>
                  {topSenders.map(([, sender], i) => {
                    // Compute months span for this sender
                    const monthSpan = Math.max(1, (sender.lastDate - sender.firstDate) / (30 * 24 * 60 * 60 * 1000));
                    const perMonth = sender.count / monthSpan;
                    // Trend: compare recent 30d rate vs overall rate
                    const overallRate = sender.count / Math.max(1, (now - sender.firstDate) / THIRTY_DAYS);
                    const trendRatio = overallRate > 0 ? sender.recentCount / overallRate : 1;
                    const trend = trendRatio > 1.3 ? 'up' : trendRatio < 0.7 ? 'down' : 'stable';
                    const lastAgo = now - sender.lastDate;
                    const lastLabel = lastAgo < 24 * 60 * 60 * 1000 ? 'Today'
                      : lastAgo < 7 * 24 * 60 * 60 * 1000 ? `${Math.floor(lastAgo / (24 * 60 * 60 * 1000))}d ago`
                      : lastAgo < 30 * 24 * 60 * 60 * 1000 ? `${Math.floor(lastAgo / (7 * 24 * 60 * 60 * 1000))}w ago`
                      : `${Math.floor(lastAgo / (30 * 24 * 60 * 60 * 1000))}mo ago`;

                    return (
                      <div key={i} className={styles.barChartRow}>
                        <span className={styles.barChartLabel} title={sender.name}>{sender.name}</span>
                        <div className={styles.barChartTrack}>
                          <div
                            className={styles.barChartFill}
                            style={{ width: `${(sender.count / maxSenderCount) * 100}%` }}
                          />
                        </div>
                        <span className={styles.barChartValue} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {sender.count}
                          <span title={`${perMonth.toFixed(1)}/mo · Last: ${lastLabel}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                            {trend === 'up' && <TrendingUp size={12} style={{ color: '#ef4444' }} />}
                            {trend === 'down' && <TrendingDown size={12} style={{ color: '#10b981' }} />}
                            {trend === 'stable' && <Minus size={12} style={{ color: 'var(--muted)' }} />}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                  {topSenders.length === 0 && (
                    <div style={{ color: 'var(--muted)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                      No data yet — sync your inbox first
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Age Distribution */}
            {(() => {
              const now = Date.now();
              const buckets = [
                { label: 'Under 30d', max: 30 },
                { label: '1\u20133 months', max: 90 },
                { label: '3\u20136 months', max: 180 },
                { label: '6\u201312 months', max: 365 },
                { label: 'Over 1 year', max: Infinity },
              ];
              const bucketColors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];

              const results = buckets.map((b, i) => {
                const prev = i === 0 ? 0 : buckets[i - 1].max;
                const count = emails.filter(e => {
                  const age = (now - new Date(e.date).getTime()) / (24 * 60 * 60 * 1000);
                  return age >= prev && (b.max === Infinity ? true : age < b.max);
                }).length;
                const nlCount = emails.filter(e => {
                  const age = (now - new Date(e.date).getTime()) / (24 * 60 * 60 * 1000);
                  return e.category === 'newsletter' && e.deleted === 0 && age >= prev && (b.max === Infinity ? true : age < b.max);
                }).length;
                return { ...b, count, nlCount, color: bucketColors[i] };
              });

              const maxBucket = Math.max(1, ...results.map(r => r.count));

              return (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '16px', padding: '1.2rem', marginTop: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <FolderOpen size={16} style={{ color: 'var(--primary)' }} />
                    Email Age Distribution
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {results.map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                        <span style={{ width: '90px', flexShrink: 0, color: 'var(--muted-light)', fontSize: '0.75rem' }}>{r.label}</span>
                        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: '4px', height: '20px', overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            width: `${(r.count / maxBucket) * 100}%`,
                            background: r.color,
                            height: '100%',
                            borderRadius: '4px',
                            opacity: 0.7,
                            transition: 'width 0.6s ease',
                            minWidth: r.count > 0 ? '4px' : '0',
                          }} />
                        </div>
                        <span style={{ width: '45px', textAlign: 'right', flexShrink: 0, fontWeight: 600, fontSize: '0.75rem' }}>
                          {r.count.toLocaleString()}
                        </span>
                        {r.nlCount > 20 && r.max >= 180 && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--muted)', flexShrink: 0 }}>
                            ({r.nlCount} newsletters)
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        );
      })()}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {(['all', 'newsletter', 'transaction', 'social', 'personal'] as const).map(filter => (
            <button
              key={filter}
              className={`${styles.tab} ${activeFilter === filter ? styles.tabActive : ''}`}
              onClick={() => handleFilterChange(filter)}
              style={{ padding: '6px 12px', fontSize: '0.8rem', textTransform: 'capitalize' }}
            >
              {filter}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 200px', maxWidth: '300px', minWidth: '150px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--muted)' }} />
          <input
            type="text"
            autoComplete="off"
            className={styles.input}
            placeholder="Search subject or sender..."
            aria-label="Search emails by subject or sender"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            style={{ paddingLeft: '32px', height: '36px', fontSize: '0.85rem' }}
          />
        </div>
      </div>

      {/* Emails Table */}
      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <span className={styles.tableTitle}>Email Records ({filteredEmails.length})</span>
        </div>
        <div className={styles.tableWrapper}>
          {filteredEmails.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
              <Mail size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
              <p>No email records found. Perform a sync or refine your search.</p>
            </div>
          ) : (
            <div className={styles.tableScrollWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Subject</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEmails.map(email => (
                  <tr key={`${email.mailbox}-${email.uid}`}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{email.senderName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{email.senderEmail}</div>
                    </td>
                    <td style={{ maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email.subject}
                    </td>
                    <td className={styles.emailDate}>
                      {new Date(email.date).toLocaleDateString()}
                    </td>
                    <td>
                      <span className={`${styles.badge} ${
                        email.category === 'newsletter' ? styles.badgeNewsletter :
                        email.category === 'transaction' ? styles.badgeTransaction :
                        email.category === 'social' ? styles.badgeSocial :
                        styles.badgePersonal
                      }`}>
                        {email.category}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        {email.unsubscribeLink && email.category === 'newsletter' && (
                          <a 
                            href={email.unsubscribeLink.startsWith('mailto:') ? email.unsubscribeLink : undefined}
                            onClick={async (e) => {
                              if (!email.unsubscribeLink?.startsWith('mailto:')) {
                                e.preventDefault();
                                window.open(email.unsubscribeLink, '_blank', 'noopener,noreferrer');
                              }
                            }}
                            className={`${styles.btn} ${styles.btnSecondary}`}
                            style={{ padding: '6px 10px', fontSize: '0.75rem', width: 'auto' }}
                          >
                            <ExternalLink size={12} />
                            Unsubscribe
                          </a>
                        )}
                        <button
                          className={`${styles.btn} ${styles.btnDanger}`}
                          style={{ padding: '6px 10px', fontSize: '0.75rem', width: 'auto' }}
                          onClick={() => handleDeleteEmail(email.uid)}
                          disabled={actionLoadingId === email.uid}
                        >
                          {actionLoadingId === email.uid ? (
                            <div className={styles.loader} style={{ width: '12px', height: '12px' }}></div>
                          ) : (
                            <Trash2 size={12} />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {/* Pagination Controls */}
          {filteredEmails.length > ROWS_PER_PAGE && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              borderTop: '1px solid var(--border, #333)',
              fontSize: '0.85rem',
            }}>
              <span style={{ color: 'var(--muted)' }}>
                Showing {(currentPage - 1) * ROWS_PER_PAGE + 1}–{Math.min(currentPage * ROWS_PER_PAGE, filteredEmails.length)} of {filteredEmails.length}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  style={{ padding: '6px 14px', fontSize: '0.8rem', width: 'auto' }}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  Previous
                </button>
                <span style={{ color: 'var(--muted)' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  style={{ padding: '6px 14px', fontSize: '0.8rem', width: 'auto' }}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
