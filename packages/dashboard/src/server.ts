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

// Default character name
const CHAR_NAME = process.env.CHAR_NAME || "rei";

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

// ---------- Request Router ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || "GET";

  // CORS headers (for local dev)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
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
    } else if (pathname === "/api/settings" && method === "GET") {
      handleGetSettings(res);
    } else if (pathname === "/api/settings" && method === "PUT") {
      await handlePutSettings(req, res);
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
