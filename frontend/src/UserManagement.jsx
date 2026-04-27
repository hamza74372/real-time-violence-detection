import React, { useState, useEffect, useCallback } from 'react';
import './UserManagement.css';

const API_BASE = 'http://127.0.0.1:8000/api';

const EMPTY_FORM = { email: '', password: '', full_name: '', role: 'operator' };

// ── Avatar initials ───────────────────────────────────────────────────────────
function Avatar({ name, role }) {
  const initial = name?.[0]?.toUpperCase() || '?';
  return (
    <div className={`um-avatar um-avatar-${role}`}>{initial}</div>
  );
}

// ── Create user form ──────────────────────────────────────────────────────────
function CreateUserForm({ onCreated, onCancel, isSaving }) {
  const [form,   setForm]   = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [showPw, setShowPw] = useState(false);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (!form.full_name.trim()) e.full_name = 'Full name is required';
    if (!form.email.trim())     e.email     = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
                                e.email     = 'Enter a valid email address';
    if (!form.password.trim())  e.password  = 'Password is required';
    else if (form.password.length < 6)
                                e.password  = 'Minimum 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) onCreated(form);
  };

  return (
    <div className="um-modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="um-modal">

        <div className="um-modal-header">
          <div className="um-modal-title-block">
            <div className="um-modal-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="um-modal-title">Create new account</span>
          </div>
          <button className="um-close-btn" onClick={onCancel}>✕</button>
        </div>

        <div className="um-modal-body">

          {/* Full name */}
          <div className="um-field">
            <label className="um-label">Full name <span className="req">*</span></label>
            <input className={`um-input ${errors.full_name ? 'um-input-err' : ''}`}
              placeholder="e.g. Hamza Shakil"
              value={form.full_name}
              onChange={e => set('full_name', e.target.value)} />
            {errors.full_name && <span className="um-field-err">{errors.full_name}</span>}
          </div>

          {/* Email */}
          <div className="um-field">
            <label className="um-label">Email address <span className="req">*</span></label>
            <input className={`um-input ${errors.email ? 'um-input-err' : ''}`}
              type="email" placeholder="operator@cityshield.com"
              value={form.email}
              onChange={e => set('email', e.target.value)} />
            {errors.email && <span className="um-field-err">{errors.email}</span>}
          </div>

          {/* Password */}
          <div className="um-field">
            <label className="um-label">Password <span className="req">*</span></label>
            <div className="um-pw-wrap">
              <input className={`um-input um-pw-input ${errors.password ? 'um-input-err' : ''}`}
                type={showPw ? 'text' : 'password'}
                placeholder="Min. 6 characters"
                value={form.password}
                onChange={e => set('password', e.target.value)} />
              <button type="button" className="um-pw-toggle" onClick={() => setShowPw(v => !v)}>
                {showPw
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/></svg>
                }
              </button>
            </div>
            {errors.password && <span className="um-field-err">{errors.password}</span>}
          </div>

          {/* Role */}
          <div className="um-field">
            <label className="um-label">Role</label>
            <div className="um-role-toggle">
              {['operator', 'admin'].map(r => (
                <button
                  key={r}
                  type="button"
                  className={`um-role-btn um-role-${r} ${form.role === r ? 'um-role-active' : ''}`}
                  onClick={() => set('role', r)}
                >
                  <div className="um-role-btn-label">{r === 'admin' ? 'Admin' : 'Operator'}</div>
                  <div className="um-role-btn-desc">
                    {r === 'admin'
                      ? 'Full system access'
                      : 'Incident triage only'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Permissions preview */}
          <div className="um-perms-preview">
            <div className="um-perms-title">This account will be able to:</div>
            <div className="um-perms-list">
              {[
                { label: 'View live camera feeds',       allowed: true },
                { label: 'Action incident triage',       allowed: true },
                { label: 'View analytics',               allowed: true },
                { label: 'Change AI threshold',          allowed: form.role === 'admin' },
                { label: 'Manage camera nodes',          allowed: form.role === 'admin' },
                { label: 'Create & delete user accounts',allowed: form.role === 'admin' },
              ].map(p => (
                <div key={p.label} className={`um-perm-row ${p.allowed ? 'perm-yes' : 'perm-no'}`}>
                  {p.allowed
                    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    : <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                  }
                  <span>{p.label}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        <div className="um-modal-footer">
          <button className="um-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="um-btn-create" onClick={handleSubmit} disabled={isSaving}>
            {isSaving
              ? <><div className="um-btn-spinner" />Creating…</>
              : 'Create account'
            }
          </button>
        </div>

      </div>
    </div>
  );
}

// ── User row ──────────────────────────────────────────────────────────────────
function UserRow({ user, currentUserEmail, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isSelf = user.email === currentUserEmail;

  return (
    <div className={`um-user-row ${isSelf ? 'um-self-row' : ''}`}>
      <Avatar name={user.full_name} role={user.role} />

      <div className="um-user-info">
        <div className="um-user-name">
          {user.full_name}
          {isSelf && <span className="um-self-tag">You</span>}
        </div>
        <div className="um-user-email">{user.email}</div>
        {user.created_at && (
          <div className="um-user-meta">Created {user.created_at}</div>
        )}
      </div>

      <span className={`um-role-badge badge-${user.role}`}>{user.role}</span>

      <div className="um-user-actions">
        {!isSelf && !confirmDelete && (
          <button className="um-delete-btn" onClick={() => setConfirmDelete(true)} title="Delete account">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Delete
          </button>
        )}
        {confirmDelete && (
          <div className="um-confirm-delete">
            <span>Delete this account?</span>
            <button className="um-confirm-yes" onClick={() => onDelete(user.email)}>Yes, delete</button>
            <button className="um-confirm-no"  onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        )}
        {isSelf && (
          <span className="um-self-note">Cannot delete own account</span>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function UserManagement({ currentUserEmail }) {
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [isSaving,  setIsSaving]  = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadUsers = useCallback(async () => {
    try {
      const data = await fetch(`${API_BASE}/users`).then(r => r.json());
      setUsers(data);
    } catch {
      showToast('Could not load users', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleCreate = async (form) => {
    setIsSaving(true);
    try {
      const res  = await fetch(`${API_BASE}/users`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.detail || 'Failed to create account', 'error');
        return;
      }
      await loadUsers();
      setShowForm(false);
      showToast(`Account created for ${form.full_name}`);
    } catch {
      showToast('Server error — is the backend running?', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (email) => {
    try {
      const res = await fetch(`${API_BASE}/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.detail || 'Delete failed', 'error');
        return;
      }
      setUsers(prev => prev.filter(u => u.email !== email));
      showToast('Account deleted');
    } catch {
      showToast('Delete failed', 'error');
    }
  };

  const admins    = users.filter(u => u.role === 'admin');
  const operators = users.filter(u => u.role === 'operator');

  return (
    <div className="um-root">

      {/* Header */}
      <div className="um-header">
        <div>
          <h2 className="um-title">User Management</h2>
          <p className="um-sub">{users.length} accounts · {admins.length} admin · {operators.length} operator</p>
        </div>
        <button className="um-add-btn" onClick={() => setShowForm(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          New account
        </button>
      </div>

      {/* Stats */}
      <div className="um-stats-row">
        {[
          { label: 'Total accounts', value: users.length,     color: 'var(--text-primary)' },
          { label: 'Admins',         value: admins.length,    color: 'var(--accent-text)' },
          { label: 'Operators',      value: operators.length, color: 'var(--green-text)' },
        ].map(s => (
          <div key={s.label} className="um-stat-card glass-panel">
            <div className="um-stat-val" style={{ color: s.color }}>{s.value}</div>
            <div className="um-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* User list */}
      <div className="um-list">
        {loading && (
          <div className="um-loading">
            <div className="um-spinner" />
            <span>Loading accounts…</span>
          </div>
        )}

        {!loading && users.length === 0 && (
          <div className="um-empty">
            <p>No accounts found.</p>
            <button className="um-add-btn" onClick={() => setShowForm(true)}>Create first account</button>
          </div>
        )}

        {admins.length > 0 && (
          <div className="um-section">
            <div className="um-section-label">Administrators</div>
            {admins.map(u => (
              <UserRow key={u.email} user={u} currentUserEmail={currentUserEmail} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {operators.length > 0 && (
          <div className="um-section">
            <div className="um-section-label">Operators</div>
            {operators.map(u => (
              <UserRow key={u.email} user={u} currentUserEmail={currentUserEmail} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <CreateUserForm
          onCreated={handleCreate}
          onCancel={() => setShowForm(false)}
          isSaving={isSaving}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`um-toast um-toast-${toast.type}`}>
          {toast.type === 'success'
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/><path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          }
          {toast.msg}
        </div>
      )}

    </div>
  );
}
