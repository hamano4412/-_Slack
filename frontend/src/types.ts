export interface User {
  id: string;
  name: string;
  avatar: string;
  email?: string;
  isAdmin: boolean;
}

export interface Channel {
  id: string;
  name: string;
  createdAt: string;
  kind: 'public' | 'private' | 'dm';
  members?: string[];
}

export type Reactions = Record<string, string[]>;

export interface StampSnapshot {
  name: string;
  text: string;
  color: string;
  font: string;
}

export interface Stamp extends StampSnapshot {
  id: string;
  userId: string;
  createdAt: string;
}

export interface Message {
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

export const STAMP_FONTS: ReadonlyArray<{ id: string; label: string; css: string }> = [
  { id: 'sans',     label: 'ゴシック',     css: '"Yu Gothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif' },
  { id: 'serif',    label: 'セリフ',       css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono',     label: '等幅',         css: '"Courier New", Consolas, monospace' },
  { id: 'rounded',  label: '丸ゴシック',   css: '"Hiragino Maru Gothic ProN", "Comic Sans MS", "Yu Gothic", sans-serif' },
  { id: 'mincho',   label: '明朝',         css: '"Yu Mincho", "Hiragino Mincho ProN", "MS Mincho", serif' },
  { id: 'pop',      label: 'ポップ',       css: '"Impact", "Arial Black", sans-serif' },
];
export function fontCss(fontId: string): string {
  return STAMP_FONTS.find((f) => f.id === fontId)?.css ?? STAMP_FONTS[0].css;
}

export interface DeletedMessagePayload {
  id: string;
  channelId: string;
  parentId?: string;
}

export type WsEvent =
  | { type: 'message.created'; payload: Message }
  | { type: 'message.updated'; payload: Message }
  | { type: 'message.deleted'; payload: DeletedMessagePayload }
  | { type: 'channel.created'; payload: Channel }
  | { type: 'channel.updated'; payload: Channel }
  | { type: 'user.updated'; payload: User }
  | { type: 'presence.updated'; payload: { onlineUserIds: string[] } };

export const AVATAR_POOL: readonly string[] = [
  '🧑', '👩', '👨', '🧔', '👶', '👵', '👴',
  '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐸',
  '🦄', '🐙', '🦉', '🐧', '🐢', '🦖', '🐳',
  '🍎', '🍌', '🍣', '🍕', '🍩', '☕', '🌸',
];

export const REACTION_QUICK_PICK: readonly string[] = [
  '👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀', '🙏', '💯',
];
