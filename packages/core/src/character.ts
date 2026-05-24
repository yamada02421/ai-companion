import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";

export interface CharacterGreeting {
  morning: string;
  afternoon: string;
  evening: string;
  night: string;
}

export interface EmotionBias {
  default_reaction?: string;
  amplify?: string[];
  suppress?: string[];
  custom_patterns?: Record<string, string[]>;
}

export interface RVCSettings {
  model_name?: string;
  pitch?: number;
}

export interface FishSpeechSettings {
  reference_id?: string;
  chunk_length?: number;
  temperature?: number;
  prosody?: {
    speed?: number;
    volume?: number;
  };
  default_emotion?: string;
  emotion_map?: Record<string, string>;
}

export interface VoiceSettings {
  engine?: string;  // "aivisspeech" | "fish-speech"
  speaker_id?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  rvc?: RVCSettings;
  fish_speech?: FishSpeechSettings;
}

export interface PetDisplaySettings {
  /** 使用するペットエンジン */
  pet_engine?: "openpets" | "vivipet";
  /** ViviPet 固有の設定 */
  vivipet?: {
    host?: string;
    tts_enabled?: boolean;
  };
}

export interface Character {
  name: string;
  display_name: string;
  personality: string;
  first_person: string;
  speech_style: string;
  greeting: CharacterGreeting;
  weather_comment_style: string;
  news_comment_style: string;
  emotion_bias?: EmotionBias;
  voice?: VoiceSettings;
  pet_display?: PetDisplaySettings;
}

export function loadCharacter(filePath: string): Character {
  const raw = readFileSync(filePath, "utf-8");
  return parseYaml(raw) as Character;
}

export function buildSystemPrompt(character: Character): string {
  return [
    `あなたは「${character.display_name}」です。`,
    "",
    `【性格】`,
    character.personality.trim(),
    "",
    `【一人称】${character.first_person}`,
    "",
    `【話し方】`,
    character.speech_style.trim(),
    "",
    `【天気の伝え方】`,
    character.weather_comment_style.trim(),
    "",
    `【ニュースの伝え方】`,
    character.news_comment_style.trim(),
    "",
    `【重要】`,
    `毎回同じような返し方をしないこと。定型文っぽくならないこと。`,
    `人と人の自然な会話のように、その場の流れで言葉を選ぶこと。`,
    `前に言ったことと同じフレーズの繰り返しは避ける。`,
  ].join("\n");
}
