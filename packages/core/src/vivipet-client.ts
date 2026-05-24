/**
 * ViviPetClient — ViviPet の HTTP API (localhost:18765) と通信するクライアント
 *
 * ViviPet Action API:
 *   POST /adapter           — エージェントイベント発火
 *   GET  /adapter/capabilities — セマンティック能力一覧
 *   GET  /health             — ヘルスチェック
 */

import { logError } from "./logger.js";
import type { PetDisplay, PetReaction } from "./pet-display.js";

/** ViviPet のセマンティックフェーズ */
export type ViviPetPhase =
  | "idle"
  | "thinking"
  | "speaking"
  | "greeting"
  | "task:progress"
  | "task:done"
  | "task:error";

/** PetReaction -> ViviPet Phase のマッピング */
const REACTION_TO_PHASE: Record<PetReaction, ViviPetPhase> = {
  idle: "idle",
  thinking: "thinking",
  working: "task:progress",
  editing: "task:progress",
  running: "task:progress",
  testing: "task:progress",
  waiting: "idle",
  waving: "greeting",
  success: "task:done",
  error: "task:error",
  celebrating: "task:done",
};

export interface ViviPetConfig {
  /** ViviPet サーバーの URL (default: "http://localhost:18765") */
  host?: string;
  /** エージェント識別名 (default: "ai-companion") */
  agent?: string;
  /** ViviPet 側 TTS を使うか (default: false) */
  ttsEnabled?: boolean;
}

export class ViviPetClient implements PetDisplay {
  private host: string;
  private agent: string;
  private ttsEnabled: boolean;

  constructor(config: ViviPetConfig = {}) {
    this.host = config.host ?? "http://localhost:18765";
    this.agent = config.agent ?? "ai-companion";
    this.ttsEnabled = config.ttsEnabled ?? false;
  }

  async say(message: string, reaction?: PetReaction): Promise<boolean> {
    const phase = reaction ? REACTION_TO_PHASE[reaction] : "speaking";
    return this.dispatch(phase, message);
  }

  async react(reaction: PetReaction): Promise<boolean> {
    const phase = REACTION_TO_PHASE[reaction];
    return this.dispatch(phase);
  }

  async status(): Promise<{ ok: boolean; engine: string }> {
    try {
      const res = await fetch(`${this.host}/health`);
      return { ok: res.ok, engine: "vivipet" };
    } catch (e) {
      logError("vivipet.status", e);
      return { ok: false, engine: "vivipet" };
    }
  }

  /** ViviPet Adapter API にイベントを送信 */
  private async dispatch(
    phase: ViviPetPhase,
    text?: string,
  ): Promise<boolean> {
    try {
      const body: Record<string, unknown> = {
        agent: this.agent,
        phase,
        tts: this.ttsEnabled,
      };
      if (text !== undefined) {
        body.text = text;
      }

      const res = await fetch(`${this.host}/adapter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch (e) {
      logError("vivipet.dispatch", e);
      return false;
    }
  }
}
