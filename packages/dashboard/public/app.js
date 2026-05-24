// ===== State =====
let currentSection = "history";
let settingsData = null;
let historyData = []; // Cached for client-side search

// Auto-refresh timers
let historyTimer = null;
let affinityTimer = null;
let memoryTimer = null;

// ===== DOM Elements =====
const navButtons = document.querySelectorAll(".nav-btn");
const sections = document.querySelectorAll(".section");
const charNameEl = document.getElementById("charName");
const statusTextEl = document.getElementById("statusText");

// ===== Sidebar Toggle (narrow viewport) =====
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebar = document.querySelector(".sidebar");

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("expanded");
});

// ===== Navigation =====
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const section = btn.dataset.section;
    if (!section) return;
    switchSection(section);
    // Collapse sidebar on narrow screens after selection
    sidebar.classList.remove("expanded");
  });
});

function switchSection(name) {
  currentSection = name;

  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === name);
  });

  sections.forEach((sec) => {
    sec.classList.toggle("active", sec.id === `section-${name}`);
  });

  // Clear all auto-refresh timers
  clearAutoRefresh();

  // Load data on switch & start relevant auto-refresh
  if (name === "history") {
    loadHistory();
    startHistoryAutoRefresh();
  }
  if (name === "affinity") {
    loadAffinity();
    startAffinityAutoRefresh();
  }
  if (name === "memory") {
    loadMemory();
    startMemoryAutoRefresh();
  }
  if (name === "news") loadNews();
  if (name === "settings") loadSettings();
}

// ===== Auto-Refresh =====
function clearAutoRefresh() {
  if (historyTimer) { clearInterval(historyTimer); historyTimer = null; }
  if (affinityTimer) { clearInterval(affinityTimer); affinityTimer = null; }
  if (memoryTimer) { clearInterval(memoryTimer); memoryTimer = null; }
}

function startHistoryAutoRefresh() {
  historyTimer = setInterval(() => loadHistory(true), 10000);
}

function startAffinityAutoRefresh() {
  affinityTimer = setInterval(() => loadAffinity(true), 30000);
}

function startMemoryAutoRefresh() {
  memoryTimer = setInterval(() => loadMemory(true), 30000);
}

// ===== Spinner Helpers =====
function showSpinner(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function hideSpinner(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("active");
}

// ===== API Helpers =====
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(path, options);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    console.error(`API error [${path}]:`, e);
    throw e;
  }
}

// ===== History =====
async function loadHistory(isAutoRefresh = false) {
  const container = document.getElementById("historyList");
  if (isAutoRefresh) showSpinner("spinnerHistory");

  try {
    const data = await apiFetch("/api/history");

    if (data.charName) {
      charNameEl.textContent = data.charName;
      document.title = `${data.charName} - Dashboard`;
    }

    historyData = data.history || [];

    // Apply current search filter
    const searchInput = document.getElementById("historySearch");
    const query = searchInput ? searchInput.value.trim() : "";
    renderHistoryFiltered(query);
  } catch (e) {
    container.innerHTML = renderEmptyState("!", "会話ログの読み込みに失敗しました");
  } finally {
    hideSpinner("spinnerHistory");
  }
}

function renderHistoryFiltered(query) {
  const container = document.getElementById("historyList");
  let filtered = historyData;

  if (query) {
    const lower = query.toLowerCase();
    filtered = historyData.filter((msg) => {
      const content = (msg.content || "").toLowerCase();
      return content.includes(lower);
    });
  }

  if (filtered.length === 0) {
    const text = query ? `「${escapeHtml(query)}」に一致する会話はありません` : "会話ログがありません";
    container.innerHTML = renderEmptyState("&#9776;", text);
    return;
  }

  container.innerHTML = filtered
    .map((msg, i) => renderMessage(msg, i, query))
    .join("");

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function renderMessage(msg, index, searchQuery) {
  const role = msg.role || "unknown";
  const isUser = role === "user";
  const roleLabel = isUser ? "You" : "Assistant";
  const cssClass = isUser ? "msg-user" : "msg-assistant";
  const avatar = isUser ? "👤" : "🤖";

  const time = msg.timestamp
    ? `<span class="msg-time">${formatTime(msg.timestamp)}</span>`
    : "";

  let content = escapeHtml(msg.content || "");

  // Highlight search matches
  if (searchQuery) {
    content = highlightText(content, searchQuery);
  }

  return `
    <div class="msg ${cssClass}">
      <div class="msg-header">
        <span class="msg-avatar">${avatar}</span>
        <span class="msg-role">${roleLabel}</span>${time}
      </div>
      <div class="msg-content">${content}</div>
    </div>
  `;
}

function highlightText(html, query) {
  if (!query) return html;
  // Escape regex special characters in the query
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  return html.replace(regex, '<mark class="search-highlight">$1</mark>');
}

// ===== Search Handler =====
const historySearchInput = document.getElementById("historySearch");
if (historySearchInput) {
  let searchTimeout = null;
  historySearchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      renderHistoryFiltered(historySearchInput.value.trim());
    }, 200);
  });
}

// ===== Memory =====
async function loadMemory(isAutoRefresh = false) {
  const container = document.getElementById("memoryContent");
  if (isAutoRefresh) showSpinner("spinnerMemory");

  try {
    const data = await apiFetch("/api/user-memory");

    if (data.charName) {
      charNameEl.textContent = data.charName;
    }

    const memory = data.memory;

    if (!memory) {
      container.innerHTML = renderEmptyState(
        "&#9733;",
        "ユーザー記憶ファイルがまだ作成されていません"
      );
      return;
    }

    // Handle different memory formats
    let facts = [];
    if (Array.isArray(memory)) {
      facts = memory;
    } else if (memory.facts && Array.isArray(memory.facts)) {
      facts = memory.facts;
    } else if (typeof memory === "object") {
      // If it's a summary-style object, render it as info
      container.innerHTML = renderMemorySummary(memory);
      return;
    }

    if (facts.length === 0) {
      container.innerHTML = renderEmptyState("&#9733;", "記憶データがありません");
      return;
    }

    // Group by category
    const grouped = groupByCategory(facts);
    container.innerHTML = Object.entries(grouped)
      .map(([category, items]) => renderMemoryCategory(category, items))
      .join("");

    // Attach delete handlers
    container.querySelectorAll(".btn-delete-fact").forEach((btn) => {
      btn.addEventListener("click", () => deleteFact(btn.dataset.id));
    });
  } catch (e) {
    container.innerHTML = renderEmptyState(
      "!",
      "ユーザー記憶の読み込みに失敗しました"
    );
  } finally {
    hideSpinner("spinnerMemory");
  }
}

function renderMemorySummary(memory) {
  let html = '<div class="card">';
  html += "<h3>記憶サマリー</h3>";

  if (memory.summary) {
    html += `<div class="memory-fact"><div class="memory-fact-content">
      <div class="memory-fact-text">${escapeHtml(memory.summary)}</div>
    </div></div>`;
  }

  if (memory.topics && Array.isArray(memory.topics)) {
    html += '<div style="margin-top: 12px;">';
    html += '<div class="memory-category-title">Topics</div>';
    memory.topics.forEach((topic) => {
      html += `<div class="memory-fact"><div class="memory-fact-content">
        <div class="memory-fact-text">${escapeHtml(topic)}</div>
      </div></div>`;
    });
    html += "</div>";
  }

  if (memory.lastUpdated) {
    html += `<div style="margin-top: 12px; font-size: 0.75rem; color: var(--text-muted);">
      Last updated: ${formatTime(memory.lastUpdated)}
    </div>`;
  }

  html += "</div>";
  return html;
}

function groupByCategory(facts) {
  const groups = {};
  facts.forEach((fact) => {
    const cat = fact.category || "General";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(fact);
  });
  return groups;
}

function renderMemoryCategory(category, facts) {
  const items = facts
    .map(
      (fact) => `
    <div class="memory-fact">
      <div class="memory-fact-content">
        <div class="memory-fact-text">${escapeHtml(fact.content || fact.text || fact.fact || JSON.stringify(fact))}</div>
        <div class="memory-fact-meta">
          ${fact.confidence !== undefined ? `<span class="confidence-bar">信頼度: <span class="confidence-fill" style="width: ${Math.round(fact.confidence * 50)}px;"></span> ${Math.round(fact.confidence * 100)}%</span>` : ""}
          ${fact.created_at || fact.createdAt ? `<span>作成: ${formatTime(fact.created_at || fact.createdAt)}</span>` : ""}
        </div>
      </div>
      <div class="memory-fact-actions">
        ${fact.id !== undefined ? `<button class="btn btn-danger btn-delete-fact" data-id="${escapeAttr(String(fact.id))}">削除</button>` : ""}
      </div>
    </div>
  `
    )
    .join("");

  return `
    <div class="memory-category">
      <div class="memory-category-title">${escapeHtml(category)}</div>
      ${items}
    </div>
  `;
}

async function deleteFact(factId) {
  if (!confirm("この記憶を削除しますか？")) return;

  try {
    await apiFetch(`/api/user-memory/${encodeURIComponent(factId)}`, {
      method: "DELETE",
    });
    loadMemory(); // Reload
  } catch (e) {
    alert("削除に失敗しました: " + e.message);
  }
}

// ===== Affinity =====
const MOOD_LABELS = {
  neutral: "落ち着いている",
  happy: "嬉しい",
  curious: "興味深い",
  tired: "少し疲れている",
  lonely: "寂しい",
  excited: "テンションが高い",
};

const MOOD_ICONS = {
  neutral: "\u{1F610}",
  happy: "\u{1F60A}",
  curious: "\u{1F914}",
  tired: "\u{1F634}",
  lonely: "\u{1F622}",
  excited: "\u{1F929}",
};

const ALL_MILESTONES = {
  first_chat: "初めての会話",
  level_10: "好感度 10 到達",
  level_25: "好感度 25 到達",
  level_50: "好感度 50 到達",
  level_75: "好感度 75 到達",
  level_100: "好感度 MAX 到達",
  streak_7: "7日連続会話",
  streak_30: "30日連続会話",
};

async function loadAffinity(isAutoRefresh = false) {
  if (isAutoRefresh) showSpinner("spinnerAffinity");

  try {
    const data = await apiFetch("/api/affinity");

    if (data.charName) {
      charNameEl.textContent = data.charName;
    }

    const a = data.affinity;
    if (!a) {
      document.getElementById("affinityLevel").textContent = "0";
      document.getElementById("affinityBar").style.width = "0%";
      document.getElementById("affinityMood").textContent = "--";
      document.getElementById("affinityStreak").textContent = "0 日";
      document.getElementById("affinityTotal").textContent = "0 回";
      document.getElementById("affinityLastChat").textContent = "なし";
      document.getElementById("affinityMilestones").innerHTML =
        renderEmptyState("\u{2665}", "まだマイルストーンはありません");
      return;
    }

    const level = Math.floor(a.level || 0);
    document.getElementById("affinityLevel").textContent = String(level);
    document.getElementById("affinityBar").style.width = `${level}%`;

    const mood = a.mood || "neutral";
    const moodIcon = MOOD_ICONS[mood] || "";
    const moodLabel = MOOD_LABELS[mood] || mood;
    document.getElementById("affinityMood").textContent = `${moodIcon} ${moodLabel}`;

    document.getElementById("affinityStreak").textContent = `${a.streak || 0} 日`;
    document.getElementById("affinityTotal").textContent = `${a.totalInteractions || 0} 回`;

    document.getElementById("affinityLastChat").textContent = a.lastInteraction
      ? formatTime(a.lastInteraction)
      : "なし";

    // Milestones
    const achieved = a.milestones || [];
    const container = document.getElementById("affinityMilestones");
    const milestoneHtml = Object.entries(ALL_MILESTONES)
      .map(([key, label]) => {
        const done = achieved.includes(key);
        return `<div class="milestone-item ${done ? "achieved" : "locked"}">
          <span class="milestone-icon">${done ? "\u{2713}" : "\u{1F512}"}</span>
          <span class="milestone-label">${escapeHtml(label)}</span>
        </div>`;
      })
      .join("");
    container.innerHTML = milestoneHtml;
  } catch (e) {
    console.error("Failed to load affinity:", e);
  } finally {
    hideSpinner("spinnerAffinity");
  }
}

// ===== News / Curator History =====
async function loadNews(isAutoRefresh = false) {
  const container = document.getElementById("newsList");
  if (isAutoRefresh) showSpinner("spinnerNews");

  try {
    const data = await apiFetch("/api/curator-history");
    const urls = data.urls || [];

    if (urls.length === 0) {
      container.innerHTML = renderEmptyState("📰", "通知済みのニュースはまだありません");
      return;
    }

    container.innerHTML = urls
      .map((url, i) => {
        const safeUrl = escapeAttr(url);
        const displayUrl = escapeHtml(url);
        return `
          <div class="news-item">
            <span class="news-index">${i + 1}</span>
            <span class="news-icon">🔗</span>
            <a class="news-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${displayUrl}</a>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    container.innerHTML = renderEmptyState("!", "ニュース履歴の読み込みに失敗しました");
  } finally {
    hideSpinner("spinnerNews");
  }
}

// ===== Settings =====
async function loadSettings() {
  const charInfo = document.getElementById("charInfo");
  const voiceSettings = document.getElementById("voiceSettings");

  try {
    const data = await apiFetch("/api/settings");

    if (data.charName) {
      charNameEl.textContent = data.charName;
    }

    settingsData = data.settings;
    if (!settingsData) {
      charInfo.innerHTML = '<p class="placeholder">設定ファイルが見つかりません</p>';
      return;
    }

    renderCharInfo(settingsData);
    renderVoiceSettings(settingsData.voice || {});
  } catch (e) {
    charInfo.innerHTML =
      '<p class="placeholder">設定の読み込みに失敗しました</p>';
  }
}

function renderCharInfo(settings) {
  const container = document.getElementById("charInfo");
  const fields = [
    { label: "名前", value: settings.display_name || settings.name || "-" },
    { label: "一人称", value: settings.first_person || "-" },
    {
      label: "性格",
      value: settings.personality || "-",
      multiline: true,
    },
    {
      label: "話し方",
      value: settings.speech_style || "-",
      multiline: true,
    },
  ];

  container.innerHTML = fields
    .map(
      (f) => `
    <div class="char-info-label">${escapeHtml(f.label)}</div>
    <div class="char-info-value${f.multiline ? " multiline" : ""}">${escapeHtml(String(f.value).trim())}</div>
  `
    )
    .join("");
}

function renderVoiceSettings(voice) {
  const container = document.getElementById("voiceSettings");

  const sliders = [
    {
      key: "speed",
      label: "Speed",
      min: 0.5,
      max: 2.0,
      step: 0.1,
      value: voice.speed ?? 1.0,
    },
    {
      key: "pitch",
      label: "Pitch",
      min: -1.0,
      max: 1.0,
      step: 0.1,
      value: voice.pitch ?? 0.0,
    },
    {
      key: "volume",
      label: "Volume",
      min: 0.0,
      max: 1.0,
      step: 0.05,
      value: voice.volume ?? 0.5,
    },
  ];

  container.innerHTML = sliders
    .map(
      (s) => `
    <div class="setting-item">
      <div class="setting-label">
        <span class="setting-label-name">${s.label}</span>
        <span class="setting-label-value" id="value-${s.key}">${s.value}</span>
      </div>
      <input type="range"
        id="slider-${s.key}"
        min="${s.min}" max="${s.max}" step="${s.step}"
        value="${s.value}"
        data-key="${s.key}"
      >
    </div>
  `
    )
    .join("");

  // Attach slider listeners
  sliders.forEach((s) => {
    const slider = document.getElementById(`slider-${s.key}`);
    const valueDisplay = document.getElementById(`value-${s.key}`);
    slider.addEventListener("input", () => {
      valueDisplay.textContent = parseFloat(slider.value).toFixed(
        s.step < 0.1 ? 2 : 1
      );
    });
  });
}

// Save settings
document.getElementById("saveSettings").addEventListener("click", async () => {
  const statusEl = document.getElementById("saveStatus");

  const voice = {};
  ["speed", "pitch", "volume"].forEach((key) => {
    const slider = document.getElementById(`slider-${key}`);
    if (slider) {
      voice[key] = parseFloat(slider.value);
    }
  });

  try {
    await apiFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice }),
    });

    statusEl.textContent = "保存しました";
    statusEl.classList.add("show");
    setTimeout(() => statusEl.classList.remove("show"), 2500);
  } catch (e) {
    statusEl.textContent = "保存に失敗しました";
    statusEl.style.color = "var(--danger)";
    statusEl.classList.add("show");
    setTimeout(() => {
      statusEl.classList.remove("show");
      statusEl.style.color = "";
    }, 3000);
  }
});

// Refresh buttons
document.getElementById("refreshHistory").addEventListener("click", () => loadHistory());
document.getElementById("refreshAffinity").addEventListener("click", () => loadAffinity());
document.getElementById("refreshMemory").addEventListener("click", () => loadMemory());
document.getElementById("refreshNews").addEventListener("click", () => loadNews());

// ===== Utility =====
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function renderEmptyState(icon, text) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <div class="empty-state-text">${text}</div>
    </div>
  `;
}

// ===== Init =====
loadHistory();
startHistoryAutoRefresh();
