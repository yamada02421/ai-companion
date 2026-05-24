# AI Companion — プロダクト仕様書 v2

## 概要

デスクトップ常駐型の AI コンパニオンアプリ。
画面下部にバーとして常駐し、キャラクターがニュース・Qiita記事・天気などを自発的に伝えてくれる。
ショートカットキーで起動/継続できる AquaVoice 風の操作体系。

## ターゲット

- 個人利用（自分専用）
- Windows 11

## 現在の状態（v0.2 達成済み）

- ターミナル版（Ink + CLI）動作中
- Claude Code 連携: `/companion` スキル、Stop hook、ステータスライン
- OpenPets MCP 連携
- ニュース（NHK RSS）/ Qiita トレンド / 天気 / 作業コメント
- 会話履歴の永続化
- キャラ切替（環境変数 `COMPANION_CHAR`）
- キャラ定義: 綾波レイ、ミク（デフォルト）

---

## Phase 3: デスクトップアプリ（AquaVoice 風）

### コンセプト

```
┌──────────────────────────────────────────────────────┐
│                   ユーザーの作業画面                    │
│                                                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│ [キャラアニメ] 「今日雨っぽいよ、傘持ってった方がいいかも」  │ ← 常駐バー
└──────────────────────────────────────────────────────┘
```

### UI 構成

#### 1. 常駐バー（デフォルト状態）
- 画面下部に水平バーとして常駐（タスクバーの上）
- 高さ: 60〜80px
- 半透明背景、角丸
- 左側: キャラクターのアニメーション（小サイズ）
- 中央: 最新メッセージ
- 右側: モードインジケーター（📰 📝 💻 💬）
- ドラッグで位置調整可能

#### 2. 展開パネル（ショートカット発動時）
- バーが上方向に展開（高さ 300〜400px）
- 会話履歴の表示
- テキスト入力欄
- モード切替ボタン（ニュース / Qiita / 雑談 / 作業）

#### 3. ミニマル状態
- バーを閉じるとシステムトレイに格納
- トレイアイコンからワンクリックで復帰

### ショートカットキー操作

```
状態遷移図:

  IDLE ──[キー長押し]──→ ACTIVE ──[キー離す]──→ IDLE
    │                                              
    └──[キー2回押し(300ms以内)]──→ CONTINUOUS ──[キー1回押し]──→ IDLE
```

| 操作 | 動作 |
|---|---|
| ショートカット長押し | バー展開 + API 発動（ニュース/Qiita/会話をランダムor順番） |
| ショートカット離す | 発動停止、バーは最新メッセージ表示に戻る |
| ショートカット2回連続 | 継続モード ON（離しても動き続ける、定期的に情報を流す） |
| 継続モード中にキー1回 | 継続モード OFF |

- デフォルトショートカット: `Ctrl+Shift+Space`（変更可能）
- 継続モードのインターバル: 60秒ごとにプロアクティブ発言

### キャラクター表示

#### アニメーション対応フォーマット
- **GIF** — ネット上のアニメGIFをそのまま使える
- **APNG** — 高品質アニメーション
- **スプライトシート** — 自作キャラ用
- **Lottie（将来）** — ベクターアニメーション

#### キャラ定義の拡張（animations フィールド追加）

```yaml
name: "default"
display_name: "ミク"
personality: |
  ...
animations:
  format: "gif"                    # gif | apng | sprite | lottie
  base_dir: "characters/default/animations/"
  states:
    idle: "idle.gif"               # 待機中
    talking: "talking.gif"         # 発言中
    thinking: "thinking.gif"       # API応答待ち
    greeting: "greeting.gif"       # 挨拶時
    sleeping: "sleeping.gif"       # 深夜モード
  size:
    width: 64
    height: 64
  fallback_emoji: "🎭"            # アニメがない場合の代替表示
```

#### キャラ素材の追加方法
1. `characters/<名前>/animations/` にGIF等を配置
2. `characters/<名前>.yaml` の `animations` を編集
3. アプリを再起動（ホットリロード対応予定）

### 情報ソース

| ソース | 取得方法 | 頻度 |
|---|---|---|
| ニュース | NHK RSS | 30分ごと |
| Qiita トレンド | Qiita API v2 | 1時間ごと |
| 天気 | OpenWeatherMap | 1時間ごと |
| 作業コメント | git log/diff | ショートカット発動時 |
| 雑談 | 時間帯ベース | ランダム |

### プロアクティブ発言

アプリ起動中、バックグラウンドで定期的に情報を取得し、キャラが自発的に話しかける。

- **頻度**: 15〜30分に1回（設定可能）
- **モード選択**: ラウンドロビン or ランダム
- **深夜抑制**: 23:00〜7:00 は頻度を下げる or 停止
- **通知**: バーにメッセージ表示 + 軽いアニメーション

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| デスクトップ | Electron（transparent + alwaysOnTop + frameless） |
| UI | React + CSS（バー/パネルコンポーネント） |
| AI | Anthropic SDK（Claude Haiku 4.5）+ プロンプトキャッシュ |
| ニュース | rss-parser（NHK RSS） |
| Qiita | Qiita API v2（認証不要エンドポイント） |
| 天気 | OpenWeatherMap API |
| ショートカット | Electron globalShortcut |
| アニメーション | img タグ（GIF/APNG）/ lottie-web（将来） |
| ビルド | tsup（core）/ electron-builder（デスクトップ） |
| パッケージ管理 | npm workspaces（monorepo） |

## ディレクトリ構成

```
ai-companion/
├── packages/
│   ├── core/                  # 共通ロジック（UI非依存）
│   │   └── src/
│   │       ├── ai.ts          # CompanionAI（会話 + 履歴永続化）
│   │       ├── character.ts   # キャラ定義読み込み
│   │       ├── news.ts        # NHK RSS
│   │       ├── qiita.ts       # Qiita トレンド
│   │       ├── weather.ts     # OpenWeatherMap
│   │       ├── scheduler.ts   # 定期通知スケジューラ
│   │       └── index.ts
│   ├── terminal/              # ターミナル版 + CLI
│   │   └── src/
│   │       ├── index.tsx      # Ink 対話型UI
│   │       ├── cli.ts         # 単発CLI
│   │       └── proactive.ts   # プロアクティブ発言
│   └── desktop/               # Electron デスクトップ版
│       ├── src/
│       │   ├── main.ts        # Electron メインプロセス
│       │   ├── preload.ts     # IPC ブリッジ
│       │   └── renderer/
│       │       ├── index.html
│       │       ├── App.tsx
│       │       └── components/
│       │           ├── TaskBar.tsx          # 常駐バー
│       │           ├── ExpandedPanel.tsx    # 展開パネル
│       │           ├── CharacterDisplay.tsx # キャラアニメーション
│       │           ├── MessageBubble.tsx    # 吹き出し
│       │           └── ModeIndicator.tsx    # モード表示
│       ├── assets/
│       └── electron-builder.yml
├── characters/
│   ├── rei.yaml               # 綾波レイ
│   ├── default.yaml           # ミク（デフォルト）
│   └── default/
│       └── animations/        # キャラ素材
├── hooks/
│   └── proactive.ps1          # Claude Code Stop hook
├── .state/                    # ランタイム状態（gitignore）
│   ├── last-message.txt
│   └── *-history.json
├── .env                       # APIキー（gitignore）
├── SPEC.md
└── TODO.md
```

## 設計原則

1. **Core は UI 非依存** — Terminal / Claude Code / Desktop すべてが Core を薄くラップするだけ
2. **キャラ定義が Single Source of Truth** — 全フロントエンドが同じ YAML を参照
3. **`.state/` がプロセス間共有** — CLI / Hook / Desktop が同じ履歴ファイルを使う
4. **OpenPets は補助チャネル** — なくても動く。あれば追加表示
5. **オフラインでも最低限動く** — API 失敗時はキャッシュ済みメッセージや挨拶で対応

## コスト見積もり

| 項目 | 月額 |
|---|---|
| Claude Haiku API | 〜$3（自発通知含む） |
| OpenWeatherMap | 無料 |
| Qiita API | 無料（認証なし制限: 60req/h） |
| ニュース RSS | 無料 |
| **合計** | **約500円/月** |

## マイルストーン

### v0.1 — Terminal MVP ✅
- [x] monorepo + TypeScript 初期化
- [x] core: Claude Haiku API 会話
- [x] core: キャラクター定義読み込み
- [x] terminal: 対話型チャット UI（Ink）
- [x] キャラクター定義: 綾波レイ

### v0.2 — 自発通知 + Claude Code 連携 ✅
- [x] core: 天気 API 連携
- [x] core: ニュース RSS 連携
- [x] core: Qiita トレンド取得
- [x] core: スケジューラ
- [x] CLI（単発会話）+ プロアクティブスクリプト
- [x] Claude Code: `/companion` スキル
- [x] Claude Code: Stop hook（自発発言）
- [x] Claude Code: ステータスライン連携
- [x] OpenPets MCP 連携
- [x] 会話履歴の永続化
- [x] キャラ切替（綾波 / ミク）

### v0.3 — デスクトップアプリ（← 次はここ）
- [ ] Electron メインプロセス（transparent + frameless + alwaysOnTop）
- [ ] 常駐バー UI（キャラ + メッセージ + モード表示）
- [ ] 展開パネル（会話履歴 + 入力欄）
- [ ] グローバルショートカット（長押し / 2回押し）
- [ ] キャラアニメーション表示（GIF）
- [ ] プロアクティブ発言（バックグラウンドスケジューラ）
- [ ] システムトレイ格納
- [ ] 設定画面（ショートカット変更、キャラ選択、通知頻度）

### v0.4 — 拡張
- [ ] キャラアニメーション: APNG / Lottie 対応
- [ ] 音声合成（VOICEVOX 連携？）
- [ ] 複数キャラ同時表示
- [ ] プラグインシステム（情報ソース追加）
