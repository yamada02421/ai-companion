/**
 * 音声エンジン切替スクリプト
 *
 * 使い方:
 *   npx tsx scripts/switch-voice-engine.ts fish-speech   → Fish Speech S2 に切替
 *   npx tsx scripts/switch-voice-engine.ts aivisspeech   → AivisSpeech に戻す
 *   npx tsx scripts/switch-voice-engine.ts               → 現在のエンジンを表示
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

// --- 設定 ---
const SUPPORTED_ENGINES = ["fish-speech", "aivisspeech"] as const;
type VoiceEngine = (typeof SUPPORTED_ENGINES)[number];

const PROJECT_ROOT = resolve(import.meta.dirname ?? __dirname, "..");
const CHARACTER_FILE = resolve(PROJECT_ROOT, "characters", "rei.yaml");

// --- メイン ---
function main(): void {
  const targetEngine = process.argv[2] as VoiceEngine | undefined;

  // YAML 読み込み（Document API でフォーマット保持）
  const rawYaml = readFileSync(CHARACTER_FILE, "utf-8");
  const doc = parseDocument(rawYaml);

  // 現在のエンジン取得
  const voiceNode = doc.get("voice", true) as any;
  const currentEngine: string | undefined = voiceNode?.get?.("engine") ?? undefined;

  // 引数なし → 現在のエンジンを表示して終了
  if (!targetEngine) {
    console.log(`Current voice engine: ${currentEngine ?? "(not set, default: aivisspeech)"}`);
    console.log("");
    console.log("Usage:");
    console.log("  npx tsx scripts/switch-voice-engine.ts fish-speech");
    console.log("  npx tsx scripts/switch-voice-engine.ts aivisspeech");
    process.exit(0);
  }

  // バリデーション
  if (!SUPPORTED_ENGINES.includes(targetEngine)) {
    console.error(`ERROR: Unsupported engine "${targetEngine}"`);
    console.error(`Supported: ${SUPPORTED_ENGINES.join(", ")}`);
    process.exit(1);
  }

  // 既に同じエンジンなら何もしない
  if (currentEngine === targetEngine) {
    console.log(`Voice engine is already set to "${targetEngine}". No changes made.`);
    process.exit(0);
  }

  // voice ノードが無ければ作成
  if (!doc.has("voice")) {
    doc.set("voice", { engine: targetEngine });
  } else {
    // voice マップに engine キーを設定
    const voice = doc.get("voice", true) as any;
    if (voice && typeof voice.set === "function") {
      voice.set("engine", targetEngine);
    } else {
      // フォールバック: voice がスカラーの場合は上書き
      doc.set("voice", { engine: targetEngine });
    }
  }

  // エンジン固有のデフォルト設定
  if (targetEngine === "fish-speech") {
    const voice = doc.get("voice", true) as any;
    if (voice && typeof voice.set === "function") {
      // Fish Speech 用デフォルト（既存値がなければ設定）
      if (!voice.has("fish_speech_port")) {
        voice.set("fish_speech_port", 8080);
      }
      if (!voice.has("fish_speech_reference_id")) {
        voice.set("fish_speech_reference_id", "rei-voice");
      }
    }
  }

  // YAML 書き出し（フォーマット保持）
  const output = doc.toString();
  writeFileSync(CHARACTER_FILE, output, "utf-8");

  const prev = currentEngine ?? "aivisspeech (default)";
  console.log(`Voice engine switched: ${prev} -> ${targetEngine}`);
  console.log(`Updated: ${CHARACTER_FILE}`);
}

main();
