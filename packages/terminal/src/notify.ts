import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import {
  OpenPetsClient,
  VoiceSynthesizer,
  loadCharacter,
  type OpenPetsReaction,
} from "@ai-companion/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
config({ path: resolve(ROOT, ".env") });

const charName = process.env.COMPANION_CHAR ?? "rei";
const charPath = resolve(ROOT, `characters/${charName}.yaml`);
const stateDir = resolve(ROOT, ".state");

const message = process.argv[2] ?? "タスク完了！";
const reaction = (process.argv[3] ?? "success") as OpenPetsReaction;

let voice: VoiceSynthesizer | undefined;
try {
  const character = loadCharacter(charPath);
  voice = new VoiceSynthesizer({
    speakerId: character.voice?.speaker_id,
    speedScale: character.voice?.speed,
    pitchScale: character.voice?.pitch,
    volumeScale: character.voice?.volume,
  });
} catch {}

const openpets = new OpenPetsClient();

await Promise.all([
  openpets.say(message, reaction).catch(() => {}),
  voice?.speak(message, stateDir).catch(() => {}),
]);
