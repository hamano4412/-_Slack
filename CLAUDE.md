# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Slack ライクなチャットアプリケーションを開発する。
MVP のスコープは以下の 2 点に絞る:

1. **フロントエンド** — Slack 風の Web UI(サイドバーにチャンネル一覧、中央にメッセージタイムライン、下部に入力欄)
2. **バックエンド** — チャットメッセージを送受信できる API + リアルタイム配信

ファイルアップロード・通話・絵文字リアクション・スレッド等は MVP 外。後続フェーズで検討。

## MVP 機能要件

### フロントエンド
- ログイン画面(ユーザー名のみで OK、最初は認証は簡易で良い)
- チャンネル一覧の表示
- 選択中チャンネルのメッセージ履歴表示
- 新規メッセージの送信(Enter で送信)
- 他クライアントからの新規メッセージをリアルタイムに受信して画面に追記

### バックエンド
- ユーザー登録 / ログイン(セッションまたはトークン)
- チャンネルの作成・一覧取得
- メッセージの投稿 / 履歴取得
- WebSocket 等によるメッセージのリアルタイム配信
- メッセージ永続化(再接続後も履歴が見える)

## Tech Stack (採用)

| レイヤ | 採用 |
|---|---|
| フロントエンド | React 18 + TypeScript + Vite |
| 状態管理 | React 標準 (useState / useEffect) — MVP では十分 |
| バックエンド | Node.js + TypeScript + Express |
| リアルタイム | WebSocket (`ws` パッケージ) |
| 永続化 | JSON ファイル (`backend/data.json`) — MVP 用、後で SQLite 等へ差し替え可能 |
| 認証 | 名前のみの簡易ログイン(user_id 発行のみ、パスワード無し) |
| ポート | backend: `3001` (HTTP) / frontend dev: `5173` (HTTPS) |
| プロトコル | dev frontend は **HTTPS**(`@vitejs/plugin-basic-ssl` で自己署名証明書を自動発行)、API/WS は同一オリジン経由で `wss://localhost:5173/ws` |
| CORS | backend 側で `cors` を全許可(MVP) |
| API URL | frontend は相対パス(`/api`, `/ws`)で呼び出し。dev は Vite proxy、prod は backend が `frontend/dist` を配信して同一オリジン |

## Repository Layout

```
/backend
  src/
    index.ts        Express + WebSocket + JSON 永続化を 1 ファイルで実装 (MVP)
  data.json         永続化ファイル (起動時に無ければ自動生成)
  package.json
  tsconfig.json
/frontend
  src/
    main.tsx        React エントリポイント
    App.tsx         Login / Sidebar / MessageList / MessageInput を含む単一コンポーネント
    api.ts          REST 呼び出しラッパ
    types.ts        User / Channel / Message 型 (backend 側と手動で揃える)
    App.css
  index.html
  vite.config.ts
  package.json
  tsconfig.json
```

規模が大きくなったら、`backend/src` は `routes / ws / services / db` に、`frontend/src` は `components / hooks` に分割する。

## Commands

### 推奨: ワンクリック起動 (Google Chrome 自動オープン)

```powershell
.\start.ps1
```

- 依存が未インストールなら自動で `npm install` を実行
- backend(`localhost:3001`)と frontend dev サーバ(`https://localhost:5173`)を別ウィンドウで起動
- 起動後に **Google Chrome で `https://localhost:5173` を自動オープン**
- Chrome が無ければ既定ブラウザで開く
- 初回アクセス時に「この接続ではプライバシーが保護されません」と Chrome が警告するが、自己署名証明書のため**正常**。`詳細設定 → localhost にアクセスする(安全ではありません)` で進む

### 開発モード(手動)

2 つの PowerShell ウィンドウで:

```powershell
# A: backend
cd backend ; npm install ; npm run dev      # http://localhost:3001

# B: frontend (Vite が /api と /ws を 3001 にプロキシ)
cd frontend ; npm install ; npm run dev      # https://localhost:5173
```

ブラウザで `https://localhost:5173` を開く。
※ Chrome は自己署名証明書に警告を出すので、`詳細設定 → localhost にアクセスする(安全ではありません)` で進む。

### 本番モード(単一ポートで Chrome から開く)

```powershell
cd frontend ; npm run build                  # → frontend/dist 生成
cd ..\backend ; npm run dev                  # backend が dist を配信
# → http://localhost:3001 を Chrome で開けば完結
```

### 公開 URL を発行(ngrok 経由・一時的)

`.\tunnel.ps1` 実行で、frontend をビルド → backend 起動 → ngrok でトンネル化 → 公開 URL を Chrome で自動オープン。
他人にもその `https://xxxx.ngrok-free.app` を渡すだけでブラウザから入れる(PC を起動している間のみ有効)。

前提:
- 初回のみ `winget install ngrok.ngrok`
- 初回のみ ngrok 無料登録 → `ngrok config add-authtoken <TOKEN>`

### その他

```powershell
# 永続化データのリセット
Remove-Item backend\data.json -ErrorAction SilentlyContinue
```

テスト・Lint は MVP では未導入。後続で追加予定。

## Architecture

### 全体像

```
┌─────────────────────┐    HTTP (REST)    ┌──────────────────────┐
│  Frontend (Web UI)  │ ─────────────────▶│  Backend API         │
│                     │ ◀──────────────── │  - Auth              │
│  - Sidebar          │                   │  - Channels CRUD     │
│  - MessageList      │   WebSocket       │  - Messages CRUD     │
│  - MessageInput     │ ◀───push─────────▶│  - Realtime Hub      │
└─────────────────────┘                   └──────────────────────┘
                                                    │
                                                    ▼
                                              ┌──────────┐
                                              │    DB    │
                                              └──────────┘
```

### コアエンティティ

- **User**: 認証主体。`id`, `name`, `created_at`
- **Channel**: チャットルーム。`id`, `name`, `created_at`
- **Membership**: User と Channel の所属関係
- **Message**: チャンネルへの 1 投稿。`id`, `channel_id`, `user_id`, `body`, `created_at`

### 通信プロトコル

- **REST**(またはこれに準ずる HTTP API)
  - `POST /auth/login`
  - `GET  /channels`
  - `POST /channels`
  - `GET  /channels/:id/messages?before=...` (履歴ページング)
  - `POST /channels/:id/messages`
- **WebSocket** (`/ws?token=...`)
  - サーバ → クライアント: `{ type: "message.created", payload: Message }` を購読中チャンネルへ push
  - クライアント → サーバ: `subscribe` / `unsubscribe`(またはログイン時に全所属チャンネルを自動購読)

### メッセージ送信のデータフロー

1. ユーザーが入力欄で Enter
2. フロントが `POST /channels/:id/messages` を呼ぶ
3. バックエンドが DB に保存 → Realtime Hub から購読クライアント全員へ WebSocket で push
4. 各クライアントは push を受けて MessageList の末尾に追記
5. 送信元クライアントは、楽観的に表示しておいた仮メッセージを ACK の `message_id` で確定状態にする

> 「POST 経由で送り、push 経由で受ける」シンプル形を MVP とする。送信も WebSocket で送る一本化は次フェーズ。

### フロントエンド設計

- **Sidebar**: 所属チャンネル一覧。クリックで currentChannelId を切替
- **MessageList**: currentChannelId のメッセージを表示。マウント時に履歴 fetch + 上スクロールで追加履歴
- **MessageInput**: 入力 + 送信 + Enter ハンドリング
- **useSocket フック**: 1 本の WebSocket を保持し、購読イベントを各コンポーネントにディスパッチ

### バックエンド設計

- **Routes 層**: 入力検証 → Services 呼び出し → レスポンス整形
- **Services 層**: ドメインロジック(権限チェック・履歴取得・投稿)
- **DB 層**: クエリのみ
- **Realtime Hub**: `channel_id -> Set<WebSocket>` のマップ。投稿時に該当チャンネルの全コネクションへ送信

## Conventions

> 確定後に追記。例:
> - コミット: Conventional Commits
> - ブランチ: `feat/`, `fix/`, `chore/`
> - 型は `/shared` に置き、フロント/バック両方からインポート

## Notes for Claude

- UI 変更後は、ブラウザで「ログイン → チャンネル選択 → メッセージ送信 → 別ブラウザで受信」のゴールデンパスを必ず手で確認する。
- WebSocket の変更時は、再接続・複数タブ・並行送信の 3 シナリオを忘れずに検証する。
- メッセージスキーマや WS イベント名を変えるときは、`/shared` の型と DB マイグレーションを同時に更新する。
- 楽観的 UI を入れる場合、ACK 前後の重複描画(POST 経由の自分の投稿が WS でも返ってきて 2 重表示)に注意。`message_id` で de-dup する。
- MVP スコープ外の機能(スレッド、リアクション、ファイル、通話)を実装前に追加しないこと。スコープが膨らみがちなので、必要になったら本ファイルの「MVP 機能要件」を先に更新してから着手する。
