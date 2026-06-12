'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Search, Trash2, ExternalLink, Mail, CheckCircle, AlertCircle, FolderOpen, Download } from 'lucide-react';
import { db, type EmailRecord } from '@/lib/db';
import styles from '@/app/page.module.css';

interface DashboardScreenProps {
  userEmail: string;
  mailboxHost: string;
}

export default function DashboardScreen({ userEmail, mailboxHost }: DashboardScreenProps) {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'newsletter' | 'transaction' | 'social' | 'personal'>('all');
  
  // Pagination state
  const ROWS_PER_PAGE = 50;
  const [currentPage, setCurrentPage] = useState(1);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncCount, setSyncCount] = useState(0);
  const [syncMessage, setSyncMessage] = useState('');
  
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
  const [selectedFolder, setSelectedFolder] = useState('INBOX');
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

        const prompt = `You are an email classification assistant. Classify the following emails into one of these exact categories: 'newsletter', 'transaction', 'social', 'personal'.
- 'newsletter': Promotional emails, circulars, advertisements, newsletters, updates.
- 'transaction': Receipts, invoices, order confirmations, bill reminders, shipping updates, one-time passwords (OTP), account creation confirmation, password reset links.
- 'social': Notifications from social networks like LinkedIn, Facebook, Twitter/X, Instagram, GitHub updates, comments, followers.
- 'personal': Direct human-to-human emails, personalized messages, and conversations that do not fit the other categories.

Analyze the sender and subject of each email carefully. Output MUST be a valid JSON array of objects, with each object having exactly "uid" (number) and "category" (string). Do not add any explanation or markdown formatting like \`\`\`json.
Emails to classify:
${JSON.stringify(batch.map(e => ({ uid: e.uid, sender: `${e.senderName} <${e.senderEmail}>`, subject: e.subject })))}`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        });

        if (!response.ok) {
          console.warn(`Gemini API batch failed: ${response.status}`);
          continue;
        }

        const resData = await response.json();
        const textResponse = resData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textResponse) continue;

        try {
          const classifications = JSON.parse(textResponse) as Array<{ uid: number; category: 'newsletter' | 'transaction' | 'social' | 'personal' }>;
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
          console.error('Failed to parse Gemini classification:', parseErr, textResponse);
        }
      }
    } catch (err) {
      console.error('AI Classification failed:', err);
    }
  };

  // Sync Inbox using streaming (single IMAP connection)
  const startSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncProgress(0);
    setSyncCount(0);
    setSyncMessage('Establishing connection to mailbox...');

    const CHUNK_SIZE = 100;
    let storedLimit: string | null = null;
    try { storedLimit = localStorage.getItem('gmclean_sync_limit'); } catch { /* localStorage may be disabled */ }
    const MAX_EMAILS_TO_SYNC = storedLimit ? parseInt(storedLimit, 10) || 500 : 500;

    try {
      const response = await fetch(
        `/api/mail/sync-stream?totalLimit=${MAX_EMAILS_TO_SYNC}&chunkSize=${CHUNK_SIZE}&folder=${encodeURIComponent(selectedFolder)}`,
        { method: 'POST' }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Streaming sync failed.');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream available.');

      const decoder = new TextDecoder();
      let buffer = '';
      let cumulativeFetched = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (delimited by double newlines)
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6);
          let event: 
            | { type: 'chunk'; emails: Array<{
                uid: number; messageId: string; senderName: string;
                senderEmail: string; subject: string; date: string;
                category: 'newsletter' | 'transaction' | 'social' | 'personal';
                unsubscribeLink?: string;
              }>; progress: { fetched: number; total: number } }
            | { type: 'done' }
            | { type: 'error'; error: string };
          try {
            event = JSON.parse(jsonStr);
          } catch {
            console.warn('Skipping malformed SSE event:', jsonStr.slice(0, 100));
            continue;
          }

          if (event.type === 'error') {
            throw new Error(event.error);
          }

          if (event.type === 'done') {
            break;
          }

          if (event.type === 'chunk') {
            const fetchedEmails = event.emails;
            const totalInMailbox = event.progress.total;
            setSyncTotal(Math.min(totalInMailbox, MAX_EMAILS_TO_SYNC));

            setSyncMessage(`Fetching emails ${cumulativeFetched} to ${cumulativeFetched + fetchedEmails.length}...`);

            // Merge with existing records to preserve local flags (unsubscribed, deleted, AI category)
            const existingKeys = fetchedEmails.map(e => [userEmail, e.uid] as [string, number]);
            const existingRecords = await db.emails.bulkGet(existingKeys);
            const existingMap = new Map<number, EmailRecord>();
            existingRecords.forEach(r => { if (r) existingMap.set(r.uid, r); });

            const recordsToSave: EmailRecord[] = fetchedEmails.map((email) => {
              const existing = existingMap.get(email.uid);
              return {
                uid: email.uid,
                mailbox: userEmail,
                messageId: email.messageId,
                senderName: email.senderName,
                senderEmail: email.senderEmail,
                subject: email.subject,
                date: new Date(email.date),
                // Preserve AI-assigned category if it differs from heuristic
                category: existing?.category || email.category,
                unsubscribeLink: email.unsubscribeLink,
                // Preserve local flags from previous syncs
                unsubscribed: existing?.unsubscribed ?? 0,
                unsubscribedAt: existing?.unsubscribedAt ?? 0,
                folder: selectedFolder,
                deleted: existing?.deleted ?? 0,
              };
            });

            // Bulk save/overwrite to IndexedDB
            await db.emails.bulkPut(recordsToSave);

            cumulativeFetched = event.progress.fetched;
            setSyncCount(cumulativeFetched);

            const progressPercent = Math.min(
              100,
              Math.round((cumulativeFetched / Math.min(totalInMailbox, MAX_EMAILS_TO_SYNC)) * 100)
            );
            setSyncProgress(progressPercent);

            // Refresh UI with partial sync data
            await loadEmails();
          }
        }
      }

      setSyncMessage('Sync completed successfully!');

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
            Sync {selectedFolder === 'INBOX' ? 'Inbox' : selectedFolder}
          </button>
          {emails.length > 0 && (
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={exportCSV}
              style={{ width: 'auto' }}
              title="Export filtered emails to CSV"
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
          onClick={() => setActiveFilter('all')}
          style={{ cursor: 'pointer', borderLeft: '4px solid #fff' }}
        >
          <span className={styles.statLabel}>Total Scanned</span>
          <span className={styles.statValue}>{stats.total}</span>
        </div>
        <div 
          className={`${styles.statCard} ${styles.statNewsletter}`} 
          onClick={() => setActiveFilter('newsletter')}
          style={{ cursor: 'pointer' }}
        >
          <span className={styles.statLabel}>Newsletters</span>
          <span className={styles.statValue} style={{ color: 'var(--category-newsletter)' }}>{stats.newsletters}</span>
        </div>
        <div 
          className={`${styles.statCard} ${styles.statTransaction}`} 
          onClick={() => setActiveFilter('transaction')}
          style={{ cursor: 'pointer' }}
        >
          <span className={styles.statLabel}>Transactions</span>
          <span className={styles.statValue} style={{ color: 'var(--category-transaction)' }}>{stats.transactions}</span>
        </div>
        <div 
          className={`${styles.statCard} ${styles.statSocial}`} 
          onClick={() => setActiveFilter('social')}
          style={{ cursor: 'pointer' }}
        >
          <span className={styles.statLabel}>Social</span>
          <span className={styles.statValue} style={{ color: 'var(--category-social)' }}>{stats.social}</span>
        </div>
        <div 
          className={`${styles.statCard} ${styles.statPersonal}`} 
          onClick={() => setActiveFilter('personal')}
          style={{ cursor: 'pointer' }}
        >
          <span className={styles.statLabel}>Personal / Other</span>
          <span className={styles.statValue} style={{ color: 'var(--category-personal)' }}>{stats.personal}</span>
        </div>
      </div>

      {/* ====== ANALYTICS DASHBOARD ====== */}
      {stats.total > 0 && (() => {
        // Compute analytics from emails array
        const senderCounts: Record<string, { name: string; count: number }> = {};
        let oldestDate: Date | null = null;
        let newestDate: Date | null = null;

        emails.forEach(e => {
          const key = (e.senderEmail || '').toLowerCase();
          if (!senderCounts[key]) senderCounts[key] = { name: e.senderName || key, count: 0 };
          senderCounts[key].count += 1;
          const d = new Date(e.date);
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
          { label: 'Newsletters', value: stats.newsletters, color: '#f59e0b' },
          { label: 'Transactions', value: stats.transactions, color: '#3b82f6' },
          { label: 'Social', value: stats.social, color: '#ec4899' },
          { label: 'Personal', value: stats.personal, color: '#10b981' },
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
              <div className={styles.quickStat}>
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
                  <svg viewBox="0 0 180 180" width="180" height="180">
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
                          strokeLinecap="round"
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

              {/* Top Senders Bar Chart */}
              <div className={styles.barChartCard}>
                <h3>Top Senders</h3>
                <div className={styles.barChartList}>
                  {topSenders.map(([, sender], i) => (
                    <div key={i} className={styles.barChartRow}>
                      <span className={styles.barChartLabel} title={sender.name}>{sender.name}</span>
                      <div className={styles.barChartTrack}>
                        <div
                          className={styles.barChartFill}
                          style={{ width: `${(sender.count / maxSenderCount) * 100}%` }}
                        />
                      </div>
                      <span className={styles.barChartValue}>{sender.count}</span>
                    </div>
                  ))}
                  {topSenders.length === 0 && (
                    <div style={{ color: 'var(--muted)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                      No data yet — sync your inbox first
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {(['all', 'newsletter', 'transaction', 'social', 'personal'] as const).map(filter => (
            <button
              key={filter}
              className={`${styles.tab} ${activeFilter === filter ? styles.tabActive : ''}`}
              onClick={() => setActiveFilter(filter)}
              style={{ padding: '6px 12px', fontSize: '0.8rem', textTransform: 'capitalize' }}
            >
              {filter}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '300px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--muted)' }} />
          <input
            type="text"
            autoComplete="off"
            className={styles.input}
            placeholder="Search subject or sender..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
                                window.open(email.unsubscribeLink, '_blank');
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
