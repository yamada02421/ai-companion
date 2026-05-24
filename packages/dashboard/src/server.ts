import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { CompanionAI, loadCharacter } from "@ai-companion/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3456;
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const STATE_DIR = path.join(PROJECT_ROOT, ".state");
const CHARACTERS_DIR = path.join(PROJECT_ROOT, "characters");
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

// Active character state file
const ACTIVE_CHAR_FILE = path.join(STATE_DIR, "active-character.txt");

/** Resolve the current character name (env > .state file > fallback) */
function getActiveCharName(): string {
  if (process.env.CHAR_NAME) return process.env.CHAR_NAME;
  try {
    const saved = fs.readFileSync(ACTIVE_CHAR_FILE, "utf-8").trim();
    if (saved) return saved;
  } catch {
    // file doesn't exist yet
  }
  return "rei";
}

// Character name — mutable so the dashboard can switch at runtime
let CHAR_NAME = getActiveCharName();

// MIME types for static file serving
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Read a JSON file, returning null if it doesn't exist */
function readJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Read a YAML file, returning null if it doesn't exist */
function readYamlFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return YAML.parse(raw);
  } catch {
    return null;
  }
}

/** Read a YAML file as a Document to preserve formatting on round-trip */
function readYamlDocument(filePath: string): YAML.Document | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return YAML.parseDocument(raw);
  } catch {
    return null;
  }
}

/** Parse JSON body from request */
function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Send JSON response */
function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

/** Serve static files with path traversal protection */
function serveStatic(
  res: http.ServerResponse,
  requestPath: string
): void {
  // Default to index.html
  let filePath = requestPath === "/" ? "/index.html" : requestPath;

  // Resolve and ensure path is within PUBLIC_DIR
  const resolved = path.resolve(PUBLIC_DIR, "." + filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  const ext = path.extname(resolved);
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(resolved);
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}

// ---------- DataManager (import/export) ----------

// Inline lightweight data manager to avoid cross-package build dependency
function exportAllData(): Record<string, unknown> {
  const historyPath = path.join(STATE_DIR, `${CHAR_NAME}-history.json`);
  const userMemoryPath = path.join(STATE_DIR, `${CHAR_NAME}-user-memory.json`);
  const affinityPath = path.join(STATE_DIR, `${CHAR_NAME}-affinity.json`);

  const history = readJsonFile(historyPath) ?? [];
  const userMemoryRaw = readJsonFile(userMemoryPath) as Record<string, unknown> | null;
  let userMemory: unknown[] = [];
  if (Array.isArray(userMemoryRaw)) {
    userMemory = userMemoryRaw;
  } else if (userMemoryRaw && Array.isArray(userMemoryRaw.facts)) {
    userMemory = userMemoryRaw.facts as unknown[];
  }
  const affinity = readJsonFile(affinityPath) ?? null;

  return {
    version: "1.0",
    charName: CHAR_NAME,
    exportedAt: new Date().toISOString(),
    history,
    userMemory,
    affinity,
  };
}

interface ImportPayload {
  version?: string;
  charName?: string;
  history?: unknown[];
  userMemory?: unknown[];
  affinity?: Record<string, unknown> | null;
}

function importAllData(data: ImportPayload): void {
  if (!data.version) {
    throw new Error("Invalid export data: missing version");
  }
  if (data.charName && data.charName !== CHAR_NAME) {
    throw new Error(
      `Character name mismatch: expected "${CHAR_NAME}", got "${data.charName}"`
    );
  }

  // Ensure state directory exists
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch {}

  if (Array.isArray(data.history)) {
    const historyPath = path.join(STATE_DIR, `${CHAR_NAME}-history.json`);
    fs.writeFileSync(historyPath, JSON.stringify(data.history, null, 2), "utf-8");
  }

  if (Array.isArray(data.userMemory)) {
    const userMemoryPath = path.join(STATE_DIR, `${CHAR_NAME}-user-memory.json`);
    const memoryState = {
      facts: data.userMemory,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(userMemoryPath, JSON.stringify(memoryState, null, 2), "utf-8");
  }

  if (data.affinity && typeof data.affinity === "object") {
    const affinityPath = path.join(STATE_DIR, `${CHAR_NAME}-affinity.json`);
    fs.writeFileSync(affinityPath, JSON.stringify(data.affinity, null, 2), "utf-8");
  }
}

// ---------- Notification Settings Helpers ----------

const NOTIFICATION_SETTINGS_FILE = path.join(STATE_DIR, "notification-settings.json");

interface NotificationSettings {
  soundEnabled: boolean;
  toastEnabled: boolean;
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  soundEnabled: true,
  toastEnabled: true,
};

function readNotificationSettings(): NotificationSettings {
  try {
    const raw = fs.readFileSync(NOTIFICATION_SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      soundEnabled: parsed.soundEnabled ?? DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
      toastEnabled: parsed.toastEnabled ?? DEFAULT_NOTIFICATION_SETTINGS.toastEnabled,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

function writeNotificationSettings(settings: NotificationSettings): void {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch {}
  fs.writeFileSync(NOTIFICATION_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

// ---------- CompanionAI Chat Instance ----------

/** Lazily initialized CompanionAI instance (recreated when character switches) */
let companionAI: CompanionAI | null = null;
let companionCharName: string | null = null;

function getCompanionAI(): CompanionAI {
  if (companionAI && companionCharName === CHAR_NAME) {
    return companionAI;
  }

  const yamlPath = path.join(CHARACTERS_DIR, `${CHAR_NAME}.yaml`);
  const character = loadCharacter(yamlPath);
  const historyPath = path.join(STATE_DIR, `${CHAR_NAME}-history.json`);

  companionAI = new CompanionAI(character, undefined, historyPath);
  companionCharName = CHAR_NAME;
  return companionAI;
}

/** POST /api/chat */
async function handlePostChat(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseBody(req);
    const { message } = JSON.parse(body) as { message?: string };

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      sendJson(res, 400, { error: "Missing 'message' field" });
      return;
    }

    const ai = getCompanionAI();
    const response = await ai.chat(message.trim());

    sendJson(res, 200, { text: response.text, reaction: response.reaction });
  } catch (e) {
    console.error("Chat error:", e);
    const msg = e instanceof Error ? e.message : "Chat failed";
    sendJson(res, 500, { error: msg });
  }
}

// ---------- Personality Evolution (inline to avoid cross-package dependency) ----------

interface EvolutionStageInfo {
  minLevel: number;
  maxLevel: number;
  label: string;
  unlockedBehaviors: string[];
}

const EVOLUTION_STAGES: EvolutionStageInfo[] = [
  {
    minLevel: 0, maxLevel: 20, label: "知り合い",
    unlockedBehaviors: ["基本的な挨拶", "質問への短い回答", "天気・ニュースの共有"],
  },
  {
    minLevel: 21, maxLevel: 50, label: "友達",
    unlockedBehaviors: ["基本的な挨拶", "質問への短い回答", "天気・ニュースの共有", "冗談・ツッコミ", "自分の好みの共有", "カジュアルな話題振り"],
  },
  {
    minLevel: 51, maxLevel: 80, label: "親友",
    unlockedBehaviors: ["基本的な挨拶", "質問への短い回答", "天気・ニュースの共有", "冗談・ツッコミ", "自分の好みの共有", "カジュアルな話題振り", "本音トーク", "心配・気遣い", "甘え表現", "過去の会話の参照"],
  },
  {
    minLevel: 81, maxLevel: 100, label: "特別",
    unlockedBehaviors: ["基本的な挨拶", "質問への短い回答", "天気・ニュースの共有", "冗談・ツッコミ", "自分の好みの共有", "カジュアルな話題振り", "本音トーク", "心配・気遣い", "甘え表現", "過去の会話の参照", "感情的に深い会話", "秘密の共有", "記念日の記憶", "名前呼び"],
  },
];

function getEvolutionStage(level: number): EvolutionStageInfo {
  const clamped = Math.max(0, Math.min(100, Math.floor(level)));
  for (const stage of EVOLUTION_STAGES) {
    if (clamped >= stage.minLevel && clamped <= stage.maxLevel) {
      return stage;
    }
  }
  return EVOLUTION_STAGES[0];
}

function getNextEvolutionStage(level: number): EvolutionStageInfo | null {
  const current = getEvolutionStage(level);
  const idx = EVOLUTION_STAGES.indexOf(current);
  if (idx < EVOLUTION_STAGES.length - 1) {
    return EVOLUTION_STAGES[idx + 1];
  }
  return null;
}

// ---------- API Handlers ----------

/** GET /api/affinity */
function handleGetAffinity(res: http.ServerResponse): void {
  const affinityPath = path.join(STATE_DIR, `${CHAR_NAME}-affinity.json`);
  const data = readJsonFile(affinityPath) as Record<string, unknown> | null;

  // Compute evolution stage info
  const level = (data && typeof data.level === "number") ? data.level : 0;
  const currentStage = getEvolutionStage(level);
  const nextStage = getNextEvolutionStage(level);
  const levelsToNext = nextStage ? nextStage.minLevel - Math.floor(level) : 0;

  const evolution = {
    currentStage: currentStage.label,
    minLevel: currentStage.minLevel,
    maxLevel: currentStage.maxLevel,
    unlockedBehaviors: currentStage.unlockedBehaviors,
    nextStage: nextStage ? nextStage.label : null,
    levelsToNext,
    allStages: EVOLUTION_STAGES.map((s) => ({ label: s.label, minLevel: s.minLevel, maxLevel: s.maxLevel })),
  };

  sendJson(res, 200, { charName: CHAR_NAME, affinity: data || null, evolution });
}

/** GET /api/history */
function handleGetHistory(res: http.ServerResponse): void {
  const historyPath = path.join(STATE_DIR, `${CHAR_NAME}-history.json`);
  const data = readJsonFile(historyPath);
  sendJson(res, 200, { charName: CHAR_NAME, history: data || [] });
}

/** GET /api/user-memory */
function handleGetUserMemory(res: http.ServerResponse): void {
  const memoryPath = path.join(STATE_DIR, `${CHAR_NAME}-user-memory.json`);
  const data = readJsonFile(memoryPath);
  sendJson(res, 200, { charName: CHAR_NAME, memory: data || null });
}

/** DELETE /api/user-memory/:id */
function handleDeleteUserMemory(
  res: http.ServerResponse,
  factId: string
): void {
  const memoryPath = path.join(STATE_DIR, `${CHAR_NAME}-user-memory.json`);
  const data = readJsonFile(memoryPath) as Record<string, unknown> | null;

  if (!data) {
    sendJson(res, 404, { error: "Memory file not found" });
    return;
  }

  // Memory structure: { facts: [...] } or array of facts
  let facts: Array<Record<string, unknown>>;
  let isWrapped = false;

  if (Array.isArray(data)) {
    facts = data;
  } else if (data && typeof data === "object" && "facts" in data && Array.isArray(data.facts)) {
    facts = data.facts as Array<Record<string, unknown>>;
    isWrapped = true;
  } else {
    sendJson(res, 400, { error: "Unexpected memory format" });
    return;
  }

  const idx = facts.findIndex(
    (f) => f.id === factId || String(f.id) === factId
  );
  if (idx === -1) {
    sendJson(res, 404, { error: "Fact not found" });
    return;
  }

  facts.splice(idx, 1);

  const toWrite = isWrapped ? { ...data, facts } : facts;
  fs.writeFileSync(memoryPath, JSON.stringify(toWrite, null, 2), "utf-8");
  sendJson(res, 200, { success: true });
}

/** GET /api/settings */
function handleGetSettings(res: http.ServerResponse): void {
  const yamlPath = path.join(CHARACTERS_DIR, `${CHAR_NAME}.yaml`);
  const data = readYamlFile(yamlPath);
  if (!data) {
    sendJson(res, 404, { error: "Character file not found" });
    return;
  }
  sendJson(res, 200, { charName: CHAR_NAME, settings: data });
}

/** GET /api/timeline */
function handleGetTimeline(
  res: http.ServerResponse,
  url: URL
): void {
  const timelinePath = path.join(STATE_DIR, `${CHAR_NAME}-timeline.json`);
  const raw = readJsonFile(timelinePath) as unknown[] | null;
  const events = Array.isArray(raw) ? raw : [];

  const dateParam = url.searchParams.get("date");

  if (dateParam) {
    // Filter by date (YYYY-MM-DD)
    const filtered = events
      .filter((e: any) => typeof e.timestamp === "string" && e.timestamp.startsWith(dateParam))
      .reverse();
    sendJson(res, 200, { charName: CHAR_NAME, events: filtered });
    return;
  }

  // Return latest N events (default 50)
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const latest = events.slice(-limit).reverse();
  sendJson(res, 200, { charName: CHAR_NAME, events: latest });
}

/** GET /api/history/search?q=keyword */
function handleSearchHistory(
  res: http.ServerResponse,
  url: URL
): void {
  const keyword = url.searchParams.get("q")?.trim();
  if (!keyword) {
    sendJson(res, 400, { error: "Missing 'q' query parameter" });
    return;
  }

  const historyPath = path.join(STATE_DIR, `${CHAR_NAME}-history.json`);
  const raw = readJsonFile(historyPath) as Array<{ role: string; content: string }> | null;
  const history = Array.isArray(raw) ? raw : [];

  const lower = keyword.toLowerCase();
  const results = history.filter((m) =>
    typeof m.content === "string" && m.content.toLowerCase().includes(lower),
  );

  sendJson(res, 200, { charName: CHAR_NAME, keyword, results });
}

/** GET /api/memory */
function handleGetConversationMemory(res: http.ServerResponse): void {
  const memoryPath = path.join(STATE_DIR, `${CHAR_NAME}-history-memory.json`);
  const data = readJsonFile(memoryPath);
  sendJson(res, 200, { charName: CHAR_NAME, memory: data || null });
}

/** GET /api/curator-history */
function handleGetCuratorHistory(res: http.ServerResponse): void {
  const historyPath = path.join(STATE_DIR, "curator-history.json");
  const data = readJsonFile(historyPath) as { urls?: string[] } | null;
  sendJson(res, 200, { urls: data?.urls || [] });
}

/** PUT /api/settings */
async function handlePutSettings(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const yamlPath = path.join(CHARACTERS_DIR, `${CHAR_NAME}.yaml`);

  // Ensure the file exists
  if (!fs.existsSync(yamlPath)) {
    sendJson(res, 404, { error: "Character file not found" });
    return;
  }

  try {
    const body = await parseBody(req);
    const updates = JSON.parse(body) as Record<string, unknown>;

    // Read current YAML as Document to preserve formatting (quotes, comments, etc.)
    const doc = readYamlDocument(yamlPath);
    if (!doc) {
      sendJson(res, 500, { error: "Failed to read current settings" });
      return;
    }

    // Apply updates using Document API for format-preserving round-trip
    if (updates.voice && typeof updates.voice === "object") {
      const voiceUpdates = updates.voice as Record<string, unknown>;
      for (const [k, v] of Object.entries(voiceUpdates)) {
        doc.setIn(["voice", k], v);
      }
    }
    // Merge other top-level keys
    for (const key of Object.keys(updates)) {
      if (key !== "voice") {
        doc.set(key, updates[key]);
      }
    }

    fs.writeFileSync(yamlPath, doc.toString(), "utf-8");
    const result = doc.toJSON() as Record<string, unknown>;
    sendJson(res, 200, { success: true, settings: result });
  } catch (e) {
    sendJson(res, 400, { error: "Invalid request body" });
  }
}

/** GET /api/characters — list all character YAML files */
function handleGetCharacters(res: http.ServerResponse): void {
  try {
    const files = fs.readdirSync(CHARACTERS_DIR).filter((f) => f.endsWith(".yaml"));
    const characters = files.map((file) => {
      const yamlPath = path.join(CHARACTERS_DIR, file);
      const data = readYamlFile(yamlPath) as Record<string, unknown> | null;
      const name = file.replace(/\.yaml$/, "");
      return {
        name,
        display_name: data?.display_name ?? name,
        personality: typeof data?.personality === "string"
          ? data.personality.split("\n")[0].trim()
          : "",
      };
    });
    sendJson(res, 200, { characters, active: CHAR_NAME });
  } catch {
    sendJson(res, 500, { error: "Failed to read characters directory" });
  }
}

/** GET /api/character/active — current active character name */
function handleGetActiveCharacter(res: http.ServerResponse): void {
  sendJson(res, 200, { active: CHAR_NAME });
}

/** PUT /api/character/active — switch active character */
async function handlePutActiveCharacter(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseBody(req);
    const { name } = JSON.parse(body) as { name?: string };
    if (!name || typeof name !== "string") {
      sendJson(res, 400, { error: "Missing 'name' field" });
      return;
    }

    // Validate that the character file exists
    const yamlPath = path.join(CHARACTERS_DIR, `${name}.yaml`);
    if (!fs.existsSync(yamlPath)) {
      sendJson(res, 404, { error: `Character '${name}' not found` });
      return;
    }

    // Persist to .state/active-character.txt
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    } catch {}
    fs.writeFileSync(ACTIVE_CHAR_FILE, name, "utf-8");

    // Update in-memory value
    CHAR_NAME = name;

    sendJson(res, 200, { success: true, active: name });
  } catch {
    sendJson(res, 400, { error: "Invalid request body" });
  }
}

/** GET /api/export */
function handleExport(res: http.ServerResponse): void {
  try {
    const data = exportAllData();
    const json = JSON.stringify(data, null, 2);
    const filename = `${CHAR_NAME}-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    res.end(json);
  } catch (e) {
    sendJson(res, 500, { error: "Export failed" });
  }
}

/** GET /api/export/markdown */
function handleExportMarkdown(res: http.ServerResponse): void {
  try {
    const historyPath = path.join(STATE_DIR, `${CHAR_NAME}-history.json`);
    const userMemoryPath = path.join(STATE_DIR, `${CHAR_NAME}-user-memory.json`);
    const affinityPath = path.join(STATE_DIR, `${CHAR_NAME}-affinity.json`);

    const history = (readJsonFile(historyPath) as Array<{ role: string; content: string; timestamp?: string }>) ?? [];
    const userMemoryRaw = readJsonFile(userMemoryPath) as Record<string, unknown> | null;
    let userMemory: Array<{ content: string; category: string; confidence: number }> = [];
    if (Array.isArray(userMemoryRaw)) {
      userMemory = userMemoryRaw as typeof userMemory;
    } else if (userMemoryRaw && Array.isArray(userMemoryRaw.facts)) {
      userMemory = userMemoryRaw.facts as typeof userMemory;
    }
    const affinity = readJsonFile(affinityPath) as { level?: number; streak?: number } | null;

    const now = new Date();
    const exportDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // Determine affinity stage label
    const level = affinity?.level ?? 0;
    let stageLabel = "知り合い";
    if (level >= 81) stageLabel = "特別";
    else if (level >= 51) stageLabel = "親友";
    else if (level >= 21) stageLabel = "友達";

    const lines: string[] = [];

    // Header
    lines.push(`# ${CHAR_NAME}との会話ログ`);
    lines.push("");
    lines.push(`エクスポート日時: ${exportDate}`);
    lines.push("");

    // Stats
    lines.push("## 統計");
    lines.push(`- 総会話数: ${history.length}`);
    lines.push(`- 好感度: Lv.${Math.floor(level)} (${stageLabel})`);
    lines.push(`- 連続日数: ${affinity?.streak ?? 0}日`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Conversation history grouped by date
    lines.push("## 会話履歴");
    lines.push("");

    if (history.length === 0) {
      lines.push("会話履歴はありません。");
      lines.push("");
    } else {
      // Group messages by date
      const grouped = new Map<string, typeof history>();
      for (const msg of history) {
        let dateKey: string;
        if (msg.timestamp) {
          dateKey = msg.timestamp.slice(0, 10);
        } else {
          dateKey = "日付不明";
        }
        if (!grouped.has(dateKey)) {
          grouped.set(dateKey, []);
        }
        grouped.get(dateKey)!.push(msg);
      }

      for (const [date, messages] of grouped) {
        lines.push(`### ${date}`);
        lines.push("");
        for (const msg of messages) {
          const speaker = msg.role === "user" ? "あなた" : CHAR_NAME;
          const content = msg.content.length > 500
            ? msg.content.slice(0, 500) + "..."
            : msg.content;
          lines.push(`**${speaker}**: ${content}`);
          lines.push("");
        }
      }
    }

    lines.push("---");
    lines.push("");

    // User memory facts
    lines.push("### ユーザーについて学んだこと");
    if (userMemory.length === 0) {
      lines.push("まだ学んだことはありません。");
    } else {
      for (const fact of userMemory) {
        lines.push(`- ${fact.content} (${fact.category}, 信頼度: ${fact.confidence})`);
      }
    }
    lines.push("");

    const markdown = lines.join("\n");
    const filename = `${CHAR_NAME}-conversation-${now.toISOString().slice(0, 10)}.md`;

    res.writeHead(200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    res.end(markdown);
  } catch (e) {
    sendJson(res, 500, { error: "Markdown export failed" });
  }
}

/** POST /api/import */
async function handleImport(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseBody(req);
    const data = JSON.parse(body) as ImportPayload;
    importAllData(data);
    sendJson(res, 200, { success: true, message: "Data imported successfully" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import failed";
    sendJson(res, 400, { error: message });
  }
}

/** GET /api/notification-settings */
function handleGetNotificationSettings(res: http.ServerResponse): void {
  const settings = readNotificationSettings();
  sendJson(res, 200, { settings });
}

/** PUT /api/notification-settings */
async function handlePutNotificationSettings(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseBody(req);
    const updates = JSON.parse(body) as Partial<NotificationSettings>;
    const current = readNotificationSettings();

    if (updates.soundEnabled !== undefined) {
      current.soundEnabled = updates.soundEnabled;
    }
    if (updates.toastEnabled !== undefined) {
      current.toastEnabled = updates.toastEnabled;
    }

    writeNotificationSettings(current);
    sendJson(res, 200, { success: true, settings: current });
  } catch {
    sendJson(res, 400, { error: "Invalid request body" });
  }
}

// ---------- Stats ----------

interface StatsHistoryMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface StatsTimelineEvent {
  id: string;
  type: string;
  timestamp: string;
  summary: string;
  details?: string;
}

interface StatsAffinityState {
  level: number;
  totalInteractions: number;
  streak: number;
  lastInteraction: string;
  mood: string;
  milestones: string[];
}

interface StatsUserMemoryState {
  facts: Array<{
    id: string;
    category: string;
    content: string;
    createdAt: string;
    confidence: number;
  }>;
  updatedAt: string;
}

interface StatsData {
  totalMessages: number;
  totalDays: number;
  avgMessagesPerDay: number;
  longestStreak: number;
  currentStreak: number;
  favoriteTopics: { topic: string; count: number }[];
  activeHours: { hour: number; count: number }[];
  weekdayActivity: { day: string; count: number }[];
  moodHistory: { date: string; mood: string }[];
  levelHistory: { date: string; level: number }[];
}

function calculateStats(): StatsData {
  const historyPath = path.join(STATE_DIR, `${CHAR_NAME}-history.json`);
  const affinityPath = path.join(STATE_DIR, `${CHAR_NAME}-affinity.json`);
  const timelinePath = path.join(STATE_DIR, `${CHAR_NAME}-timeline.json`);
  const userMemoryPath = path.join(STATE_DIR, `${CHAR_NAME}-user-memory.json`);

  const history = (readJsonFile(historyPath) as StatsHistoryMessage[] | null) ?? [];
  const affinity = readJsonFile(affinityPath) as StatsAffinityState | null;
  const timelineRaw = readJsonFile(timelinePath) as StatsTimelineEvent[] | null;
  const timeline = Array.isArray(timelineRaw) ? timelineRaw : [];
  const userMemory = readJsonFile(userMemoryPath) as StatsUserMemoryState | null;

  const totalMessages = Array.isArray(history) ? history.length : 0;

  // Calculate total days from timestamps
  const dates = new Set<string>();
  for (const msg of (Array.isArray(history) ? history : [])) {
    if (msg.timestamp) {
      const date = msg.timestamp.slice(0, 10);
      if (date.length === 10) dates.add(date);
    }
  }
  for (const evt of timeline) {
    if (evt.timestamp) {
      const date = evt.timestamp.slice(0, 10);
      if (date.length === 10) dates.add(date);
    }
  }
  const totalDays = dates.size || 1;
  const avgMessagesPerDay = Math.round((totalMessages / totalDays) * 10) / 10;

  // Streaks
  const currentStreak = affinity?.streak ?? 0;
  const chatDates = new Set<string>();
  for (const evt of timeline) {
    if (evt.type === "chat" && evt.timestamp) {
      chatDates.add(evt.timestamp.slice(0, 10));
    }
  }
  let longestStreak = currentStreak;
  if (chatDates.size > 0) {
    const sorted = [...chatDates].sort();
    let longest = 1;
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        streak++;
        if (streak > longest) longest = streak;
      } else {
        streak = 1;
      }
    }
    longestStreak = Math.max(longest, currentStreak);
  }

  // Favorite topics from user memory categories
  const favoriteTopics: { topic: string; count: number }[] = [];
  if (userMemory && Array.isArray(userMemory.facts)) {
    const categoryLabels: Record<string, string> = {
      preference: "好み",
      habit: "習慣",
      work: "仕事",
      interest: "興味",
      personal: "個人情報",
      other: "その他",
    };
    const categoryCount = new Map<string, number>();
    for (const fact of userMemory.facts) {
      const label = categoryLabels[fact.category] || fact.category;
      categoryCount.set(label, (categoryCount.get(label) || 0) + 1);
    }
    for (const [topic, count] of categoryCount) {
      favoriteTopics.push({ topic, count });
    }
    favoriteTopics.sort((a, b) => b.count - a.count);
    favoriteTopics.splice(5);
  }

  // Active hours
  const hourCounts = new Array(24).fill(0);
  for (const msg of (Array.isArray(history) ? history : [])) {
    if (msg.timestamp) {
      try {
        const d = new Date(msg.timestamp);
        if (!isNaN(d.getTime())) hourCounts[d.getHours()]++;
      } catch {}
    }
  }
  for (const evt of timeline) {
    if (evt.type === "chat" && evt.timestamp) {
      try {
        const d = new Date(evt.timestamp);
        if (!isNaN(d.getTime())) hourCounts[d.getHours()]++;
      } catch {}
    }
  }
  const activeHours = hourCounts.map((count: number, hour: number) => ({ hour, count }));

  // Weekday activity
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const dayCounts = new Array(7).fill(0);
  for (const msg of (Array.isArray(history) ? history : [])) {
    if (msg.timestamp) {
      try {
        const d = new Date(msg.timestamp);
        if (!isNaN(d.getTime())) dayCounts[d.getDay()]++;
      } catch {}
    }
  }
  for (const evt of timeline) {
    if (evt.type === "chat" && evt.timestamp) {
      try {
        const d = new Date(evt.timestamp);
        if (!isNaN(d.getTime())) dayCounts[d.getDay()]++;
      } catch {}
    }
  }
  const weekdayActivity = dayCounts.map((count: number, i: number) => ({ day: dayNames[i], count }));

  // Mood history from timeline
  const moodByDate = new Map<string, string>();
  for (const evt of timeline) {
    const date = evt.timestamp?.slice(0, 10);
    if (!date) continue;
    if (evt.type === "milestone") {
      moodByDate.set(date, "excited");
    } else if (evt.type === "chat" && !moodByDate.has(date)) {
      moodByDate.set(date, "happy");
    }
  }
  const moodHistory = [...moodByDate.entries()]
    .map(([date, mood]) => ({ date, mood }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Level history (approximate)
  const levelChatDates = [...chatDates].sort();
  const currentLevel = affinity?.level ?? 0;
  const levelHistory: { date: string; level: number }[] = [];
  if (levelChatDates.length > 0) {
    const levelPerDay = levelChatDates.length > 1 ? currentLevel / levelChatDates.length : currentLevel;
    for (let i = 0; i < levelChatDates.length; i++) {
      const approxLevel = Math.min(Math.round(levelPerDay * (i + 1) * 10) / 10, 100);
      levelHistory.push({ date: levelChatDates[i], level: approxLevel });
    }
    if (levelHistory.length > 0) {
      levelHistory[levelHistory.length - 1].level = currentLevel;
    }
    // Keep last 30 entries
    levelHistory.splice(0, Math.max(0, levelHistory.length - 30));
  } else if (currentLevel > 0) {
    levelHistory.push({ date: new Date().toISOString().slice(0, 10), level: currentLevel });
  }

  return {
    totalMessages,
    totalDays,
    avgMessagesPerDay,
    longestStreak,
    currentStreak,
    favoriteTopics,
    activeHours,
    weekdayActivity,
    moodHistory,
    levelHistory,
  };
}

/** GET /api/stats */
function handleGetStats(res: http.ServerResponse): void {
  try {
    const stats = calculateStats();
    sendJson(res, 200, { charName: CHAR_NAME, stats });
  } catch (e) {
    sendJson(res, 500, { error: "Failed to calculate stats" });
  }
}

// ---------- Health Check ----------

interface ServiceStatus {
  name: string;
  status: "ok" | "down" | "unknown";
  latency?: number;
  details?: string;
}

const HEALTH_TIMEOUT = 2000;

async function httpHealthCheck(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; elapsed: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, elapsed: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, elapsed: Math.round(performance.now() - start) };
  }
}

async function checkOpenPetsHealth(): Promise<ServiceStatus> {
  const configPath = path.join(
    process.env.APPDATA ?? "",
    "OpenPets",
    "runtime",
    "ipc.json",
  );
  if (!fs.existsSync(configPath)) {
    return { name: "OpenPets", status: "down", details: "IPC config not found" };
  }

  const start = performance.now();
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as {
      protocolVersion: number;
      endpoint: string;
      token: string;
    };

    const result = await new Promise<boolean>((resolve) => {
      const socket = net.connect(config.endpoint);
      let data = "";
      socket.setTimeout(HEALTH_TIMEOUT);
      socket.on("connect", () => {
        socket.write(
          JSON.stringify({
            id: "health-check",
            version: config.protocolVersion,
            token: config.token,
            method: "lease.acquire",
            params: {},
          }) + "\n",
        );
      });
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          try {
            resolve(JSON.parse(data.split("\n")[0]).ok === true);
          } catch {
            resolve(false);
          }
          socket.destroy();
        }
      });
      socket.on("timeout", () => { socket.destroy(); resolve(false); });
      socket.on("error", () => resolve(false));
    });

    const elapsed = Math.round(performance.now() - start);
    return {
      name: "OpenPets",
      status: result ? "ok" : "down",
      latency: elapsed,
      details: result ? "IPC connected" : "lease.acquire failed",
    };
  } catch {
    return {
      name: "OpenPets",
      status: "down",
      latency: Math.round(performance.now() - start),
      details: "IPC connection error",
    };
  }
}

async function runHealthChecks(): Promise<ServiceStatus[]> {
  const httpChecks: Array<{ name: string; url: string }> = [
    { name: "AivisSpeech", url: "http://127.0.0.1:10101/version" },
    { name: "Fish Speech S2", url: "http://127.0.0.1:8080/v1/health" },
    { name: "ViviPet", url: "http://localhost:18765/adapter" },
    { name: "Dashboard", url: `http://127.0.0.1:${PORT}/api/settings` },
  ];

  const httpResults = httpChecks.map(async ({ name, url }) => {
    const { ok, elapsed } = await httpHealthCheck(url, HEALTH_TIMEOUT);
    return {
      name,
      status: ok ? "ok" : "down",
      latency: elapsed,
      details: ok ? "responding" : "unreachable",
    } as ServiceStatus;
  });

  const [openPetsResult, ...rest] = await Promise.all([
    checkOpenPetsHealth(),
    ...httpResults,
  ]);

  // Reorder: AivisSpeech, Fish Speech S2, OpenPets, ViviPet, Dashboard
  return [rest[0], rest[1], openPetsResult, rest[2], rest[3]];
}

/** GET /api/health */
async function handleGetHealth(res: http.ServerResponse): Promise<void> {
  try {
    const services = await runHealthChecks();
    sendJson(res, 200, { services });
  } catch {
    sendJson(res, 500, { error: "Health check failed" });
  }
}

// ---------- Request Router ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || "GET";

  // CORS headers (for local dev)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // API routes
    if (pathname === "/api/affinity" && method === "GET") {
      handleGetAffinity(res);
    } else if (pathname === "/api/history/search" && method === "GET") {
      handleSearchHistory(res, url);
    } else if (pathname === "/api/history" && method === "GET") {
      handleGetHistory(res);
    } else if (pathname === "/api/memory" && method === "GET") {
      handleGetConversationMemory(res);
    } else if (pathname === "/api/user-memory" && method === "GET") {
      handleGetUserMemory(res);
    } else if (
      pathname.startsWith("/api/user-memory/") &&
      method === "DELETE"
    ) {
      const factId = decodeURIComponent(pathname.slice("/api/user-memory/".length));
      handleDeleteUserMemory(res, factId);
    } else if (pathname === "/api/timeline" && method === "GET") {
      handleGetTimeline(res, url);
    } else if (pathname === "/api/curator-history" && method === "GET") {
      handleGetCuratorHistory(res);
    } else if (pathname === "/api/settings" && method === "GET") {
      handleGetSettings(res);
    } else if (pathname === "/api/settings" && method === "PUT") {
      await handlePutSettings(req, res);
    } else if (pathname === "/api/characters" && method === "GET") {
      handleGetCharacters(res);
    } else if (pathname === "/api/character/active" && method === "GET") {
      handleGetActiveCharacter(res);
    } else if (pathname === "/api/character/active" && method === "PUT") {
      await handlePutActiveCharacter(req, res);
    } else if (pathname === "/api/export/markdown" && method === "GET") {
      handleExportMarkdown(res);
    } else if (pathname === "/api/export" && method === "GET") {
      handleExport(res);
    } else if (pathname === "/api/import" && method === "POST") {
      await handleImport(req, res);
    } else if (pathname === "/api/notification-settings" && method === "GET") {
      handleGetNotificationSettings(res);
    } else if (pathname === "/api/notification-settings" && method === "PUT") {
      await handlePutNotificationSettings(req, res);
    } else if (pathname === "/api/health" && method === "GET") {
      await handleGetHealth(res);
    } else if (pathname === "/api/stats" && method === "GET") {
      handleGetStats(res);
    } else if (pathname === "/api/chat" && method === "POST") {
      await handlePostChat(req, res);
    } else if (!pathname.startsWith("/api/")) {
      // Static files
      serveStatic(res, pathname);
    } else {
      sendJson(res, 404, { error: "Not found" });
    }
  } catch (err) {
    console.error("Request error:", err);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Character: ${CHAR_NAME}`);
  console.log(`State dir: ${STATE_DIR}`);
});
