# AI Companion — プロダクト仕様書

## 概要

デスクトップ / ターミナルで動作する AI コンパニオンアプリ。
好きなキャラクターを設定し、天気・ニュースなどを自発的に教えてくれる。

## ターゲット

- 個人利用（自分用）
- Windows 11 メイン

## 2つのモード

### Terminal 版

- Node.js TUI（ターミナル内で動作）
- キャラクターはテキスト + AA / 簡易アニメーション
- 軽量・常駐しやすい

### Desktop 版

- Electron アプリ
- キャラクター画像 / Live2D 表示（将来）
- デスクトップ常駐オーバーレイ

## コア機能（両版共通）

### 1. キャラクター会話

- Claude Haiku API による自然な会話
- キャラクター設定ファイル（性格・口調・一人称など）で差し替え可能
- システムプロンプトにキャラ設定を注入
- プロンプトキャッシュでコスト最適化

### 2. 自発的な通知

- **天気**: OpenWeatherMap API（無料枠）で定期取得 → キャラが教える
- **ニュース**: RSS（NHK等）で定期取得 → キャラがピックアップして教える
- **挨拶**: 時間帯に応じた挨拶（おはよう / おかえり / おやすみ）
- タイマー駆動で自発的に話しかける

### 3. キャラクター管理

- `characters/` ディレクトリにキャラ定義 JSON/YAML を配置
- 起動時 or コマンドでキャラ切り替え
- キャラごとに口調・性格・アバター画像を設定

## キャラクター定義ファイル例

```yaml
name: "レイ"
display_name: "綾波レイ"
personality: |
  寡黙で感情表現が少ないが、芯は強い。
  短い言葉で核心を突く。
first_person: "私"
speech_style: |
  - 敬語は使わない
  - 短文が多い
  - 「…」を時々使う
  - 感情を直接表現しない
greeting:
  morning: "…おはよう"
  evening: "おかえり"
  night: "…もう遅い。寝たほうがいい"
avatar: "characters/rei/avatar.png"
```

## 技術スタック

- **言語**: TypeScript
- **ランタイム**: Node.js
- **API**: Anthropic SDK（Claude Haiku 4.5）
- **天気**: OpenWeatherMap API
- **ニュース**: RSS パーサー（rss-parser）
- **Terminal UI**: Ink（React for CLI）
- **Desktop**: Electron
- **ビルド**: tsup / esbuild
- **パッケージ管理**: npm workspaces（monorepo）

## ディレクトリ構成

```
ai-companion/
├── packages/
│   ├── core/           # 共通ロジック
│   │   └── src/
│   │       ├── ai.ts           # Claude API ラッパー
│   │       ├── weather.ts      # 天気取得
│   │       ├── news.ts         # ニュース取得
│   │       ├── character.ts    # キャラ読み込み・管理
│   │       ├── scheduler.ts    # 自発通知スケジューラ
│   │       └── index.ts
│   ├── terminal/       # ターミナル版
│   │   └── src/
│   │       └── index.ts
│   └── desktop/        # デスクトップ版（Electron）
│       └── src/
│           ├── main.ts
│           └── renderer/
├── characters/         # キャラクター定義
│   └── rei.yaml
├── .env.example        # API キー設定例
├── package.json        # monorepo root
└── tsconfig.json
```

## コスト見積もり

| 項目 | 月額 |
|---|---|
| Claude Haiku API | 〜$3（≒450円） |
| OpenWeatherMap | 無料 |
| ニュース RSS | 無料 |
| **合計** | **約500円/月** |

## マイルストーン

### v0.1 — MVP（Terminal版）

- [ ] プロジェクト初期化（monorepo + TypeScript）
- [ ] core: Claude Haiku API 会話
- [ ] core: キャラクター定義読み込み
- [ ] terminal: 対話型チャット UI
- [ ] キャラクター1体（レイ）の定義ファイル

### v0.2 — 自発通知

- [ ] core: 天気 API 連携
- [ ] core: ニュース RSS 連携
- [ ] core: スケジューラ（定期通知）
- [ ] terminal: 通知表示

### v0.3 — Desktop版

- [ ] Electron アプリ基盤
- [ ] デスクトップオーバーレイ UI
- [ ] キャラクター画像表示

### v0.4 — キャラ拡張

- [ ] 複数キャラ対応
- [ ] キャラ切り替えコマンド
- [ ] キャラごとのアバター画像
