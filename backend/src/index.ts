import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ===== Response shapes (must stay identical to what frontend expects) =====
interface User {
  id: string;
  name: string;
  avatar: string;
  email?: string;
  isAdmin: boolean;
}
type Reactions = Record<string, string[]>;
interface Channel {
  id: string;
  name: string;
  createdAt: string;
  kind: 'public' | 'private' | 'dm';
  members?: string[];
}
interface Stamp {
  id: string;
  userId: string;
  name: string;
  text: string;
  color: string;
  font: string;
  createdAt: string;
}

interface StampSnapshot {
  name: string;
  text: string;
  color: string;
  font: string;
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
  imageUrl?: string;
  stamp?: StampSnapshot;
}

// ===== DB row shapes =====
interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar: string;
  is_admin: boolean;
  created_at: string;
}
interface ChannelRow {
  id: string;
  name: string;
  kind: 'public' | 'private' | 'dm';
  members: string[] | null;
  created_at: string;
}
interface MessageRow {
  id: string;
  channel_id: string;
  user_id: string;
  user_name: string;
  body: string;
  parent_id: string | null;
  reactions: Reactions | null;
  mentions: string[] | null;
  edited_at: string | null;
  created_at: string;
  image_url: string | null;
  stamp: StampSnapshot | null;
}

interface StampRow {
  id: string;
  user_id: string;
  name: string;
  text: string;
  color: string;
  font: string;
  created_at: string;
}

function userOf(r: UserRow): User {
  return {
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    email: r.email,
    isAdmin: !!r.is_admin,
  };
}
function channelOf(r: ChannelRow): Channel {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    members: r.members ?? undefined,
    createdAt: r.created_at,
  };
}
function messageOf(r: MessageRow, replyCount = 0, lastReplyAt?: string): Message {
  return {
    id: r.id,
    channelId: r.channel_id,
    userId: r.user_id,
    userName: r.user_name,
    body: r.body,
    createdAt: r.created_at,
    editedAt: r.edited_at ?? undefined,
    parentId: r.parent_id ?? undefined,
    replyCount,
    lastReplyAt,
    reactions: r.reactions ?? {},
    mentions: r.mentions ?? [],
    imageUrl: r.image_url ?? undefined,
    stamp: r.stamp ?? undefined,
  };
}

function stampOf(r: StampRow): Stamp {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    text: r.text,
    color: r.color,
    font: r.font,
    createdAt: r.created_at,
  };
}

// ===== Supabase client =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[backend] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — check backend/.env',
  );
  process.exit(1);
}
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ===== Avatars =====
const AVATAR_POOL = [
  '🧑', '👩', '👨', '🧔', '👶', '👵', '👴',
  '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐸',
  '🦄', '🐙', '🦉', '🐧', '🐢', '🦖', '🐳',
  '🍎', '🍌', '🍣', '🍕', '🍩', '☕', '🌸',
];
function randomAvatar(): string {
  return AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
}

// ===== Mentions extraction (greedy on user names) =====
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

async function getAllUsers(): Promise<User[]> {
  const { data, error } = await supabase.from('users').select('*');
  if (error) throw error;
  return (data as UserRow[]).map(userOf);
}

// ===== Helpers: fetch + access control =====
async function getChannel(id: string): Promise<Channel | null> {
  const { data } = await supabase.from('channels').select('*').eq('id', id).maybeSingle();
  return data ? channelOf(data as ChannelRow) : null;
}
async function getUser(id: string): Promise<User | null> {
  const { data } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  return data ? userOf(data as UserRow) : null;
}
function canAccess(channel: Channel, userId: string | undefined): boolean {
  if (channel.kind === 'public') return true;
  if (!userId) return false;
  return channel.members?.includes(userId) ?? false;
}
function recipientsOf(channel: Channel): string[] | undefined {
  return channel.kind === 'public' ? undefined : channel.members;
}

// 親メッセージ群に対して replyCount / lastReplyAt を一括で付与する
async function attachReplyCounts(messages: Message[]): Promise<Message[]> {
  const parentIds = messages.filter((m) => !m.parentId).map((m) => m.id);
  if (parentIds.length === 0) return messages;
  const { data, error } = await supabase
    .from('messages')
    .select('parent_id, created_at')
    .in('parent_id', parentIds);
  if (error) throw error;
  type Row = { parent_id: string; created_at: string };
  const map = new Map<string, { count: number; last: string }>();
  for (const r of (data ?? []) as Row[]) {
    const cur = map.get(r.parent_id) ?? { count: 0, last: '' };
    cur.count++;
    if (r.created_at > cur.last) cur.last = r.created_at;
    map.set(r.parent_id, cur);
  }
  return messages.map((m) => {
    const c = map.get(m.id);
    return c ? { ...m, replyCount: c.count, lastReplyAt: c.last } : m;
  });
}

// ===== WebSocket clients (in-memory) =====
const clients = new Map<WebSocket, string | undefined>();
// userId -> Set<WebSocket>。複数タブ・別ブラウザで同一ユーザーが繋いだケースを取りこぼさない
const userConnections = new Map<string, Set<WebSocket>>();

function broadcast(event: unknown, options?: { only?: string[] }): void {
  const data = JSON.stringify(event);
  for (const [ws, uid] of clients) {
    if (options?.only) {
      if (!uid || !options.only.includes(uid)) continue;
    }
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastPresence(): void {
  const onlineUserIds = [...userConnections.keys()];
  broadcast({ type: 'presence.updated', payload: { onlineUserIds } });
}

function attachConnection(ws: WebSocket, userId: string): void {
  const set = userConnections.get(userId) ?? new Set<WebSocket>();
  set.add(ws);
  userConnections.set(userId, set);
}

function detachConnection(ws: WebSocket): boolean {
  const uid = clients.get(ws);
  if (!uid) return false;
  const set = userConnections.get(uid);
  if (!set) return false;
  set.delete(ws);
  if (set.size === 0) {
    userConnections.delete(uid);
    return true; // ユーザーがオフラインに変わった
  }
  userConnections.set(uid, set);
  return false;
}

// ===== Express =====
const app = express();
app.use(cors());
app.use(express.json());

// 共通エラーラッパ
// Supabase 由来の PostgrestError は Error インスタンスではなく `{message, code, hint}` の
// オブジェクトなので、それも拾って human-readable に整形して返す。
function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('[error]', err);
      let msg = 'internal error';
      let code: string | undefined;
      if (err instanceof Error) {
        msg = err.message;
      } else if (err && typeof err === 'object') {
        const e = err as { message?: string; code?: string; hint?: string };
        if (e.message) msg = e.message;
        if (e.code) code = e.code;
        if (e.hint) msg += ` (${e.hint})`;
      }
      // 既知の DB セットアップ漏れを分かりやすく
      if (
        code === 'PGRST205' || // table not in schema cache
        code === '42P01' ||    // relation does not exist
        code === '42703'       // column does not exist
      ) {
        msg = `${msg} — backend/migrations の SQL を Supabase Studio で適用してください`;
      }
      if (!res.headersSent) res.status(500).json({ error: msg, code });
    }
  };
}

// ----- Auth: signup (email + password + display name) -----
app.post('/api/auth/signup', wrap(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password and name are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }
  // service_role の admin API で auth.users を作成。メール確認はスキップ。
  // user_metadata に渡した name / avatar はトリガーで public.users にコピーされる。
  const avatar = randomAvatar();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, avatar },
  });
  if (error || !data.user) {
    const msg = error?.message ?? 'failed to create user';
    if (/already.*registered|exists|duplicate/i.test(msg)) {
      return res.status(409).json({ error: 'email already registered' });
    }
    return res.status(400).json({ error: msg });
  }

  // トリガーで作られた public.users 行を取得
  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile) return res.status(500).json({ error: 'user profile missing' });
  const u = userOf(profile as UserRow);
  broadcast({ type: 'user.updated', payload: u });
  res.status(201).json({ user: u });
}));

// ----- Auth: login (email + password) -----
app.post('/api/auth/login', wrap(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile) return res.status(404).json({ error: 'user profile not found' });
  res.json({ user: userOf(profile as UserRow) });
}));

// ----- Users -----
app.get('/api/users', wrap(async (_req, res) => {
  const users = await getAllUsers();
  res.json({ users });
}));

// 管理者が他ユーザーの is_admin を切替
app.patch('/api/users/:id/admin', wrap(async (req, res) => {
  const requesterId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const isAdmin = !!req.body?.isAdmin;
  if (!requesterId) return res.status(400).json({ error: 'userId is required' });
  const requester = await getUser(requesterId);
  if (!requester) return res.status(401).json({ error: 'unknown user' });
  if (!requester.isAdmin) return res.status(403).json({ error: 'admin only' });
  const targetId = req.params.id;
  if (targetId === requesterId && !isAdmin) {
    return res.status(400).json({ error: 'cannot demote yourself' });
  }
  const { data, error } = await supabase
    .from('users')
    .update({ is_admin: isAdmin })
    .eq('id', targetId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'user not found' });
  const u = userOf(data as UserRow);
  broadcast({ type: 'user.updated', payload: u });
  res.json({ user: u });
}));

app.put('/api/users/:id', wrap(async (req, res) => {
  const patch: { name?: string; avatar?: string } = {};
  if (typeof req.body?.avatar === 'string' && req.body.avatar.trim()) {
    patch.avatar = req.body.avatar.trim();
  }
  if (typeof req.body?.name === 'string' && req.body.name.trim()) {
    patch.name = req.body.name.trim();
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'nothing to update' });
  }
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'user not found' });
  const u = userOf(data as UserRow);
  broadcast({ type: 'user.updated', payload: u });
  res.json({ user: u });
}));

// ----- Channels -----
app.get('/api/channels', wrap(async (req, res) => {
  const userId = typeof req.query?.userId === 'string' ? req.query.userId : '';
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const all = (data as ChannelRow[]).map(channelOf);
  const result = all.filter((c) => {
    if (c.kind === 'public') return true;
    if (!userId) return false;
    return c.members?.includes(userId) ?? false;
  });
  res.json({ channels: result });
}));

app.post('/api/channels', wrap(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const kind: 'public' | 'private' = req.body?.kind === 'private' ? 'private' : 'public';
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const memberIdsRaw: unknown = req.body?.memberIds;
  const memberIds = Array.isArray(memberIdsRaw)
    ? memberIdsRaw.filter((id): id is string => typeof id === 'string')
    : [];

  if (!name) return res.status(400).json({ error: 'name is required' });

  // チャンネル作成は管理者のみ
  if (!userId) return res.status(401).json({ error: 'userId is required' });
  const creator = await getUser(userId);
  if (!creator) return res.status(401).json({ error: 'unknown user' });
  if (!creator.isAdmin) {
    return res.status(403).json({ error: 'admin only: 管理者のみチャンネルを作成できます' });
  }

  if (kind === 'public') {
    const { data: dup } = await supabase
      .from('channels')
      .select('id')
      .eq('kind', 'public')
      .eq('name', name)
      .maybeSingle();
    if (dup) return res.status(409).json({ error: 'channel already exists' });
  }

  let members: string[] | undefined;
  if (kind === 'private') {
    if (memberIds.length > 0) {
      const { data: vinvs } = await supabase
        .from('users')
        .select('id')
        .in('id', memberIds);
      const validIds = new Set((vinvs ?? []).map((r: { id: string }) => r.id));
      const invitees = [...validIds].filter((id) => id !== userId);
      members = [userId, ...invitees];
    } else {
      members = [userId];
    }
  }

  const newId = randomUUID();
  const { data: created, error } = await supabase
    .from('channels')
    .insert({ id: newId, name, kind, members: members ?? null })
    .select()
    .single();
  if (error) throw error;
  const ch = channelOf(created as ChannelRow);
  const opts = kind === 'private' ? { only: members! } : undefined;
  broadcast({ type: 'channel.created', payload: ch }, opts);
  res.status(201).json({ channel: ch });
}));

// プライベートチャンネルへの招待
app.post('/api/channels/:id/members', wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const inviteeIdsRaw: unknown = req.body?.inviteeIds;
  const inviteeIds = Array.isArray(inviteeIdsRaw)
    ? inviteeIdsRaw.filter((id): id is string => typeof id === 'string')
    : [];
  if (!userId || inviteeIds.length === 0) {
    return res.status(400).json({ error: 'userId and inviteeIds are required' });
  }
  const channel = await getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  if (channel.kind !== 'private') {
    return res.status(400).json({ error: 'only private channels can be invited to' });
  }
  if (!channel.members?.includes(userId)) {
    return res.status(403).json({ error: 'not a member of this channel' });
  }

  const existing = new Set(channel.members);
  const { data: vinvs } = await supabase
    .from('users')
    .select('id')
    .in('id', inviteeIds);
  const validIds = (vinvs ?? []).map((r: { id: string }) => r.id);
  const toAdd = validIds.filter((id: string) => !existing.has(id));
  if (toAdd.length === 0) return res.status(400).json({ error: 'no valid invitees' });

  const nextMembers = [...channel.members, ...toAdd];
  const { data: updated, error } = await supabase
    .from('channels')
    .update({ members: nextMembers })
    .eq('id', channel.id)
    .select()
    .single();
  if (error) throw error;
  const ch = channelOf(updated as ChannelRow);

  const previousMembers = [...existing];
  broadcast({ type: 'channel.updated', payload: ch }, { only: previousMembers });
  broadcast({ type: 'channel.created', payload: ch }, { only: toAdd });
  res.json({ channel: ch });
}));

// ----- DM -----
app.post('/api/dms', wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const otherUserId = typeof req.body?.otherUserId === 'string' ? req.body.otherUserId : '';
  if (!userId || !otherUserId) {
    return res.status(400).json({ error: 'userId and otherUserId are required' });
  }
  if (userId === otherUserId) return res.status(400).json({ error: 'cannot DM yourself' });
  const { data: usrs } = await supabase
    .from('users')
    .select('id')
    .in('id', [userId, otherUserId]);
  if (!usrs || usrs.length !== 2) return res.status(404).json({ error: 'user not found' });

  const members = [userId, otherUserId].sort();
  const { data: dms } = await supabase.from('channels').select('*').eq('kind', 'dm');
  const existing = (dms as ChannelRow[] | null ?? []).find((c) => {
    const m = (c.members ?? []).slice().sort();
    return m.length === 2 && m[0] === members[0] && m[1] === members[1];
  });
  if (existing) return res.json({ channel: channelOf(existing), created: false });

  const newId = randomUUID();
  const { data: created, error } = await supabase
    .from('channels')
    .insert({
      id: newId,
      name: `dm:${members[0]}:${members[1]}`,
      kind: 'dm',
      members,
    })
    .select()
    .single();
  if (error) throw error;
  const ch = channelOf(created as ChannelRow);
  broadcast({ type: 'channel.created', payload: ch }, { only: members });
  res.status(201).json({ channel: ch, created: true });
}));

// ----- Messages: list top-level -----
app.get('/api/channels/:id/messages', wrap(async (req, res) => {
  const userId = typeof req.query?.userId === 'string' ? req.query.userId : '';
  const channel = await getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  if (!canAccess(channel, userId)) return res.status(403).json({ error: 'forbidden' });
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('channel_id', channel.id)
    .is('parent_id', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const base = (data as MessageRow[]).map((r) => messageOf(r));
  const withCounts = await attachReplyCounts(base);
  res.json({ messages: withCounts });
}));

// ----- Replies -----
app.get('/api/messages/:id/replies', wrap(async (req, res) => {
  const userId = typeof req.query?.userId === 'string' ? req.query.userId : '';
  const { data: parentRow } = await supabase
    .from('messages')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!parentRow) return res.status(404).json({ error: 'message not found' });
  const p = parentRow as MessageRow;
  const channel = await getChannel(p.channel_id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  if (!canAccess(channel, userId)) return res.status(403).json({ error: 'forbidden' });
  const { data: rs, error } = await supabase
    .from('messages')
    .select('*')
    .eq('parent_id', p.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const replies = (rs as MessageRow[]).map((r) => messageOf(r));
  const replyCount = replies.length;
  const lastReplyAt = replyCount ? replies[replyCount - 1].createdAt : undefined;
  res.json({
    parent: { ...messageOf(p), replyCount, lastReplyAt },
    replies,
  });
}));

// ----- Stamps (個人ライブラリ) -----
const ALLOWED_FONTS = new Set(['sans', 'serif', 'mono', 'rounded', 'mincho', 'pop']);

// ワークスペース全員が見られる。userId フィルタなし。
app.get('/api/stamps', wrap(async (_req, res) => {
  const { data, error } = await supabase
    .from('stamps')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  res.json({ stamps: (data as StampRow[]).map(stampOf) });
}));

app.post('/api/stamps', wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const color = typeof req.body?.color === 'string' ? req.body.color.trim() : '#111111';
  const font = typeof req.body?.font === 'string' ? req.body.font : 'sans';
  if (!userId || !name || !text) {
    return res.status(400).json({ error: 'userId, name, text are required' });
  }
  if (name.length > 30 || text.length > 60) {
    return res.status(400).json({ error: 'name <= 30 chars, text <= 60 chars' });
  }
  if (!ALLOWED_FONTS.has(font)) {
    return res.status(400).json({ error: 'invalid font' });
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ error: 'color must be hex like #ff8ac8' });
  }
  const user = await getUser(userId);
  if (!user) return res.status(401).json({ error: 'unknown user' });
  const { data, error } = await supabase
    .from('stamps')
    .insert({ user_id: userId, name, text, color, font })
    .select()
    .single();
  if (error) throw error;
  res.status(201).json({ stamp: stampOf(data as StampRow) });
}));

app.delete('/api/stamps/:id', wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const { data: existing } = await supabase
    .from('stamps')
    .select('user_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'stamp not found' });
  if ((existing as { user_id: string }).user_id !== userId) {
    return res.status(403).json({ error: 'only the owner can delete' });
  }
  const { error } = await supabase.from('stamps').delete().eq('id', req.params.id);
  if (error) throw error;
  res.status(204).end();
}));

// ----- Image upload -----
const STORAGE_BUCKET = 'chat-attachments';
const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('only PNG/JPEG/GIF/WebP are allowed'));
  },
});

app.post('/api/uploads', upload.single('file'), wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const user = await getUser(userId);
  if (!user) return res.status(401).json({ error: 'unknown user' });
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: 'no file uploaded' });
  const ext = (file.mimetype.split('/')[1] ?? 'bin').toLowerCase();
  const objectPath = `${userId}/${Date.now()}-${randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      cacheControl: '3600',
      upsert: false,
    });
  if (upErr) return res.status(500).json({ error: upErr.message });
  const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  res.status(201).json({ url: pub.publicUrl });
}));

// multer / fileFilter エラーを JSON で返す
app.use((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
  if (!err) return next();
  const msg = err instanceof Error ? err.message : 'upload failed';
  if (!res.headersSent) res.status(400).json({ error: msg });
});

// ----- Create a message (top-level OR reply) -----
app.post('/api/channels/:id/messages', wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : undefined;
  const imageUrl =
    typeof req.body?.imageUrl === 'string' && req.body.imageUrl.trim()
      ? req.body.imageUrl.trim()
      : null;
  // スタンプ snapshot: { name, text, color, font }
  let stamp: StampSnapshot | null = null;
  const rawStamp = req.body?.stamp;
  if (rawStamp && typeof rawStamp === 'object') {
    const s = rawStamp as Partial<StampSnapshot>;
    if (
      typeof s.name === 'string' &&
      typeof s.text === 'string' &&
      typeof s.color === 'string' &&
      typeof s.font === 'string' &&
      s.text.length > 0
    ) {
      stamp = {
        name: s.name.slice(0, 30),
        text: s.text.slice(0, 60),
        color: /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#111111',
        font: ALLOWED_FONTS.has(s.font) ? s.font : 'sans',
      };
    }
  }
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!body && !imageUrl && !stamp) {
    return res.status(400).json({ error: 'body, imageUrl or stamp is required' });
  }
  const user = await getUser(userId);
  if (!user) return res.status(401).json({ error: 'unknown user' });
  const channel = await getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  if (!canAccess(channel, userId)) {
    return res.status(403).json({ error: 'not a member of this channel' });
  }

  let parent: MessageRow | undefined;
  if (parentId) {
    const { data: pRow } = await supabase
      .from('messages')
      .select('*')
      .eq('id', parentId)
      .maybeSingle();
    if (!pRow) return res.status(404).json({ error: 'parent message not found' });
    const p = pRow as MessageRow;
    if (p.channel_id !== channel.id) {
      return res.status(400).json({ error: 'parent is in another channel' });
    }
    if (p.parent_id) return res.status(400).json({ error: 'cannot reply to a reply' });
    parent = p;
  }

  const users = await getAllUsers();
  const mentions = extractMentions(body, users);
  const { data: inserted, error } = await supabase
    .from('messages')
    .insert({
      channel_id: channel.id,
      user_id: user.id,
      user_name: user.name,
      body,
      parent_id: parentId ?? null,
      reactions: {},
      mentions,
      image_url: imageUrl,
      stamp,
    })
    .select()
    .single();
  if (error) throw error;
  const message = messageOf(inserted as MessageRow);

  const recipients = recipientsOf(channel);
  const broadcastOptions = recipients ? { only: recipients } : undefined;

  if (parent) {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parent.id);
    const updatedParent: Message = {
      ...messageOf(parent),
      replyCount: count ?? 0,
      lastReplyAt: message.createdAt,
    };
    broadcast({ type: 'message.updated', payload: updatedParent }, broadcastOptions);
  }

  broadcast({ type: 'message.created', payload: message }, broadcastOptions);
  res.status(201).json({ message });
}));

// ----- Edit message (author only) -----
app.patch('/api/messages/:id', wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!userId || !body) return res.status(400).json({ error: 'userId and body are required' });
  const { data: mRow } = await supabase
    .from('messages')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!mRow) return res.status(404).json({ error: 'message not found' });
  const m = mRow as MessageRow;
  if (m.user_id !== userId) return res.status(403).json({ error: 'only the author can edit' });
  const channel = await getChannel(m.channel_id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });

  const users = await getAllUsers();
  const { data: updRow, error } = await supabase
    .from('messages')
    .update({
      body,
      mentions: extractMentions(body, users),
      edited_at: new Date().toISOString(),
    })
    .eq('id', m.id)
    .select()
    .single();
  if (error) throw error;
  const updated = messageOf(updRow as MessageRow);
  broadcast(
    { type: 'message.updated', payload: updated },
    recipientsOf(channel) ? { only: recipientsOf(channel)! } : undefined,
  );
  res.json({ message: updated });
}));

// ----- Delete message (author only) -----
app.delete('/api/messages/:id', wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const { data: mRow } = await supabase
    .from('messages')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!mRow) return res.status(404).json({ error: 'message not found' });
  const m = mRow as MessageRow;
  if (m.user_id !== userId) return res.status(403).json({ error: 'only the author can delete' });
  const channel = await getChannel(m.channel_id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });

  const recipients = recipientsOf(channel);
  const broadcastOptions = recipients ? { only: recipients } : undefined;

  if (!m.parent_id) {
    // 親メッセージ削除: 返信も Postgres 側の cascade で同時削除されるが、
    // クライアントに正確に通知するため事前に id を取得しておく
    const { data: replyRows } = await supabase
      .from('messages')
      .select('id')
      .eq('parent_id', m.id);
    const replyIds = (replyRows ?? []).map((r: { id: string }) => r.id);
    const { error } = await supabase.from('messages').delete().eq('id', m.id);
    if (error) throw error;
    for (const rid of replyIds) {
      broadcast(
        { type: 'message.deleted', payload: { id: rid, channelId: channel.id, parentId: m.id } },
        broadcastOptions,
      );
    }
    broadcast(
      { type: 'message.deleted', payload: { id: m.id, channelId: channel.id } },
      broadcastOptions,
    );
  } else {
    const parentId = m.parent_id;
    const { error } = await supabase.from('messages').delete().eq('id', m.id);
    if (error) throw error;
    const { data: parentRow } = await supabase
      .from('messages')
      .select('*')
      .eq('id', parentId)
      .maybeSingle();
    if (parentRow) {
      const parent = messageOf(parentRow as MessageRow);
      const { data: remaining } = await supabase
        .from('messages')
        .select('created_at')
        .eq('parent_id', parentId)
        .order('created_at', { ascending: true });
      const arr = (remaining ?? []) as { created_at: string }[];
      const updated: Message = {
        ...parent,
        replyCount: arr.length,
        lastReplyAt: arr.length ? arr[arr.length - 1].created_at : undefined,
      };
      broadcast({ type: 'message.updated', payload: updated }, broadcastOptions);
    }
    broadcast(
      {
        type: 'message.deleted',
        payload: { id: m.id, channelId: channel.id, parentId },
      },
      broadcastOptions,
    );
  }
  res.status(204).end();
}));

// ----- Reactions -----
app.post('/api/messages/:id/reactions/toggle', wrap(async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';
  const stampId = typeof req.body?.stampId === 'string' ? req.body.stampId : '';
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!emoji && !stampId) {
    return res.status(400).json({ error: 'emoji or stampId is required' });
  }
  const user = await getUser(userId);
  if (!user) return res.status(401).json({ error: 'unknown user' });
  const { data: mRow } = await supabase
    .from('messages')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!mRow) return res.status(404).json({ error: 'message not found' });
  const m = mRow as MessageRow;
  const channel = await getChannel(m.channel_id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  if (!canAccess(channel, userId)) {
    return res.status(403).json({ error: 'not a member of this channel' });
  }

  // スタンプの場合はキーに `stamp:<uuid>` を使う。スタンプが存在することを検証。
  let key: string;
  if (stampId) {
    const { data: s } = await supabase
      .from('stamps')
      .select('id')
      .eq('id', stampId)
      .maybeSingle();
    if (!s) return res.status(404).json({ error: 'stamp not found' });
    key = `stamp:${stampId}`;
  } else {
    key = emoji;
  }

  const reactions: Reactions = { ...(m.reactions ?? {}) };
  const users = reactions[key] ?? [];
  const idx = users.indexOf(userId);
  if (idx >= 0) {
    users.splice(idx, 1);
    if (users.length === 0) delete reactions[key];
    else reactions[key] = users;
  } else {
    users.push(userId);
    reactions[key] = users;
  }
  const { data: updRow, error } = await supabase
    .from('messages')
    .update({ reactions })
    .eq('id', m.id)
    .select()
    .single();
  if (error) throw error;
  const updated = messageOf(updRow as MessageRow);
  broadcast(
    { type: 'message.updated', payload: updated },
    recipientsOf(channel) ? { only: recipientsOf(channel)! } : undefined,
  );
  res.json({ message: updated });
}));

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
  // 接続直後に現在のオンラインユーザー一覧をこの相手だけに通知
  ws.send(
    JSON.stringify({
      type: 'presence.updated',
      payload: { onlineUserIds: [...userConnections.keys()] },
    }),
  );

  ws.on('message', async (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m?.type === 'auth' && typeof m.userId === 'string') {
        const { data } = await supabase
          .from('users')
          .select('id')
          .eq('id', m.userId)
          .maybeSingle();
        if (data) {
          // 既に同じ ws を別 userId で認証してたら一旦解除
          const prev = clients.get(ws);
          if (prev && prev !== m.userId) {
            detachConnection(ws);
          }
          clients.set(ws, m.userId);
          const wasOffline = !userConnections.has(m.userId);
          attachConnection(ws, m.userId);
          if (wasOffline) broadcastPresence();
        }
      }
    } catch {
      /* ignore malformed */
    }
  });

  ws.on('close', () => {
    const becameOffline = detachConnection(ws);
    clients.delete(ws);
    if (becameOffline) broadcastPresence();
  });
  ws.on('error', () => {
    const becameOffline = detachConnection(ws);
    clients.delete(ws);
    if (becameOffline) broadcastPresence();
  });
});

const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] using Supabase at ${SUPABASE_URL}`);
});
