import { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
const DEFAULT_HOST = "http://127.0.0.1:10101";

export interface VoiceConfig {
  host?: string;
  speakerId?: number;
  speedScale?: number;
  pitchScale?: number;
  volumeScale?: number;
}

export class VoiceSynthesizer {
  private host: string;
  private speakerId: number;
  private speedScale: number;
  private pitchScale: number;
  private volumeScale: number;
  constructor(config: VoiceConfig = {}) {
    this.host = config.host ?? DEFAULT_HOST;
    this.speakerId = config.speakerId ?? 0;
    this.speedScale = config.speedScale ?? 1.0;
    this.pitchScale = config.pitchScale ?? 0.0;
    this.volumeScale = config.volumeScale ?? 1.0;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/version`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listSpeakers(): Promise<
    { name: string; styles: { id: number; name: string }[] }[]
  > {
    const res = await fetch(`${this.host}/speakers`);
    return res.json();
  }

  async synthesize(text: string): Promise<Buffer> {
    const cleanText = text
      .replace(/[\r\n]+/g, "、")
      .replace(/[🎉🎊✨💯🏆📰📝💻💬]/g, "")
      .trim();

    if (!cleanText) throw new Error("Empty text");

    const queryRes = await fetch(
      `${this.host}/audio_query?text=${encodeURIComponent(cleanText)}&speaker=${this.speakerId}`,
      { method: "POST" },
    );
    if (!queryRes.ok) throw new Error(`audio_query failed: ${queryRes.status}`);

    const query = await queryRes.json();
    query.speedScale = this.speedScale;
    query.pitchScale = this.pitchScale;
    query.volumeScale = this.volumeScale;

    const synthRes = await fetch(
      `${this.host}/synthesis?speaker=${this.speakerId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      },
    );
    if (!synthRes.ok) throw new Error(`synthesis failed: ${synthRes.status}`);

    return Buffer.from(await synthRes.arrayBuffer());
  }

  async speakToFile(text: string, outputDir: string): Promise<string> {
    const audio = await this.synthesize(text);
    try {
      mkdirSync(outputDir, { recursive: true });
    } catch {}
    const filePath = join(outputDir, `voice-${Date.now()}.wav`);
    writeFileSync(filePath, audio);
    return filePath;
  }

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
        if (!f.startsWith("voice-") || !f.endsWith(".wav")) continue;
        const full = join(dir, f);
        const age = now - statSync(full).mtimeMs;
        if (age > maxAge) unlinkSync(full);
      }
    } catch {}
  }
}

function playAudio(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    const escaped = filePath.replace(/'/g, "''");
    exec(
      `powershell -NoProfile -Command "(New-Object Media.SoundPlayer '${escaped}').PlaySync()"`,
      () => resolve(),
    );
  });
}
