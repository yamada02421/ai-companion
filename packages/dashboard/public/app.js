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
  if (name === "stats") loadStats();
  if (name === "characters") loadCharacters();
  if (name === "status") loadStatus();
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
    const evolution = data.evolution;

    if (!a) {
      document.getElementById("affinityLevel").textContent = "0";
      document.getElementById("affinityBar").style.width = "0%";
      document.getElementById("affinityMood").textContent = "--";
      document.getElementById("affinityStreak").textContent = "0 日";
      document.getElementById("affinityTotal").textContent = "0 回";
      document.getElementById("affinityLastChat").textContent = "なし";
      document.getElementById("affinityMilestones").innerHTML =
        renderEmptyState("\u{2665}", "まだマイルストーンはありません");
      renderEvolutionStage(evolution);
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

    // Evolution Stage
    renderEvolutionStage(evolution);

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

function renderEvolutionStage(evolution) {
  const container = document.getElementById("evolutionStage");
  if (!container) return;

  if (!evolution) {
    container.innerHTML = renderEmptyState("\u{1F331}", "進化情報がありません");
    return;
  }

  const stageLabels = {
    "知り合い": "\u{1F465}",
    "友達": "\u{1F91D}",
    "親友": "\u{1F496}",
    "特別": "\u{2728}"
  };
  const stageIcon = stageLabels[evolution.currentStage] || "\u{1F465}";

  // All stages for track display
  const allStages = evolution.allStages || [];

  // Next stage info
  let nextStageHtml = "";
  if (evolution.nextStage) {
    nextStageHtml = `
      <div class="evolution-next">
        次のステージ「<strong>${escapeHtml(evolution.nextStage)}</strong>」まであと <strong>${evolution.levelsToNext}</strong> レベル
      </div>
    `;
  } else {
    nextStageHtml = `<div class="evolution-next evolution-max">最高ステージに到達しています！</div>`;
  }

  // Stage progression visualization
  const stagesHtml = allStages.map((s) => {
    const isCurrent = s.label === evolution.currentStage;
    const isPassed = s.maxLevel < evolution.minLevel;
    let cls = "evolution-stage-dot";
    if (isCurrent) cls += " current";
    else if (isPassed) cls += " passed";
    else cls += " locked";
    return `<div class="${cls}">
      <span class="evolution-stage-dot-icon">${stageLabels[s.label] || "\u{25CF}"}</span>
      <span class="evolution-stage-dot-label">${escapeHtml(s.label)}</span>
      <span class="evolution-stage-dot-range">Lv.${s.minLevel}-${s.maxLevel}</span>
    </div>`;
  }).join('<div class="evolution-stage-connector"></div>');

  // Unlocked behaviors
  const behaviorsHtml = (evolution.unlockedBehaviors || [])
    .map((b) => `<span class="evolution-behavior-tag">${escapeHtml(b)}</span>`)
    .join("");

  container.innerHTML = `
    <div class="evolution-current">
      <span class="evolution-current-icon">${stageIcon}</span>
      <span class="evolution-current-label">${escapeHtml(evolution.currentStage)}</span>
      <span class="evolution-current-range">(Lv.${evolution.minLevel} - ${evolution.maxLevel})</span>
    </div>
    ${nextStageHtml}
    <div class="evolution-stages-track">
      ${stagesHtml}
    </div>
    <div class="evolution-behaviors">
      <div class="evolution-behaviors-title">解放済み行動</div>
      <div class="evolution-behaviors-list">
        ${behaviorsHtml}
      </div>
    </div>
  `;
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

// ===== Stats =====
async function loadStats() {
  showSpinner("spinnerStats");

  try {
    const data = await apiFetch("/api/stats");
    const s = data.stats;

    if (!s) {
      document.getElementById("statsTotalMessages").textContent = "0";
      document.getElementById("statsTotalDays").textContent = "0";
      document.getElementById("statsAvgPerDay").textContent = "0";
      document.getElementById("statsLongestStreak").textContent = "0";
      document.getElementById("statsCurrentStreak").textContent = "0";
      return;
    }

    // Basic stats
    document.getElementById("statsTotalMessages").textContent =
      String(s.totalMessages || 0);
    document.getElementById("statsTotalDays").textContent =
      `${s.totalDays || 0} 日`;
    document.getElementById("statsAvgPerDay").textContent =
      `${s.avgMessagesPerDay || 0} 件/日`;
    document.getElementById("statsLongestStreak").textContent =
      `${s.longestStreak || 0} 日`;
    document.getElementById("statsCurrentStreak").textContent =
      `${s.currentStreak || 0} 日`;

    // Hourly activity bar chart
    renderHourlyChart(s.activeHours || []);

    // Weekday activity bar chart
    renderWeekdayChart(s.weekdayActivity || []);

    // Favorite topics
    renderFavoriteTopics(s.favoriteTopics || []);

    // Level history
    renderLevelHistory(s.levelHistory || []);
  } catch (e) {
    console.error("Failed to load stats:", e);
  } finally {
    hideSpinner("spinnerStats");
  }
}

function renderHourlyChart(activeHours) {
  const container = document.getElementById("statsHourlyChart");
  if (activeHours.length === 0) {
    container.innerHTML = renderEmptyState("&#128202;", "時間帯データがありません");
    return;
  }

  const maxCount = Math.max(...activeHours.map((h) => h.count), 1);

  const bars = activeHours
    .map((h) => {
      const heightPct = Math.round((h.count / maxCount) * 100);
      const label = String(h.hour).padStart(2, "0");
      return `
        <div class="stats-bar-col">
          <div class="stats-bar-value">${h.count || ""}</div>
          <div class="stats-bar" style="height: ${heightPct}%;" title="${label}時: ${h.count}件"></div>
          <div class="stats-bar-label">${label}</div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `<div class="stats-bar-row">${bars}</div>`;
}

function renderWeekdayChart(weekdayActivity) {
  const container = document.getElementById("statsWeekdayChart");
  if (weekdayActivity.length === 0) {
    container.innerHTML = renderEmptyState("&#128202;", "曜日データがありません");
    return;
  }

  const maxCount = Math.max(...weekdayActivity.map((d) => d.count), 1);

  const bars = weekdayActivity
    .map((d) => {
      const heightPct = Math.round((d.count / maxCount) * 100);
      return `
        <div class="stats-bar-col stats-bar-col-wide">
          <div class="stats-bar-value">${d.count || ""}</div>
          <div class="stats-bar" style="height: ${heightPct}%;" title="${d.day}: ${d.count}件"></div>
          <div class="stats-bar-label">${d.day}</div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `<div class="stats-bar-row">${bars}</div>`;
}

function renderFavoriteTopics(topics) {
  const container = document.getElementById("statsTopics");

  if (topics.length === 0) {
    container.innerHTML = renderEmptyState("&#128172;", "トピックデータがまだありません");
    return;
  }

  const maxCount = Math.max(...topics.map((t) => t.count), 1);

  const items = topics
    .map((t, i) => {
      const widthPct = Math.round((t.count / maxCount) * 100);
      return `
        <div class="stats-topic-row">
          <span class="stats-topic-rank">${i + 1}</span>
          <span class="stats-topic-name">${escapeHtml(t.topic)}</span>
          <div class="stats-topic-bar-wrap">
            <div class="stats-topic-bar" style="width: ${widthPct}%;"></div>
          </div>
          <span class="stats-topic-count">${t.count}</span>
        </div>
      `;
    })
    .join("");

  container.innerHTML = items;
}

function renderLevelHistory(levelHistory) {
  const container = document.getElementById("statsLevelHistory");

  if (levelHistory.length === 0) {
    container.innerHTML = renderEmptyState("&#128200;", "好感度データがまだありません");
    return;
  }

  const rows = levelHistory
    .map((entry) => {
      const barWidth = Math.round(entry.level);
      const dateLabel = entry.date.slice(5); // MM-DD
      return `
        <div class="stats-level-row">
          <span class="stats-level-date">${escapeHtml(dateLabel)}</span>
          <div class="stats-level-bar-wrap">
            <div class="stats-level-bar" style="width: ${barWidth}%;"></div>
          </div>
          <span class="stats-level-value">${entry.level}</span>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `<div class="stats-level-list">${rows}</div>`;
}

document.getElementById("refreshStats").addEventListener("click", () => loadStats());

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

// ===== Status =====
const STATUS_COLORS = {
  ok: "var(--success)",
  down: "var(--danger)",
  unknown: "var(--text-muted)",
};

const STATUS_LABELS = {
  ok: "OK",
  down: "Down",
  unknown: "Unknown",
};

async function loadStatus() {
  const container = document.getElementById("statusGrid");
  showSpinner("spinnerStatus");

  try {
    const data = await apiFetch("/api/health");
    const services = data.services || [];

    if (services.length === 0) {
      container.innerHTML = renderEmptyState("&#9889;", "サービス情報がありません");
      return;
    }

    container.innerHTML = services
      .map((svc) => {
        const color = STATUS_COLORS[svc.status] || STATUS_COLORS.unknown;
        const label = STATUS_LABELS[svc.status] || svc.status;
        const latencyText = svc.latency !== undefined ? `${svc.latency} ms` : "--";
        const detailsText = svc.details ? escapeHtml(svc.details) : "";

        return `
          <div class="status-card status-${escapeAttr(svc.status)}">
            <div class="status-card-header">
              <span class="status-indicator" style="background: ${color}; box-shadow: 0 0 8px ${color};"></span>
              <span class="status-card-name">${escapeHtml(svc.name)}</span>
            </div>
            <div class="status-card-body">
              <div class="status-card-badge" style="color: ${color}; border-color: ${color};">${label}</div>
              <div class="status-card-latency">
                <span class="status-latency-label">Latency</span>
                <span class="status-latency-value">${latencyText}</span>
              </div>
              ${detailsText ? `<div class="status-card-details">${detailsText}</div>` : ""}
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    container.innerHTML = renderEmptyState("!", "ステータスの取得に失敗しました");
  } finally {
    hideSpinner("spinnerStatus");
  }
}

document.getElementById("refreshStatus").addEventListener("click", () => loadStatus());

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

  // Load notification settings
  loadNotificationSettings();
}

async function loadNotificationSettings() {
  try {
    const data = await apiFetch("/api/notification-settings");
    const settings = data.settings || {};

    const toastToggle = document.getElementById("toggle-toast");
    const soundToggle = document.getElementById("toggle-sound");

    if (toastToggle) toastToggle.checked = settings.toastEnabled !== false;
    if (soundToggle) soundToggle.checked = settings.soundEnabled !== false;
  } catch (e) {
    console.error("Failed to load notification settings:", e);
  }
}

async function saveNotificationSettings() {
  const toastToggle = document.getElementById("toggle-toast");
  const soundToggle = document.getElementById("toggle-sound");

  const payload = {
    toastEnabled: toastToggle ? toastToggle.checked : true,
    soundEnabled: soundToggle ? soundToggle.checked : true,
  };

  try {
    await apiFetch("/api/notification-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("Failed to save notification settings:", e);
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

// Notification toggle auto-save on change
["toggle-toast", "toggle-sound"].forEach((id) => {
  const toggle = document.getElementById(id);
  if (toggle) {
    toggle.addEventListener("change", () => saveNotificationSettings());
  }
});

// Save settings (voice + notification)
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
    await Promise.all([
      apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      }),
      saveNotificationSettings(),
    ]);

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
