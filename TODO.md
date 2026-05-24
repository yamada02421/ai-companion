# TODO — AI Companion

---

## 次にやること（未着手）

### v0.6 — 実装済み ✅（2026-05-24）
- [x] UserMemoryManager — 会話からユーザー情報を自動学習・永続保存（動作確認済み）
- [x] NewsCurator — 6RSSフィード巡回 → AI厳選 → 一言紹介＋リンク提示
- [x] Web ダッシュボード — 会話ログ / ユーザー記憶 / キャラ設定（localhost:3456）
- [x] proactive.ts に curate モード統合
- [x] Stop Hook 開発モード（短い完了通知のみ）

### v0.7 — 次の改善候補（優先順に）
- [ ] Fish Speech S2 でTTS置き換え（ストリーミング＋感情制御）— SPEC作成中
- [ ] Live2D 化（ViviPet or Open-LLM-VTuber）— SPEC作成中
- [ ] プロアクティブ会話＋画面認識
- [ ] 好感度システム
- [ ] VAD（音声検出）でハンズフリー化

---

## 完了: v0.5.1 — 当セッションの改善 ✅（2026-05-24）
- [x] RVC モデルダウンロード取りやめ → 現行音声モデルで固定
- [x] pet_idle.py — OpenPets アイドルアニメーション（API不使用、ローカルIPC直接）
- [x] pet_idle.py ラベル非表示対応（react後に idle に戻す）
- [x] 会話のテンプレ感を解消（character.ts プロンプト改善 + rei.yaml 例文削除）
- [x] 音声終了後にテキストが残る問題を修正（cli.ts / proactive.ts に idle リセット追加）
- [x] housekeeper エージェント作成（.claude/agents/housekeeper.md）
- [x] 改善方向のリサーチ完了（Fish Speech S2, Mem0, ViviPet, Open-LLM-VTuber 等）

---

## 完了済み

### v0.1 — Terminal MVP ✅
- [x] monorepo + TypeScript 初期化
- [x] core: Claude Haiku API 会話
- [x] core: キャラクター定義読み込み
- [x] terminal: 対話型チャット UI（Ink）
- [x] キャラクター定義: 綾波レイ

### v0.2 — 自発通知 + Claude Code 連携 ✅
- [x] core: 天気 / ニュース / Qiita
- [x] CLI + プロアクティブスクリプト
- [x] Claude Code 連携（スキル / Hook / ステータスライン）
- [x] 会話履歴の永続化
- [x] キャラ切替

## 完了: v0.5 AivisSpeech + RVC 声質変換 ✅

### AivisSpeech 音声合成 ✅
- [x] VoiceSynthesizer（voice.ts）— AivisSpeech API 連携
- [x] CLI / proactive から音声再生（OpenPets 表示と並列）
- [x] キャラ YAML に voice 設定（speaker_id, speed, pitch）
- [x] Stop hook で作業完了時に音声通知
- [x] 古い音声ファイルの自動クリーンアップ

### RVC 声質変換パイプライン ✅
- [x] ultimate-rvc + PyTorch CUDA 環境構築（Python 3.12 venv）
- [x] VoiceConverter（rvc.ts）— urvc CLI ラッパー
- [x] rvc_convert.py — Python 変換スクリプト
- [x] voice.ts に RVC パイプライン統合（AivisSpeech → RVC → 再生）
- [x] ~~綾波レイの RVC モデルダウンロード~~ → 不要。現行音声モデルで固定

### thinking 表示改善 ✅
- [x] summarize-work.ts — AI が作業内容を見て完了コメント
- [x] PostToolUse フック — 作業中に何をしているか OpenPets 表示
- [x] quick-notify.ts — 軽量通知スクリプト（音声なし）

---

## 完了: v0.4 会話記憶強化 + キャラ別感情パターン ✅

### 会話コンテキスト記憶の強化 ✅
- [x] MemoryManager（memory.ts）— 会話要約 + トピック追跡
- [x] 30件超過時に古い会話を Claude Haiku で要約→圧縮
- [x] 要約・トピックをシステムプロンプトに含めて文脈維持
- [x] 履歴の正規化（user/assistant 交互を保証）

### キャラ別感情パターン ✅
- [x] Character YAML に emotion_bias を追加
- [x] default_reaction / amplify / suppress / custom_patterns 対応
- [x] rei.yaml: thinking 寄り、celebrating 抑制、カスタムパターン

---

## 完了: v0.3 OpenPets ネイティブ連携 ✅

### Step 1: OpenPets 直接出力 ✅
- [x] OpenPets IPC クライアント（core/openpets.ts）
- [x] proactive.ts → OpenPets 直接表示
- [x] cli.ts → OpenPets 直接表示
- [x] console.log 出力と OpenPets 表示の両立

### Step 2: タスク完了通知 ✅
- [x] notify.ts — Stop hook からタスク完了を OpenPets に通知
- [x] proactive.ps1 更新（毎回通知 + 25%でプロアクティブ発言）

### Step 3: 感情分析 → リアクション自動切替 ✅
- [x] emotion.ts — 日本語テキストから感情を判定
- [x] 感情 → OpenPets reaction マッピング（celebrating, error, thinking, working, waving, success, waiting, idle）
- [x] proactive.ts / cli.ts にリアクション連携組み込み
- [x] 改行メッセージの除去（OpenPets single-line制約対応）
