import type { Channel, Message, Stamp, StampSnapshot, User } from './types';

// 401 (=サーバが知らないユーザー) を検知したときの脱出ハンドラ。
// 例: backend を入れ替えて DB が空になった場合、ブラウザに残っている古い user.id で
// API を呼ぶと 401 が返る。App.tsx 側でログイン画面に戻すコールバックを登録する。
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    http<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signup: (name: string, email: string, password: string) =>
    http<{ user: User }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  listUsers: () => http<{ users: User[] }>('/api/users'),

  updateUser: (userId: string, patch: { avatar?: string; name?: string }) =>
    http<{ user: User }>(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  setUserAdmin: (targetUserId: string, requesterUserId: string, isAdmin: boolean) =>
    http<{ user: User }>(`/api/users/${targetUserId}/admin`, {
      method: 'PATCH',
      body: JSON.stringify({ userId: requesterUserId, isAdmin }),
    }),

  listChannels: (userId: string) =>
    http<{ channels: Channel[] }>(`/api/channels?userId=${encodeURIComponent(userId)}`),

  openDM: (userId: string, otherUserId: string) =>
    http<{ channel: Channel; created: boolean }>('/api/dms', {
      method: 'POST',
      body: JSON.stringify({ userId, otherUserId }),
    }),

  createChannel: (params: {
    name: string;
    kind?: 'public' | 'private';
    userId?: string;
    memberIds?: string[];
  }) =>
    http<{ channel: Channel }>('/api/channels', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  inviteToChannel: (channelId: string, userId: string, inviteeIds: string[]) =>
    http<{ channel: Channel }>(`/api/channels/${channelId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, inviteeIds }),
    }),

  listMessages: (channelId: string, userId: string) =>
    http<{ messages: Message[] }>(
      `/api/channels/${channelId}/messages?userId=${encodeURIComponent(userId)}`,
    ),

  sendMessage: (
    channelId: string,
    userId: string,
    body: string,
    parentId?: string,
    imageUrl?: string,
    stamp?: StampSnapshot,
  ) =>
    http<{ message: Message }>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ userId, body, parentId, imageUrl, stamp }),
    }),

  listStamps: (userId: string) =>
    http<{ stamps: Stamp[] }>(`/api/stamps?userId=${encodeURIComponent(userId)}`),

  createStamp: (
    userId: string,
    name: string,
    text: string,
    color: string,
    font: string,
  ) =>
    http<{ stamp: Stamp }>('/api/stamps', {
      method: 'POST',
      body: JSON.stringify({ userId, name, text, color, font }),
    }),

  deleteStamp: (stampId: string, userId: string) =>
    fetch(`/api/stamps/${stampId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }).then((r) => {
      if (!r.ok) {
        if (r.status === 401) onUnauthorized?.();
        throw new Error(`${r.status} ${r.statusText}`);
      }
    }),

  uploadImage: async (userId: string, file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append('userId', userId);
    fd.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    if (!res.ok) {
      if (res.status === 401) onUnauthorized?.();
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    return res.json() as Promise<{ url: string }>;
  },

  editMessage: (messageId: string, userId: string, body: string) =>
    http<{ message: Message }>(`/api/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ userId, body }),
    }),

  deleteMessage: (messageId: string, userId: string) =>
    fetch(`/api/messages/${messageId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }).then((r) => {
      if (!r.ok) {
        if (r.status === 401) onUnauthorized?.();
        throw new Error(`${r.status} ${r.statusText}`);
      }
    }),

  listReplies: (messageId: string, userId: string) =>
    http<{ parent: Message; replies: Message[] }>(
      `/api/messages/${messageId}/replies?userId=${encodeURIComponent(userId)}`,
    ),

  toggleReaction: (messageId: string, userId: string, emoji: string) =>
    http<{ message: Message }>(`/api/messages/${messageId}/reactions/toggle`, {
      method: 'POST',
      body: JSON.stringify({ userId, emoji }),
    }),
};

export function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
