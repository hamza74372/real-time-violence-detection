// ─── Central API config ───────────────────────────────────────────────────────
// Change VITE_API_HOST in .env.local to point to a different backend.
// All components import from here — never hardcode 127.0.0.1 elsewhere.

export const API_HOST = import.meta.env.VITE_API_HOST ?? 'http://127.0.0.1:8000';
export const API_BASE = import.meta.env.VITE_API_BASE ?? `${API_HOST}/api`;
