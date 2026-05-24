import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import {
  CompanionAI,
  loadCharacter,
  OpenPetsClient,
  UnifiedVoiceSynthesizer,
  NewsCurator,
  setLogDir,
  TimelineManager,
} from "@ai-companion/core";
import type { VoiceEngine } from "@ai-companion/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
config({ path: resolve(ROOT, ".env") });

const charName = process.env.COMPANION_CHAR ?? "rei";
const charPath = resolve(ROOT, `characters/${charName}.yaml`);
if (!existsSync(charPath)) {
  console.error(`キャラクターファイルが見つかりません: ${charPath}`);
  process.exit(1);
}

const stateDir = resolve(ROOT, ".state");
setLogDir(stateDir);
const historyPath = resolve(stateDir, `${charName}-history.json`);
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

const timeline = new TimelineManager(stateDir, charName);

async function run() {
  const curator = new NewsCurator(stateDir);

  const article = await curator.curate();
  if (!article) {
    console.log("通知対象の記事がありません（頻度制限中、または新着なし）");
    process.exit(0);
  }

  // AI character voice for the teaser
  const context = `注目ニュースを紹介してください:
タイトル: ${article.title}
ソース: ${article.source}
注目理由: ${article.reason}

キャラクターとして1-2文で紹介してください。`;

  const { text, reaction } = await ai.proactiveMessage(context);

  // Console output
  console.log(`\n📰 ${article.source}: ${article.title}`);
  console.log(`   ${text}`);
  console.log(`   🔗 ${article.url}`);
  console.log(`   💡 ${article.reason}\n`);

  // Record curate event on the timeline
  timeline.addEvent("curate", article.title, `${text}\n\nSource: ${article.source}\nURL: ${article.url}`);

  // OpenPets notification + voice in parallel
  await Promise.all([
    openpets.say(text, reaction).catch(() => {}),
    voice.speak(text, stateDir).catch(() => {}),
  ]);
  await openpets.react("idle").catch(() => {});
}

run().catch((err) => {
  console.error("curate error:", err);
  process.exit(1);
});
