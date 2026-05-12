import type { Channel, Message, User } from './types';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (name: string) =>
    http<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  listUsers: () => http<{ users: User[] }>('/api/users'),

  updateUser: (userId: string, patch: { avatar?: string; name?: string }) =>
    http<{ user: User }>(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  listChannels: (userId: string) =>
    http<{ channels: Channel[] }>(`/api/channels?userId=${encodeURIComponent(userId)}`),

  openDM: (userId: string, otherUserId: string) =>
    http<{ channel: Channel; created: boolean }>('/api/dms', {
      method: 'POST',
      body: JSON.stringify({ userId, otherUserId }),
    }),

  createChannel: (name: string) =>
    http<{ channel: Channel }>('/api/channels', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  listMessages: (channelId: string) =>
    http<{ messages: Message[] }>(`/api/channels/${channelId}/messages`),

  sendMessage: (channelId: string, userId: string, body: string, parentId?: string) =>
    http<{ message: Message }>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ userId, body, parentId }),
    }),

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
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    }),

  listReplies: (messageId: string) =>
    http<{ parent: Message; replies: Message[] }>(`/api/messages/${messageId}/replies`),

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
