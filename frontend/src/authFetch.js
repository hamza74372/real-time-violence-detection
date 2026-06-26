/**
 * CityShield AI — Authenticated Fetch Helper
 *
 * Wraps the native fetch() to automatically inject the Firebase ID token
 * as an Authorization: Bearer header on every API request.
 *
 * Usage:
 *   import { authFetch } from './authFetch';
 *   const data = await authFetch(`${API_BASE}/incidents`).then(r => r.json());
 *   const res  = await authFetch(`${API_BASE}/cameras`, { method: 'POST', ... });
 */
import { auth } from './firebase';

export async function authFetch(url, options = {}) {
  const user = auth.currentUser;

  if (user) {
    try {
      const token = await user.getIdToken();
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      };
    } catch (err) {
      console.warn('authFetch: failed to get ID token', err);
    }
  }

  return fetch(url, options);
}
