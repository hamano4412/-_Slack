import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { api, getWsUrl, setOnUnauthorized } from './api';
import {
  AVATAR_POOL,
  REACTION_QUICK_PICK,
  STAMP_FONTS,
  fontCss,
  type Channel,
  type Message,
  type Stamp,
  type StampSnapshot,
  type User,
  type WsEvent,
} from './types';

const USER_STORAGE_KEY = 'slack-like.user';
const LAST_READ_KEY = (uid: string) => `slack-like.lastRead:${uid}`;
const THEME_STORAGE_KEY = 'slack-like.theme';
const DRAFT_KEY = (userId: string, scope: string) =>
  `slack-like.draft:${userId}:${scope}`;

function loadDraft(userId: string, scope: string): string {
  try {
    return localStorage.getItem(DRAFT_KEY(userId, scope)) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(userId: string, scope: string, text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY(userId, scope), text);
    else localStorage.removeItem(DRAFT_KEY(userId, scope));
  } catch {
    /* private mode / quota — ignore */
  }
}

type ThemeId =
  | 'pink-purple'
  | 'neon-yellow'
  | 'sunset'
  | 'ocean'
  | 'forest'
  | 'lavender'
  | 'cherry'
  | 'violet'
  | 'tropical'
  | 'ember'
  | 'arctic'
  | 'mint'
  | 'peach'
  | 'galaxy';

const THEMES: ReadonlyArray<{ id: ThemeId; label: string; swatch: string }> = [
  { id: 'pink-purple', label: 'ピンク × 紫', swatch: 'linear-gradient(135deg, #ff8ac8 0%, #b388ff 100%)' },
  { id: 'neon-yellow', label: 'ネオンイエロー', swatch: 'linear-gradient(135deg, #DFFF00 0%, #BFE000 100%)' },
  { id: 'sunset',      label: 'サンセット',     swatch: 'linear-gradient(135deg, #ffb86b 0%, #ff6bcb 100%)' },
  { id: 'ocean',       label: 'オーシャン',     swatch: 'linear-gradient(135deg, #6bd5ff 0%, #5b8def 100%)' },
  { id: 'forest',      label: 'フォレスト',     swatch: 'linear-gradient(135deg, #95e07b 0%, #2eb872 100%)' },
  { id: 'lavender',    label: 'ラベンダー',     swatch: 'linear-gradient(135deg, #d6b3ff 0%, #9b6bff 100%)' },
  { id: 'cherry',      label: 'チェリー',       swatch: 'linear-gradient(135deg, #ff7575 0%, #ff3d8c 100%)' },
  { id: 'violet',      label: 'バイオレット',   swatch: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)' },
  { id: 'tropical',    label: 'トロピカル',     swatch: 'linear-gradient(135deg, #6ee7b7 0%, #fde047 100%)' },
  { id: 'ember',       label: 'エンバー',       swatch: 'linear-gradient(135deg, #fb923c 0%, #fbbf24 100%)' },
  { id: 'arctic',      label: 'アークティック', swatch: 'linear-gradient(135deg, #93c5fd 0%, #ddd6fe 100%)' },
  { id: 'mint',        label: 'ミント',         swatch: 'linear-gradient(135deg, #5eead4 0%, #99f6e4 100%)' },
  { id: 'peach',       label: 'ピーチ',         swatch: 'linear-gradient(135deg, #fbcfe8 0%, #fda4af 100%)' },
  { id: 'galaxy',      label: 'ギャラクシー',   swatch: 'linear-gradient(135deg, #c084fc 0%, #f0abfc 100%)' },
];

function loadStoredTheme(): ThemeId {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored && THEMES.some((t) => t.id === stored)) return stored as ThemeId;
  return 'pink-purple';
}

function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function loadLastRead(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_READ_KEY(userId));
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveLastRead(userId: string, data: Record<string, string>): void {
  try {
    localStorage.setItem(LAST_READ_KEY(userId), JSON.stringify(data));
  } catch {
    /* quota / private mode — ignore */
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(loadStoredUser);
  const [theme, setTheme] = useState<ThemeId>(loadStoredTheme);
  const unauthorizedHandled = useRef(false);

  // backend がユーザーを知らない(=401)場合、localStorage を捨ててログイン画面に戻す。
  // 並列リクエストが同時に 401 を返したときに alert / setUser が複数回走らないようガード。
  useEffect(() => {
    setOnUnauthorized(() => {
      if (unauthorizedHandled.current) return;
      unauthorizedHandled.current = true;
      alert('セッションが無効になりました。再度ログインしてください。');
      localStorage.removeItem(USER_STORAGE_KEY);
      setUser(null);
    });
    return () => setOnUnauthorized(null);
  }, []);

  // ログイン画面に戻ったら次回ログインのためにガードを解除
  useEffect(() => {
    if (user) unauthorizedHandled.current = false;
  }, [user]);

  // テーマを <html data-theme="..."> に反映 + localStorage に保存
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  if (!user) {
    return (
      <Login
        onLogin={(u) => {
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
          setUser(u);
        }}
      />
    );
  }

  return (
    <Chat
      user={user}
      theme={theme}
      onThemeChange={setTheme}
      onUserChange={(u) => {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
        setUser(u);
      }}
      onLogout={() => {
        localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
      }}
    />
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';
  const trimmedEmail = email.trim();
  const trimmedName = name.trim();
  const canSubmit =
    !busy &&
    !!trimmedEmail &&
    !!password &&
    (!isSignup || !!trimmedName);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = isSignup
        ? await api.signup(trimmedName, trimmedEmail, password)
        : await api.login(trimmedEmail, password);
      onLogin(user);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // backend が "401 ...: {"error":"..."}" 形式で返すので人間向けに整形
      const m = raw.match(/"error":"([^"]+)"/);
      setError(m ? m[1] : raw);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Slack-like</h1>
        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(null); }}
          >
            ログイン
          </button>
          <button
            type="button"
            className={`login-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(null); }}
          >
            新規登録
          </button>
        </div>

        {isSignup && (
          <label className="login-field">
            <span>表示名</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 山田 太郎"
            />
          </label>
        )}
        <label className="login-field">
          <span>メールアドレス</span>
          <input
            autoFocus={!isSignup}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete={isSignup ? 'email' : 'username'}
          />
        </label>
        <label className="login-field">
          <span>パスワード</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? '6文字以上' : ''}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
          />
        </label>

        <button type="submit" disabled={!canSubmit}>
          {isSignup ? 'アカウント作成' : 'ログイン'}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="login-switch">
          {isSignup ? (
            <>
              すでにアカウントをお持ちですか?{' '}
              <button
                type="button"
                className="login-link"
                onClick={() => { setMode('login'); setError(null); }}
              >
                ログイン
              </button>
            </>
          ) : (
            <>
              はじめての方は{' '}
              <button
                type="button"
                className="login-link"
                onClick={() => { setMode('signup'); setError(null); }}
              >
                新規登録
              </button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}

function Chat({
  user,
  theme,
  onThemeChange,
  onUserChange,
  onLogout,
}: {
  user: User;
  theme: ThemeId;
  onThemeChange: (t: ThemeId) => void;
  onUserChange: (u: User) => void;
  onLogout: () => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showInvitePicker, setShowInvitePicker] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showStampManager, setShowStampManager] = useState(false);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [threadReplies, setThreadReplies] = useState<Message[]>([]);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [unreadMentions, setUnreadMentions] = useState<Record<string, number>>({});
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const lastReadRef = useRef<Record<string, string>>(loadLastRead(user.id));
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  const currentChannelIdRef = useRef<string | null>(currentChannelId);
  useEffect(() => {
    currentChannelIdRef.current = currentChannelId;
  }, [currentChannelId]);
  const openThreadIdRef = useRef<string | null>(openThreadId);
  useEffect(() => {
    openThreadIdRef.current = openThreadId;
  }, [openThreadId]);

  // 初期データ
  useEffect(() => {
    let cancelled = false;
    api.listChannels(user.id).then((r) => {
      if (cancelled) return;
      setChannels(r.channels);
      const firstPublic = r.channels.find((c) => c.kind === 'public');
      if (firstPublic) setCurrentChannelId((cur) => cur ?? firstPublic.id);

      // 各チャンネルの未読件数を初回だけ集計(lastRead が未設定のチャンネルは "既読扱い")
      Promise.all(
        r.channels.map((c) =>
          api
            .listMessages(c.id, user.id)
            .then(({ messages }) => {
              const lr = lastReadRef.current[c.id];
              if (!lr) return [c.id, 0] as const;
              const count = messages.filter(
                (m) => m.userId !== user.id && m.createdAt > lr,
              ).length;
              return [c.id, count] as const;
            })
            .catch(() => [c.id, 0] as const),
        ),
      ).then((pairs) => {
        if (cancelled) return;
        setUnreadByChannel((prev) => {
          const merged: Record<string, number> = { ...prev };
          for (const [id, n] of pairs) {
            // 初期fetch とWSの間の競合に対しては max を採用
            merged[id] = Math.max(merged[id] ?? 0, n);
          }
          return merged;
        });
      });
    });
    api.listUsers().then((r) => {
      if (cancelled) return;
      const map: Record<string, User> = {};
      for (const u of r.users) map[u.id] = u;
      setUsers(map);
    });
    api
      .listStamps()
      .then((r) => {
        if (!cancelled) setStamps(r.stamps);
      })
      .catch(() => { /* stamps table がまだ無いケース等は黙殺 */ });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // チャンネル切替時: 履歴ロード / スレッドを閉じる / 未読クリア + lastRead 保存 + 下書き復元
  useEffect(() => {
    if (!currentChannelId) return;
    api.listMessages(currentChannelId, user.id).then((r) => setMessages(r.messages));
    setOpenThreadId(null);
    setThreadReplies([]);
    setShowInvitePicker(false);
    // 切替先のチャンネル用に保存されている下書きを復元
    setDraft(loadDraft(user.id, `ch:${currentChannelId}`));
    // 既読化: lastRead を更新して永続化
    const now = new Date().toISOString();
    lastReadRef.current = { ...lastReadRef.current, [currentChannelId]: now };
    saveLastRead(user.id, lastReadRef.current);
    setUnreadByChannel((prev) => {
      if (!prev[currentChannelId]) return prev;
      const next = { ...prev };
      delete next[currentChannelId];
      return next;
    });
    setUnreadMentions((prev) => {
      if (!prev[currentChannelId]) return prev;
      const next = { ...prev };
      delete next[currentChannelId];
      return next;
    });
  }, [currentChannelId, user.id]);

  // draft の自動保存(チャンネル単位)
  useEffect(() => {
    if (!currentChannelId) return;
    saveDraft(user.id, `ch:${currentChannelId}`, draft);
  }, [draft, currentChannelId, user.id]);

  // スレッドを開いたら返信をロード
  useEffect(() => {
    if (!openThreadId) {
      setThreadReplies([]);
      return;
    }
    api
      .listReplies(openThreadId, user.id)
      .then((r) => setThreadReplies(r.replies))
      .catch(() => setThreadReplies([]));
  }, [openThreadId, user.id]);

  // WebSocket
  useEffect(() => {
    const ws = new WebSocket(getWsUrl());
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', userId: user.id }));
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as WsEvent;
        if (event.type === 'message.created') {
          const m = event.payload;
          if (m.parentId) {
            // スレッドの返信
            if (m.parentId === openThreadIdRef.current) {
              setThreadReplies((prev) =>
                prev.some((x) => x.id === m.id) ? prev : [...prev, m],
              );
            }
          } else {
            // チャンネルのトップレベル
            if (m.channelId === currentChannelIdRef.current) {
              setMessages((prev) =>
                prev.some((x) => x.id === m.id) ? prev : [...prev, m],
              );
            }
          }
          // 未読集計: 他人の投稿で、いま見ていないチャンネル
          if (m.userId !== user.id && m.channelId !== currentChannelIdRef.current) {
            setUnreadByChannel((prev) => ({
              ...prev,
              [m.channelId]: (prev[m.channelId] ?? 0) + 1,
            }));
            if (m.mentions?.includes(user.id)) {
              setUnreadMentions((prev) => ({
                ...prev,
                [m.channelId]: (prev[m.channelId] ?? 0) + 1,
              }));
            }
          }
        } else if (event.type === 'message.updated') {
          const m = event.payload;
          // 親(あるいは普通のメッセージ)
          setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          // スレッド内
          setThreadReplies((prev) => prev.map((x) => (x.id === m.id ? m : x)));
        } else if (event.type === 'message.deleted') {
          const { id, parentId } = event.payload;
          if (parentId) {
            setThreadReplies((prev) => prev.filter((x) => x.id !== id));
          } else {
            setMessages((prev) => prev.filter((x) => x.id !== id));
            if (openThreadIdRef.current === id) {
              setOpenThreadId(null);
              setThreadReplies([]);
            }
          }
        } else if (event.type === 'channel.created') {
          setChannels((prev) =>
            prev.some((c) => c.id === event.payload.id) ? prev : [...prev, event.payload],
          );
        } else if (event.type === 'channel.updated') {
          setChannels((prev) =>
            prev.some((c) => c.id === event.payload.id)
              ? prev.map((c) => (c.id === event.payload.id ? event.payload : c))
              : [...prev, event.payload],
          );
        } else if (event.type === 'user.updated') {
          setUsers((prev) => ({ ...prev, [event.payload.id]: event.payload }));
          if (event.payload.id === user.id) onUserChange(event.payload);
        } else if (event.type === 'presence.updated') {
          setOnlineUserIds(new Set(event.payload.onlineUserIds));
        }
      } catch {
        /* ignore malformed */
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function createChannel(name: string, kind: 'public' | 'private', memberIds: string[]) {
    try {
      const { channel } = await api.createChannel({
        name,
        kind,
        userId: user.id,
        memberIds: kind === 'private' ? memberIds : undefined,
      });
      setChannels((prev) =>
        prev.some((c) => c.id === channel.id) ? prev : [...prev, channel],
      );
      setShowCreateChannel(false);
      openChannel(channel.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function inviteMembers(channelId: string, inviteeIds: string[]) {
    try {
      const { channel } = await api.inviteToChannel(channelId, user.id, inviteeIds);
      setChannels((prev) =>
        prev.some((c) => c.id === channel.id)
          ? prev.map((c) => (c.id === channel.id ? channel : c))
          : [...prev, channel],
      );
      setShowInvitePicker(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleUserAdmin(targetId: string, nextIsAdmin: boolean) {
    try {
      await api.setUserAdmin(targetId, user.id, nextIsAdmin);
      // user.updated は WS で全員に流れる
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function createStamp(name: string, text: string, color: string, font: string) {
    try {
      const { stamp } = await api.createStamp(user.id, name, text, color, font);
      setStamps((prev) => [stamp, ...prev]);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteStamp(stampId: string) {
    if (!confirm('このスタンプを削除しますか?')) return;
    try {
      await api.deleteStamp(stampId, user.id);
      setStamps((prev) => prev.filter((s) => s.id !== stampId));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleStampReaction(messageId: string, stampId: string) {
    const key = `stamp:${stampId}`;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? toggleReactionLocal(m, user.id, key) : m)),
    );
    setThreadReplies((prev) =>
      prev.map((m) => (m.id === messageId ? toggleReactionLocal(m, user.id, key) : m)),
    );
    try {
      await api.toggleStampReaction(messageId, user.id, stampId);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function startDM(otherUserId: string) {
    setShowDmPicker(false);
    try {
      const { channel } = await api.openDM(user.id, otherUserId);
      setChannels((prev) =>
        prev.some((c) => c.id === channel.id) ? prev : [...prev, channel],
      );
      openChannel(channel.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendDraft(opts?: { imageUrl?: string }) {
    const body = draft.trim();
    if ((!body && !opts?.imageUrl) || !currentChannelId) return;
    setDraft('');
    saveDraft(user.id, `ch:${currentChannelId}`, ''); // 下書きクリア
    try {
      await api.sendMessage(currentChannelId, user.id, body, undefined, opts?.imageUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendReply(
    body: string,
    opts?: { imageUrl?: string; stamp?: StampSnapshot },
  ) {
    const trimmed = body.trim();
    if (
      (!trimmed && !opts?.imageUrl && !opts?.stamp) ||
      !currentChannelId ||
      !openThreadId
    ) {
      return;
    }
    try {
      await api.sendMessage(
        currentChannelId,
        user.id,
        trimmed,
        openThreadId,
        opts?.imageUrl,
        opts?.stamp,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? toggleReactionLocal(m, user.id, emoji) : m)),
    );
    setThreadReplies((prev) =>
      prev.map((m) => (m.id === messageId ? toggleReactionLocal(m, user.id, emoji) : m)),
    );
    try {
      await api.toggleReaction(messageId, user.id, emoji);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function editMessage(messageId: string, body: string) {
    try {
      await api.editMessage(messageId, user.id, body);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteMessage(messageId: string) {
    if (!confirm('このメッセージを削除しますか?(スレッドの場合は返信も全て削除されます)')) return;
    try {
      await api.deleteMessage(messageId, user.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function pickAvatar(avatar: string) {
    setShowAvatarPicker(false);
    try {
      const { user: updated } = await api.updateUser(user.id, { avatar });
      onUserChange(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  const roomChannels = useMemo(
    () => channels.filter((c) => c.kind === 'public' || c.kind === 'private'),
    [channels],
  );
  const dmChannels = useMemo(() => channels.filter((c) => c.kind === 'dm'), [channels]);

  function otherMember(channel: Channel): User | null {
    if (channel.kind !== 'dm' || !channel.members) return null;
    const otherId = channel.members.find((id) => id !== user.id);
    return otherId ? users[otherId] ?? null : null;
  }

  const dmCandidates = useMemo(
    () => Object.values(users).filter((u) => u.id !== user.id),
    [users, user.id],
  );

  const currentChannel = channels.find((c) => c.id === currentChannelId) ?? null;
  const currentOther = currentChannel ? otherMember(currentChannel) : null;
  const openThreadParent = openThreadId ? messages.find((m) => m.id === openThreadId) ?? null : null;

  const inviteCandidates = useMemo(() => {
    if (currentChannel?.kind !== 'private') return [];
    const memberSet = new Set(currentChannel.members ?? []);
    return Object.values(users).filter((u) => !memberSet.has(u.id));
  }, [currentChannel, users]);
  const currentMembers = useMemo(() => {
    if (!currentChannel?.members) return [];
    return currentChannel.members.map((id) => users[id]).filter((u): u is User => !!u);
  }, [currentChannel, users]);

  function openChannel(id: string) {
    setCurrentChannelId(id);
    setMobileView('chat');
  }

  return (
    <div
      className={`layout ${openThreadId ? 'with-thread' : ''} mobile-${mobileView}`}
    >
      <aside className="sidebar">
        <div className="workspace">
          <strong>Slack-like</strong>
          <span className="workspace-actions">
            <button
              className="logout"
              onClick={() => setShowThemePicker((v) => !v)}
              title="テーマカラー"
            >
              🎨
            </button>
            <button
              className="logout"
              onClick={() => setShowSettingsMenu((v) => !v)}
              title="設定"
            >
              ⚙
            </button>
            <button className="logout" onClick={onLogout} title="ログアウト">
              ⎋
            </button>
          </span>
        </div>
        {showSettingsMenu && (
          <div className="settings-menu">
            <button
              className="settings-item"
              onClick={() => {
                setShowStampManager(true);
                setShowSettingsMenu(false);
              }}
            >
              🏷️ スタンプ作成 / 管理
            </button>
            {user.isAdmin && (
              <button
                className="settings-item"
                onClick={() => {
                  setShowAdminPanel(true);
                  setShowSettingsMenu(false);
                }}
              >
                👥 メンバー管理(管理者)
              </button>
            )}
          </div>
        )}
        {showThemePicker && (
          <div className="theme-picker">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-pick ${t.id === theme ? 'current' : ''}`}
                style={{ background: t.swatch }}
                onClick={() => {
                  onThemeChange(t.id);
                  setShowThemePicker(false);
                }}
                title={t.label}
                aria-label={t.label}
              />
            ))}
          </div>
        )}

        <div
          className="me"
          onClick={() => setShowAvatarPicker((v) => !v)}
          title="クリックでアバター変更"
        >
          <span className="me-avatar">{user.avatar}</span>
          <span className="me-name">@{user.name}</span>
          <span className="me-edit">✎</span>
        </div>
        {showAvatarPicker && (
          <div className="avatar-picker">
            {AVATAR_POOL.map((a) => (
              <button
                key={a}
                className={`avatar-pick ${a === user.avatar ? 'current' : ''}`}
                onClick={() => pickAvatar(a)}
                title={a}
              >
                {a}
              </button>
            ))}
          </div>
        )}

        <div className="section-title with-action">
          Channels
          {user.isAdmin && (
            <button
              className="section-action"
              onClick={() => setShowCreateChannel(true)}
              title="新しいチャンネルを作成(管理者)"
            >
              +
            </button>
          )}
        </div>
        <ul className="channels">
          {roomChannels.map((c) => {
            const mentions = unreadMentions[c.id] ?? 0;
            const unread = unreadByChannel[c.id] ?? 0;
            const isActive = c.id === currentChannelId;
            const prefix = c.kind === 'private' ? '🔒' : '#';
            return (
              <li
                key={c.id}
                className={[
                  isActive ? 'active' : '',
                  unread > 0 && !isActive ? 'unread' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => openChannel(c.id)}
              >
                <span className="ch-name">{`${prefix} ${c.name}`}</span>
                {mentions > 0 && <span className="mention-badge">{mentions}</span>}
              </li>
            );
          })}
        </ul>

        <div className="section-title with-action">
          Direct Messages
          <button
            className="section-action"
            onClick={() => setShowDmPicker((v) => !v)}
            title="新しい DM を開始"
          >
            +
          </button>
        </div>
        {showDmPicker && (
          <div className="dm-picker">
            {dmCandidates.length === 0 && <div className="dm-empty">他のユーザーがいません</div>}
            {dmCandidates.map((u) => (
              <button key={u.id} className="dm-candidate" onClick={() => startDM(u.id)}>
                <span className="dm-candidate-avatar">{u.avatar}</span>
                <span>{u.name}</span>
              </button>
            ))}
          </div>
        )}
        <ul className="dms">
          {dmChannels.map((c) => {
            const other = otherMember(c);
            const unread = unreadByChannel[c.id] ?? 0;
            const isActive = c.id === currentChannelId;
            const online = other ? onlineUserIds.has(other.id) : false;
            return (
              <li
                key={c.id}
                className={[
                  isActive ? 'active' : '',
                  unread > 0 && !isActive ? 'unread' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => openChannel(c.id)}
              >
                <span className="dm-avatar" data-online={online}>
                  {other?.avatar ?? '👤'}
                </span>
                <span className="dm-name">{other?.name ?? '(unknown)'}</span>
                {unread > 0 && <span className="mention-badge">{unread}</span>}
              </li>
            );
          })}
        </ul>
      </aside>

      <main className="main">
        <header className="channel-header">
          <button
            className="back-button"
            onClick={() => setMobileView('list')}
            title="戻る"
            aria-label="戻る"
          >
            ‹
          </button>
          <span className="channel-header-title">
            {currentChannel?.kind === 'dm' ? (
              <>
                <span
                  className="channel-header-avatar"
                  data-online={currentOther ? onlineUserIds.has(currentOther.id) : false}
                >
                  {currentOther?.avatar ?? '👤'}
                </span>
                {currentOther?.name ?? '(unknown user)'}
              </>
            ) : currentChannel?.kind === 'private' ? (
              <>🔒&nbsp;{currentChannel.name}</>
            ) : currentChannel ? (
              <>#&nbsp;{currentChannel.name}</>
            ) : (
              'チャンネルを選択'
            )}
          </span>
          {currentChannel?.kind === 'private' && (
            <button
              className="header-action"
              onClick={() => setShowInvitePicker(true)}
              title="メンバーを招待"
            >
              👤+ 招待
            </button>
          )}
        </header>
        <MessageList
          messages={messages}
          users={users}
          currentUserId={user.id}
          onlineUserIds={onlineUserIds}
          stamps={stamps}
          onToggleReaction={toggleReaction}
          onToggleStampReaction={toggleStampReaction}
          onOpenThread={(id) => setOpenThreadId(id)}
          onEdit={editMessage}
          onDelete={deleteMessage}
        />
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={sendDraft}
          userId={user.id}
          candidates={dmCandidates}
          placeholder={
            currentChannel?.kind === 'dm'
              ? `${currentOther?.name ?? ''} に DM を送信`
              : currentChannel
              ? `#${currentChannel.name} にメッセージを送信(@ でメンション)`
              : ''
          }
          disabled={!currentChannelId}
        />
      </main>

      {openThreadId && openThreadParent && (
        <ThreadPanel
          parent={openThreadParent}
          replies={threadReplies}
          users={users}
          currentUserId={user.id}
          onlineUserIds={onlineUserIds}
          mentionCandidates={dmCandidates}
          stamps={stamps}
          onClose={() => setOpenThreadId(null)}
          onSendReply={sendReply}
          onToggleReaction={toggleReaction}
          onToggleStampReaction={toggleStampReaction}
          onEdit={editMessage}
          onDelete={deleteMessage}
        />
      )}

      {showCreateChannel && (
        <CreateChannelModal
          candidates={dmCandidates}
          onCancel={() => setShowCreateChannel(false)}
          onCreate={createChannel}
        />
      )}

      {showInvitePicker && currentChannel?.kind === 'private' && (
        <InviteModal
          channelName={currentChannel.name}
          currentMembers={currentMembers}
          candidates={inviteCandidates}
          onCancel={() => setShowInvitePicker(false)}
          onInvite={(ids) => inviteMembers(currentChannel.id, ids)}
        />
      )}

      {showAdminPanel && user.isAdmin && (
        <AdminPanel
          users={Object.values(users)}
          currentUserId={user.id}
          onClose={() => setShowAdminPanel(false)}
          onToggle={toggleUserAdmin}
        />
      )}

      {showStampManager && (
        <StampManagerModal
          stamps={stamps}
          onCancel={() => setShowStampManager(false)}
          onCreate={createStamp}
          onDelete={deleteStamp}
        />
      )}
    </div>
  );
}

function StampManagerModal({
  stamps,
  onCancel,
  onCreate,
  onDelete,
}: {
  stamps: Stamp[];
  onCancel: () => void;
  onCreate: (name: string, text: string, color: string, font: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState('#ff3d8c');
  const [font, setFont] = useState(STAMP_FONTS[0].id);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const t = text.trim();
    if (!n || !t) return;
    onCreate(n, t, color, font);
    setName('');
    setText('');
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal stamp-manager" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <strong>🏷️ スタンプ作成 / 管理</strong>
          <button type="button" className="modal-close" onClick={onCancel} title="閉じる">
            ✕
          </button>
        </header>

        <form className="modal-field" onSubmit={submit}>
          <span className="modal-label">新しいスタンプ</span>

          <label className="login-field">
            <span>スタンプ名(管理用)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 了解"
              maxLength={30}
            />
          </label>

          <label className="login-field">
            <span>表示する文字</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="例: OK!"
              maxLength={60}
            />
          </label>

          <div className="stamp-row">
            <label className="login-field" style={{ flex: 1 }}>
              <span>文字色</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="stamp-color-input"
              />
            </label>
            <label className="login-field" style={{ flex: 2 }}>
              <span>フォント</span>
              <select
                value={font}
                onChange={(e) => setFont(e.target.value)}
                className="stamp-font-select"
              >
                {STAMP_FONTS.map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="stamp-preview-wrap">
            <span className="modal-label">プレビュー</span>
            <div
              className="stamp-preview"
              style={{ color, fontFamily: fontCss(font) }}
            >
              {text || '...'}
            </div>
          </div>

          <footer className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onCancel}>
              閉じる
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!name.trim() || !text.trim()}
            >
              作成
            </button>
          </footer>
        </form>

        <div className="modal-field">
          <span className="modal-label">作成済みスタンプ ({stamps.length})</span>
          {stamps.length === 0 ? (
            <div className="member-empty">まだスタンプはありません</div>
          ) : (
            <div className="stamp-list">
              {stamps.map((s) => (
                <div key={s.id} className="stamp-list-row">
                  <span
                    className="stamp-preview small"
                    style={{ color: s.color, fontFamily: fontCss(s.font) }}
                  >
                    {s.text}
                  </span>
                  <span className="stamp-list-name">{s.name}</span>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => onDelete(s.id)}
                    title="削除"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminPanel({
  users,
  currentUserId,
  onClose,
  onToggle,
}: {
  users: User[];
  currentUserId: string;
  onClose: () => void;
  onToggle: (targetId: string, nextIsAdmin: boolean) => void;
}) {
  const sorted = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <strong>⚙ メンバー管理</strong>
          <button type="button" className="modal-close" onClick={onClose} title="閉じる">
            ✕
          </button>
        </header>
        <div className="modal-field">
          <span className="modal-label">
            管理者(チェック ON) <span className="modal-hint">合計 {users.length} 人</span>
          </span>
          <div className="member-picker">
            {sorted.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <label
                  key={u.id}
                  className={`member-row ${u.isAdmin ? 'checked' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={u.isAdmin}
                    disabled={isSelf && u.isAdmin}
                    onChange={(e) => onToggle(u.id, e.target.checked)}
                    title={isSelf && u.isAdmin ? '自分の権限は外せません' : ''}
                  />
                  <span className="member-avatar">{u.avatar}</span>
                  <span className="member-name">
                    {u.name}
                    {isSelf && <span className="modal-hint"> (自分)</span>}
                  </span>
                  {u.isAdmin && <span className="admin-badge">管理者</span>}
                </label>
              );
            })}
          </div>
        </div>
        <footer className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </div>
  );
}

function CreateChannelModal({
  candidates,
  onCancel,
  onCreate,
}: {
  candidates: User[];
  onCancel: () => void;
  onCreate: (name: string, kind: 'public' | 'private', memberIds: string[]) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'public' | 'private'>('public');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, kind, [...selected]);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="modal-header">
          <strong>新しいチャンネル</strong>
          <button type="button" className="modal-close" onClick={onCancel} title="閉じる">
            ✕
          </button>
        </header>

        <label className="modal-field">
          <span className="modal-label">チャンネル名</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: marketing"
          />
        </label>

        <fieldset className="modal-field">
          <span className="modal-label">種類</span>
          <label className="radio-row">
            <input
              type="radio"
              name="kind"
              checked={kind === 'public'}
              onChange={() => setKind('public')}
            />
            <span>
              <strong># 公開チャンネル</strong>
              <span className="radio-desc">全員が見て参加できます</span>
            </span>
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="kind"
              checked={kind === 'private'}
              onChange={() => setKind('private')}
            />
            <span>
              <strong>🔒 プライベートチャンネル</strong>
              <span className="radio-desc">招待されたメンバーだけが見ることができます</span>
            </span>
          </label>
        </fieldset>

        {kind === 'private' && (
          <div className="modal-field">
            <span className="modal-label">
              メンバーを招待 <span className="modal-hint">({selected.size} 人選択中)</span>
            </span>
            {candidates.length === 0 ? (
              <div className="member-empty">他のユーザーがいません</div>
            ) : (
              <div className="member-picker">
                {candidates.map((u) => {
                  const checked = selected.has(u.id);
                  return (
                    <label
                      key={u.id}
                      className={`member-row ${checked ? 'checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(u.id)}
                      />
                      <span className="member-avatar">{u.avatar}</span>
                      <span className="member-name">{u.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <footer className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" className="btn-primary" disabled={!name.trim()}>
            作成
          </button>
        </footer>
      </form>
    </div>
  );
}

function InviteModal({
  channelName,
  currentMembers,
  candidates,
  onCancel,
  onInvite,
}: {
  channelName: string;
  currentMembers: User[];
  candidates: User[];
  onCancel: () => void;
  onInvite: (inviteeIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0) return;
    onInvite([...selected]);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="modal-header">
          <strong>🔒 {channelName} に招待</strong>
          <button type="button" className="modal-close" onClick={onCancel} title="閉じる">
            ✕
          </button>
        </header>

        <div className="modal-field">
          <span className="modal-label">現在のメンバー({currentMembers.length} 人)</span>
          <div className="member-chips">
            {currentMembers.map((m) => (
              <span key={m.id} className="member-chip">
                <span className="member-chip-avatar">{m.avatar}</span>
                {m.name}
              </span>
            ))}
          </div>
        </div>

        <div className="modal-field">
          <span className="modal-label">
            招待する <span className="modal-hint">({selected.size} 人選択中)</span>
          </span>
          {candidates.length === 0 ? (
            <div className="member-empty">招待できるユーザーがいません</div>
          ) : (
            <div className="member-picker">
              {candidates.map((u) => {
                const checked = selected.has(u.id);
                return (
                  <label
                    key={u.id}
                    className={`member-row ${checked ? 'checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(u.id)}
                    />
                    <span className="member-avatar">{u.avatar}</span>
                    <span className="member-name">{u.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <footer className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={selected.size === 0}
          >
            招待
          </button>
        </footer>
      </form>
    </div>
  );
}

function toggleReactionLocal(m: Message, userId: string, emoji: string): Message {
  const list = m.reactions[emoji] ?? [];
  const has = list.includes(userId);
  const nextList = has ? list.filter((id) => id !== userId) : [...list, userId];
  const nextReactions = { ...m.reactions };
  if (nextList.length === 0) delete nextReactions[emoji];
  else nextReactions[emoji] = nextList;
  return { ...m, reactions: nextReactions };
}

function MessageList({
  messages,
  users,
  currentUserId,
  onlineUserIds,
  stamps,
  onToggleReaction,
  onToggleStampReaction,
  onOpenThread,
  onEdit,
  onDelete,
}: {
  messages: Message[];
  users: Record<string, User>;
  currentUserId: string;
  onlineUserIds: Set<string>;
  stamps: Stamp[];
  onToggleReaction: (messageId: string, emoji: string) => void;
  onToggleStampReaction: (messageId: string, stampId: string) => void;
  onOpenThread: (messageId: string) => void;
  onEdit: (messageId: string, body: string) => void;
  onDelete: (messageId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages.length]);

  return (
    <div className="messages" ref={ref}>
      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          author={users[m.userId]}
          users={users}
          currentUserId={currentUserId}
          isAuthorOnline={onlineUserIds.has(m.userId)}
          stamps={stamps}
          onToggleReaction={onToggleReaction}
          onToggleStampReaction={onToggleStampReaction}
          onOpenThread={onOpenThread}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
      {messages.length === 0 && <div className="empty">まだメッセージはありません</div>}
    </div>
  );
}

function MessageRow({
  message,
  author,
  users,
  currentUserId,
  isAuthorOnline,
  stamps,
  onToggleReaction,
  onToggleStampReaction,
  onOpenThread,
  onEdit,
  onDelete,
  hideThreadAction,
}: {
  message: Message;
  author: User | undefined;
  users: Record<string, User>;
  currentUserId: string;
  isAuthorOnline?: boolean;
  stamps?: Stamp[];
  onToggleReaction: (messageId: string, emoji: string) => void;
  onToggleStampReaction?: (messageId: string, stampId: string) => void;
  onOpenThread?: (messageId: string) => void;
  onEdit: (messageId: string, body: string) => void;
  onDelete: (messageId: string) => void;
  hideThreadAction?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body);

  const isOwn = message.userId === currentUserId;
  const avatar = author?.avatar ?? '🙂';
  const displayName = author?.name ?? message.userName;
  const mentionsMe = message.mentions?.includes(currentUserId);
  const reactionEntries = useMemo(
    () => Object.entries(message.reactions),
    [message.reactions],
  );
  const renderedBody = useMemo(
    () => renderMessageBody(message.body, users, currentUserId),
    [message.body, users, currentUserId],
  );

  function startEdit() {
    setEditDraft(message.body);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
  }
  function saveEdit() {
    const body = editDraft.trim();
    if (!body || body === message.body) {
      setEditing(false);
      return;
    }
    onEdit(message.id, body);
    setEditing(false);
  }
  function onEditKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  return (
    <div className={`msg ${isOwn ? 'self' : ''} ${mentionsMe ? 'mentions-me' : ''}`}>
      <div className="msg-avatar" data-online={isAuthorOnline}>{avatar}</div>
      <div className="msg-content">
        <div className="msg-head">
          <span className="msg-author">{displayName}</span>
          <span className="msg-time">{formatTime(message.createdAt)}</span>
          {message.editedAt && <span className="msg-edited">(編集済み)</span>}
        </div>

        {editing ? (
          <div className="edit-box">
            <textarea
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={onEditKey}
              rows={2}
            />
            <div className="edit-actions">
              <button className="btn-ghost" onClick={cancelEdit}>
                キャンセル (Esc)
              </button>
              <button className="btn-primary" onClick={saveEdit} disabled={!editDraft.trim()}>
                保存 (Enter)
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.body && <div className="msg-body">{renderedBody}</div>}
            {message.imageUrl && (
              <a
                className="msg-image"
                href={message.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="クリックで原寸表示"
              >
                <img src={message.imageUrl} alt="" loading="lazy" />
              </a>
            )}
            {message.stamp && (
              <div
                className="msg-stamp"
                style={{
                  color: message.stamp.color,
                  fontFamily: fontCss(message.stamp.font),
                }}
                title={message.stamp.name}
              >
                {message.stamp.text}
              </div>
            )}
          </>
        )}

        {reactionEntries.length > 0 && (
          <div className="reactions">
            {reactionEntries.map(([key, userIds]) => {
              const mine = userIds.includes(currentUserId);
              const isStamp = key.startsWith('stamp:');
              const stampId = isStamp ? key.slice('stamp:'.length) : '';
              const stamp = isStamp ? stamps?.find((s) => s.id === stampId) : undefined;
              const handleClick = () => {
                if (isStamp && onToggleStampReaction) {
                  onToggleStampReaction(message.id, stampId);
                } else {
                  onToggleReaction(message.id, key);
                }
              };
              return (
                <button
                  key={key}
                  className={`reaction ${mine ? 'mine' : ''} ${isStamp ? 'reaction-stamp' : ''}`}
                  onClick={handleClick}
                  title={userIds.join(', ')}
                >
                  {isStamp ? (
                    stamp ? (
                      <span
                        className="reaction-stamp-text"
                        style={{ color: stamp.color, fontFamily: fontCss(stamp.font) }}
                      >
                        {stamp.text}
                      </span>
                    ) : (
                      <span className="reaction-stamp-missing">(削除済)</span>
                    )
                  ) : (
                    <span>{key}</span>
                  )}
                  <span className="reaction-count">{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {!hideThreadAction && message.replyCount > 0 && (
          <button
            className="thread-link"
            onClick={() => onOpenThread?.(message.id)}
            title="スレッドを開く"
          >
            💬 {message.replyCount} 件の返信
            {message.lastReplyAt && (
              <span className="thread-link-time"> · 最新 {formatTime(message.lastReplyAt)}</span>
            )}
          </button>
        )}

        {!editing && (
          <div className="msg-actions">
            <button
              className="msg-action"
              onClick={() => setPickerOpen((v) => !v)}
              title="スタンプを追加"
            >
              😀
            </button>
            {!hideThreadAction && onOpenThread && (
              <button
                className="msg-action"
                onClick={() => onOpenThread(message.id)}
                title="スレッドで返信"
              >
                💬
              </button>
            )}
            {isOwn && (
              <button className="msg-action" onClick={startEdit} title="編集">
                ✎
              </button>
            )}
            {isOwn && (
              <button
                className="msg-action danger"
                onClick={() => onDelete(message.id)}
                title="削除"
              >
                🗑
              </button>
            )}
          </div>
        )}

        {pickerOpen && (
          <div className="reaction-picker">
            <div className="reaction-pick-group">
              {REACTION_QUICK_PICK.map((e) => (
                <button
                  key={e}
                  className="reaction-pick"
                  onClick={() => {
                    onToggleReaction(message.id, e);
                    setPickerOpen(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            {onToggleStampReaction && stamps && stamps.length > 0 && (
              <>
                <div className="reaction-pick-divider">スタンプ</div>
                <div className="reaction-pick-stamps">
                  {stamps.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="reaction-pick-stamp"
                      onClick={() => {
                        onToggleStampReaction(message.id, s.id);
                        setPickerOpen(false);
                      }}
                      title={s.name}
                      style={{ color: s.color, fontFamily: fontCss(s.font) }}
                    >
                      {s.text}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadPanel({
  parent,
  replies,
  users,
  currentUserId,
  onlineUserIds,
  mentionCandidates,
  stamps,
  onClose,
  onSendReply,
  onToggleReaction,
  onToggleStampReaction,
  onEdit,
  onDelete,
}: {
  parent: Message;
  replies: Message[];
  users: Record<string, User>;
  currentUserId: string;
  onlineUserIds: Set<string>;
  mentionCandidates: User[];
  stamps: Stamp[];
  onClose: () => void;
  onSendReply: (body: string, opts?: { imageUrl?: string; stamp?: StampSnapshot }) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onToggleStampReaction: (messageId: string, stampId: string) => void;
  onEdit: (messageId: string, body: string) => void;
  onDelete: (messageId: string) => void;
}) {
  const draftScope = `th:${parent.id}`;
  const [replyDraft, setReplyDraft] = useState(() => loadDraft(currentUserId, draftScope));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [replies.length]);
  // スレッド切替時に下書きを差し替え
  useEffect(() => {
    setReplyDraft(loadDraft(currentUserId, draftScope));
  }, [currentUserId, draftScope]);
  // 入力毎に保存
  useEffect(() => {
    saveDraft(currentUserId, draftScope, replyDraft);
  }, [replyDraft, currentUserId, draftScope]);

  function submit(opts?: { imageUrl?: string }) {
    const body = replyDraft.trim();
    if (!body && !opts?.imageUrl) return;
    onSendReply(body, opts);
    setReplyDraft('');
    saveDraft(currentUserId, draftScope, '');
  }

  return (
    <aside className="thread">
      <header className="thread-header">
        <strong>スレッド</strong>
        <button className="thread-close" onClick={onClose} title="閉じる">
          ✕
        </button>
      </header>
      <div className="thread-body" ref={ref}>
        <MessageRow
          message={parent}
          author={users[parent.userId]}
          users={users}
          currentUserId={currentUserId}
          isAuthorOnline={onlineUserIds.has(parent.userId)}
          stamps={stamps}
          onToggleReaction={onToggleReaction}
          onToggleStampReaction={onToggleStampReaction}
          onEdit={onEdit}
          onDelete={onDelete}
          hideThreadAction
        />
        <div className="thread-divider">
          {replies.length > 0 ? `${replies.length} 件の返信` : 'まだ返信はありません'}
        </div>
        {replies.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            author={users[m.userId]}
            users={users}
            currentUserId={currentUserId}
            isAuthorOnline={onlineUserIds.has(m.userId)}
            stamps={stamps}
            onToggleReaction={onToggleReaction}
            onToggleStampReaction={onToggleStampReaction}
            onEdit={onEdit}
            onDelete={onDelete}
            hideThreadAction
          />
        ))}
      </div>
      <Composer
        value={replyDraft}
        onChange={setReplyDraft}
        onSubmit={submit}
        userId={currentUserId}
        candidates={mentionCandidates}
        placeholder="スレッドに返信(@ でメンション)"
      />
    </aside>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// メッセージ本文に出現する @<userName> を pill に変換しつつ、テキストはそのまま描画
function renderMessageBody(
  body: string,
  users: Record<string, User>,
  currentUserId: string,
): ReactNode[] {
  const sorted = Object.values(users)
    .filter((u) => !!u.name)
    .sort((a, b) => b.name.length - a.name.length);
  const parts: ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  let key = 0;
  while (i < body.length) {
    if (body[i] === '@') {
      let matched: User | null = null;
      for (const u of sorted) {
        if (body.startsWith(u.name, i + 1)) {
          matched = u;
          break;
        }
      }
      if (matched) {
        if (i > cursor) parts.push(body.slice(cursor, i));
        const isMe = matched.id === currentUserId;
        parts.push(
          <span key={`m-${key++}`} className={`mention ${isMe ? 'mention-me' : ''}`}>
            @{matched.name}
          </span>,
        );
        cursor = i + 1 + matched.name.length;
        i = cursor;
        continue;
      }
    }
    i++;
  }
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts.length > 0 ? parts : [body];
}

function detectMention(text: string, cursor: number): { atIdx: number; query: string } | null {
  const before = text.slice(0, cursor);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1) return null;
  // @ の直前が文頭または空白でなければ無視(メアド等の誤検出回避)
  if (atIdx > 0 && !/\s/.test(text[atIdx - 1])) return null;
  const between = before.slice(atIdx + 1);
  if (/\s/.test(between)) return null;
  return { atIdx, query: between };
}

function Composer({
  value,
  onChange,
  onSubmit,
  userId,
  candidates,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (opts?: { imageUrl?: string }) => void;
  userId: string;
  candidates: User[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pendingImage, setPendingImage] = useState<{ url: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const filtered = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return candidates
      .filter((u) => u.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, candidates]);

  const canSend = !disabled && !uploading && (!!value.trim() || !!pendingImage);

  function onChangeText(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const cursor = e.target.selectionStart ?? next.length;
    onChange(next);
    const m = detectMention(next, cursor);
    if (m) {
      setMentionStart(m.atIdx);
      setMentionQuery(m.query);
      setSelectedIdx(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(u: User) {
    const queryLen = mentionQuery?.length ?? 0;
    const before = value.slice(0, mentionStart);
    const after = value.slice(mentionStart + 1 + queryLen);
    const inserted = `@${u.name} `;
    const next = `${before}${inserted}${after}`;
    onChange(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = mentionStart + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    if (!canSend) return;
    onSubmit(pendingImage ? { imageUrl: pendingImage.url } : undefined);
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.preview);
      setPendingImage(null);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filtered[selectedIdx] ?? filtered[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 同じファイルを再選択可能に
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('画像ファイルのみアップロードできます');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('画像は 10MB 以下にしてください');
      return;
    }
    setUploading(true);
    const preview = URL.createObjectURL(file);
    try {
      const { url } = await api.uploadImage(userId, file);
      if (pendingImage) URL.revokeObjectURL(pendingImage.preview);
      setPendingImage({ url, preview });
    } catch (err) {
      URL.revokeObjectURL(preview);
      const raw = err instanceof Error ? err.message : String(err);
      // backend が "STATUS ...: {"error":"..."}" 形式で投げてくるので人間向けに整形
      const m = raw.match(/"error":"([^"]+)"/);
      const friendly = m ? m[1] : raw;
      console.error('[upload]', err);
      alert(`画像のアップロードに失敗しました: ${friendly}`);
    } finally {
      setUploading(false);
    }
  }

  function removePending() {
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.preview);
      setPendingImage(null);
    }
  }

  return (
    <div className="composer">
      <div className="composer-input">
        {pendingImage && (
          <div className="composer-attachment">
            <img src={pendingImage.preview} alt="attachment preview" />
            <button
              type="button"
              className="composer-attachment-remove"
              onClick={removePending}
              title="削除"
            >
              ✕
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChangeText}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={disabled}
        />
        {mentionQuery !== null && filtered.length > 0 && (
          <ul className="mention-popup">
            {filtered.map((u, i) => (
              <li
                key={u.id}
                className={i === selectedIdx ? 'selected' : ''}
                onMouseEnter={() => setSelectedIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u);
                }}
              >
                <span className="mention-popup-avatar">{u.avatar}</span>
                <span>{u.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={onPickFile}
      />
      <button
        type="button"
        className="composer-attach"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
        title="画像を添付"
      >
        {uploading ? '…' : '📎'}
      </button>
      <button onClick={submit} disabled={!canSend}>
        送信
      </button>
    </div>
  );
}
