# SPEC-0001: Fish Speech S2 統合設計

**Status**: Draft
**Created**: 2025-05-24
**Author**: AI Companion Team

---

## 1. 背景と目的

### 現状 (AivisSpeech)
- ローカル HTTP API (`localhost:10101`)
- 2ステップ合成: `audio_query` -> `synthesis`
- WAV 形式の一括返却(ストリーミング非対応)
- 感情制御なし(RVC による声質変換で補完)
- `VoiceSynthesizer` クラスが `packages/core/src/voice.ts` に実装済み

### 目標 (Fish Speech S2)
- ストリーミング音声合成(チャンク単位で受信しながら再生開始)
- インラインタグによる感情・プロソディ制御(`[happy]`, `[whisper]` 等)
- 日本語 Tier 1 品質(S2-Pro の最高品質ランク)
- RVC 後処理を不要にする(S2 自体の品質で代替)

---

## 2. Fish Speech S2-Pro 技術概要

### モデルアーキテクチャ
- **パラメータ数**: 4B (Slow AR) + 400M (Fast AR)
- **バックボーン**: Qwen3 ベースの Decoder-only Transformer
- **コーデック**: RVQ 10 codebooks @ ~21 Hz
- **学習データ**: 10M+ 時間、80+ 言語
- **強化学習**: GRPO (Group Relative Policy Optimization)

### 対応言語 (Tier 分類)
| Tier | 言語 | 品質 |
|------|------|------|
| **Tier 1** | **日本語**, 英語, 中国語 | 最高品質 |
| Tier 2 | 韓国語, スペイン語, フランス語, ドイツ語, ロシア語 等 | 高品質 |
| Tier 3 | その他 60+ 言語 | 対応 |

### GPU 要件
| 構成 | VRAM | 備考 |
|------|------|------|
| FP32/BF16 (フルモデル) | 24GB+ | RTX 3090/4090, A5000 等 |
| **FP8 量子化** | **~12GB** | RTX 4060 Ti 16GB でも動作可能 |
| BNB NF4 4bit | 16GB+ | 品質低下の可能性あり |

### パフォーマンス (H200 参考値)
- RTF (Real-Time Factor): 0.195
- TTFA (Time-to-First-Audio): ~100ms
- スループット: 3,000+ acoustic tokens/sec

---

## 3. ローカルサーバー構成

Fish Speech S2 をローカルで動かすには2つの方式がある。

### 方式 A: fish-speech 標準 API サーバー (推奨 - 初期段階)

```
fish-speech/tools/api_server.py
  -> POST /v1/tts         (TTS 生成)
  -> GET  /v1/health      (ヘルスチェック)
  -> POST /v1/vqgan/encode (VQ エンコード)
  -> POST /v1/vqgan/decode (VQ デコード)
  -> POST /v1/references/add    (リファレンス音声追加)
  -> GET  /v1/references/list   (リファレンス一覧)
```

**起動コマンド**:
```bash
python tools/api_server.py \
  --llama-checkpoint-path checkpoints/s2-pro \
  --decoder-checkpoint-path checkpoints/s2-pro/codec.pth \
  --listen 127.0.0.1:8080 \
  --half  # FP16 モード (BF16 非対応 GPU 向け)
```

**主要オプション**:
| フラグ | デフォルト | 説明 |
|--------|-----------|------|
| `--listen` | `127.0.0.1:8080` | バインドアドレス |
| `--workers` | `1` | Uvicorn ワーカー数 |
| `--device` | `cuda` | デバイス |
| `--half` | off | FP16 モード |
| `--compile` | off | torch.compile (Windows 非対応) |
| `--api-key` | なし | Bearer トークン認証 |

### 方式 B: SGLang-Omni サーバー (将来・高スループット向け)

```bash
python -m sglang_omni.cli.cli serve \
    --model-path fishaudio/s2-pro \
    --config examples/configs/s2pro_tts.yaml \
    --port 8000
```

- OpenAI 互換 `/v1/audio/speech` エンドポイント
- Continuous Batching, Paged KV Cache, CUDA Graph 対応
- Docker イメージ: `frankleeeee/sglang-omni:dev`

**判断**: 初期は方式 A で十分。スケール需要が出たら方式 B に移行。

---

## 4. API インターフェース詳細

### 4.1 HTTP API: POST /v1/tts

**リクエスト** (JSON):
```json
{
  "text": "[happy] おかえり。今日はどうだった？",
  "reference_id": "rei-voice",
  "format": "wav",
  "sample_rate": 44100,
  "temperature": 0.7,
  "top_p": 0.7,
  "repetition_penalty": 1.2,
  "chunk_length": 300,
  "max_new_tokens": 1024,
  "latency": "normal",
  "prosody": {
    "speed": 1.1,
    "volume": 0
  }
}
```

**レスポンス**: `Transfer-Encoding: chunked` で音声バイナリがストリーム返却される。

**Content-Type 対応**: `application/json` / `application/msgpack`

### 4.2 WebSocket ストリーミング (将来検討)

ローカルサーバーでは HTTP chunked transfer で十分だが、
Cloud API (`wss://api.fish.audio/v1/tts/live`) のプロトコルも把握しておく。

```
Client -> Server: StartEvent { event: "start", request: { ... } }
Client -> Server: TextEvent  { event: "text", text: "チャンク" }
Client -> Server: FlushEvent { event: "flush" }
Client -> Server: CloseEvent { event: "stop" }

Server -> Client: AudioEvent  { event: "audio", audio: <binary> }
Server -> Client: FinishEvent { event: "finish", reason: "stop" }
```

MessagePack シリアライゼーション。

### 4.3 リファレンス音声管理

キャラクターの声を再現するために、リファレンス音声を事前登録する。

```bash
# リファレンス音声の追加
curl -X POST http://127.0.0.1:8080/v1/references/add \
  -F "reference_id=rei-voice" \
  -F "audio=@reference/rei_sample.wav" \
  -F "text=おはよう。今日もいい天気だね。"

# 登録済みリファレンス一覧
curl http://127.0.0.1:8080/v1/references/list
```

---

## 5. 感情制御システム

### 5.1 インラインタグ方式

Fish Speech S2 は `[bracket]` 構文で自然言語の感情・プロソディ指示をインラインで埋め込める。
固定タグセットではなく、自由記述が可能。

**基本感情タグ (24種)**:
`[happy]` `[sad]` `[angry]` `[excited]` `[calm]` `[nervous]` `[confident]`
`[surprised]` `[satisfied]` `[scared]` `[worried]` `[frustrated]` `[curious]`
`[sarcastic]` `[embarrassed]` `[proud]` `[relaxed]` `[grateful]` 等

**トーンマーカー**:
`[whispering]` `[shouting]` `[soft tone]` `[in a hurry tone]`

**音声エフェクト**:
`[laughing]` `[chuckling]` `[sighing]` `[sobbing]` `[yawning]` `[panting]`

**自由記述の例**:
`[whisper in small voice]` `[professional broadcast tone]` `[pitch up]`

### 5.2 タグ配置ルール

- タグは文中のどこにでも配置可能
- タグは **その後の部分** に影響する
- 感情の切り替えポイントにタグを置く

```
[calm] そう。[surprised] え、本当に？ [happy] それはよかった。
```

### 5.3 既存の emotion.ts との統合

現在の `detectEmotion()` は OpenPets のリアクション用。
Fish Speech の感情タグは**別レイヤー**として追加する。

**変換マッピング案**:

| AI レスポンスの文脈 | Fish Speech タグ | OpenPets リアクション |
|-------|-------|-------|
| 挨拶・おかえり | `[calm]` `[soft tone]` | `waving` |
| 驚き・発見 | `[surprised]` `[excited]` | `celebrating` |
| 考え中・分析 | `[calm]` `[soft tone]` | `thinking` |
| 共感・心配 | `[worried]` `[soft tone]` | `waiting` |
| 喜び・成功 | `[happy]` `[excited]` | `success` |
| エラー・問題 | `[worried]` `[nervous]` | `error` |

---

## 6. クラス設計

### 6.1 FishSpeechSynthesizer (新クラス)

```typescript
// packages/core/src/fish-speech.ts

export interface FishSpeechConfig {
  host?: string;               // default: "http://127.0.0.1:8080"
  referenceId?: string;        // リファレンス音声 ID
  format?: "wav" | "mp3" | "pcm" | "opus";
  sampleRate?: number;         // default: 44100
  temperature?: number;        // 0-1, default: 0.7
  topP?: number;               // 0-1, default: 0.7
  repetitionPenalty?: number;  // default: 1.2
  chunkLength?: number;        // 100-300, default: 300
  maxNewTokens?: number;       // default: 1024
  latency?: "low" | "balanced" | "normal";
  prosody?: {
    speed?: number;            // 0.5-2.0, default: 1.0
    volume?: number;           // -20 to +20 dB, default: 0
  };
}

export interface EmotionTag {
  position: number;            // テキスト内の挿入位置
  tag: string;                 // e.g. "happy", "whisper in small voice"
}

export class FishSpeechSynthesizer {
  private host: string;
  private config: Required<Omit<FishSpeechConfig, "host">>;

  constructor(config: FishSpeechConfig = {});

  /** サーバーの死活監視 */
  async isAvailable(): Promise<boolean>;
  // GET /v1/health -> { status: "ok" }

  /** リファレンス音声一覧 */
  async listReferences(): Promise<{ id: string; name: string }[]>;
  // GET /v1/references/list

  /** テキストに感情タグを埋め込む */
  applyEmotionTags(text: string, tags: EmotionTag[]): string;
  // e.g. "[happy] おかえり" 

  /** 一括合成 (AivisSpeech 互換) */
  async synthesize(text: string): Promise<Buffer>;
  // POST /v1/tts -> Buffer (全チャンクを結合)

  /** ストリーミング合成 (チャンク単位コールバック) */
  async synthesizeStream(
    text: string,
    onChunk: (chunk: Buffer) => void
  ): Promise<void>;
  // POST /v1/tts -> ReadableStream -> onChunk

  /** ファイルに書き出し */
  async speakToFile(text: string, outputDir: string): Promise<string>;

  /** 合成して再生 (ストリーミング対応) */
  async speak(text: string, outputDir: string): Promise<void>;
  // ストリーミング: チャンクを受信しながら再生開始
}
```

### 6.2 VoiceSynthesizer との互換性

既存の `VoiceSynthesizer` は AivisSpeech 専用として残す。
新しい統合インターフェースで切り替えられるようにする。

```typescript
// packages/core/src/voice-engine.ts

export type VoiceEngine = "aivis" | "fish-speech";

export interface UnifiedVoiceConfig {
  engine: VoiceEngine;
  aivis?: VoiceConfig;         // 既存の AivisSpeech 設定
  fishSpeech?: FishSpeechConfig;  // 新しい Fish Speech 設定
}

export class UnifiedVoiceSynthesizer {
  private aivis: VoiceSynthesizer | null = null;
  private fish: FishSpeechSynthesizer | null = null;
  private activeEngine: VoiceEngine;

  constructor(config: UnifiedVoiceConfig);

  /** アクティブなエンジンの可用性チェック */
  async isAvailable(): Promise<boolean>;

  /** テキストを合成して再生 */
  async speak(text: string, outputDir: string): Promise<void>;

  /** エンジン切り替え (フォールバック対応) */
  async switchEngine(engine: VoiceEngine): Promise<boolean>;
}
```

### 6.3 キャラクター YAML への追加

```yaml
# characters/rei.yaml に追加する項目
voice:
  engine: "fish-speech"       # "aivis" | "fish-speech"

  # Fish Speech 設定
  fish_speech:
    reference_id: "rei-voice"
    temperature: 0.7
    prosody:
      speed: 1.1
      volume: 0
    default_emotion: "calm"   # デフォルト感情タグ
    emotion_map:              # AI レスポンス文脈 -> Fish Speech タグ
      greeting: "soft tone"
      surprise: "surprised"
      thinking: "calm"
      empathy: "worried, soft tone"
      joy: "happy"
      error: "worried"

  # 既存 AivisSpeech 設定 (フォールバック用に残す)
  aivis:
    speaker_id: 1878365376
    speed: 1.1
    pitch: 0.0
    volume: 0.3
    rvc:
      model_name: "Ayanami_Rei"
      pitch: 0
```

### 6.4 character.ts の型拡張

```typescript
// VoiceSettings を拡張
export interface FishSpeechSettings {
  reference_id?: string;
  temperature?: number;
  prosody?: {
    speed?: number;
    volume?: number;
  };
  default_emotion?: string;
  emotion_map?: Record<string, string>;
}

export interface VoiceSettings {
  engine?: "aivis" | "fish-speech";
  // 既存フィールド (AivisSpeech 用)
  speaker_id?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  rvc?: RVCSettings;
  // 新規フィールド (Fish Speech 用)
  fish_speech?: FishSpeechSettings;
}
```

---

## 7. ストリーミング再生の実現方法

### 7.1 HTTP Chunked Transfer によるストリーミング

Fish Speech の `/v1/tts` は `Transfer-Encoding: chunked` でレスポンスを返す。
Node.js の `fetch` + `ReadableStream` で受信しながら再生する。

```typescript
async synthesizeStream(
  text: string,
  onChunk: (chunk: Buffer) => void
): Promise<void> {
  const res = await fetch(`${this.host}/v1/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      reference_id: this.config.referenceId,
      format: "wav",
      ...this.buildRequestParams(),
    }),
  });

  if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(Buffer.from(value));
  }
}
```

### 7.2 再生方式の選択肢

| 方式 | 説明 | レイテンシ | 実装複雑度 |
|------|------|-----------|-----------|
| **A. 一括ファイル書き出し** | 全チャンク受信後に WAV 再生 | 高 | 低 |
| **B. ffplay パイプ** | ffplay に stdin でストリーム | 低 | 中 |
| **C. NAudio/Web Audio** | ネイティブオーディオ API | 最低 | 高 |

**推奨**: 初期実装は **方式 A** (既存の `playAudio` と同じ)。
次のフェーズで **方式 B** に移行してストリーミング再生を実現。

```typescript
// 方式 B: ffplay パイプによるストリーミング再生
async speakStreaming(text: string): Promise<void> {
  const ffplay = spawn("ffplay", [
    "-nodisp", "-autoexit", "-f", "wav", "-i", "pipe:0"
  ]);

  await this.synthesizeStream(text, (chunk) => {
    ffplay.stdin.write(chunk);
  });

  ffplay.stdin.end();
  await new Promise((resolve) => ffplay.on("close", resolve));
}
```

---

## 8. インストール手順

### 8.1 前提条件

- Windows 11 + WSL2 (Ubuntu 22.04+)
- NVIDIA GPU (12GB+ VRAM 推奨、FP8 量子化使用時)
- CUDA 12.6+ ドライバー
- Python 3.12
- Git, Git LFS

### 8.2 インストール手順

```powershell
# 1. リポジトリクローン
git clone https://github.com/fishaudio/fish-speech.git
cd fish-speech

# 2. Python 仮想環境
python -m venv .venv
.venv\Scripts\Activate.ps1

# 3. 依存関係インストール (CUDA 12.6 の場合)
pip install -e ".[cu126]"

# 4. モデルダウンロード (フルモデル ~8GB)
huggingface-cli download fishaudio/s2-pro --local-dir checkpoints/s2-pro

# 4-alt. FP8 量子化モデル (~4GB, VRAM 12GB で動作)
huggingface-cli download drbaph/s2-pro-fp8 --local-dir checkpoints/s2-pro-fp8

# 5. サーバー起動
python tools/api_server.py \
  --llama-checkpoint-path checkpoints/s2-pro \
  --decoder-checkpoint-path checkpoints/s2-pro/codec.pth \
  --listen 127.0.0.1:8080 \
  --half

# 6. 動作確認
curl http://127.0.0.1:8080/v1/health
# -> {"status":"ok"}
```

### 8.3 リファレンス音声の準備

綾波レイの声を再現するには:

1. キャラクターの音声サンプル (5-15秒の WAV) を用意
2. そのサンプルのトランスクリプト (正確な文字起こし) を用意
3. サーバーに登録:

```bash
curl -X POST http://127.0.0.1:8080/v1/references/add \
  -F "reference_id=rei-voice" \
  -F "audio=@reference/rei_sample.wav" \
  -F "text=おはよう。今日もいい天気だね。"
```

---

## 9. 移行計画

### Phase 1: セットアップと検証 (今回)
- [x] 技術調査・設計ドキュメント
- [ ] セットアップスクリプト作成
- [ ] Fish Speech S2 のローカル起動確認
- [ ] リファレンス音声の作成・登録

### Phase 2: 基本実装
- [ ] `FishSpeechSynthesizer` クラス実装
- [ ] `UnifiedVoiceSynthesizer` 実装
- [ ] `character.ts` 型拡張
- [ ] `rei.yaml` に Fish Speech 設定追加
- [ ] 一括合成での動作確認

### Phase 3: ストリーミング・感情制御
- [ ] ストリーミング合成実装
- [ ] ffplay パイプ再生
- [ ] 感情タグ自動挿入 (AI レスポンス解析)
- [ ] AivisSpeech からの自動フォールバック

### Phase 4: 最適化
- [ ] FP8 量子化での品質検証
- [ ] レイテンシ最適化
- [ ] SGLang-Omni への移行検討

---

## 10. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| VRAM 不足 (24GB 必要) | サーバー起動不可 | FP8 量子化モデル (~12GB) を使用 |
| Windows ネイティブ非対応 | `--compile` 使用不可 | WSL2 で実行。`--compile` なしでも動作 |
| リファレンス音声の品質 | 声質再現が不十分 | 複数サンプル試行、トランスクリプト精度向上 |
| AivisSpeech との切り替え | 一方が落ちた場合 | `UnifiedVoiceSynthesizer` でフォールバック |
| ストリーミング再生の複雑さ | 初期実装の遅延 | Phase 1 は一括合成、Phase 3 でストリーミング |

---

## 参考リンク

- [Fish Speech GitHub](https://github.com/fishaudio/fish-speech)
- [Fish Speech ドキュメント](https://speech.fish.audio/)
- [Fish Audio API リファレンス](https://docs.fish.audio/)
- [S2-Pro モデル (HuggingFace)](https://huggingface.co/fishaudio/s2-pro)
- [S2-Pro FP8 量子化](https://huggingface.co/drbaph/s2-pro-fp8)
- [SGLang-Omni](https://github.com/sgl-project/sglang-omni)
- [感情制御ドキュメント](https://docs.fish.audio/developer-guide/core-features/emotions)
- [WebSocket Streaming API](https://docs.fish.audio/api-reference/endpoint/websocket/tts-live)
- [Fish Audio S2 ブログ](https://fish.audio/blog/fish-audio-open-sources-s2/)
