import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { api, getWsUrl } from './api';
import {
  AVATAR_POOL,
  REACTION_QUICK_PICK,
  type Channel,
  type Message,
  type User,
  type WsEvent,
} from './types';

const USER_STORAGE_KEY = 'slack-like.user';

function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(loadStoredUser);

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
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(name.trim());
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Slack-like</h1>
        <p>表示名を入力してください(アバターはあとで変更できます)</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="your name"
        />
        <button type="submit" disabled={busy || !name.trim()}>
          ログイン
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function Chat({
  user,
  onUserChange,
  onLogout,
}: {
  user: User;
  onUserChange: (u: User) => void;
  onLogout: () => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newChannelName, setNewChannelName] = useState('');
  const [draft, setDraft] = useState('');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [threadReplies, setThreadReplies] = useState<Message[]>([]);

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
    api.listChannels(user.id).then((r) => {
      setChannels(r.channels);
      const firstPublic = r.channels.find((c) => c.kind === 'public');
      if (firstPublic) setCurrentChannelId((cur) => cur ?? firstPublic.id);
    });
    api.listUsers().then((r) => {
      const map: Record<string, User> = {};
      for (const u of r.users) map[u.id] = u;
      setUsers(map);
    });
  }, [user.id]);

  // チャンネル切替時に履歴ロード + スレッドを閉じる
  useEffect(() => {
    if (!currentChannelId) return;
    api.listMessages(currentChannelId).then((r) => setMessages(r.messages));
    setOpenThreadId(null);
    setThreadReplies([]);
  }, [currentChannelId]);

  // スレッドを開いたら返信をロード
  useEffect(() => {
    if (!openThreadId) {
      setThreadReplies([]);
      return;
    }
    api
      .listReplies(openThreadId)
      .then((r) => setThreadReplies(r.replies))
      .catch(() => setThreadReplies([]));
  }, [openThreadId]);

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
        } else if (event.type === 'user.updated') {
          setUsers((prev) => ({ ...prev, [event.payload.id]: event.payload }));
          if (event.payload.id === user.id) onUserChange(event.payload);
        }
      } catch {
        /* ignore malformed */
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function createChannel(e: FormEvent) {
    e.preventDefault();
    const name = newChannelName.trim();
    if (!name) return;
    try {
      const { channel } = await api.createChannel(name);
      setNewChannelName('');
      setChannels((prev) =>
        prev.some((c) => c.id === channel.id) ? prev : [...prev, channel],
      );
      setCurrentChannelId(channel.id);
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
      setCurrentChannelId(channel.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendDraft() {
    const body = draft.trim();
    if (!body || !currentChannelId) return;
    setDraft('');
    try {
      await api.sendMessage(currentChannelId, user.id, body);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendReply(body: string) {
    const trimmed = body.trim();
    if (!trimmed || !currentChannelId || !openThreadId) return;
    try {
      await api.sendMessage(currentChannelId, user.id, trimmed, openThreadId);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  function onDraftKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendDraft();
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

  const publicChannels = useMemo(
    () => channels.filter((c) => c.kind === 'public'),
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

  return (
    <div className={`layout ${openThreadId ? 'with-thread' : ''}`}>
      <aside className="sidebar">
        <div className="workspace">
          <strong>Slack-like</strong>
          <button className="logout" onClick={onLogout} title="ログアウト">
            ⎋
          </button>
        </div>

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

        <div className="section-title">Channels</div>
        <ul className="channels">
          {publicChannels.map((c) => (
            <li
              key={c.id}
              className={c.id === currentChannelId ? 'active' : ''}
              onClick={() => setCurrentChannelId(c.id)}
            >
              # {c.name}
            </li>
          ))}
        </ul>
        <form className="new-channel" onSubmit={createChannel}>
          <input
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            placeholder="new-channel"
          />
          <button type="submit" disabled={!newChannelName.trim()}>
            +
          </button>
        </form>

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
            return (
              <li
                key={c.id}
                className={c.id === currentChannelId ? 'active' : ''}
                onClick={() => setCurrentChannelId(c.id)}
              >
                <span className="dm-avatar">{other?.avatar ?? '👤'}</span>
                <span className="dm-name">{other?.name ?? '(unknown)'}</span>
              </li>
            );
          })}
        </ul>
      </aside>

      <main className="main">
        <header className="channel-header">
          {currentChannel?.kind === 'dm' ? (
            <>
              <span className="channel-header-avatar">{currentOther?.avatar ?? '👤'}</span>
              {currentOther?.name ?? '(unknown user)'}
            </>
          ) : currentChannel ? (
            <>#&nbsp;{currentChannel.name}</>
          ) : (
            'チャンネルを選択'
          )}
        </header>
        <MessageList
          messages={messages}
          users={users}
          currentUserId={user.id}
          onToggleReaction={toggleReaction}
          onOpenThread={(id) => setOpenThreadId(id)}
          onEdit={editMessage}
          onDelete={deleteMessage}
        />
        <div className="composer">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKeyDown}
            placeholder={
              currentChannel?.kind === 'dm'
                ? `${currentOther?.name ?? ''} に DM を送信`
                : currentChannel
                ? `#${currentChannel.name} にメッセージを送信`
                : ''
            }
            rows={2}
            disabled={!currentChannelId}
          />
          <button onClick={sendDraft} disabled={!draft.trim() || !currentChannelId}>
            送信
          </button>
        </div>
      </main>

      {openThreadId && openThreadParent && (
        <ThreadPanel
          parent={openThreadParent}
          replies={threadReplies}
          users={users}
          currentUserId={user.id}
          onClose={() => setOpenThreadId(null)}
          onSendReply={sendReply}
          onToggleReaction={toggleReaction}
          onEdit={editMessage}
          onDelete={deleteMessage}
        />
      )}
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
  onToggleReaction,
  onOpenThread,
  onEdit,
  onDelete,
}: {
  messages: Message[];
  users: Record<string, User>;
  currentUserId: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
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
          currentUserId={currentUserId}
          onToggleReaction={onToggleReaction}
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
  currentUserId,
  onToggleReaction,
  onOpenThread,
  onEdit,
  onDelete,
  hideThreadAction,
}: {
  message: Message;
  author: User | undefined;
  currentUserId: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
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
  const reactionEntries = useMemo(
    () => Object.entries(message.reactions),
    [message.reactions],
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
    <div className={`msg ${isOwn ? 'self' : ''}`}>
      <div className="msg-avatar">{avatar}</div>
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
          <div className="msg-body">{message.body}</div>
        )}

        {reactionEntries.length > 0 && (
          <div className="reactions">
            {reactionEntries.map(([emoji, userIds]) => {
              const mine = userIds.includes(currentUserId);
              return (
                <button
                  key={emoji}
                  className={`reaction ${mine ? 'mine' : ''}`}
                  onClick={() => onToggleReaction(message.id, emoji)}
                  title={userIds.join(', ')}
                >
                  <span>{emoji}</span>
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
  onClose,
  onSendReply,
  onToggleReaction,
  onEdit,
  onDelete,
}: {
  parent: Message;
  replies: Message[];
  users: Record<string, User>;
  currentUserId: string;
  onClose: () => void;
  onSendReply: (body: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onEdit: (messageId: string, body: string) => void;
  onDelete: (messageId: string) => void;
}) {
  const [replyDraft, setReplyDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [replies.length]);

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (replyDraft.trim()) {
        onSendReply(replyDraft);
        setReplyDraft('');
      }
    }
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
          currentUserId={currentUserId}
          onToggleReaction={onToggleReaction}
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
            currentUserId={currentUserId}
            onToggleReaction={onToggleReaction}
            onEdit={onEdit}
            onDelete={onDelete}
            hideThreadAction
          />
        ))}
      </div>
      <div className="composer">
        <textarea
          value={replyDraft}
          onChange={(e) => setReplyDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="スレッドに返信"
          rows={2}
        />
        <button
          onClick={() => {
            if (!replyDraft.trim()) return;
            onSendReply(replyDraft);
            setReplyDraft('');
          }}
          disabled={!replyDraft.trim()}
        >
          送信
        </button>
      </div>
    </aside>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
