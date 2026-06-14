import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiGetMe, apiLogin, apiLogout, apiRegister } from '../lib/api';
import { pullAndMerge, startSync, stopSync, type SyncState } from '../lib/sync';

interface AuthState {
  token: string | null;
  username: string | null;
  busy: boolean;
  error: string | null;
  sync: SyncState;

  init(): void;
  register(username: string, password: string): Promise<boolean>;
  login(username: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  _begin(token: string, username: string): Promise<void>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      username: null,
      busy: false,
      error: null,
      sync: 'off',

      init() {
        const token = get().token;
        if (!token) return;
        // Verify the stored token, then pull + start syncing.
        apiGetMe(token)
          .then(({ username }) => get()._begin(token, username))
          .catch(() => set({ token: null, username: null, sync: 'off' }));
      },

      async _begin(token, username) {
        set({ token, username, error: null, sync: 'syncing' });
        try {
          await pullAndMerge(token);
          set({ sync: 'synced' });
        } catch {
          set({ sync: 'error' });
        }
        startSync(token, (s) => set({ sync: s }));
      },

      async register(username, password) {
        set({ busy: true, error: null });
        try {
          const { token, username: name } = await apiRegister(username, password);
          await get()._begin(token, name);
          return true;
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Registration failed' });
          return false;
        } finally {
          set({ busy: false });
        }
      },

      async login(username, password) {
        set({ busy: true, error: null });
        try {
          const { token, username: name } = await apiLogin(username, password);
          await get()._begin(token, name);
          return true;
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Login failed' });
          return false;
        } finally {
          set({ busy: false });
        }
      },

      async logout() {
        const token = get().token;
        stopSync();
        set({ token: null, username: null, sync: 'off', error: null });
        if (token) await apiLogout(token).catch(() => {});
      },
    }),
    { name: 'chesser-auth', partialize: (s) => ({ token: s.token, username: s.username }) },
  ),
);
