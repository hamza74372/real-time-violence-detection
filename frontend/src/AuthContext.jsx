import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [role,    setRole]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Firebase restores session automatically — just listen
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        setUser(fbUser);
        try {
          const snap = await getDoc(doc(db, 'users', fbUser.email));
          if (snap.exists()) {
            const data = snap.data();
            setRole(data.role || 'operator');
            setProfile(data);
          } else {
            setRole('operator');
            setProfile({ full_name: fbUser.email, role: 'operator' });
          }
        } catch {
          setRole('operator');
          setProfile({ full_name: fbUser.email, role: 'operator' });
        }
      } else {
        setUser(null);
        setRole(null);
        setProfile(null);
      }
      setLoading(false);
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