# SPEC-0002: Live2D デスクトップペット統合設計

**Status**: Draft
**Created**: 2026-05-24
**Author**: AI Companion Team

---

## 1. 背景と目的

### 現状 (OpenPets)

- OpenPets MCP サーバー経由でデスクトップペットを表示
- IPC (Named Pipe) で `pet.say` / `pet.react` / `lease.acquire` を送信
- 11 種のリアクション: `idle`, `thinking`, `working`, `editing`, `running`, `testing`, `waiting`, `waving`, `success`, `error`, `celebrating`
- 表情・モーションの自由度が低い（固定アニメーションの切り替えのみ）
- `packages/core/src/openpets.ts` に `OpenPetsClient` として実装済み
- `packages/core/src/emotion.ts` でテキストからリアクションを自動検出

### 目標

- Live2D モデルによる滑らかで表情豊かなキャラクター表示
- 感情・モーション・リップシンクをAIレスポンスに連動させる
- カスタム Live2D モデル（綾波レイ等）の差し替えに対応
- 既存の `packages/desktop/` Electron アプリとの統合
- TTS (AivisSpeech / Fish Speech) との連携によるリップシンク
- OpenPets からの段階的移行（フォールバック可能）

---

## 2. 候補の比較調査

### 2.1 ViviPet

**概要**: AI 駆動の Live2D デスクトップコンパニオン。外部エージェントが HTTP API 経由でキャラクターを制御する設計。

**リポジトリ**: https://github.com/suntianc/ViviPet
**ライセンス**: GPL-3.0
**リリース状況**: v1.0.0-beta1 (2026-05-05) - Windows x64 exe あり

**技術スタック**:
- Electron + React + TypeScript + Vite + WebGL
- Live2D Cubism 5
- Turbo (monorepo)

**Action API (Adapter)**:
```
POST http://localhost:18765/adapter        -- エージェントイベント発火
GET  http://localhost:18765/adapter/capabilities  -- セマンティック能力一覧
GET  http://localhost:18765/health          -- ヘルスチェック
```

**リクエスト例**:
```json
{
  "agent": "ai-companion",
  "phase": "thinking",
  "text": "考え中...",
  "tts": false
}
```

- Semantic Phase 方式: Live2D モーション名ではなく「`thinking`」「`task:done`」等のセマンティックな位相で指示
- モデル内部のモーション割り当ては ViviPet 側が自動解決

**カスタムモデル**:
- トレイメニューから ZIP 形式で Live2D モデルをインポート可能
- 必須ファイル: `.model3.json`, `.moc3`, `texture_00.png`
- 必須モーション: `Idle`（その他 `Thinking`, `Speaking`, `Happy`, `Angry` 等はオプション）
- `models.json` で手動マッピングのオーバーライドも可能

**TTS**:
- 3プロバイダ: system (macOS `say`), local service, cloud (OpenAI/ElevenLabs/Azure)
- 3リクエストモード: preset, clone, instruct
- リップシンク連動あり

**Windows 対応**: Windows x64 インストーラー (152 MB) がリリースされている

---

### 2.2 Open-LLM-VTuber

**概要**: 音声対話型 AI コンパニオン。Live2D アバター付きでローカル LLM / クラウド LLM と会話可能。

**リポジトリ**: https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
**ドキュメント**: https://docs.llmvtuber.com/
**ライセンス**: MIT

**技術スタック**:
- Python バックエンド (FastAPI)
- Web フロントエンド + Electron デスクトップクライアント
- Live2D (Web)
- ASR (sherpa-onnx-asr 等) + TTS (edgeTTS, VOICEVOX 等)

**Claude 対応**:
- `conf.yaml` の `llm_provider` を `claude` に変更し、`claude_llm` ブロックで API キーとモデルを設定
- Vision 機能対応（v1.2.0 で修正済み）

**デスクトップペットモード**:
- 透過背景、常時最前面、非インタラクティブ領域のクリックスルー
- マウスホイールでサイズ調整
- 入力ボックスとサブタイトルは独立ドラッグ可能
- Web モードとデスクトップペットモード間の切り替えで状態は保持

**インストール**:
```bash
git clone https://github.com/Open-LLM-VTuber/Open-LLM-VTuber --recursive
cd Open-LLM-VTuber
uv sync && uv run run_server.py
```

**システム要件**:
- Python 3.10-3.12
- FFmpeg
- GPU 推奨（ローカル LLM/TTS 使用時）
- クラウド API のみ使用なら CPU でも動作可

**カスタマイズ**:
- Live2D モデル差し替え可能
- キャラクタープロンプト変更
- 音声クローン
- MCP プロトコルによるツール呼び出し

---

### 2.3 カスタム Electron + Live2D SDK

**概要**: 既存の `packages/desktop/` Electron アプリに Live2D SDK を直接組み込む。

**主要ライブラリ**:
- `pixi-live2d-display` (PixiJS 用 Live2D プラグイン、Cubism 2.1/4 両対応)
- `pixi-live2d-display-lipsyncpatch` (リップシンク対応フォーク)
- Live2D Cubism Core (`live2dcubismcore.min.js` - Cubism 4 SDK から抽出)

**npm パッケージ**:
```bash
npm install pixi-live2d-display pixi.js
# または リップシンク対応版
npm install pixi-live2d-display-lipsyncpatch pixi.js
```

**Live2D SDK ライセンス**:
- **個人・小規模事業**: 無料（Expandable Application を除く）
- **年間売上 2,000 万円超**: Publication License Agreement が必要
- **VTuber トラッキングソフト**: Expandable Application 扱い（要審査）
- **AI チャットボット**: 配布方法と規模により異なる
- 開発・検証フェーズは無料

**リップシンク実現方法**:
1. `pixi-live2d-display-lipsyncpatch` を使用
2. TTS 音声の音量レベルを解析して `ParamMouthOpenY` パラメータに反映
3. Web Audio API (`AnalyserNode`) でリアルタイム解析

**既存 Electron アプリとの統合ポイント**:
- `packages/desktop/src/renderer/App.tsx` に Live2D キャンバスを追加
- ウィンドウを透過に変更 (`transparent: true`, `backgroundColor: '#00000000'`)
- `packages/desktop/src/main.ts` の IPC ハンドラに Live2D 制御コマンドを追加

---

## 3. 比較表

| 評価軸 | ViviPet | Open-LLM-VTuber | カスタム Electron + Live2D |
|--------|---------|-----------------|--------------------------|
| **導入コスト** | 低（バイナリインストール） | 中（Python 環境構築） | 高（SDK 組み込み開発） |
| **既存コードとの統合** | HTTP API で疎結合 | 別プロセスとして共存 | 直接統合 |
| **カスタマイズ性** | 中（モデル差替え可、API は固定） | 高（フルソースアクセス） | 最高（完全制御） |
| **Windows 対応** | 対応済み（exe あり） | 対応（Python + Electron） | 対応（既存 Electron） |
| **Live2D 品質** | Cubism 5 | Cubism 4 (Web) | Cubism 4/5 (選択可) |
| **リップシンク** | 内蔵 | 内蔵 | 要実装 (lipsyncpatch) |
| **TTS 統合** | 内蔵（3プロバイダ） | 内蔵（多数） | 要実装（既存 voice.ts 活用） |
| **API 制御** | HTTP REST (簡単) | conf.yaml + Web UI | 自由設計 |
| **リソース消費** | Electron 1プロセス | Python + Electron 2プロセス | 既存 Electron に統合 |
| **ライセンス** | GPL-3.0 | MIT | Live2D SDK (個人無料) |
| **保守・更新** | 外部依存 (beta) | 活発なコミュニティ | 自己保守 |
| **AI バックエンド** | 外部任せ（API で受信） | 内蔵（Claude 対応） | 既存 CompanionAI 直接利用 |
| **工数見積もり** | 1-2 日 | 2-3 日 | 5-10 日 |

---

## 4. 推奨アプローチ: ViviPet + 既存バックエンド統合

### 4.1 推奨理由

1. **最も低い導入コスト**: バイナリインストール + HTTP API で即座に動作確認可能
2. **関心の分離**: Live2D 描画は ViviPet に任せ、AI ロジックは既存 `@ai-companion/core` を維持
3. **段階的移行**: OpenPets -> ViviPet のアダプタを `openpets.ts` と同じインターフェースで作れる
4. **リップシンク内蔵**: TTS との連携が最初から動く
5. **Cubism 5 対応**: 最新の Live2D SDK を利用

### 4.2 却下案と理由

**Open-LLM-VTuber を却下した理由**:
- Python バックエンドが別途必要で、既存の Node.js/TypeScript スタックと二重管理になる
- 独自の AI バックエンド (conf.yaml) を持っており、既存の `CompanionAI` クラスとの統合が冗長
- ASR/TTS/LLM すべてを含む「全部入り」設計で、必要以上に重い
- デスクトップペットモードはあくまでフロントエンドの一機能であり、API 経由の外部制御に最適化されていない

**カスタム Electron + Live2D を却下した理由**:
- 工数が 5-10 日と最も高い
- Live2D SDK の組み込み、リップシンク、モーション管理をすべて自前実装する必要がある
- `pixi-live2d-display-lipsyncpatch` は最終更新が 1 年前で、PixiJS v7 向け（メンテナンス不安）
- 将来的にカスタム実装に切り替えるオプションは残しつつ、初期はViviPet で素早く立ち上げるのが合理的

### 4.3 将来の選択肢

ViviPet が要件を満たさなくなった場合（API 拡張性の限界、GPL-3.0 ライセンスの問題等）、カスタム Electron + Live2D への移行パスを確保しておく。その際は ViviPet のソースコード（Electron + React + Cubism 5）を参考実装として活用できる。

---

## 5. 実装ステップ

### Phase 1: ViviPet 導入と動作確認 (1 日)

1. **ViviPet インストール**
   - v1.0.0-beta1 の Windows x64 exe をダウンロード
   - インストール・起動確認
   - デフォルト Live2D モデルでの動作確認

2. **Adapter API の疎通確認**
   ```bash
   # ヘルスチェック
   curl http://localhost:18765/health

   # 能力一覧の取得
   curl http://localhost:18765/adapter/capabilities

   # テストイベント送信
   curl -X POST http://localhost:18765/adapter \
     -H "Content-Type: application/json" \
     -d '{"agent":"test","phase":"thinking","text":"テスト中...","tts":false}'
   ```

3. **セマンティックフェーズの調査**
   - `/adapter/capabilities` のレスポンスから利用可能なフェーズ一覧を取得
   - 各フェーズに対応するモーションの挙動を確認

### Phase 2: ViviPet クライアント実装 (1 日)

1. **`packages/core/src/vivipet.ts` 新規作成**

   ```typescript
   export interface ViviPetConfig {
     host?: string;          // default: "http://localhost:18765"
     agent?: string;         // agent 識別名
     ttsEnabled?: boolean;   // ViviPet 側 TTS を使うか
   }

   export type ViviPetPhase =
     | "idle"
     | "thinking"
     | "speaking"
     | "happy"
     | "confused"
     | "angry"
     | "surprised"
     | "task:done"
     | "error";

   export class ViviPetClient {
     private host: string;
     private agent: string;
     private ttsEnabled: boolean;

     constructor(config: ViviPetConfig = {});

     /** ヘルスチェック */
     async isAvailable(): Promise<boolean>;
     // GET /health

     /** セマンティック能力一覧を取得 */
     async getCapabilities(): Promise<string[]>;
     // GET /adapter/capabilities

     /** エージェントイベントを送信 */
     async dispatch(phase: ViviPetPhase, text?: string): Promise<boolean>;
     // POST /adapter { agent, phase, text, tts }

     /** テキストとフェーズを同時に送信 (吹き出し + モーション) */
     async say(text: string, phase?: ViviPetPhase): Promise<boolean>;

     /** モーションのみ変更 */
     async setPhase(phase: ViviPetPhase): Promise<boolean>;
   }
   ```

2. **OpenPets リアクション -> ViviPet フェーズの変換マッピング**

   ```typescript
   const REACTION_TO_PHASE: Record<OpenPetsReaction, ViviPetPhase> = {
     idle: "idle",
     thinking: "thinking",
     working: "thinking",        // ViviPet に "working" がなければ
     editing: "thinking",
     running: "thinking",
     testing: "thinking",
     waiting: "idle",
     waving: "happy",
     success: "task:done",
     error: "error",
     celebrating: "happy",
   };
   ```

3. **統合インターフェース `packages/core/src/pet-display.ts`**

   ```typescript
   export type PetBackend = "openpets" | "vivipet";

   export interface PetDisplayConfig {
     backend: PetBackend;
     openpets?: {};              // OpenPets は設定不要（IPC 自動検出）
     vivipet?: ViviPetConfig;
   }

   export class PetDisplay {
     private openpets: OpenPetsClient | null = null;
     private vivipet: ViviPetClient | null = null;
     private activeBackend: PetBackend;

     constructor(config: PetDisplayConfig);

     /** テキストを表示してリアクションを設定 */
     async say(text: string, reaction: OpenPetsReaction): Promise<boolean>;

     /** リアクションのみ変更 */
     async react(reaction: OpenPetsReaction): Promise<boolean>;

     /** バックエンドの可用性チェック (フォールバック対応) */
     async isAvailable(): Promise<boolean>;
   }
   ```

### Phase 3: 既存コードとの統合 (0.5 日)

1. **`packages/core/src/index.ts` にエクスポート追加**
   ```typescript
   export { ViviPetClient, type ViviPetConfig, type ViviPetPhase } from "./vivipet.js";
   export { PetDisplay, type PetDisplayConfig, type PetBackend } from "./pet-display.js";
   ```

2. **`packages/desktop/src/main.ts` の改修**
   - `CompanionAI.chat()` / `proactiveMessage()` の戻り値 `CompanionResponse.reaction` を `PetDisplay` に連携
   - 既存の OpenPets 呼び出し箇所を `PetDisplay` に置き換え

3. **`packages/terminal/` での利用**
   - ターミナル版でも `PetDisplay` 経由で ViviPet 制御可能に

4. **`.env.example` への追加**
   ```
   PET_BACKEND=vivipet          # "openpets" | "vivipet"
   VIVIPET_HOST=http://localhost:18765
   ```

### Phase 4: カスタム Live2D モデル導入 (1-2 日)

1. **綾波レイ Live2D モデルの準備**
   - Cubism 5 対応の `.moc3` + `.model3.json` 形式
   - 必須モーション: `Idle`
   - 推奨モーション: `Thinking`, `Speaking`, `Happy`, `Angry`, `Confused`, `Surprised`
   - 表情ファイル (`.exp3.json`): `Blush`, `Angry`, `Surprised` 等
   - テクスチャ: `texture_00.png` (2048x2048 推奨)

2. **モデルのパッケージング**
   ```
   models/rei/
   ├── rei.model3.json
   ├── rei.moc3
   ├── texture_00.png
   ├── rei.physics3.json
   ├── motions/
   │   ├── Idle.motion3.json
   │   ├── Thinking.motion3.json
   │   ├── Speaking.motion3.json
   │   ├── Happy.motion3.json
   │   └── ...
   └── expressions/
       ├── Blush.exp3.json
       └── ...
   ```

3. **ViviPet へのインポート**
   - ZIP に圧縮してトレイメニューからインポート
   - `models.json` でアクションマッピングのカスタマイズ

### Phase 5: TTS + リップシンク連携 (1 日)

1. **ViviPet TTS 設定**
   - ViviPet の TTS を使う場合: ViviPet 側で local TTS プロバイダとして AivisSpeech / Fish Speech を設定
   - 自前 TTS を使う場合: `tts: false` で吹き出しテキストのみ送信し、音声は既存 `voice.ts` / `fish-speech.ts` で再生

2. **推奨構成**:
   - ViviPet: リップシンクのトリガーのみ（`tts: true` + local TTS プロバイダ）
   - ai-companion: AI ロジック + テキスト生成 -> ViviPet Adapter API に POST
   - TTS サーバー: AivisSpeech or Fish Speech (ViviPet から呼び出し)

3. **フロー**:
   ```
   ユーザー入力
     -> CompanionAI.chat() [ai-companion]
     -> レスポンス取得 { text, reaction }
     -> PetDisplay.say(text, reaction) [ai-companion]
       -> ViviPetClient.dispatch(phase, text) [HTTP POST]
         -> ViviPet 受信
           -> Live2D モーション再生
           -> 吹き出し表示
           -> TTS 合成 (local provider -> AivisSpeech/Fish Speech)
           -> リップシンク連動
   ```

---

## 6. 必要なリソース

### ソフトウェア

| リソース | 入手先 | 備考 |
|---------|--------|------|
| ViviPet v1.0.0-beta1 | https://github.com/suntianc/ViviPet/releases | Windows x64 exe (152 MB) |
| Live2D モデル (綾波レイ) | 自作 or BOOTH 購入 | Cubism 5 対応 `.moc3` 形式 |
| AivisSpeech or Fish Speech | 既存環境を流用 | SPEC-0001 参照 |

### Live2D モデル入手先候補

- **BOOTH**: Live2D モデルのマーケットプレイス（有料/無料）
- **Live2D Cubism Editor**: 自作する場合（PRO 版 年 7,128 円 / FREE 版あり）
- **nizima**: Live2D 公式マーケット
- **ViviPet デフォルトモデル**: 最初の動作確認用（@bailyovo 提供の無料モデル）

### ハードウェア要件

| コンポーネント | 要件 | 備考 |
|--------------|------|------|
| CPU | 特に制約なし | Electron 動作可能であれば OK |
| RAM | 8GB+ | ViviPet + ai-companion 同時動作 |
| GPU | WebGL 対応 | Live2D 描画用、専用 GPU 不要 |
| ストレージ | 200MB+ | ViviPet + Live2D モデル |

---

## 7. 既存コードとの統合マップ

```
packages/core/src/
├── openpets.ts          ... 既存 OpenPets クライアント (維持)
├── vivipet.ts           ... [新規] ViviPet HTTP クライアント
├── pet-display.ts       ... [新規] 統合ペット表示インターフェース
├── emotion.ts           ... 既存 テキスト -> リアクション変換 (維持)
├── ai.ts                ... 既存 CompanionAI (reaction を PetDisplay へ)
├── voice.ts             ... 既存 AivisSpeech TTS (維持)
├── fish-speech.ts       ... [SPEC-0001] Fish Speech TTS
└── index.ts             ... エクスポートに vivipet / pet-display 追加

packages/desktop/src/
├── main.ts              ... [改修] PetDisplay 初期化 + IPC 連携
└── renderer/
    └── App.tsx           ... [改修] ViviPet 使用時は吹き出し表示を省略可

characters/
└── rei.yaml             ... [追加] pet_display セクション
    # pet_display:
    #   backend: vivipet
    #   vivipet:
    #     host: http://localhost:18765
    #     tts_enabled: true

.env.example             ... [追加] PET_BACKEND, VIVIPET_HOST
```

---

## 8. 工数見積もり

| フェーズ | 内容 | 工数 |
|---------|------|------|
| Phase 1 | ViviPet 導入・動作確認 | 0.5 日 |
| Phase 2 | ViviPet クライアント実装 | 1 日 |
| Phase 3 | 既存コード統合 | 0.5 日 |
| Phase 4 | カスタムモデル導入 | 1-2 日 |
| Phase 5 | TTS + リップシンク連携 | 1 日 |
| **合計** | | **4-5 日** |

---

## 9. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| ViviPet が beta で不安定 | クラッシュ、API 変更 | OpenPets フォールバックを `PetDisplay` で維持 |
| GPL-3.0 ライセンス | ai-companion の配布に影響 | ViviPet は独立プロセスとして利用（HTTP API 経由 = プロセス分離のため GPL 汚染しない） |
| Adapter API のフェーズが不足 | 表現力が限定的 | `/adapter/capabilities` で実際のフェーズ一覧を確認し、不足があれば Issue / PR で提案 |
| カスタムモデルの品質 | モーションが不自然 | 最初は ViviPet デフォルトモデルで検証、段階的にカスタムモデルへ移行 |
| ViviPet 側 TTS と ai-companion 側 TTS の二重再生 | 音声が重複 | `tts: false` or `tts: true` を明確に使い分ける設計 |
| ViviPet のポートが競合 | 18765 が使用中 | ViviPet 側の設定で変更可能か確認、不可なら環境変数で対応 |

---

## 10. 将来の拡張

### カスタム Electron + Live2D への移行パス

ViviPet で十分な検証を行った後、以下の条件に該当する場合はカスタム実装を検討する:

- ViviPet の API 拡張性が限界に達した場合
- GPL-3.0 が配布上の問題になった場合
- より深いカスタマイズ（独自 UI 統合、独自モーション制御）が必要になった場合

その際の実装ベースライン:
- `pixi-live2d-display` + `pixi-live2d-display-lipsyncpatch` (or フォーク版 `@laffy1309/pixi-live2d-lipsyncpatch`)
- Live2D Cubism Core (`live2dcubismcore.min.js`)
- 既存 `packages/desktop/` の Electron ウィンドウに直接統合
- ViviPet のソースコード (Electron + React + Cubism 5) を参考実装として活用

### 機能ロードマップ

1. **Phase 6**: 感情タグと Live2D 表情の連動 (Fish Speech `[happy]` -> ViviPet `happy` phase)
2. **Phase 7**: マウスカーソル追跡 (ViviPet 内蔵の目追跡を活用)
3. **Phase 8**: インタラクティブ操作 (クリック -> 特別モーション)
4. **Phase 9**: 複数キャラクター対応 (キャラ切り替え時に Live2D モデルも切り替え)

---

## 参考リンク

- [ViviPet GitHub](https://github.com/suntianc/ViviPet)
- [Open-LLM-VTuber GitHub](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)
- [Open-LLM-VTuber ドキュメント](https://docs.llmvtuber.com/)
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [pixi-live2d-display-lipsyncpatch](https://www.npmjs.com/package/pixi-live2d-display-lipsyncpatch)
- [Live2D Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/)
- [Live2D SDK ライセンス](https://www.live2d.com/en/sdk/license/)
- [ai-zen/live2d-copilot](https://github.com/ai-zen/live2d-copilot) (参考: Electron + Live2D + AI)
- [SPEC-0001: Fish Speech S2 統合設計](./SPEC-0001_fish-speech-integration.md)
