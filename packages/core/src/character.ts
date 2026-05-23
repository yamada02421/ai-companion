import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";

export interface CharacterGreeting {
  morning: string;
  afternoon: string;
  evening: string;
  night: string;
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
}

export function loadCharacter(filePath: string): Character {
  const raw = readFileSync(filePath, "utf-8");
  return parseYaml(raw) as Character;
}

export function buildSystemPrompt(character: Character): string {
  return [
    `あなたは「${character.display_name}」として振る舞ってください。`,
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
    `ユーザーとの会話では、常にこのキャラクターとして応答してください。`,
    `キャラクターを壊さないでください。`,
  ].join("\n");
}
