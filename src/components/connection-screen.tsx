'use client';

import React, { useState, useEffect } from 'react';
import { Mail, Shield, AlertTriangle, Cpu } from 'lucide-react';
import styles from '@/app/page.module.css';

interface ConnectionScreenProps {
  onConnectSuccess: (data: { user: string; host: string }) => void;
  onOpenSettings: () => void;
  initialError?: string;
}

export default function ConnectionScreen({ onConnectSuccess, onOpenSettings, initialError }: ConnectionScreenProps) {
  const [activeTab, setActiveTab] = useState<'preset' | 'manual'>('preset');
  const [provider, setProvider] = useState<'gmail' | 'outlook' | 'yahoo' | 'custom'>('gmail');
  
  // Form fields
  const [host, setHost] = useState('imap.gmail.com');
  const [port, setPort] = useState('993');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [secure, setSecure] = useState(true);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError || '');

  useEffect(() => {
    if (initialError) {
      setTimeout(() => setError(initialError), 0);
    }
  }, [initialError]);

  // Handle Preset selection change
  const handleProviderChange = (prov: 'gmail' | 'outlook' | 'yahoo' | 'custom') => {
    setProvider(prov);
    if (prov === 'gmail') {
      setHost('imap.gmail.com');
      setPort('993');
      setSecure(true);
    } else if (prov === 'outlook') {
      setHost('outlook.office365.com');
      setPort('993');
      setSecure(true);
    } else if (prov === 'yahoo') {
      setHost('imap.mail.yahoo.com');
      setPort('993');
      setSecure(true);
    }
  };

  // Submit manual or preset App Password connection
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/mail/sync?limit=1&offset=0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, user, pass, secure }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to authenticate connection.');
      }

      onConnectSuccess({ user: data.user, host: data.host });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Connection failed. Double check credentials.';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // Trigger OAuth login redirection
  const handleOAuthLogin = async (platform: 'google' | 'microsoft') => {
    setLoading(true);
    setError('');

    try {
      let clientId = '';
      let clientSecret = '';

      if (platform === 'google') {
        clientId = localStorage.getItem('gmclean_google_client_id') || '';
        clientSecret = localStorage.getItem('gmclean_google_client_secret') || '';
      } else {
        clientId = localStorage.getItem('gmclean_ms_client_id') || '';
        clientSecret = localStorage.getItem('gmclean_ms_client_secret') || '';
      }

      // Validate credentials before redirecting
      if (!clientId || !clientSecret) {
        setError(
          `No ${platform === 'google' ? 'Google' : 'Microsoft'} OAuth credentials configured. ` +
          'Open Settings to enter your Client ID and Client Secret first.'
        );
        setLoading(false);
        return;
      }

      let encryptedState = '';

      // Encrypt credentials into state for the callback to use
      const encryptResponse = await fetch('/api/auth/encrypt-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const encryptData = await encryptResponse.json();
      if (encryptResponse.ok) {
        encryptedState = encryptData.state;
      }

      const redirectUri = `${window.location.origin}/api/auth/callback/${platform}`;

      if (platform === 'google') {
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'https://mail.google.com/',
          state: encryptedState,
          access_type: 'offline',
          prompt: 'consent'
        }).toString();

        window.location.href = authUrl;
      } else {
        const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` + new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
          state: encryptedState,
          prompt: 'login'
        }).toString();

        window.location.href = authUrl;
      }
    } catch {
      setError('OAuth routing failed. Verify your Client keys in Settings.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.connectWrapper}>
      <div className={styles.connectCard}>
        <div className={styles.header}>
          <div style={{ display: 'inline-flex', padding: '12px', background: 'var(--primary-glow)', borderRadius: '14px', color: 'var(--primary)', marginBottom: '1rem' }}>
            <Cpu size={32} />
          </div>
          <h1 className={styles.title}>Connect Mailbox</h1>
          <p className={styles.subtitle}>Analyze and unsubscribe from newsletters privately</p>
        </div>

        {error && (
          <div className={`${styles.alert} ${styles.alertError}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'preset' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('preset')}
          >
            OAuth (One-Click)
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'manual' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('manual')}
          >
            App Password
          </button>
        </div>

        {activeTab === 'preset' ? (
          <div className={styles.oauthGrid}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => handleOAuthLogin('google')}
              disabled={loading}
              style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', height: '48px' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114A5.59 5.59 0 0 1 8.4 12.928a5.59 5.59 0 0 1 5.59-5.589c2.39 0 4.346 1.482 5.093 3.6h4.35C22.54 5.378 17.848 2 12.24 2 6.585 2 2 6.585 2 12.24s4.585 10.24 10.24 10.24c5.795 0 10.24-4.114 10.24-10.24 0-.649-.07-1.285-.24-1.955H12.24z"/>
              </svg>
              Google / Gmail OAuth
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => handleOAuthLogin('microsoft')}
              disabled={loading}
              style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', height: '48px' }}
            >
              <svg width="20" height="20" viewBox="0 0 23 23">
                <path fill="#F25022" d="M0 0h11v11H0z"/>
                <path fill="#7FBA00" d="M12 0h11v11H12z"/>
                <path fill="#00A4EF" d="M0 12h11v11H0z"/>
                <path fill="#FFB900" d="M12 12h11v11H12z"/>
              </svg>
              Outlook / Office 365 OAuth
            </button>
            
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center', marginTop: '1rem' }}>
              Note: To use OAuth, click <button type="button" onClick={onOpenSettings} style={{ color: 'var(--primary)', background: 'transparent', border: 'none', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}>Settings</button> first to configure your Google/Microsoft Developer keys.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Select Provider</label>
              <select
                className={styles.select}
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as 'gmail' | 'outlook' | 'yahoo' | 'custom')}
              >
                <option value="gmail">Gmail</option>
                <option value="outlook">Outlook / Hotmail</option>
                <option value="yahoo">Yahoo Mail</option>
                <option value="custom">Custom IMAP Configuration</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Email Address</label>
              <input
                type="email"
                required
                className={styles.input}
                placeholder="you@example.com"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>App Password</span>
                <button type="button" onClick={onOpenSettings} style={{ color: 'var(--primary)', background: 'transparent', border: 'none', fontSize: '0.75rem', cursor: 'pointer' }}>
                  How to generate?
                </button>
              </label>
              <input
                type="password"
                required
                className={styles.input}
                placeholder="•••• •••• •••• ••••"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </div>

            {provider === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>IMAP Host</label>
                  <input
                    type="text"
                    required
                    className={styles.input}
                    placeholder="imap.domain.com"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Port</label>
                  <input
                    type="text"
                    required
                    className={styles.input}
                    placeholder="993"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={loading}
              style={{ marginTop: '1.5rem', height: '48px' }}
            >
              {loading ? (
                <>
                  <div className={styles.loader}></div>
                  Connecting...
                </>
              ) : (
                <>
                  <Mail size={16} />
                  Connect with App Password
                </>
              )}
            </button>
          </form>
        )}

        <div className={styles.infoBox} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
          <Shield size={18} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong>Privacy Guarantee:</strong> GMClean is entirely database-less and local-first. Your email details are encrypted in your browser and never saved on our servers.
          </span>
        </div>
      </div>
    </div>
  );
}
