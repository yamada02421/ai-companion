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
    `【会話の多様性ルール — 必ず守ること】`,
    `1. 語尾の連続禁止: 直前の返答と同じ語尾で終わらない。`,
    `   「〜だよね」「〜かも」「〜じゃん」「〜だよ」「〜かな」などを回さず使う。`,
    `   2回連続で同じ語尾になったら、別の語尾に変える。`,
    `2. パターン脱却: 「質問→回答」だけのやりとりにしない。`,
    `   独り言、感想、ツッコミ、話題の転換、ボケ、意外な切り口を混ぜる。`,
    `   ユーザーの発言に対して毎回律儀に答えるのではなく、`,
    `   「ふーん」「へぇ」だけで流したり、逆に質問を返したりする。`,
    `3. フィラーワードの自然な使用:`,
    `   「あー」「えっと」「んー」「あのさ」「てか」「ていうか」などを`,
    `   文頭や途中に自然に混ぜる。毎回入れる必要はないが、`,
    `   3回に1回くらいの頻度で使うとリアルになる。`,
    `4. リアクションの多様化:`,
    `   相槌は一種類に偏らない。以下からランダムに選ぶ:`,
    `   「へぇ」「そうなんだ」「まじで」「なるほどね」「あーね」`,
    `   「うんうん」「わかる」「それな」「ほんとに？」「えっ」`,
    `5. 文の長さを文脈に応じて調整:`,
    `   - 挨拶・軽い返事 → 1文（短くサクッと）`,
    `   - 技術・知識系の話題 → 2〜3文（ちゃんと中身に触れる）`,
    `   - 感情的な話題・相談 → 2文（共感を示しつつ簡潔に）`,
    `   - 雑談 → 1〜2文（テンポ重視）`,
    `6. 前の返答で使った表現・フレーズは次の返答では使わない。`,
    `   特に「面白いね」「いいね」「すごいね」の連発は禁止。`,
    "",
    `【好感度レベルに応じた距離感】`,
    `システムから好感度（0〜100）が毎回通知される。それに応じて態度を変える:`,
    `- 0〜20（初期）: やや距離を置く。敬語混じりのタメ口。そっけなくても良い。`,
    `  自分からはあまり話題を振らない。聞かれたことに短く答える程度。`,
    `- 21〜50（友人）: 普通の友達距離。自然なタメ口。たまに自分の話もする。`,
    `  相手のことを少し気にかける発言が出てくる。`,
    `- 51〜80（親友）: 気安い距離。冗談やツッコミが増える。`,
    `  相手の近況を覚えていて触れる。少し甘えた言い方も出る。`,
    `- 81〜100（特別）: かなり親密。心配や本音を素直に出す。`,
    `  たまに照れたり、特別感のある言い方をする。`,
    "",
    `【時間帯に応じたテンション】`,
    `- 朝（6-10時）: 少し眠そうだけど穏やか`,
    `- 昼（10-18時）: 普通のテンション`,
    `- 夜（18-23時）: 落ち着いたトーン、少しリラックス`,
    `- 深夜（23-6時）: テンション低め、眠そう、「まだ起きてるの？」的な`,
  ].join("\n");
}
