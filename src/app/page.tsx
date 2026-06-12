'use client';

import React, { useState, useEffect } from 'react';
import { Mail, LayoutDashboard, Settings, LogOut, CheckCircle } from 'lucide-react';
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

  // Check if session exists on load
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('/api/mail/sync');
        const data = await res.json();
        if (res.ok && data.authenticated) {
          setSession({ user: data.user, host: data.host });
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        setSessionChecking(false);
      }
    };

    checkSession();
    
    // Check for success or error url params (e.g. from OAuth redirects)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const err = params.get('error');
      if (err) {
        setTimeout(() => setAuthError(err), 0);
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);

  const handleConnectSuccess = (data: { user: string; host: string }) => {
    setSession(data);
    setNotification('Successfully connected to mailbox!');
    setTimeout(() => setNotification(null), 3000);
  };

  const handleLogout = async () => {
    const confirmLogout = window.confirm('Are you sure you want to disconnect? This will clear your credentials and delete all scanned metadata stored locally in this browser.');
    if (!confirmLogout) return;

    try {
      await fetch('/api/mail/sync', { method: 'DELETE' });
      
      // Zero out local IndexedDB to guarantee privacy
      await db.emails.clear();
      
      setSession(null);
      setActiveTab('dashboard');
    } catch (err) {
      console.error('Logout request failed:', err);
    }
  };

  if (sessionChecking) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--background)', color: 'var(--muted)' }}>
        <div className={styles.loader} style={{ width: '36px', height: '36px', borderWidth: '3px' }}></div>
        <span style={{ marginLeft: '1rem', fontSize: '0.95rem' }}>Initializing GMClean session...</span>
      </div>
    );
  }

  // RENDER CONNECT PAGE IF UNAUTHENTICATED
  if (!session) {
    return (
      <main className={styles.container}>
        <ConnectionScreen 
          onConnectSuccess={handleConnectSuccess} 
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
            <div className={styles.userBadge}>
              <span className={styles.userName}>{session.user}</span>
              <span className={styles.userHost}>{session.host}</span>
            </div>

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

            <span className={styles.navLabel} style={{ fontSize: '0.65rem', color: 'var(--muted)', textAlign: 'center', opacity: 0.5, marginTop: '0.25rem' }}>
              v1.0.0
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
              userEmail={session.user}
              mailboxHost={session.host}
              onQuickClean={(senderEmails) => {
                setPreselectedSenders(senderEmails);
                setActiveTab('newsletters');
              }}
            />
          ) : (
            <NewsletterScreen 
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
