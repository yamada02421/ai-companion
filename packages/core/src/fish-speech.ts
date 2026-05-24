import { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { playAudio } from "./voice.js";

const DEFAULT_HOST = "http://127.0.0.1:8080";

export interface FishSpeechConfig {
  host?: string;
  referenceId?: string;
  chunkLength?: number;
  format?: string;
  temperature?: number;
  topP?: number;
  repetitionPenalty?: number;
  maxNewTokens?: number;
  latency?: "low" | "balanced" | "normal";
  prosody?: {
    speed?: number;
    volume?: number;
  };
}

export class FishSpeechSynthesizer {
  private host: string;
  private referenceId: string | undefined;
  private chunkLength: number;
  private format: string;
  private temperature: number;
  private topP: number;
  private repetitionPenalty: number;
  private maxNewTokens: number;
  private latency: "low" | "balanced" | "normal";
  private prosody: { speed: number; volume: number };

  constructor(config: FishSpeechConfig = {}) {
    this.host = config.host ?? DEFAULT_HOST;
    this.referenceId = config.referenceId;
    this.chunkLength = config.chunkLength ?? 200;
    this.format = config.format ?? "wav";
    this.temperature = config.temperature ?? 0.7;
    this.topP = config.topP ?? 0.7;
    this.repetitionPenalty = config.repetitionPenalty ?? 1.2;
    this.maxNewTokens = config.maxNewTokens ?? 1024;
    this.latency = config.latency ?? "normal";
    this.prosody = {
      speed: config.prosody?.speed ?? 1.0,
      volume: config.prosody?.volume ?? 0,
    };
  }

  /** GET /v1/health -- check if the Fish Speech server is up */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/v1/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Synthesize text into an audio Buffer (non-streaming, collects all chunks) */
  async synthesize(text: string): Promise<Buffer> {
    const cleanText = text
      .replace(/[\r\n]+/g, "、")
      .replace(/[🎉🎊✨💯🏆📰📝💻💬]/g, "")
      .trim();

    if (!cleanText) throw new Error("Empty text");

    const body: Record<string, unknown> = {
      text: cleanText,
      references: [],
      chunk_length: this.chunkLength,
      format: this.format,
      streaming: false,
      temperature: this.temperature,
      top_p: this.topP,
      repetition_penalty: this.repetitionPenalty,
      max_new_tokens: this.maxNewTokens,
      latency: this.latency,
      prosody: this.prosody,
    };

    if (this.referenceId) {
      body.reference_id = this.referenceId;
    }

    const res = await fetch(`${this.host}/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Fish Speech TTS failed: ${res.status}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }

  /** Synthesize and write to a WAV file, returns the file path */
  async speakToFile(text: string, outputDir: string): Promise<string> {
    const audio = await this.synthesize(text);
    try {
      mkdirSync(outputDir, { recursive: true });
    } catch {}
    const ext = this.format === "mp3" ? "mp3" : "wav";
    const filePath = join(outputDir, `voice-${Date.now()}.${ext}`);
    writeFileSync(filePath, audio);
    return filePath;
  }

  /** Synthesize, write to file, and play */
  async speak(text: string, outputDir: string): Promise<void> {
    this.cleanOldFiles(outputDir);
    const filePath = await this.speakToFile(text, outputDir);
    await playAudio(filePath);
  }

  private cleanOldFiles(dir: string): void {
    try {
      const maxAge = 10 * 60 * 1000;
      const now = Date.now();
      for (const f of readdirSync(dir)) {
        if (!f.startsWith("voice-") || !(f.endsWith(".wav") || f.endsWith(".mp3"))) continue;
        const full = join(dir, f);
        const age = now - statSync(full).mtimeMs;
        if (age > maxAge) unlinkSync(full);
      }
    } catch {}
  }
}
