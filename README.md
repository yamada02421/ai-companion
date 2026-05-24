# AI Companion

AI デスクトップコンパニオン -- カスタマイズ可能なキャラクター（デフォルト: 綾波レイ）と音声で会話できるデスクトップ常駐型 AI アシスタント。

Claude Haiku 4.5 をベースに、音声認識・音声合成・感情表現・記憶・好感度システムを統合し、ニュースキュレーションや画面認識によるプロアクティブな会話を実現します。

---

## 主要機能

- **Push-to-Talk & VAD ハンズフリー音声会話** -- 右 Alt キー長押し（PTT）または音声自動検出（VAD）で双方向音声会話。Faster Whisper による日本語音声認識
- **ニュースキュレーション** -- NHK / Hacker News / Zenn / はてブ / Publickey / Gigazine の 6 フィードから AI が 1 本を厳選して紹介
- **画面認識プロアクティブ会話** -- スクリーンショットを Claude Haiku Vision で分析し、作業状況に応じた声かけ
- **ユーザー学習記憶** -- 会話から好み・習慣・仕事内容などを自動抽出し、最大 100 件を記憶
- **好感度・ムードシステム** -- 会話回数・連続日数に応じた好感度（0-100）と時間帯連動のムード変化。マイルストーン達成通知付き
- **Web ダッシュボード** -- 会話ログ / ユーザー記憶 / キャラクター設定 / タイムライン / 好感度をブラウザで閲覧・編集（`localhost:3456`）
- **複数キャラクター対応** -- YAML 定義でキャラクターを追加可能。ダッシュボードからランタイム切替
- **データエクスポート / インポート** -- 会話履歴・記憶・好感度を JSON で一括バックアップ・復元
- **OpenPets / ViviPet デスクトップペット連携** -- 感情に応じたリアクションをデスクトップペットに反映
- **AivisSpeech / Fish Speech 音声合成** -- AivisSpeech（VOICEVOX 互換 API）と Fish Speech S2 の 2 エンジン対応。フォールバック付き
- **Windows トースト通知 / システムサウンド** -- BurntToast / .NET Toast / Wscript.Shell による通知

---

## クイックスタート

```bash
# 依存パッケージのインストール
npm install

# 全機能一括起動（ダッシュボード + ペットアイドル + 音声会話）
npm start             # PTT モード（右 Alt キー）
npm run start:vad     # VAD モード（ハンズフリー）

# ダッシュボード単体起動
npm run dashboard     # http://localhost:3456

# テキストチャット
npm run chat "こんにちは"
npm run chat          # 引数なしで時間帯に応じた挨拶
```

---

## npm scripts 一覧

| スクリプト | コマンド | 説明 |
|---|---|---|
| `build` | `npm run build` | 全ワークスペースのビルド |
| `dev:terminal` | `npm run dev:terminal` | ターミナル UI を開発モードで起動 |
| `chat` | `npm run chat [メッセージ]` | CLI テキストチャット（引数なしで挨拶） |
| `talk` | `npm run talk` | Push-to-Talk 音声会話（右 Alt キー） |
| `talk:vad` | `npm run talk:vad` | VAD ハンズフリー音声会話 |
| `pet:idle` | `npm run pet:idle` | ペットアイドルアニメーション起動 |
| `curate` | `npm run curate` | ニュースキュレーション実行（1 本厳選） |
| `dashboard` | `npm run dashboard` | Web ダッシュボード起動（port 3456） |
| `create-character` | `npm run create-character` | 新規キャラクター作成ウィザード |
| `start` | `npm start` | 全機能一括起動（PTT モード） |
| `start:vad` | `npm run start:vad` | 全機能一括起動（VAD モード） |
| `stop` | `npm run stop` | 一括起動したプロセスを全停止 |

---

## プロジェクト構成

```
ai-companion/
├── packages/
│   ├── core/               # コアライブラリ
│   │   └── src/
│   │       ├── ai.ts             # CompanionAI（Claude Haiku 4.5 会話エンジン）
│   │       ├── character.ts      # キャラクター定義の読み込み・システムプロンプト構築
│   │       ├── memory.ts         # 会話履歴管理・自動要約コンパクション
│   │       ├── user-memory.ts    # ユーザー学習記憶（自動事実抽出）
│   │       ├── affinity.ts       # 好感度・ムード・マイルストーン管理
│   │       ├── emotion.ts        # テキスト感情検出
│   │       ├── voice.ts          # AivisSpeech 音声合成
│   │       ├── fish-speech.ts    # Fish Speech S2 音声合成
│   │       ├── unified-voice.ts  # 音声エンジン統合（フォールバック付き）
│   │       ├── curator.ts        # ニュースキュレーター（6 RSS → AI 厳選）
│   │       ├── screen-capture.ts # スクリーンショット撮影（PowerShell）
│   │       ├── screen-observer.ts# 画面認識（Claude Haiku Vision）
│   │       ├── openpets.ts       # OpenPets IPC クライアント
│   │       ├── vivipet-client.ts # ViviPet HTTP クライアント
│   │       ├── pet-display.ts    # ペットディスプレイ抽象化
│   │       ├── timeline.ts       # タイムラインイベント管理
│   │       ├── data-manager.ts   # データエクスポート / インポート
│   │       ├── notification.ts   # Windows トースト通知・システムサウンド
│   │       ├── news.ts           # RSS ニュース取得
│   │       ├── qiita.ts          # Qiita トレンド取得
│   │       ├── weather.ts        # 天気情報取得
│   │       ├── cache.ts          # コンテンツキャッシュ
│   │       ├── scheduler.ts      # スケジューラー
│   │       └── logger.ts         # ログ出力
│   ├── terminal/            # CLI・プロアクティブ会話
│   │   └── src/
│   │       ├── cli.ts            # テキストチャット CLI
│   │       ├── index.tsx         # Ink ターミナル UI
│   │       ├── proactive.ts      # プロアクティブ会話（時間帯別モード選択）
│   │       ├── curate.ts         # ニュースキュレーション実行
│   │       ├── notify.ts         # 通知
│   │       ├── quick-notify.ts   # クイック通知
│   │       └── summarize-work.ts # 作業サマリー
│   └── dashboard/           # Web ダッシュボード
│       └── src/
│           └── server.ts         # HTTP サーバー（API + 静的ファイル配信）
├── characters/              # キャラクター定義 YAML
│   ├── rei.yaml                  # 綾波レイ（デフォルト）
│   └── default.yaml              # 汎用 AI アシスタント
├── scripts/                 # ユーティリティスクリプト
│   ├── ptt.py                    # PTT / VAD 音声会話（Python）
│   ├── pet_idle.py               # ペットアイドルアニメーション
│   ├── start-all.ps1             # 全機能一括起動
│   ├── stop-all.ps1              # 全プロセス停止
│   ├── setup-fish-speech.ps1     # Fish Speech セットアップ
│   └── create-character.ts       # キャラクター作成ウィザード
├── docs/spec/               # 設計書
│   ├── SPEC-0001_fish-speech-integration.md
│   └── SPEC-0002_live2d-integration.md
├── .env.example             # 環境変数テンプレート
├── package.json             # ルート（npm workspaces）
└── tsconfig.json            # TypeScript 設定
```

---

## 必要な環境

| 要件 | バージョン | 用途 |
|---|---|---|
| Node.js | 20 以上 | TypeScript 実行、Web ダッシュボード |
| Python | 3.12 以上 | 音声会話（PTT / VAD） |
| Windows | 11 | スクリーンショット、通知、音声再生 |
| AivisSpeech | 最新 | 音声合成（VOICEVOX 互換、`localhost:10101`） |

### Python 依存パッケージ（音声会話用）

```bash
pip install numpy sounddevice faster-whisper pynput webrtcvad
```

- `faster-whisper` -- 音声認識（Whisper medium モデル、CUDA 推奨）
- `pynput` -- PTT モードのキーボード監視
- `webrtcvad` -- VAD モードの音声区間検出
- `sounddevice` -- マイク入力

### オプション

- **Fish Speech S2** -- 代替音声合成エンジン（`localhost:8080`）
- **OpenPets** -- デスクトップペット連携
- **ViviPet** -- 代替デスクトップペット連携（`localhost:18765`）
- **BurntToast** -- Windows トースト通知の強化（PowerShell モジュール）

---

## 設定

### 環境変数（`.env`）

`.env.example` をコピーして `.env` を作成してください。

```bash
cp .env.example .env
```

| 変数名 | 必須 | 説明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 必須 | Anthropic API キー |
| `OPENWEATHERMAP_API_KEY` | 任意 | 天気情報取得用 |
| `WEATHER_CITY` | 任意 | 天気表示の都市名（デフォルト: Tokyo） |
| `COMPANION_CHAR` | 任意 | 使用キャラクター名（デフォルト: rei） |

### キャラクター YAML

`characters/` ディレクトリに YAML ファイルを配置します。`npm run create-character` で対話的に作成できます。

主な設定項目:

```yaml
name: "rei"
display_name: "綾波レイ"
personality: |
  キャラクターの性格設定...
first_person: "私"
speech_style: |
  話し方のルール...
greeting:
  morning: おはよ
  afternoon: おつかれ
  evening: おかえり
  night: まだ起きてるの
voice:
  speaker_id: 1878365376
  speed: 1.1
  pitch: 0.0
  volume: 0.3
emotion_bias:
  default_reaction: "thinking"
  amplify: ["thinking", "waving"]
  suppress: ["celebrating"]
```

---

## アーキテクチャ

- **npm workspaces** による monorepo 構成（`core` / `terminal` / `dashboard`）
- **Claude Haiku 4.5** を全 AI 処理（会話・要約・記憶抽出・画面認識・キュレーション）に使用
- 会話履歴は **自動要約コンパクション**（30 メッセージ超で古い履歴を要約して圧縮）
- 状態ファイル（履歴・記憶・好感度・タイムライン）は `.state/` ディレクトリに JSON 保存

---

## ライセンス

MIT
