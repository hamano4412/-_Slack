export interface User {
  id: string;
  name: string;
  avatar: string;
}

export interface Channel {
  id: string;
  name: string;
  createdAt: string;
  kind: 'public' | 'dm';
  members?: string[];
}

export type Reactions = Record<string, string[]>;

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
  | { type: 'user.updated'; payload: User };

export const AVATAR_POOL: readonly string[] = [
  '🧑', '👩', '👨', '🧔', '👶', '👵', '👴',
  '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐸',
  '🦄', '🐙', '🦉', '🐧', '🐢', '🦖', '🐳',
  '🍎', '🍌', '🍣', '🍕', '🍩', '☕', '🌸',
];

export const REACTION_QUICK_PICK: readonly string[] = [
  '👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀', '🙏', '💯',
];
