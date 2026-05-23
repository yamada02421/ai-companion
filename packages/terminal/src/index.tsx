import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  CompanionAI,
  loadCharacter,
  fetchWeather,
  formatWeatherContext,
  fetchNews,
  formatNewsContext,
  Scheduler,
} from "@ai-companion/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

interface ChatMessage {
  role: "user" | "companion" | "system";
  text: string;
}

function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ai, setAi] = useState<CompanionAI | null>(null);
  const [charName, setCharName] = useState("");

  useEffect(() => {
    const charPath = resolve(__dirname, "../../../characters/rei.yaml");
    const character = loadCharacter(charPath);
    const companion = new CompanionAI(character);

    setAi(companion);
    setCharName(character.display_name);

    const greeting = companion.getGreeting();
    setMessages([{ role: "companion", text: greeting }]);

    const scheduler = new Scheduler();
    scheduler.addEvent("weather", 60);
    scheduler.addEvent("news", 120);
    scheduler.onNotify(async (type) => {
      try {
        let context = "";
        if (type === "weather" && process.env.OPENWEATHERMAP_API_KEY) {
          const weather = await fetchWeather(
            process.env.OPENWEATHERMAP_API_KEY,
            process.env.WEATHER_CITY ?? "Tokyo"
          );
          context = formatWeatherContext(weather);
        } else if (type === "news") {
          const news = await fetchNews();
          context = formatNewsContext(news);
        }

        if (context) {
          const reply = await companion.proactiveMessage(context);
          setMessages((prev) => [
            ...prev,
            { role: "companion", text: reply },
          ]);
        }
      } catch {}
    });
    scheduler.start();

    return () => scheduler.stop();
  }, []);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      exit();
    }
  });

  const handleSubmit = async (value: string) => {
    if (!value.trim() || !ai || loading) return;
    setInput("");

    if (value.trim() === "/quit") {
      exit();
      return;
    }

    setMessages((prev) => [...prev, { role: "user", text: value }]);
    setLoading(true);

    try {
      const reply = await ai.chat(value);
      setMessages((prev) => [...prev, { role: "companion", text: reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          text: `エラー: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const visibleMessages = messages.slice(-20);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ── AI Companion ── {charName} ──
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} marginBottom={0}>
            {msg.role === "user" ? (
              <Text>
                <Text color="green" bold>
                  あなた:{" "}
                </Text>
                <Text>{msg.text}</Text>
              </Text>
            ) : msg.role === "companion" ? (
              <Text>
                <Text color="magenta" bold>
                  {charName}:{" "}
                </Text>
                <Text>{msg.text}</Text>
              </Text>
            ) : (
              <Text color="red">{msg.text}</Text>
            )}
          </Box>
        ))}
      </Box>

      {loading && (
        <Box marginBottom={1}>
          <Text color="yellow">考え中...</Text>
        </Box>
      )}

      <Box>
        <Text color="green" bold>
          {"> "}
        </Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Ctrl+C or /quit で終了</Text>
      </Box>
    </Box>
  );
}

render(<App />);
