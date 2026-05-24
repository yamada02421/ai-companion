import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import {
  CompanionAI,
  loadCharacter,
  OpenPetsClient,
  VoiceSynthesizer,
  NewsCurator,
  setLogDir,
} from "@ai-companion/core";

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
const voice = new VoiceSynthesizer({
  speakerId: character.voice?.speaker_id,
  speedScale: character.voice?.speed,
  pitchScale: character.voice?.pitch,
  volumeScale: character.voice?.volume,
  rvc: character.voice?.rvc?.model_name
    ? {
        modelName: character.voice.rvc.model_name,
        pitch: character.voice.rvc.pitch,
        projectRoot: ROOT,
      }
    : undefined,
});

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
