import { VoiceSynthesizer, type VoiceConfig } from "./voice.js";
import { FishSpeechSynthesizer, type FishSpeechConfig } from "./fish-speech.js";

export type VoiceEngine = "aivisspeech" | "fish-speech";

export interface UnifiedVoiceConfig {
  engine: VoiceEngine;
  aivisspeech?: VoiceConfig;
  fishSpeech?: FishSpeechConfig;
}

export class UnifiedVoiceSynthesizer {
  private aivisSynth: VoiceSynthesizer | null = null;
  private fishSynth: FishSpeechSynthesizer | null = null;
  private activeEngine: VoiceEngine;

  constructor(config: UnifiedVoiceConfig) {
    this.activeEngine = config.engine;

    // Always create AivisSpeech instance (needed for fallback)
    if (config.aivisspeech || config.engine === "aivisspeech") {
      this.aivisSynth = new VoiceSynthesizer(config.aivisspeech);
    }

    // Create Fish Speech instance if configured or selected
    if (config.fishSpeech || config.engine === "fish-speech") {
      this.fishSynth = new FishSpeechSynthesizer(config.fishSpeech);
    }
  }

  /**
   * Speak the text using the active engine.
   * If Fish Speech is active but unavailable, falls back to AivisSpeech.
   */
  async speak(text: string, outputDir: string): Promise<void> {
    if (this.activeEngine === "fish-speech" && this.fishSynth) {
      const available = await this.fishSynth.isAvailable();
      if (available) {
        await this.fishSynth.speak(text, outputDir);
        return;
      }
      // Fallback to AivisSpeech
      if (this.aivisSynth) {
        await this.aivisSynth.speak(text, outputDir);
        return;
      }
    }

    if (this.aivisSynth) {
      await this.aivisSynth.speak(text, outputDir);
      return;
    }

    // No engine available -- silently do nothing
  }
}
