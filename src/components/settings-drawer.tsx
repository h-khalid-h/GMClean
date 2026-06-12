'use client';

import React, { useState, useEffect } from 'react';
import { X, Save, Key, Shield, HelpCircle, Trash2 } from 'lucide-react';
import { db } from '@/lib/db';
import styles from '@/app/page.module.css';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsDrawer({ isOpen, onClose }: SettingsDrawerProps) {
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [msClientId, setMsClientId] = useState('');
  const [msClientSecret, setMsClientSecret] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [syncLimit, setSyncLimit] = useState('500');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [clearStatus, setClearStatus] = useState<'idle' | 'cleared'>('idle');
  const [activeGuide, setActiveGuide] = useState<'gmail' | 'outlook' | 'yahoo'>('gmail');

  // Load settings from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        setGoogleClientId(localStorage.getItem('gmclean_google_client_id') || '');
        setGoogleClientSecret(localStorage.getItem('gmclean_google_client_secret') || '');
        setMsClientId(localStorage.getItem('gmclean_ms_client_id') || '');
        setMsClientSecret(localStorage.getItem('gmclean_ms_client_secret') || '');
        setGeminiApiKey(localStorage.getItem('gmclean_gemini_api_key') || '');
        setSyncLimit(localStorage.getItem('gmclean_sync_limit') || '500');
      }, 0);
    }
  }, [isOpen]);

  const handleSave = () => {
    try {
      localStorage.setItem('gmclean_google_client_id', googleClientId);
      localStorage.setItem('gmclean_google_client_secret', googleClientSecret);
      localStorage.setItem('gmclean_ms_client_id', msClientId);
      localStorage.setItem('gmclean_ms_client_secret', msClientSecret);
      localStorage.setItem('gmclean_gemini_api_key', geminiApiKey);
      localStorage.setItem('gmclean_sync_limit', syncLimit);

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      alert('Failed to save settings. Your browser may have storage disabled or full.');
    }
  };

  const handleClearCache = async () => {
    const confirmClear = window.confirm('Are you sure you want to delete all cached email metadata stored locally in this browser? This will not affect emails on your actual mail server.');
    if (!confirmClear) return;

    try {
      await db.emails.clear();
      setClearStatus('cleared');
      setTimeout(() => {
        setClearStatus('idle');
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.error('Failed to clear emails database:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Application Settings" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()} style={{ animation: 'none' }}>
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Application Settings</h2>
          <button className={styles.btnClose} onClick={onClose} aria-label="Close settings">
            <X size={24} />
          </button>
        </div>

        {saveStatus === 'saved' && (
          <div className={`${styles.alert} ${styles.alertSuccess}`}>
            Settings saved successfully!
          </div>
        )}

        {clearStatus === 'cleared' && (
          <div className={`${styles.alert} ${styles.alertSuccess}`}>
            Local cache cleared successfully! Reloading...
          </div>
        )}

        {/* Section 1: AI Settings */}
        <div className={styles.drawerSection}>
          <h3 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Key size={18} /> AI Classification Options
          </h3>
          <div className={styles.formGroup}>
            <label className={styles.label}>Gemini API Key (Optional)</label>
            <input
              type="password"
              autoComplete="new-password"
              className={styles.input}
              placeholder="AI Smart Boost key..."
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              Enables local AI-powered smart sorting for ambiguous emails (under development).
            </span>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Sync Limit (emails per scan)</label>
            <select
              className={styles.select}
              value={syncLimit}
              onChange={(e) => setSyncLimit(e.target.value)}
            >
              <option value="100">100 emails (fastest)</option>
              <option value="250">250 emails</option>
              <option value="500">500 emails (default)</option>
              <option value="1000">1,000 emails</option>
              <option value="2000">2,000 emails</option>
              <option value="5000">5,000 emails (slowest)</option>
            </select>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              Maximum number of emails to fetch during each sync. Higher limits take longer.
            </span>
          </div>
        </div>

        {/* Section 2: OAuth Credentials */}
        <div className={styles.drawerSection}>
          <h3 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={18} /> Custom OAuth2 Developer Keys
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted-light)' }}>
            To enable one-click OAuth login without sharing your account password, provide your own Google/Microsoft API client keys.
          </p>

          <div style={{ padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '0.5rem' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#a78bfa' }}>Google OAuth2</h4>
            <div className={styles.formGroup}>
              <label className={styles.label}>Client ID</label>
              <input
                type="text"
                className={styles.input}
                placeholder="Google OAuth Client ID"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Client Secret</label>
              <input
                type="password"
                autoComplete="new-password"
                className={styles.input}
                placeholder="Google OAuth Client Secret"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
              />
            </div>
          </div>

          <div style={{ padding: '10px', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#60a5fa' }}>Microsoft OAuth2</h4>
            <div className={styles.formGroup}>
              <label className={styles.label}>Client ID</label>
              <input
                type="text"
                className={styles.input}
                placeholder="Microsoft Application Client ID"
                value={msClientId}
                onChange={(e) => setMsClientId(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Client Secret</label>
              <input
                type="password"
                autoComplete="new-password"
                className={styles.input}
                placeholder="Microsoft Application Client Secret"
                value={msClientSecret}
                onChange={(e) => setMsClientSecret(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Section 3: App Password Documentation */}
        <div className={styles.drawerSection}>
          <h3 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HelpCircle size={18} /> App Password Setup Guides
          </h3>
          
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${activeGuide === 'gmail' ? styles.tabActive : ''}`}
              onClick={() => setActiveGuide('gmail')}
            >
              Gmail
            </button>
            <button
              className={`${styles.tab} ${activeGuide === 'outlook' ? styles.tabActive : ''}`}
              onClick={() => setActiveGuide('outlook')}
            >
              Outlook
            </button>
            <button
              className={`${styles.tab} ${activeGuide === 'yahoo' ? styles.tabActive : ''}`}
              onClick={() => setActiveGuide('yahoo')}
            >
              Yahoo
            </button>
          </div>

          <div style={{ fontSize: '0.85rem', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', padding: '15px', borderRadius: '10px' }}>
            {activeGuide === 'gmail' && (
              <div>
                <strong style={{ color: '#fff' }}>For Google accounts (Gmail/Google Workspace):</strong>
                <ol style={{ marginLeft: '1.2rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <li>Go to your <a href="https://myaccount.google.com" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>Google Account Dashboard</a>.</li>
                  <li>Click on <strong>Security</strong> on the left panel.</li>
                  <li>Ensure <strong>2-Step Verification</strong> is enabled.</li>
                  <li>Search for <strong>&quot;App passwords&quot;</strong> in the top search bar.</li>
                  <li>Create a new password (e.g., call it &quot;GMClean&quot;).</li>
                  <li>Copy the 16-character code generated and paste it as the mailbox password.</li>
                </ol>
              </div>
            )}

            {activeGuide === 'outlook' && (
              <div>
                <strong style={{ color: '#fff' }}>For Microsoft accounts (Hotmail/Outlook.com):</strong>
                <ol style={{ marginLeft: '1.2rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <li>Login to your <a href="https://account.microsoft.com" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>Microsoft Account</a>.</li>
                  <li>Navigate to <strong>Security</strong> &gt; <strong>Advanced Security Options</strong>.</li>
                  <li>Under <strong>App passwords</strong>, click <strong>Create a new app password</strong>.</li>
                  <li>Copy the password and use it to log in.</li>
                </ol>
              </div>
            )}

            {activeGuide === 'yahoo' && (
              <div>
                <strong style={{ color: '#fff' }}>For Yahoo accounts:</strong>
                <ol style={{ marginLeft: '1.2rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <li>Sign in to your Yahoo Account Info page.</li>
                  <li>Select <strong>Account Security</strong>.</li>
                  <li>Click <strong>Generate app password</strong>.</li>
                  <li>Enter &quot;GMClean&quot; and click <strong>Generate</strong>.</li>
                  <li>Copy and paste the app password.</li>
                </ol>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
            <Save size={16} /> Save Settings
          </button>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleClearCache} style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
            <Trash2 size={16} /> Clear Cache
          </button>
        </div>
      </div>
    </div>
  );
}

