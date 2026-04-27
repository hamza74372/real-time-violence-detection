import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import './LoginScreen.css';

const DEMO = [
  { label: 'Admin',    email: 'admin@cityshield.com',    password: 'Admin@123',    color: 'blue' },
  { label: 'Operator', email: 'operator@cityshield.com', password: 'Operator@123', color: 'green' },
];

export default function LoginScreen() {
  const { login, error, setError, loading: authLoading } = useAuth();

  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [showPass,   setShowPass]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.');
      return;
    }
    setSubmitting(true);
    await login(email.trim(), password);
    setSubmitting(false);
  };

  const fillDemo = (acc) => {
    setEmail(acc.email);
    setPassword(acc.password);
    setError('');
  };

  if (authLoading) {
    return (
      <div className="login-root">
        <div className="login-loader"><div className="login-spinner" /></div>
      </div>
    );
  }

  return (
    <div className="login-root">
      <div className="login-bg-grid" />

      <div className="login-card">

        {/* Brand */}
        <div className="login-brand">
          <div className="login-brand-icon">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
              <path d="M16 2L4 7v8c0 7.4 5.1 14.3 12 16 6.9-1.7 12-8.6 12-16V7L16 2z"
                stroke="currentColor" strokeWidth="1.8"/>
              <path d="M11 16l3 3 7-7" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div className="login-brand-name">CityShield <span>AI</span></div>
            <div className="login-brand-sub">Smart City Surveillance System</div>
          </div>
        </div>

        <h1 className="login-heading">Sign in to continue</h1>
        <p className="login-sub">Authorised personnel only</p>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit} noValidate>

          {/* Email */}
          <div className="login-field">
            <label className="login-label">Email address</label>
            <div className="input-wrap">
              <svg className="input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                  stroke="currentColor" strokeWidth="1.8"/>
                <path d="M22 6l-10 7L2 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              <input
                className={`login-input ${error ? 'input-err' : ''}`}
                type="email"
                placeholder="you@cityshield.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                autoComplete="email"
                autoFocus
              />
            </div>
          </div>

          {/* Password */}
          <div className="login-field">
            <label className="login-label">Password</label>
            <div className="input-wrap">
              <svg className="input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              <input
                className={`login-input ${error ? 'input-err' : ''}`}
                type={showPass ? 'text' : 'password'}
                placeholder="Enter password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                autoComplete="current-password"
              />
              <button type="button" className="pass-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1}>
                {showPass
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"
                          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/></svg>
                }
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="login-error">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              {error}
            </div>
          )}

          <button className="login-btn" type="submit" disabled={submitting}>
            {submitting
              ? <><div className="btn-spinner" />Authenticating…</>
              : 'Sign in'
            }
          </button>

        </form>

        {/* Demo quick-fill */}
        <div className="login-divider"><span>Demo accounts</span></div>

        <div className="demo-grid">
          {DEMO.map(acc => (
            <button
              key={acc.email}
              type="button"
              className={`demo-btn demo-${acc.color}`}
              onClick={() => fillDemo(acc)}
            >
              <div className="demo-label">{acc.label}</div>
              <div className="demo-email">{acc.email}</div>
              <div className="demo-pw">{acc.password}</div>
            </button>
          ))}
        </div>

        <p className="login-note">Sessions managed by Firebase · Role stored in Firestore</p>
      </div>
    </div>
  );
}