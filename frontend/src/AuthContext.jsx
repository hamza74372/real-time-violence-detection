import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { API_BASE } from './config';

const AuthContext = createContext(null);

// Fetch role from backend with retries — keeps trying until backend is ready
async function fetchRoleFromBackend(fbUser, maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const token = await fbUser.getIdToken();
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res   = await fetch(`${API_BASE}/users`, {
        headers: { Authorization: `Bearer ${token}` },
        signal:  ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (res.ok) {
        const users  = await res.json();
        const dbUser = users.find(u => u.email.toLowerCase() === fbUser.email.toLowerCase());
        if (dbUser) return { role: dbUser.role || 'operator', profile: dbUser };
      }
    } catch {
      // backend not ready yet — wait and retry
    }
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000));
  }
  return null; // all attempts failed
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [role,    setRole]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        setUser(fbUser);
        // Show the app immediately with operator role while we fetch the real role
        setRole('operator');
        setProfile({ full_name: fbUser.email, role: 'operator' });
        setLoading(false);

        // Fetch real role in background — retries every 2s for up to 16s
        const result = await fetchRoleFromBackend(fbUser);
        if (result) {
          setRole(result.role);
          setProfile(result.profile);
        } else {
          // Backend unavailable — try Firestore as last resort
          try {
            const snap = await getDoc(doc(db, 'users', fbUser.email));
            if (snap.exists()) {
              const data = snap.data();
              setRole(data.role || 'operator');
              setProfile(data);
            }
          } catch { /* stay as operator */ }
        }
      } else {
        setUser(null);
        setRole(null);
        setProfile(null);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const login = useCallback(async (email, password) => {
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (e) {
      const msgs = {
        'auth/invalid-credential':     'Invalid email or password.',
        'auth/user-not-found':         'No account with that email.',
        'auth/wrong-password':         'Incorrect password.',
        'auth/invalid-email':          'Enter a valid email address.',
        'auth/too-many-requests':      'Too many attempts — wait and retry.',
        'auth/network-request-failed': 'Network error. Check connection.',
      };
      setError(msgs[e.code] || 'Sign-in failed. Please try again.');
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setError('');
  }, []);

  return (
    <AuthContext.Provider value={{
      user, role, profile, loading, error, setError,
      login, logout,
      isAdmin:         role === 'admin',
      isOperator:      role === 'operator',
      fullName:        profile?.full_name || user?.email || '',
      isAuthenticated: !!user && !!role,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}
