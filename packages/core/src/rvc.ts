import { existsSync } from "fs";

export interface RVCConfig {
  modelName: string;
  projectRoot: string;
  serverUrl?: string;
  pitch?: number;
}

export class VoiceConverter {
  private modelName: string;
  private serverUrl: string;
  private pitch: number;

  constructor(config: RVCConfig) {
    this.modelName = config.modelName;
    this.serverUrl = config.serverUrl ?? "http://127.0.0.1:8090";
    this.pitch = config.pitch ?? 0;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async convert(inputWav: string, outputDir: string): Promise<string> {
    if (!(await this.isAvailable())) return inputWav;

    try {
      const res = await fetch(`${this.serverUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: inputWav,
          output_dir: outputDir,
          model: this.modelName,
          pitch: this.pitch,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) return inputWav;

      const data = (await res.json()) as { ok: boolean; output?: string };
      if (data.ok && data.output && existsSync(data.output)) {
        return data.output;
      }
      return inputWav;
    } catch {
      return inputWav;
    }
  }
}
