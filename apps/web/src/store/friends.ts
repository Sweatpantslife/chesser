import { create } from 'zustand';
import type { FriendColor, FriendTimeControl } from '@chesser/shared';
import i18n from '../i18n';
import { useAuth } from './auth';
import {
  apiCancelChallenge,
  apiCancelFriendRequest,
  apiGetChallenges,
  apiGetFriendFeed,
  apiGetFriends,
  apiRemoveFriend,
  apiRespondChallenge,
  apiRespondFriendRequest,
  apiSendChallenge,
  apiSendFriendRequest,
  FRIEND_CODE_RE,
  type FeedEvent,
  type FriendsResponse,
  type IncomingChallenge,
  type OutgoingChallenge,
} from '../lib/friendsApi';

/**
 * Friends & challenges — a thin cache over the server state (which is always
 * authoritative). The Friends panel drives `refresh()` on mount and on a short
 * poll while visible; every action refetches so the UI can't drift.
 *
 * Not persisted (same reasoning as store/social.ts): the graph is per-account
 * and privacy-sensitive, so it's refetched per session rather than risking a
 * stale copy leaking across sign-ins on a shared device.
 */

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
// Notices/errors composed here (not server-sent) resolve through the errors
// namespace at the moment they're produced; server Error messages pass
// through untranslated (phase 3). `tf` is created per call so a language
// switch mid-session picks up the new locale on the next action.
const tf = () => i18n.getFixedT(null, 'errors');

interface FriendsState {
  data: FriendsResponse | null; // null until first load per session
  challengesIn: IncomingChallenge[];
  challengesOut: OutgoingChallenge[];
  feed: FeedEvent[];
  /** Load/network error for the panel's status line. */
  error: string | null;

  /** Refetch friends + challenges (+ feed). Cheap; safe to poll. */
  refresh(): Promise<void>;
  /** Send a request; input is a username or a friend code. Returns a user-facing notice. */
  addFriend(raw: string): Promise<{ ok: boolean; message: string }>;
  respondRequest(id: string, accept: boolean): Promise<void>;
  cancelRequest(id: string): Promise<void>;
  removeFriend(username: string): Promise<void>;
  sendChallenge(username: string, tc: FriendTimeControl | null, color: FriendColor | 'random'): Promise<string | null>;
  /** Accept/decline. On accept resolves with the seat to join. */
  respondChallenge(
    id: string,
    accept: boolean,
  ): Promise<{ roomCode: string; token: string; color: FriendColor } | null>;
  cancelChallenge(id: string): Promise<void>;
  clear(): void;
}

const token = () => useAuth.getState().token;

export const useFriends = create<FriendsState>()((set, get) => ({
  data: null,
  challengesIn: [],
  challengesOut: [],
  feed: [],
  error: null,

  async refresh() {
    const t = token();
    if (!t) return;
    try {
      const [data, challenges, feed] = await Promise.all([apiGetFriends(t), apiGetChallenges(t), apiGetFriendFeed(t)]);
      set({ data, challengesIn: challenges.incoming, challengesOut: challenges.outgoing, feed: feed.events, error: null });
    } catch (e) {
      set({ error: errMsg(e, tf()('friends.unreachable')) });
    }
  },

  async addFriend(raw) {
    const t = token();
    if (!t) return { ok: false, message: tf()('friends.signInFirst') };
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false, message: tf()('friends.enterTarget') };
    const target = FRIEND_CODE_RE.test(trimmed) ? { code: trimmed.toUpperCase() } : { username: trimmed };
    try {
      const res = await apiSendFriendRequest(t, target);
      await get().refresh();
      return res.accepted
        ? { ok: true, message: tf()('friends.nowFriends', { username: res.username }) }
        : { ok: true, message: tf()('friends.requestSent', { username: res.username }) };
    } catch (e) {
      return { ok: false, message: errMsg(e, tf()('friends.sendRequestFailed')) };
    }
  },

  async respondRequest(id, accept) {
    const t = token();
    if (!t) return;
    await apiRespondFriendRequest(t, id, accept).catch((e) => set({ error: errMsg(e, tf()('friends.respondFailed')) }));
    await get().refresh();
  },

  async cancelRequest(id) {
    const t = token();
    if (!t) return;
    await apiCancelFriendRequest(t, id).catch(() => undefined);
    await get().refresh();
  },

  async removeFriend(username) {
    const t = token();
    if (!t) return;
    await apiRemoveFriend(t, username).catch((e) => set({ error: errMsg(e, tf()('friends.removeFailed')) }));
    await get().refresh();
  },

  async sendChallenge(username, tc, color) {
    const t = token();
    if (!t) return tf()('friends.signInFirst');
    try {
      await apiSendChallenge(t, username, tc, color);
      await get().refresh();
      return null;
    } catch (e) {
      return errMsg(e, tf()('friends.sendChallengeFailed'));
    }
  },

  async respondChallenge(id, accept) {
    const t = token();
    if (!t) return null;
    try {
      const res = await apiRespondChallenge(t, id, accept);
      void get().refresh();
      if (accept && res.roomCode && res.token && res.color) {
        return { roomCode: res.roomCode, token: res.token, color: res.color };
      }
      return null;
    } catch (e) {
      set({ error: errMsg(e, tf()('friends.respondChallengeFailed')) });
      void get().refresh();
      return null;
    }
  },

  async cancelChallenge(id) {
    const t = token();
    if (!t) return;
    await apiCancelChallenge(t, id).catch(() => undefined);
    await get().refresh();
  },

  clear() {
    set({ data: null, challengesIn: [], challengesOut: [], feed: [], error: null });
  },
}));
