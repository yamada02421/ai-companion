import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { config } from "dotenv";
import {
  OpenPetsClient,
  VoiceSynthesizer,
  loadCharacter,
  CompanionAI,
} from "@ai-companion/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
config({ path: resolve(ROOT, ".env") });

const charName = process.env.COMPANION_CHAR ?? "rei";
const charPath = resolve(ROOT, `characters/${charName}.yaml`);
const stateDir = resolve(ROOT, ".state");
const historyPath = resolve(stateDir, `${charName}-history.json`);

const character = loadCharacter(charPath);
const ai = new CompanionAI(character, undefined, historyPath);
const openpets = new OpenPetsClient();
const voice = new VoiceSynthesizer({
  speakerId: character.voice?.speaker_id,
  speedScale: character.voice?.speed,
  pitchScale: character.voice?.pitch,
  volumeScale: character.voice?.volume,
});

function getRecentActivity(): string {
  const parts: string[] = [];

  try {
    const diff = execSync("git diff --stat HEAD 2>nul", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (diff) parts.push(`変更ファイル:\n${diff}`);
  } catch {}

  try {
    const log = execSync("git log --oneline -1 --format=%s 2>nul", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (log) parts.push(`最新コミット: ${log}`);
  } catch {}

  return parts.join("\n");
}

const activity = getRecentActivity();
const context = activity
  ? `ユーザーの作業が一区切りつきました。以下の変更があったようです:\n${activity}\n\n「お疲れさま」と一言声をかけてください。作業内容に軽く触れて、15文字〜30文字程度で。`
  : "ユーザーの作業が一区切りつきました。「お疲れさま」と短く声をかけてください。15文字〜30文字程度で。";

const { text, reaction } = await ai.proactiveMessage(context);

await Promise.all([
  openpets.say(text, reaction).catch(() => {}),
  voice.speak(text, stateDir).catch(() => {}),
]);
