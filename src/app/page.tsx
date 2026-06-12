'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Mail, LayoutDashboard, Settings, LogOut, CheckCircle, Plus, User, Sun, Moon, Shield } from 'lucide-react';
import ConnectionScreen from '@/components/connection-screen';
import DashboardScreen from '@/components/dashboard-screen';
import NewsletterScreen from '@/components/newsletter-screen';
import SettingsDrawer from '@/components/settings-drawer';
import { db } from '@/lib/db';
import styles from '@/app/page.module.css';

export default function Home() {
  const [session, setSession] = useState<{ user: string; host: string } | null>(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'newsletters'>('dashboard');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [preselectedSenders, setPreselectedSenders] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<{ index: number; user: string; host: string }[]>([]);
  const [addingAccount, setAddingAccount] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [crossHealth, setCrossHealth] = useState<{ score: number; total: number; newsletters: number; accounts: number } | null>(null);

  // Load saved theme on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gmclean_theme') as 'dark' | 'light' | null;
      const initial = saved || 'dark';
      setTheme(initial);
      document.documentElement.setAttribute('data-theme', initial);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('gmclean_theme', next);
  };

  // Check if session exists on load
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/mail/sync');
      const data = await res.json();
      if (res.ok && data.authenticated) {
        setSession({ user: data.user, host: data.host });
      } else {
        setSession(null);
      }
      if (data.accounts) setAccounts(data.accounts);
    } catch (err) {
      console.error('Failed to restore session:', err);
    } finally {
      setSessionChecking(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
    
    // Check for success or error url params (e.g. from OAuth redirects)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const err = params.get('error');
      if (err) {
        setTimeout(() => setAuthError(err), 0);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, [checkSession]);

  const handleConnectSuccess = (data: { user: string; host: string }) => {
    setSession(data);
    setNotification('Successfully connected to mailbox!');
    setTimeout(() => setNotification(null), 3000);
  };

  const handleLogout = async () => {
    const confirmLogout = window.confirm('Disconnect this account? Scanned data for this mailbox will be cleared from this browser.');
    if (!confirmLogout) return;

    try {
      // Clear emails for the current user only
      if (session) {
        await db.emails.where('mailbox').equals(session.user).delete();
      }
      await fetch('/api/mail/sync', { method: 'DELETE' });
      
      // Re-check session (may have other accounts)
      setAddingAccount(false);
      await checkSession();
      setActiveTab('dashboard');
    } catch (err) {
      console.error('Logout request failed:', err);
    }
  };

  const handleSwitchAccount = async (index: number) => {
    try {
      await fetch('/api/mail/sync', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      await checkSession();
      setActiveTab('dashboard');
      setAddingAccount(false);
    } catch (err) {
      console.error('Failed to switch account:', err);
    }
  };

  // Compute cross-account health when accounts change
  useEffect(() => {
    if (accounts.length < 2) { setCrossHealth(null); return; }
    const compute = async () => {
      let totalEmails = 0;
      let totalNewsletters = 0;
      for (const acc of accounts) {
        const all = await db.emails.where('mailbox').equals(acc.user).count();
        const nl = await db.emails.where('mailbox').equals(acc.user).filter(e => e.category === 'newsletter' && e.deleted === 0).count();
        totalEmails += all;
        totalNewsletters += nl;
      }
      const ratio = totalEmails > 0 ? totalNewsletters / totalEmails : 0;
      const score = Math.round(Math.max(0, 100 - (ratio * 200)));
      setCrossHealth({ score, total: totalEmails, newsletters: totalNewsletters, accounts: accounts.length });
    };
    compute();
  }, [accounts]);

  const handleAddAccount = () => {
    setAddingAccount(true);
  };

  if (sessionChecking) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--background)', color: 'var(--muted)' }}>
        <div className={styles.loader} style={{ width: '36px', height: '36px', borderWidth: '3px' }}></div>
        <span style={{ marginLeft: '1rem', fontSize: '0.95rem' }}>Initializing GMClean session...</span>
      </div>
    );
  }

  // RENDER CONNECT PAGE IF UNAUTHENTICATED (or adding account)
  if (!session || addingAccount) {
    return (
      <main className={styles.container}>
        {addingAccount && (
          <button
            onClick={() => setAddingAccount(false)}
            style={{
              position: 'fixed', top: '1rem', left: '1rem', zIndex: 100,
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              color: 'var(--foreground)', borderRadius: '8px', padding: '8px 16px',
              cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            ← Back to Dashboard
          </button>
        )}
        <ConnectionScreen 
          onConnectSuccess={(data) => {
            handleConnectSuccess(data);
            setAddingAccount(false);
            checkSession();
          }} 
          onOpenSettings={() => setIsSettingsOpen(true)} 
          initialError={authError || undefined}
        />
        <SettingsDrawer 
          isOpen={isSettingsOpen} 
          onClose={() => setIsSettingsOpen(false)} 
        />
      </main>
    );
  }

  // RENDER MAIN DASHBOARD LAYOUT IF AUTHENTICATED
  return (
    <main className={styles.container}>
      <div className={styles.dashboard}>
        
        {/* SIDEBAR */}
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <Mail size={22} style={{ color: 'var(--primary)' }} />
            <span>GMClean</span>
          </div>

          <nav className={styles.nav}>
            <button
              className={`${styles.navLink} ${activeTab === 'dashboard' ? styles.navLinkActive : ''}`}
              onClick={() => setActiveTab('dashboard')}
              aria-label="Overview dashboard"
            >
              <LayoutDashboard size={18} />
              <span className={styles.navLabel}>Overview</span>
            </button>
            <button
              className={`${styles.navLink} ${activeTab === 'newsletters' ? styles.navLinkActive : ''}`}
              onClick={() => setActiveTab('newsletters')}
              aria-label="Manage subscriptions"
            >
              <Mail size={18} />
              <span className={styles.navLabel}>Subscriptions</span>
            </button>
          </nav>

          <div className={styles.sidebarFooter}>
            {/* Cross-Account Health Badge */}
            {crossHealth && (
              <div style={{
                padding: '0.6rem', marginBottom: '0.5rem', width: '100%',
                background: 'rgba(139,92,246,0.08)', borderRadius: '8px',
                border: '1px solid rgba(139,92,246,0.15)',
                textAlign: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', marginBottom: '0.3rem' }}>
                  <Shield size={14} style={{ color: crossHealth.score >= 70 ? '#10b981' : crossHealth.score >= 40 ? '#f59e0b' : '#ef4444' }} />
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>All Accounts</span>
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: crossHealth.score >= 70 ? '#10b981' : crossHealth.score >= 40 ? '#f59e0b' : '#ef4444' }}>
                  {crossHealth.score}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
                  {crossHealth.total.toLocaleString()} emails · {crossHealth.newsletters.toLocaleString()} newsletters
                </div>
              </div>
            )}
            {/* Account Switcher */}
            {accounts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem', width: '100%' }}>
                {accounts.map(acc => (
                  <button
                    key={acc.index}
                    className={styles.navLink}
                    onClick={() => handleSwitchAccount(acc.index)}
                    style={{
                      padding: '0.4rem 0.6rem', fontSize: '0.75rem', width: '100%',
                      background: acc.user === session.user ? 'rgba(139,92,246,0.15)' : 'transparent',
                      borderLeft: acc.user === session.user ? '2px solid var(--primary)' : '2px solid transparent',
                    }}
                    title={`${acc.user} (${acc.host})`}
                  >
                    <User size={14} />
                    <span className={styles.navLabel} style={{ fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {acc.user.length > 18 ? acc.user.slice(0, 18) + '…' : acc.user}
                    </span>
                  </button>
                ))}
                <button
                  className={styles.navLink}
                  onClick={handleAddAccount}
                  style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', color: 'var(--primary)' }}
                  title="Connect another mailbox"
                >
                  <Plus size={14} />
                  <span className={styles.navLabel} style={{ fontSize: '0.7rem' }}>Add Account</span>
                </button>
              </div>
            )}

            <button
              className={styles.navLink}
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Open settings"
              style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
            >
              <Settings size={16} />
              <span className={styles.navLabel}>Settings</span>
            </button>
            
            <button
              className={styles.navLink}
              onClick={handleLogout}
              aria-label="Disconnect and clear data"
              style={{ color: '#ef4444', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
            >
              <LogOut size={16} />
              <span className={styles.navLabel}>Disconnect</span>
            </button>

            <button
              className={styles.navLink}
              onClick={toggleTheme}
              aria-label="Toggle theme"
              style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              <span className={styles.navLabel}>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>

            <span className={styles.navLabel} style={{ fontSize: '0.65rem', color: 'var(--muted)', textAlign: 'center', opacity: 0.5, marginTop: '0.25rem' }}>
              v2.0.0
            </span>
          </div>
        </aside>

        {/* MAIN DISPLAY PORT */}
        <section className={styles.mainContent}>
          {notification && (
            <div className={`${styles.alert} ${styles.alertSuccess}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle size={18} />
              <span>{notification}</span>
            </div>
          )}

          {activeTab === 'dashboard' ? (
            <DashboardScreen
              key={session.user}
              userEmail={session.user}
              mailboxHost={session.host}
              onQuickClean={(senderEmails) => {
                setPreselectedSenders(senderEmails);
                setActiveTab('newsletters');
              }}
            />
          ) : (
            <NewsletterScreen 
              key={session.user}
              userEmail={session.user}
              preselectedSenders={preselectedSenders}
              onPreselectedConsumed={() => setPreselectedSenders([])}
            />
          )}
        </section>
      </div>

      <SettingsDrawer 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </main>
  );
}
