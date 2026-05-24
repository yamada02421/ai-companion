import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import {
  CompanionAI,
  loadCharacter,
  OpenPetsClient,
  UnifiedVoiceSynthesizer,
  setLogDir,
} from "@ai-companion/core";
import type { VoiceEngine } from "@ai-companion/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

const charName = process.env.COMPANION_CHAR ?? "default";
const charPath = resolve(__dirname, `../../../characters/${charName}.yaml`);
if (!existsSync(charPath)) {
  console.error(`キャラクターファイルが見つかりません: ${charPath}`);
  process.exit(1);
}

const historyPath = resolve(
  __dirname,
  `../../../.state/${charName}-history.json`,
);
const stateDir = resolve(__dirname, "../../../.state");
setLogDir(stateDir);
const character = loadCharacter(charPath);
const ai = new CompanionAI(character, undefined, historyPath);
const openpets = new OpenPetsClient();
const voiceEngine = (character.voice?.engine ?? "aivisspeech") as VoiceEngine;
const voice = new UnifiedVoiceSynthesizer({
  engine: voiceEngine,
  aivisspeech: {
    speakerId: character.voice?.speaker_id,
    speedScale: character.voice?.speed,
    pitchScale: character.voice?.pitch,
    volumeScale: character.voice?.volume,
  },
  fishSpeech: character.voice?.fish_speech
    ? {
        referenceId: character.voice.fish_speech.reference_id,
        chunkLength: character.voice.fish_speech.chunk_length,
        temperature: character.voice.fish_speech.temperature,
        prosody: character.voice.fish_speech.prosody,
      }
    : undefined,
});

const message = process.argv.slice(2).join(" ");

if (!message) {
  const greeting = ai.getGreeting();
  console.log(greeting);
  await Promise.all([
    openpets.say(greeting, "waving").catch(() => {}),
    voice.speak(greeting, stateDir).catch(() => {}),
  ]);
  await openpets.react("idle").catch(() => {});
  process.exit(0);
}

const { text, reaction } = await ai.chat(message);
console.log(text);

await Promise.all([
  openpets.say(text, reaction).catch(() => {}),
  voice.speak(text, stateDir).catch(() => {}),
]);
await openpets.react("idle").catch(() => {});

try {
  mkdirSync(stateDir, { recursive: true });
} catch {}
writeFileSync(resolve(stateDir, "last-message.txt"), text, "utf-8");
