import express, { Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

interface User {
  id: string;
  name: string;
  avatar: string;
}

type Reactions = Record<string, string[]>;

interface Channel {
  id: string;
  name: string;
  createdAt: string;
  kind: 'public' | 'dm';
  members?: string[];
}

interface Message {
  id: string;
  channelId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
  editedAt?: string;
  parentId?: string;
  replyCount: number;
  lastReplyAt?: string;
  reactions: Reactions;
  mentions: string[];
}

interface DB {
  users: User[];
  channels: Channel[];
  messages: Message[];
}

const AVATAR_POOL = [
  '🧑', '👩', '👨', '🧔', '👶', '👵', '👴',
  '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐸',
  '🦄', '🐙', '🦉', '🐧', '🐢', '🦖', '🐳',
  '🍎', '🍌', '🍣', '🍕', '🍩', '☕', '🌸',
];
function randomAvatar(): string {
  return AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
}

// Greedy mention 抽出: ユーザー名を長さ降順で並べ、@<name> が現れる位置を貪欲マッチする
function extractMentions(body: string, users: User[]): string[] {
  const sorted = [...users].sort((a, b) => b.name.length - a.name.length);
  const found = new Set<string>();
  let i = 0;
  while (i < body.length) {
    if (body[i] === '@') {
      let matched = false;
      for (const u of sorted) {
        if (u.name && body.startsWith(u.name, i + 1)) {
          found.add(u.id);
          i += 1 + u.name.length;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    } else {
      i++;
    }
  }
  return [...found];
}

const DATA_FILE = path.join(__dirname, '..', 'data.json');

function loadDb(): DB {
  if (!fs.existsSync(DATA_FILE)) {
    const now = new Date().toISOString();
    const initial: DB = {
      users: [],
      channels: [
        { id: 'general', name: 'general', createdAt: now, kind: 'public' },
        { id: 'random', name: 'random', createdAt: now, kind: 'public' },
      ],
      messages: [],
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Partial<DB>;
  const users: User[] = (raw.users ?? []).map((u: any) => ({
    id: u.id,
    name: u.name,
    avatar: typeof u.avatar === 'string' && u.avatar ? u.avatar : randomAvatar(),
  }));
  const channels: Channel[] = (raw.channels ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    kind: c.kind === 'dm' ? 'dm' : 'public',
    members: Array.isArray(c.members) ? c.members : undefined,
  }));
  const messages: Message[] = (raw.messages ?? []).map((m: any) => ({
    id: m.id,
    channelId: m.channelId,
    userId: m.userId,
    userName: m.userName,
    body: m.body,
    createdAt: m.createdAt,
    editedAt: typeof m.editedAt === 'string' ? m.editedAt : undefined,
    parentId: typeof m.parentId === 'string' ? m.parentId : undefined,
    replyCount: typeof m.replyCount === 'number' ? m.replyCount : 0,
    lastReplyAt: typeof m.lastReplyAt === 'string' ? m.lastReplyAt : undefined,
    reactions: (m.reactions && typeof m.reactions === 'object' ? m.reactions : {}) as Reactions,
    mentions: Array.isArray(m.mentions) ? m.mentions : [],
  }));
  // replyCount を実カウントに整える
  for (const parent of messages.filter((m) => !m.parentId)) {
    const replies = messages.filter((m) => m.parentId === parent.id);
    parent.replyCount = replies.length;
    if (replies.length > 0) {
      parent.lastReplyAt = replies
        .map((r) => r.createdAt)
        .sort()
        .at(-1);
    }
  }
  return { users, channels, messages };
}

function saveDb(): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const db = loadDb();
saveDb();

// ===== WebSocket clients with auth =====
const clients = new Map<WebSocket, string | undefined>();

function broadcast(event: unknown, options?: { only?: string[] }): void {
  const data = JSON.stringify(event);
  for (const [ws, uid] of clients) {
    if (options?.only) {
      if (!uid || !options.only.includes(uid)) continue;
    }
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}
function recipientsOf(channel: Channel): string[] | undefined {
  return channel.kind === 'dm' ? channel.members : undefined;
}

// ===== Express =====
const app = express();
app.use(cors());
app.use(express.json());

// ----- Auth -----
app.post('/api/auth/login', (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  let user = db.users.find((u) => u.name === name);
  let created = false;
  if (!user) {
    user = { id: randomUUID(), name, avatar: randomAvatar() };
    db.users.push(user);
    saveDb();
    created = true;
  }
  if (created) broadcast({ type: 'user.updated', payload: user });
  res.json({ user });
});

// ----- Users -----
app.get('/api/users', (_req: Request, res: Response) => {
  res.json({ users: db.users });
});

app.put('/api/users/:id', (req: Request, res: Response) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const avatar = typeof req.body?.avatar === 'string' && req.body.avatar.trim() ? req.body.avatar.trim() : null;
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null;
  if (avatar) user.avatar = avatar;
  if (name) user.name = name;
  saveDb();
  broadcast({ type: 'user.updated', payload: user });
  res.json({ user });
});

// ----- Channels -----
app.get('/api/channels', (req: Request, res: Response) => {
  const userId = typeof req.query?.userId === 'string' ? req.query.userId : '';
  const result = db.channels.filter((c) => {
    if (c.kind === 'public') return true;
    if (!userId) return false;
    return c.members?.includes(userId) ?? false;
  });
  res.json({ channels: result });
});

app.post('/api/channels', (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (db.channels.some((c) => c.kind === 'public' && c.name === name)) {
    return res.status(409).json({ error: 'channel already exists' });
  }
  const channel: Channel = {
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    kind: 'public',
  };
  db.channels.push(channel);
  saveDb();
  broadcast({ type: 'channel.created', payload: channel });
  res.status(201).json({ channel });
});

// ----- DM -----
app.post('/api/dms', (req: Request, res: Response) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const otherUserId = typeof req.body?.otherUserId === 'string' ? req.body.otherUserId : '';
  if (!userId || !otherUserId) return res.status(400).json({ error: 'userId and otherUserId are required' });
  if (userId === otherUserId) return res.status(400).json({ error: 'cannot DM yourself' });
  const me = db.users.find((u) => u.id === userId);
  const other = db.users.find((u) => u.id === otherUserId);
  if (!me || !other) return res.status(404).json({ error: 'user not found' });

  const members = [userId, otherUserId].sort();
  const existing = db.channels.find(
    (c) =>
      c.kind === 'dm' &&
      c.members &&
      c.members.length === 2 &&
      c.members[0] === members[0] &&
      c.members[1] === members[1],
  );
  if (existing) return res.json({ channel: existing, created: false });

  const channel: Channel = {
    id: randomUUID(),
    name: `dm:${members[0]}:${members[1]}`,
    createdAt: new Date().toISOString(),
    kind: 'dm',
    members,
  };
  db.channels.push(channel);
  saveDb();
  broadcast({ type: 'channel.created', payload: channel }, { only: members });
  res.status(201).json({ channel, created: true });
});

// ----- Messages: list top-level only -----
app.get('/api/channels/:id/messages', (req: Request, res: Response) => {
  const channel = db.channels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  const messages = db.messages.filter((m) => m.channelId === channel.id && !m.parentId);
  res.json({ messages });
});

// ----- Replies in a thread -----
app.get('/api/messages/:id/replies', (req: Request, res: Response) => {
  const parent = db.messages.find((m) => m.id === req.params.id);
  if (!parent) return res.status(404).json({ error: 'message not found' });
  const replies = db.messages
    .filter((m) => m.parentId === parent.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ parent, replies });
});

// ----- Create a message (top-level OR reply) -----
app.post('/api/channels/:id/messages', (req: Request, res: Response) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : undefined;
  if (!userId || !body) return res.status(400).json({ error: 'userId and body are required' });
  const user = db.users.find((u) => u.id === userId);
  if (!user) return res.status(401).json({ error: 'unknown user' });
  const channel = db.channels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  if (channel.kind === 'dm' && !channel.members?.includes(userId)) {
    return res.status(403).json({ error: 'not a member of this DM' });
  }

  let parent: Message | undefined;
  if (parentId) {
    parent = db.messages.find((m) => m.id === parentId);
    if (!parent) return res.status(404).json({ error: 'parent message not found' });
    if (parent.channelId !== channel.id) return res.status(400).json({ error: 'parent is in another channel' });
    if (parent.parentId) return res.status(400).json({ error: 'cannot reply to a reply' });
  }

  const message: Message = {
    id: randomUUID(),
    channelId: channel.id,
    userId: user.id,
    userName: user.name,
    body,
    createdAt: new Date().toISOString(),
    parentId,
    replyCount: 0,
    reactions: {},
    mentions: extractMentions(body, db.users),
  };
  db.messages.push(message);

  const recipients = recipientsOf(channel);
  const broadcastOptions = recipients ? { only: recipients } : undefined;

  // 親があれば replyCount を更新して通知
  if (parent) {
    parent.replyCount += 1;
    parent.lastReplyAt = message.createdAt;
    broadcast({ type: 'message.updated', payload: parent }, broadcastOptions);
  }

  saveDb();
  broadcast({ type: 'message.created', payload: message }, broadcastOptions);
  res.status(201).json({ message });
});

// ----- Edit a message (author only) -----
app.patch('/api/messages/:id', (req: Request, res: Response) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!userId || !body) return res.status(400).json({ error: 'userId and body are required' });
  const message = db.messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'message not found' });
  if (message.userId !== userId) return res.status(403).json({ error: 'only the author can edit' });
  const channel = db.channels.find((c) => c.id === message.channelId);
  if (!channel) return res.status(404).json({ error: 'channel not found' });

  message.body = body;
  message.editedAt = new Date().toISOString();
  message.mentions = extractMentions(body, db.users);
  saveDb();
  broadcast(
    { type: 'message.updated', payload: message },
    recipientsOf(channel) ? { only: recipientsOf(channel)! } : undefined,
  );
  res.json({ message });
});

// ----- Delete a message (author only) — cascade delete replies -----
app.delete('/api/messages/:id', (req: Request, res: Response) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const message = db.messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'message not found' });
  if (message.userId !== userId) return res.status(403).json({ error: 'only the author can delete' });
  const channel = db.channels.find((c) => c.id === message.channelId);
  if (!channel) return res.status(404).json({ error: 'channel not found' });

  const recipients = recipientsOf(channel);
  const broadcastOptions = recipients ? { only: recipients } : undefined;

  if (!message.parentId) {
    // 親を消す: 返信も全部消す
    const replyIds = db.messages.filter((m) => m.parentId === message.id).map((m) => m.id);
    db.messages = db.messages.filter((m) => m.id !== message.id && m.parentId !== message.id);
    for (const rid of replyIds) {
      broadcast(
        { type: 'message.deleted', payload: { id: rid, channelId: channel.id, parentId: message.id } },
        broadcastOptions,
      );
    }
    broadcast(
      { type: 'message.deleted', payload: { id: message.id, channelId: channel.id } },
      broadcastOptions,
    );
  } else {
    // 返信を消す: 親の replyCount をデクリメント
    const parent = db.messages.find((m) => m.id === message.parentId);
    db.messages = db.messages.filter((m) => m.id !== message.id);
    if (parent) {
      parent.replyCount = Math.max(0, parent.replyCount - 1);
      const stillReplies = db.messages
        .filter((m) => m.parentId === parent.id)
        .map((m) => m.createdAt)
        .sort();
      parent.lastReplyAt = stillReplies.at(-1);
      broadcast({ type: 'message.updated', payload: parent }, broadcastOptions);
    }
    broadcast(
      {
        type: 'message.deleted',
        payload: { id: message.id, channelId: channel.id, parentId: message.parentId },
      },
      broadcastOptions,
    );
  }

  saveDb();
  res.status(204).end();
});

// ----- Reactions -----
app.post('/api/messages/:id/reactions/toggle', (req: Request, res: Response) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';
  if (!userId || !emoji) return res.status(400).json({ error: 'userId and emoji are required' });
  const user = db.users.find((u) => u.id === userId);
  if (!user) return res.status(401).json({ error: 'unknown user' });
  const message = db.messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'message not found' });
  const channel = db.channels.find((c) => c.id === message.channelId);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  if (channel.kind === 'dm' && !channel.members?.includes(userId)) {
    return res.status(403).json({ error: 'not a member of this DM' });
  }

  const users = message.reactions[emoji] ?? [];
  const idx = users.indexOf(userId);
  if (idx >= 0) {
    users.splice(idx, 1);
    if (users.length === 0) delete message.reactions[emoji];
    else message.reactions[emoji] = users;
  } else {
    users.push(userId);
    message.reactions[emoji] = users;
  }
  saveDb();
  broadcast(
    { type: 'message.updated', payload: message },
    recipientsOf(channel) ? { only: recipientsOf(channel)! } : undefined,
  );
  res.json({ message });
});

// ===== Static (prod build) =====
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^\/(?!api|ws).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
  console.log(`[backend] serving frontend build from ${FRONTEND_DIST}`);
} else {
  console.log(`[backend] no frontend build at ${FRONTEND_DIST} (use Vite dev server on 5173)`);
}

// ===== WebSocket =====
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  clients.set(ws, undefined);
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m?.type === 'auth' && typeof m.userId === 'string') {
        const exists = db.users.some((u) => u.id === m.userId);
        if (exists) clients.set(ws, m.userId);
      }
    } catch { /* ignore malformed */ }
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
});
