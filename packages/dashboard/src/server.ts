import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

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

// ---------- API Handlers ----------

/** GET /api/affinity */
function handleGetAffinity(res: http.ServerResponse): void {
  const affinityPath = path.join(STATE_DIR, `${CHAR_NAME}-affinity.json`);
  const data = readJsonFile(affinityPath);
  sendJson(res, 200, { charName: CHAR_NAME, affinity: data || null });
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
    } else if (pathname === "/api/history" && method === "GET") {
      handleGetHistory(res);
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
    } else if (pathname === "/api/export" && method === "GET") {
      handleExport(res);
    } else if (pathname === "/api/import" && method === "POST") {
      await handleImport(req, res);
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
