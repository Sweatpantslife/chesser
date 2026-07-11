/**
 * Client for the friends & challenges endpoints
 * (apps/server/src/social/friends-routes.ts). Same conventions as
 * lib/socialApi.ts: thin fetch wrappers, bearer auth, errors thrown with the
 * server's message.
 */
import type { FriendColor, FriendTimeControl } from '@chesser/shared';

async function jsonOrThrow(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });
const jsonHeaders = (token: string) => ({ 'Content-Type': 'application/json', ...authHeaders(token) });

// --- friends ------------------------------------------------------------------

export interface FriendInfo {
  username: string;
  since: number;
}

export interface FriendRequestInfo {
  id: string;
  username: string;
  at: number;
}

export interface FriendsResponse {
  friends: FriendInfo[];
  incoming: FriendRequestInfo[];
  outgoing: FriendRequestInfo[];
  /** Your shareable friend code. */
  code: string;
}

export function apiGetFriends(token: string): Promise<FriendsResponse> {
  return fetch('/api/friends', { headers: authHeaders(token) }).then(jsonOrThrow);
}

/** Looks like a friend code (8 chars, unambiguous alphabet) vs a username. */
export const FRIEND_CODE_RE = /^[A-Za-z2-9]{8}$/;

export function apiSendFriendRequest(
  token: string,
  target: { username: string } | { code: string },
): Promise<{ ok: boolean; accepted: boolean; username: string }> {
  return fetch('/api/friends/request', { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify(target) }).then(jsonOrThrow);
}

export function apiRespondFriendRequest(token: string, id: string, accept: boolean): Promise<{ ok: boolean }> {
  return fetch('/api/friends/respond', { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ id, accept }) }).then(
    jsonOrThrow,
  );
}

export function apiCancelFriendRequest(token: string, id: string): Promise<{ ok: boolean }> {
  return fetch(`/api/friends/request/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(token) }).then(jsonOrThrow);
}

export function apiRemoveFriend(token: string, username: string): Promise<{ ok: boolean }> {
  return fetch(`/api/friends/${encodeURIComponent(username)}`, { method: 'DELETE', headers: authHeaders(token) }).then(jsonOrThrow);
}

// --- challenges ------------------------------------------------------------------

export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface IncomingChallenge {
  id: string;
  from: string;
  timeControl: FriendTimeControl | null;
  /** The CHALLENGER's color — you'd play the other side. */
  color: FriendColor | 'random';
  createdAt: number;
}

export interface OutgoingChallenge {
  id: string;
  to: string;
  timeControl: FriendTimeControl | null;
  color: FriendColor | 'random';
  createdAt: number;
  status: ChallengeStatus;
  roomCode?: string;
}

export function apiGetChallenges(token: string): Promise<{ incoming: IncomingChallenge[]; outgoing: OutgoingChallenge[] }> {
  return fetch('/api/challenges', { headers: authHeaders(token) }).then(jsonOrThrow);
}

export function apiSendChallenge(
  token: string,
  username: string,
  timeControl: FriendTimeControl | null,
  color: FriendColor | 'random',
): Promise<{ ok: boolean; id: string }> {
  return fetch('/api/challenges', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ username, timeControl, color }),
  }).then(jsonOrThrow);
}

export interface AcceptedChallengeSeat {
  ok: boolean;
  status: 'accepted' | 'declined';
  roomCode?: string;
  token?: string;
  color?: FriendColor;
}

export function apiRespondChallenge(token: string, id: string, accept: boolean): Promise<AcceptedChallengeSeat> {
  return fetch(`/api/challenges/${encodeURIComponent(id)}/respond`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ accept }),
  }).then(jsonOrThrow);
}

export function apiCancelChallenge(token: string, id: string): Promise<{ ok: boolean }> {
  return fetch(`/api/challenges/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(token) }).then(jsonOrThrow);
}

// --- activity feed -----------------------------------------------------------------

export type FeedKind = 'rush' | 'rating' | 'achievement' | 'streak';

export interface FeedEvent {
  username: string;
  at: number;
  kind: FeedKind;
  board?: 'puzzles' | 'bots';
  value?: number;
  id?: string;
  count?: number;
}

export function apiGetFriendFeed(token: string): Promise<{ events: FeedEvent[] }> {
  return fetch('/api/friends/feed', { headers: authHeaders(token) }).then(jsonOrThrow);
}
