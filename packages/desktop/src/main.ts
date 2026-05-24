import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, screen, nativeImage } from "electron";
import { join, resolve } from "path";
import { readdirSync } from "fs";
import { CompanionAI, loadCharacter, fetchNews, formatNewsContext, fetchQiitaTrending, formatQiitaContext } from "@ai-companion/core";
import { config } from "dotenv";
import { execSync } from "child_process";

const ROOT = resolve(__dirname, "../../..");
config({ path: resolve(ROOT, ".env") });

let charName = process.env.COMPANION_CHAR ?? "default";
let charPath = resolve(ROOT, `characters/${charName}.yaml`);
let historyPath = resolve(ROOT, `.state/${charName}-history.json`);
let character = loadCharacter(charPath);
let ai = new CompanionAI(character, undefined, historyPath);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isExpanded = false;
let isContinuousMode = false;
let continuousTimer: ReturnType<typeof setInterval> | null = null;
let lastKeyPressTime = 0;
let currentShortcut = "CommandOrControl+Shift+Space";
let proactiveInterval = 15;

const BAR_HEIGHT = 72;
const EXPANDED_HEIGHT = 480;
const isDev = !app.isPackaged;

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = Math.min(800, screenWidth - 40);

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: BAR_HEIGHT,
    x: Math.round((screenWidth - winWidth) / 2),
    y: screenHeight - BAR_HEIGHT,
    frame: false,
    transparent: false,
    backgroundColor: "#1a1a2e",
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(join(__dirname, "renderer", "index.html"));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const greeting = ai.getGreeting();
    mainWindow?.webContents.send("companion:message", {
      role: "companion",
      text: greeting,
      mode: "casual",
    });
    mainWindow?.webContents.send("companion:character", {
      name: character.display_name,
    });
  });
}

function toggleExpand(expand?: boolean) {
  if (!mainWindow) return;
  isExpanded = expand ?? !isExpanded;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const [winWidth] = mainWindow.getSize();
  const newHeight = isExpanded ? EXPANDED_HEIGHT : BAR_HEIGHT;
  const newY = screenHeight - newHeight;

  mainWindow.setBounds({
    x: Math.round((screenWidth - winWidth) / 2),
    y: newY,
    width: winWidth,
    height: newHeight,
  });

  mainWindow.webContents.send("companion:expand", isExpanded);
}

async function triggerProactive(mode?: string) {
  const modes = ["news", "qiita", "work", "casual"];
  const selected = mode ?? modes[Math.floor(Math.random() * modes.length)];
  let context = "";

  mainWindow?.webContents.send("companion:thinking", true);

  try {
    switch (selected) {
      case "news": {
        const items = await fetchNews();
        context = formatNewsContext(items);
        break;
      }
      case "qiita": {
        const items = await fetchQiitaTrending(5);
        context = formatQiitaContext(items);
        if (!context) {
          const news = await fetchNews();
          context = formatNewsContext(news);
        }
        break;
      }
      case "work": {
        try {
          const log = execSync("git log --oneline -5", {
            cwd: ROOT,
            encoding: "utf-8",
            timeout: 5000,
          }).trim();
          context = log
            ? `ユーザーの最近の開発活動:\n${log}\n\nキャラクターとして短く感想や提案を。`
            : "ユーザーが作業中です。キャラクターとして短く声をかけてください。";
        } catch {
          context = "ユーザーが作業中です。キャラクターとして短く声をかけてください。";
        }
        break;
      }
      case "casual": {
        const hour = new Date().getHours();
        if (hour >= 22 || hour < 5) context = "深夜です。ユーザーがまだ起きています。体を気遣う一言を。";
        else if (hour < 10) context = "朝です。一日の始まりに短く声をかけてください。";
        else if (hour >= 12 && hour < 13) context = "お昼時です。食事を促す一言を。";
        else context = "ユーザーが作業中です。短く声をかけてください。";
        break;
      }
    }

    const reply = await ai.proactiveMessage(context);
    mainWindow?.webContents.send("companion:message", {
      role: "companion",
      text: reply,
      mode: selected,
    });
  } catch {
  } finally {
    mainWindow?.webContents.send("companion:thinking", false);
  }
}

function startContinuousMode() {
  isContinuousMode = true;
  mainWindow?.webContents.send("companion:continuous", true);
  triggerProactive();
  continuousTimer = setInterval(() => triggerProactive(), 60_000);
}

function stopContinuousMode() {
  isContinuousMode = false;
  mainWindow?.webContents.send("companion:continuous", false);
  if (continuousTimer) {
    clearInterval(continuousTimer);
    continuousTimer = null;
  }
}

function registerShortcut() {
  try { globalShortcut.unregisterAll(); } catch {}
  globalShortcut.register(currentShortcut, () => {
    const now = Date.now();
    const timeSinceLastPress = now - lastKeyPressTime;
    lastKeyPressTime = now;

    if (isContinuousMode) {
      stopContinuousMode();
      toggleExpand(false);
      return;
    }

    if (timeSinceLastPress < 300) {
      toggleExpand(true);
      startContinuousMode();
      return;
    }

    toggleExpand(true);
    triggerProactive();

    setTimeout(() => {
      if (!isContinuousMode && isExpanded) {
        toggleExpand(false);
      }
    }, 15_000);
  });
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  );
  tray = new Tray(icon);
  tray.setToolTip("AI Companion");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "表示", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "設定", click: () => { toggleExpand(true); mainWindow?.webContents.send("companion:show-settings", true); } },
    { type: "separator" },
    { label: "終了", click: () => app.quit() },
  ]));
  tray.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

function getAvailableCharacters(): string[] {
  try {
    return readdirSync(resolve(ROOT, "characters"))
      .filter((f: string) => f.endsWith(".yaml"))
      .map((f: string) => f.replace(".yaml", ""));
  } catch { return []; }
}

function switchCharacter(name: string) {
  charName = name;
  charPath = resolve(ROOT, `characters/${charName}.yaml`);
  historyPath = resolve(ROOT, `.state/${charName}-history.json`);
  character = loadCharacter(charPath);
  ai = new CompanionAI(character, undefined, historyPath);
  mainWindow?.webContents.send("companion:character", { name: character.display_name });
  const greeting = ai.getGreeting();
  mainWindow?.webContents.send("companion:message", {
    role: "companion",
    text: greeting,
    mode: "casual",
  });
}

// IPC handlers
ipcMain.handle("companion:chat", async (_event, message: string) => {
  mainWindow?.webContents.send("companion:thinking", true);
  try {
    const reply = await ai.chat(message);
    mainWindow?.webContents.send("companion:message", {
      role: "companion",
      text: reply,
      mode: "chat",
    });
    return reply;
  } finally {
    mainWindow?.webContents.send("companion:thinking", false);
  }
});

ipcMain.handle("companion:trigger", async (_event, mode: string) => {
  await triggerProactive(mode);
});

ipcMain.handle("companion:toggle-expand", () => {
  toggleExpand();
});

ipcMain.handle("companion:get-settings", () => {
  return {
    shortcut: currentShortcut,
    proactiveInterval,
    currentChar: charName,
    characters: getAvailableCharacters(),
  };
});

ipcMain.handle("companion:save-settings", (_event, settings: {
  shortcut?: string;
  proactiveInterval?: number;
  character?: string;
}) => {
  if (settings.shortcut && settings.shortcut !== currentShortcut) {
    currentShortcut = settings.shortcut;
    registerShortcut();
  }
  if (settings.proactiveInterval) {
    proactiveInterval = settings.proactiveInterval;
  }
  if (settings.character && settings.character !== charName) {
    switchCharacter(settings.character);
  }
  return true;
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerShortcut();

  setInterval(() => {
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 7) return;
    triggerProactive();
  }, proactiveInterval * 60 * 1000);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // stay in tray
});
