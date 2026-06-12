'use client';

import React, { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('GMClean Error Boundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleClearAndReload = async () => {
    try {
      // Clear IndexedDB to recover from corrupted data
      const databases = await window.indexedDB.databases();
      for (const dbInfo of databases) {
        if (dbInfo.name) {
          window.indexedDB.deleteDatabase(dbInfo.name);
        }
      }
    } catch (e) {
      console.error('Failed to clear IndexedDB:', e);
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          background: '#08090f',
          color: '#f8fafc',
          textAlign: 'center',
          gap: '1.5rem'
        }}>
          <div style={{
            display: 'inline-flex',
            padding: '14px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '16px',
            color: '#f87171'
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Something went wrong</h1>
          
          <p style={{ color: '#94a3b8', maxWidth: '400px', fontSize: '0.9rem', lineHeight: 1.6 }}>
            GMClean encountered an unexpected error. This may be caused by corrupted local data. 
            You can try recovering or clearing all cached data to start fresh.
          </p>

          <code style={{
            display: 'block',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            fontSize: '0.8rem',
            color: '#f87171',
            maxWidth: '500px',
            wordBreak: 'break-word'
          }}>
            {this.state.error?.message || 'Unknown error'}
          </code>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '10px 20px',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.06)',
                color: '#f8fafc',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              Try Again
            </button>
            <button
              onClick={this.handleClearAndReload}
              style={{
                padding: '10px 20px',
                borderRadius: '10px',
                border: 'none',
                background: '#7c3aed',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              Clear Cache & Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
