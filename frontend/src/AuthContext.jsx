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
          // Attempt to retrieve user roles from backend API for robust server-side security bypass
          const res = await fetch(`${API_BASE}/users`);
          if (res.ok) {
            const users = await res.json();
            const dbUser = users.find(u => u.email.toLowerCase() === fbUser.email.toLowerCase());
            if (dbUser) {
              setRole(dbUser.role || 'operator');
              setProfile(dbUser);
            } else {
              // Fallback to client-side Firestore SDK if backend lookup doesn't find the user
              const snap = await getDoc(doc(db, 'users', fbUser.email));
              if (snap.exists()) {
                const data = snap.data();
                setRole(data.role || 'operator');
                setProfile(data);
              } else {
                setRole('operator');
                setProfile({ full_name: fbUser.email, role: 'operator' });
              }
            }
          } else {
            // Fallback to client-side Firestore SDK if API call returns an error status
            const snap = await getDoc(doc(db, 'users', fbUser.email));
            if (snap.exists()) {
              const data = snap.data();
              setRole(data.role || 'operator');
              setProfile(data);
            } else {
              setRole('operator');
              setProfile({ full_name: fbUser.email, role: 'operator' });
            }
          }
        } catch (err) {
          console.error("Error retrieving user role from API:", err);
          try {
            // Fallback to client-side Firestore SDK if fetch fails (e.g. network/CORS error)
            const snap = await getDoc(doc(db, 'users', fbUser.email));
            if (snap.exists()) {
              const data = snap.data();
              setRole(data.role || 'operator');
              setProfile(data);
            } else {
              setRole('operator');
              setProfile({ full_name: fbUser.email, role: 'operator' });
            }
          } catch (innerErr) {
            console.error("Firestore SDK fallback failed:", innerErr);
            setRole('operator');
            setProfile({ full_name: fbUser.email, role: 'operator' });
          }
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