// ===== State =====
let currentSection = "history";
let settingsData = null;
let historyData = []; // Cached for client-side search

// Auto-refresh timers
let historyTimer = null;
let affinityTimer = null;
let memoryTimer = null;
let timelineTimer = null;

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
  if (name === "timeline") {
    loadTimeline();
    startTimelineAutoRefresh();
  }
  if (name === "news") loadNews();
  if (name === "characters") loadCharacters();
  if (name === "settings") loadSettings();
}

// ===== Auto-Refresh =====
function clearAutoRefresh() {
  if (historyTimer) { clearInterval(historyTimer); historyTimer = null; }
  if (affinityTimer) { clearInterval(affinityTimer); affinityTimer = null; }
  if (memoryTimer) { clearInterval(memoryTimer); memoryTimer = null; }
  if (timelineTimer) { clearInterval(timelineTimer); timelineTimer = null; }
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

// ===== Timeline =====
const TIMELINE_ICONS = {
  chat: "\u{1F4AC}",       // speech balloon
  proactive: "\u{1F4E2}",  // loudspeaker
  curate: "\u{1F4F0}",     // newspaper
  observe: "\u{1F441}",    // eye
  milestone: "\u{1F3C6}",  // trophy
  system: "\u{2699}",      // gear
};

const TIMELINE_TYPE_LABELS = {
  chat: "会話",
  proactive: "声かけ",
  curate: "ニュース",
  observe: "画面観察",
  milestone: "マイルストーン",
  system: "システム",
};

function startTimelineAutoRefresh() {
  timelineTimer = setInterval(() => loadTimeline(true), 15000);
}

async function loadTimeline(isAutoRefresh = false) {
  const container = document.getElementById("timelineList");
  if (isAutoRefresh) showSpinner("spinnerTimeline");

  try {
    const dateInput = document.getElementById("timelineDateFilter");
    const dateValue = dateInput ? dateInput.value : "";

    let apiUrl = "/api/timeline";
    if (dateValue) {
      apiUrl += `?date=${encodeURIComponent(dateValue)}`;
    }

    const data = await apiFetch(apiUrl);
    const events = data.events || [];

    if (events.length === 0) {
      const msg = dateValue
        ? `${dateValue} のイベントはありません`
        : "タイムラインイベントがまだありません";
      container.innerHTML = renderEmptyState("\u{1F551}", msg);
      return;
    }

    // Group events by date
    const grouped = groupTimelineByDate(events);
    container.innerHTML = Object.entries(grouped)
      .map(([date, evts]) => renderTimelineDateGroup(date, evts))
      .join("");

    // Attach toggle handlers for details
    container.querySelectorAll(".timeline-event-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const detailsEl = btn.parentElement.querySelector(".timeline-event-details");
        if (detailsEl) {
          detailsEl.classList.toggle("open");
          btn.textContent = detailsEl.classList.contains("open") ? "閉じる" : "詳細";
        }
      });
    });
  } catch (e) {
    container.innerHTML = renderEmptyState("!", "タイムラインの読み込みに失敗しました");
  } finally {
    hideSpinner("spinnerTimeline");
  }
}

function groupTimelineByDate(events) {
  const groups = {};
  events.forEach((evt) => {
    const date = evt.timestamp ? evt.timestamp.slice(0, 10) : "unknown";
    if (!groups[date]) groups[date] = [];
    groups[date].push(evt);
  });
  return groups;
}

function formatDateLabel(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    if (dateStr === todayStr) return "今日";
    if (dateStr === yesterdayStr) return "昨日";

    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  } catch {
    return dateStr;
  }
}

function renderTimelineDateGroup(date, events) {
  const label = formatDateLabel(date);
  const items = events.map((evt) => renderTimelineEvent(evt)).join("");
  return `
    <div class="timeline-date-group">
      <div class="timeline-date-label">${escapeHtml(label)}</div>
      ${items}
    </div>
  `;
}

function renderTimelineEvent(evt) {
  const icon = TIMELINE_ICONS[evt.type] || "\u{2022}";
  const typeLabel = TIMELINE_TYPE_LABELS[evt.type] || evt.type;
  const time = evt.timestamp ? formatTimeShort(evt.timestamp) : "";
  const hasDetails = evt.details && evt.details !== evt.summary;

  return `
    <div class="timeline-event">
      <span class="timeline-event-icon">${icon}</span>
      <div class="timeline-event-body">
        <div class="timeline-event-header">
          <span class="timeline-event-type type-${escapeAttr(evt.type)}">${escapeHtml(typeLabel)}</span>
          <span class="timeline-event-time">${time}</span>
        </div>
        <div class="timeline-event-summary">${escapeHtml(evt.summary)}</div>
        ${hasDetails ? `
          <button class="timeline-event-toggle">詳細</button>
          <div class="timeline-event-details">${escapeHtml(evt.details)}</div>
        ` : ""}
      </div>
    </div>
  `;
}

function formatTimeShort(ts) {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

// Timeline date filter handler
const timelineDateInput = document.getElementById("timelineDateFilter");
if (timelineDateInput) {
  timelineDateInput.addEventListener("change", () => {
    loadTimeline();
  });
}

// ===== Characters =====
async function loadCharacters() {
  const container = document.getElementById("charactersList");
  showSpinner("spinnerCharacters");

  try {
    const data = await apiFetch("/api/characters");
    const characters = data.characters || [];
    const active = data.active || "";

    if (characters.length === 0) {
      container.innerHTML = renderEmptyState("&#128101;", "キャラクターが見つかりません");
      return;
    }

    container.innerHTML = characters
      .map((ch) => {
        const isActive = ch.name === active;
        return `
          <div class="char-card ${isActive ? "char-card-active" : ""}">
            <div class="char-card-header">
              <span class="char-card-avatar">${isActive ? "&#9670;" : "&#9671;"}</span>
              <div class="char-card-names">
                <div class="char-card-display">${escapeHtml(ch.display_name || ch.name)}</div>
                <div class="char-card-id">${escapeHtml(ch.name)}</div>
              </div>
              ${isActive ? '<span class="char-card-badge">Active</span>' : ""}
            </div>
            <div class="char-card-personality">${escapeHtml(ch.personality || "")}</div>
            <div class="char-card-actions">
              ${isActive
                ? '<button class="btn btn-secondary" disabled>使用中</button>'
                : `<button class="btn btn-primary btn-switch-char" data-name="${escapeAttr(ch.name)}">切り替え</button>`
              }
            </div>
          </div>
        `;
      })
      .join("");

    // Attach switch handlers
    container.querySelectorAll(".btn-switch-char").forEach((btn) => {
      btn.addEventListener("click", () => switchCharacter(btn.dataset.name));
    });
  } catch (e) {
    container.innerHTML = renderEmptyState("!", "キャラクター一覧の読み込みに失敗しました");
  } finally {
    hideSpinner("spinnerCharacters");
  }
}

async function switchCharacter(name) {
  try {
    await apiFetch("/api/character/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    // Reload character list to reflect new active state
    loadCharacters();

    // Update header with new character name
    charNameEl.textContent = name;
    document.title = `${name} - Dashboard`;
  } catch (e) {
    alert("キャラクターの切り替えに失敗しました: " + e.message);
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
document.getElementById("refreshTimeline").addEventListener("click", () => loadTimeline());
document.getElementById("refreshCharacters").addEventListener("click", () => loadCharacters());

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

// ===== Data Export / Import =====
document.getElementById("exportData").addEventListener("click", async () => {
  const statusEl = document.getElementById("dataMgmtStatus");
  try {
    const res = await fetch("/api/export");
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // Extract filename from Content-Disposition header, or use fallback
    const disposition = res.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch
      ? filenameMatch[1]
      : `companion-export-${new Date().toISOString().slice(0, 10)}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    statusEl.textContent = "エクスポートしました";
    statusEl.style.color = "var(--success)";
    statusEl.classList.add("show");
    setTimeout(() => statusEl.classList.remove("show"), 2500);
  } catch (e) {
    statusEl.textContent = "エクスポートに失敗しました";
    statusEl.style.color = "var(--danger)";
    statusEl.classList.add("show");
    setTimeout(() => {
      statusEl.classList.remove("show");
      statusEl.style.color = "";
    }, 3000);
  }
});

document.getElementById("importDataBtn").addEventListener("click", () => {
  document.getElementById("importFileInput").click();
});

document.getElementById("importFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById("dataMgmtStatus");

  // Confirm before overwrite
  if (!confirm("インポートすると現在のデータが上書きされます。続行しますか？")) {
    e.target.value = "";
    return;
  }

  try {
    const text = await file.text();
    // Validate JSON before sending
    const parsed = JSON.parse(text);
    if (!parsed.version) {
      throw new Error("無効なエクスポートファイルです（versionフィールドがありません）");
    }

    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || "Import failed");
    }

    statusEl.textContent = "インポートしました。データが復元されました。";
    statusEl.style.color = "var(--success)";
    statusEl.classList.add("show");
    setTimeout(() => statusEl.classList.remove("show"), 3000);

    // Reload current section data
    loadHistory();
    loadAffinity();
    loadMemory();
  } catch (e) {
    statusEl.textContent = "インポートに失敗しました: " + e.message;
    statusEl.style.color = "var(--danger)";
    statusEl.classList.add("show");
    setTimeout(() => {
      statusEl.classList.remove("show");
      statusEl.style.color = "";
    }, 4000);
  }

  // Reset file input so the same file can be selected again
  e.target.value = "";
});

// ===== Init =====
loadHistory();
startHistoryAutoRefresh();
