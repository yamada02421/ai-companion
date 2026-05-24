import { exec } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { logError } from "./logger.js";

// --- Types ---

export type NotificationSoundType = "chat" | "news" | "milestone" | "alert";

export interface NotificationSettings {
  soundEnabled: boolean;
  toastEnabled: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  soundEnabled: true,
  toastEnabled: true,
};

// Map sound types to System.Media.SystemSounds members
const SOUND_MAP: Record<NotificationSoundType, string> = {
  chat: "Asterisk",
  news: "Beep",
  milestone: "Exclamation",
  alert: "Hand",
};

// --- NotificationManager ---

export class NotificationManager {
  private stateDir: string;
  private settingsPath: string;
  private settings: NotificationSettings;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.settingsPath = join(stateDir, "notification-settings.json");
    this.settings = this.loadSettings();
  }

  /** Load settings from disk, falling back to defaults */
  private loadSettings(): NotificationSettings {
    try {
      const raw = readFileSync(this.settingsPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
      return {
        soundEnabled: parsed.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
        toastEnabled: parsed.toastEnabled ?? DEFAULT_SETTINGS.toastEnabled,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /** Save current settings to disk */
  saveSettings(updates: Partial<NotificationSettings>): void {
    if (updates.soundEnabled !== undefined) {
      this.settings.soundEnabled = updates.soundEnabled;
    }
    if (updates.toastEnabled !== undefined) {
      this.settings.toastEnabled = updates.toastEnabled;
    }
    try {
      mkdirSync(this.stateDir, { recursive: true });
    } catch {}
    writeFileSync(
      this.settingsPath,
      JSON.stringify(this.settings, null, 2),
      "utf-8",
    );
  }

  /** Get current settings */
  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  /** Reload settings from disk (useful when another process updates the file) */
  reloadSettings(): void {
    this.settings = this.loadSettings();
  }

  /**
   * Show a Windows toast notification via PowerShell.
   * Uses BurntToast module if available, otherwise falls back to
   * basic .NET toast or `msg` command.
   */
  async toast(title: string, message: string): Promise<void> {
    if (!this.settings.toastEnabled) return;

    // Escape single quotes for PowerShell strings
    const safeTitle = title.replace(/'/g, "''");
    const safeMessage = message.replace(/'/g, "''");

    // Strategy 1: BurntToast module (most reliable for desktop notifications)
    // Strategy 2: .NET ToastNotificationManager
    // Strategy 3: Simple msg command fallback
    const script = `
try {
  if (Get-Command New-BurntToastNotification -ErrorAction SilentlyContinue) {
    New-BurntToastNotification -Text '${safeTitle}', '${safeMessage}' -ErrorAction Stop
    exit 0
  }
} catch {}

try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

  $template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$('${safeTitle}')</text>
      <text>$('${safeMessage}')</text>
    </binding>
  </visual>
</toast>
"@

  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml($template)
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AI Companion')
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  $notifier.Show($toast)
  exit 0
} catch {}

try {
  $wshell = New-Object -ComObject Wscript.Shell
  $wshell.Popup('${safeMessage}', 5, '${safeTitle}', 0x40)
  exit 0
} catch {}
`;

    return new Promise<void>((resolve) => {
      exec(
        `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
        { timeout: 10000 },
        (error) => {
          if (error) {
            logError("notification.toast", error);
          }
          resolve();
        },
      );
    });
  }

  /**
   * Play a system notification sound via PowerShell.
   * Uses [System.Media.SystemSounds] to play built-in Windows sounds.
   */
  async playNotificationSound(type: NotificationSoundType): Promise<void> {
    if (!this.settings.soundEnabled) return;

    const soundMember = SOUND_MAP[type] ?? "Asterisk";

    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Media.SystemSounds]::${soundMember}.Play()`;

    return new Promise<void>((resolve) => {
      exec(
        `powershell -NoProfile -NonInteractive -Command "${script}"`,
        { timeout: 5000 },
        (error) => {
          if (error) {
            logError("notification.playSound", error);
          }
          resolve();
        },
      );
    });
  }

  /**
   * Convenience: show toast + play sound together.
   */
  async notify(
    title: string,
    message: string,
    soundType: NotificationSoundType = "chat",
  ): Promise<void> {
    await Promise.all([
      this.toast(title, message),
      this.playNotificationSound(soundType),
    ]);
  }
}
