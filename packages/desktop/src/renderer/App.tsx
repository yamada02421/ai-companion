import React, { useState, useEffect, useRef } from "react";

declare global {
  interface Window {
    companion: {
      chat: (message: string) => Promise<string>;
      trigger: (mode: string) => Promise<void>;
      toggleExpand: () => Promise<void>;
      getSettings: () => Promise<Settings>;
      saveSettings: (s: Partial<Settings>) => Promise<boolean>;
      onMessage: (cb: (data: { role: string; text: string; mode: string }) => void) => void;
      onThinking: (cb: (thinking: boolean) => void) => void;
      onExpand: (cb: (expanded: boolean) => void) => void;
      onContinuous: (cb: (active: boolean) => void) => void;
      onCharacter: (cb: (data: { name: string }) => void) => void;
      onShowSettings: (cb: (show: boolean) => void) => void;
    };
  }
}

interface Settings {
  shortcut: string;
  proactiveInterval: number;
  currentChar: string;
  characters: string[];
}

interface ChatMessage {
  role: "user" | "companion";
  text: string;
  mode: string;
  time: string;
}

const modeIcons: Record<string, string> = {
  news: "\u{1F4F0}",
  qiita: "\u{1F4DD}",
  work: "\u{1F4BB}",
  casual: "\u{1F4AC}",
  chat: "\u{1F4AC}",
};

function formatTime(): string {
  const d = new Date();
  return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.companion.getSettings().then(setSettings);
  }, []);

  if (!settings) return <div style={panelStyle}>読み込み中...</div>;

  const save = async (partial: Partial<Settings>) => {
    await window.companion.saveSettings(partial);
    setSettings({ ...settings, ...partial });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: "bold" }}>設定</span>
        <button onClick={onClose} style={closeBtnStyle}>✕</button>
      </div>

      <label style={labelStyle}>キャラクター</label>
      <select
        value={settings.currentChar}
        onChange={(e) => save({ character: e.target.value })}
        style={inputStyle}
      >
        {settings.characters.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <label style={labelStyle}>ショートカットキー</label>
      <input
        value={settings.shortcut}
        onChange={(e) => setSettings({ ...settings, shortcut: e.target.value })}
        onBlur={() => save({ shortcut: settings.shortcut })}
        style={inputStyle}
        placeholder="例: CommandOrControl+Shift+Space"
      />

      <label style={labelStyle}>プロアクティブ発言間隔（分）</label>
      <input
        type="number"
        min={5}
        max={120}
        value={settings.proactiveInterval}
        onChange={(e) => {
          const v = parseInt(e.target.value);
          if (v >= 5) {
            setSettings({ ...settings, proactiveInterval: v });
            save({ proactiveInterval: v });
          }
        }}
        style={inputStyle}
      />

      {saved && <div style={{ color: "#7fff7f", fontSize: 12, marginTop: 8 }}>保存しました</div>}
    </div>
  );
}

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [charName, setCharName] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.companion.onMessage((data) => {
      setMessages((prev) => [
        ...prev.slice(-50),
        { role: data.role as "user" | "companion", text: data.text, mode: data.mode, time: formatTime() },
      ]);
    });
    window.companion.onThinking(setThinking);
    window.companion.onExpand(setExpanded);
    window.companion.onContinuous(setContinuous);
    window.companion.onCharacter((data) => setCharName(data.name));
    window.companion.onShowSettings(setShowSettings);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || thinking) return;
    const msg = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: msg, mode: "chat", time: formatTime() },
    ]);
    await window.companion.chat(msg);
  };

  const latestMessage = messages[messages.length - 1];
  const latestMode = latestMessage?.mode ?? "casual";

  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "#1a1a2e",
      borderRadius: 12,
      border: "1px solid rgba(255, 255, 255, 0.08)",
      color: "#e8e8e8",
      overflow: "hidden",
      fontFamily: "'Segoe UI', 'Yu Gothic UI', 'Meiryo', sans-serif",
    }}>
      {/* 展開パネル */}
      {expanded && !showSettings && (
        <>
          {/* 会話履歴 */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
          }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                marginBottom: 8,
                textAlign: msg.role === "user" ? "right" : "left",
              }}>
                <div style={{
                  display: "inline-block",
                  maxWidth: "80%",
                  padding: "8px 12px",
                  borderRadius: 12,
                  background: msg.role === "user"
                    ? "rgba(99, 132, 255, 0.25)"
                    : "rgba(255, 255, 255, 0.06)",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}>
                  {msg.role === "companion" && (
                    <div style={{ fontSize: 11, color: "#b088f9", marginBottom: 4 }}>
                      {modeIcons[msg.mode] ?? ""} {charName}
                    </div>
                  )}
                  <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
                </div>
                <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{msg.time}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* 入力欄 */}
          <form onSubmit={handleSubmit} style={{
            display: "flex",
            padding: "8px 12px",
            gap: 8,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="メッセージを入力..."
              disabled={thinking}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#e8e8e8",
                fontSize: 13,
                outline: "none",
              }}
            />
            <button type="submit" disabled={thinking} style={{
              background: thinking ? "rgba(99, 132, 255, 0.2)" : "rgba(99, 132, 255, 0.4)",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              color: "#fff",
              fontSize: 13,
              cursor: thinking ? "wait" : "pointer",
            }}>
              送信
            </button>
          </form>

          {/* モードボタン */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: 6,
            padding: "6px 12px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}>
            {(["news", "qiita", "work", "casual"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => window.companion.trigger(mode)}
                disabled={thinking}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                  padding: "4px 12px",
                  color: "#aaa",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {modeIcons[mode]} {mode}
              </button>
            ))}
            <button
              onClick={() => setShowSettings(true)}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6,
                padding: "4px 12px",
                color: "#aaa",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ⚙ 設定
            </button>
          </div>
        </>
      )}

      {/* 設定パネル */}
      {expanded && showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {/* 常駐バー */}
      <div
        onClick={() => window.companion.toggleExpand()}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          height: expanded ? 52 : "100%",
          gap: 12,
          cursor: "pointer",
          borderTop: expanded ? "1px solid rgba(255,255,255,0.06)" : "none",
          flexShrink: 0,
        }}
      >
        <div style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #b088f9 0%, #6384ff 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          fontWeight: "bold",
          flexShrink: 0,
          color: "#fff",
        }}>
          {charName ? charName[0] : "?"}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11,
            color: "#b088f9",
            marginBottom: 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            {charName}
            {continuous && (
              <span style={{
                fontSize: 9,
                background: "rgba(99, 255, 132, 0.2)",
                color: "#7fff7f",
                padding: "1px 6px",
                borderRadius: 4,
              }}>
                LIVE
              </span>
            )}
            {thinking && (
              <span style={{ fontSize: 9, color: "#ffcc00" }}>考え中...</span>
            )}
          </div>
          <div style={{
            fontSize: 13,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {latestMessage?.text ?? "..."}
          </div>
        </div>

        <div style={{ fontSize: 18, flexShrink: 0, opacity: 0.6 }}>
          {modeIcons[latestMode] ?? ""}
        </div>
        <div style={{ fontSize: 11, color: "#555", flexShrink: 0 }}>
          {expanded ? "▼" : "▲"}
        </div>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  flex: 1,
  padding: 20,
  overflowY: "auto",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#999",
  marginTop: 12,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: "8px 10px",
  color: "#e8e8e8",
  fontSize: 13,
  outline: "none",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#888",
  fontSize: 16,
  cursor: "pointer",
};
