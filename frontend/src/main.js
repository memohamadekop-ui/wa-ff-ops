import QRCode from "qrcode";
import "./style.css";

const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL || window.location.origin
).replace(/\/+$/, "");
const pageSize = 50;
const root = document.querySelector("#app");
let sessionToken = sessionStorage.getItem("wa-history-session");
let connection = null;
let conversations = [];
let selectedConversation = null;
let messages = [];
let globalMessages = [];
let globalSearchActive = false;
let conversationOffset = 0;
let messageOffset = 0;
let hasMoreConversations = false;
let hasMoreMessages = false;
let statusTimer = 0;
let busy = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function formatDate(value) {
  if (!value) return "Belum ada pesan";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tanggal tidak valid";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status) {
  return {
    starting: "Memulai",
    qr: "Menunggu scan QR",
    authenticated: "Terautentikasi",
    ready: "Terhubung",
    disconnected: "Terputus",
    error: "Ada masalah",
  }[status] ?? "Tidak diketahui";
}

function showLogin(message = "") {
  window.clearInterval(statusTimer);
  root.innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="brand-mark">WA</div>
        <p class="eyebrow">OCC · HISTORY CONSOLE</p>
        <h1>WhatsApp History</h1>
        <p class="muted">Masuk menggunakan akun administrator OCC.</p>
        <form id="login-form">
          <label for="email">Email</label>
          <input id="email" type="email" autocomplete="username" required>
          <label for="password">Password</label>
          <input id="password" type="password" autocomplete="current-password" required>
          <button class="button button-primary" type="submit">Masuk</button>
        </form>
        ${message ? `<div id="login-message" class="feedback feedback-error" role="status">${escapeHtml(message)}</div>` : ""}
      </section>
    </main>`;

  const loginForm = document.querySelector("#login-form");
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = loginForm.querySelector("button");
    submit.disabled = true;
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          email: document.querySelector("#email").value.trim(),
          password: document.querySelector("#password").value,
        }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok || !result.success || typeof result.data?.token !== "string") {
        throw new Error(result.error || `Login gagal (${response.status})`);
      }
      sessionToken = result.data.token;
      sessionStorage.setItem("wa-history-session", sessionToken);
      renderDashboard();
    } catch (error) {
      let loginMessage = document.querySelector("#login-message");
      if (!loginMessage) {
        loginMessage = document.createElement("div");
        loginMessage.id = "login-message";
        loginMessage.className = "feedback feedback-error";
        loginMessage.setAttribute("role", "status");
        loginForm.after(loginMessage);
      }
      loginMessage.textContent = error.message || "Login gagal.";
      submit.disabled = false;
    }
  });
}

function renderDashboard() {
  root.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">WA</div>
          <div><p class="eyebrow">OCC · HISTORY CONSOLE</p><h1>WhatsApp History</h1></div>
        </div>
        <div class="connection-actions">
          <span id="status-pill" class="status-pill status-starting"><span class="status-dot"></span><span id="status-label">Memulai</span></span>
          <button id="refresh-button" class="button button-secondary">Refresh</button>
          <button id="connect-button" class="button button-primary">Hubungkan</button>
          <button id="sync-button" class="button button-secondary">Sync sekarang</button>
          <button id="disconnect-button" class="button button-danger">Putuskan</button>
          <button id="logout-button" class="button button-secondary">Keluar</button>
        </div>
      </header>
      <div class="demo-banner"><span aria-hidden="true">i</span><p>Akses terbatas ke akun yang diizinkan. Halaman ini hanya menampilkan riwayat; tidak ada fitur kirim pesan.</p></div>
      <div id="feedback" class="feedback hidden" role="status"></div>
      <section class="connection-card">
        <div>
          <p class="eyebrow">KONEKSI PERANGKAT</p>
          <h2 id="connection-title">Status koneksi</h2>
          <p id="connection-detail" class="muted">Memuat status WhatsApp...</p>
        </div>
        <div id="qr-slot" class="qr-placeholder"><span>▦</span><span>QR akan muncul di sini</span></div>
      </section>
      <section class="workspace">
        <aside class="conversation-panel">
          <div class="panel-heading"><div><p class="eyebrow">ARSIP</p><h2>Percakapan</h2></div><span id="conversation-count" class="count-badge">0</span></div>
          <form id="conversation-search" class="search-form">
            <span class="search-icon">⌕</span>
            <input id="conversation-query" aria-label="Cari nama atau nomor" placeholder="Cari nama atau nomor">
            <button class="search-submit" aria-label="Cari" type="submit">↵</button>
          </form>
          <div id="conversation-list" class="conversation-list"></div>
          <button id="more-conversations" class="load-more hidden">Muat percakapan lainnya</button>
        </aside>
        <section class="message-panel">
          <div class="panel-heading message-heading">
            <div><p id="message-eyebrow" class="eyebrow">RIWAYAT PESAN</p><h2 id="message-title">Pilih percakapan</h2></div>
            <span id="message-count" class="count-badge">0</span>
          </div>
          <form id="global-search" class="global-search">
            <input id="global-query" aria-label="Cari isi pesan atau ID transaksi" placeholder="Cari isi pesan atau ID transaksi">
            <button class="button button-primary" type="submit">Cari semua pesan</button>
            <button id="export-global" class="button button-secondary hidden" type="button">Export Excel</button>
            <button id="close-global-search" class="button button-secondary hidden" type="button">Tutup</button>
          </form>
          <form id="chat-search" class="conversation-message-search hidden">
            <input id="chat-query" aria-label="Cari pesan di percakapan ini" placeholder="Cari pesan di percakapan ini">
            <button class="button button-secondary" type="submit">Cari di percakapan</button>
            <button id="export-chat" class="button button-secondary hidden" type="button">Export Excel</button>
          </form>
          <div id="message-list" class="message-list"><div class="empty-detail"><h3>Pilih percakapan</h3><p>Pilih percakapan untuk melihat riwayat pesan.</p></div></div>
          <button id="more-messages" class="load-more message-load-more hidden">Muat pesan lainnya</button>
        </section>
      </section>
      <footer>WhatsApp History API · read-only · data disimpan di Supabase</footer>
    </main>`;

  document.querySelector("#logout-button").addEventListener("click", () => {
    sessionStorage.removeItem("wa-history-session");
    sessionToken = null;
    showLogin();
  });
  document.querySelector("#refresh-button").addEventListener("click", () => void refreshStatus());
  document.querySelector("#connect-button").addEventListener("click", () => void runAction("connect"));
  document.querySelector("#disconnect-button").addEventListener("click", () => void runAction("disconnect"));
  document.querySelector("#sync-button").addEventListener("click", () => void runSync());
  document.querySelector("#conversation-search").addEventListener("submit", (event) => {
    event.preventDefault();
    void loadConversations(0, false, document.querySelector("#conversation-query").value.trim());
  });
  document.querySelector("#global-search").addEventListener("submit", (event) => void searchGlobal(event));
  document.querySelector("#chat-search").addEventListener("submit", (event) => void searchChat(event));
  document.querySelector("#export-global").addEventListener("click", () =>
    void exportSearch(document.querySelector("#global-query").value.trim()),
  );
  document.querySelector("#export-chat").addEventListener("click", () =>
    void exportSearch(document.querySelector("#chat-query").value.trim(), selectedConversation?.id),
  );
  document.querySelector("#close-global-search").addEventListener("click", () => {
    globalSearchActive = false;
    globalMessages = [];
    renderMessages();
  });
  document.querySelector("#more-conversations").addEventListener("click", () =>
    void loadConversations(conversationOffset + pageSize, true, document.querySelector("#conversation-query").value.trim()),
  );
  document.querySelector("#more-messages").addEventListener("click", () => {
    if (selectedConversation) void loadMessages(selectedConversation, messageOffset + pageSize, true);
  });
  void refreshStatus();
  void loadConversations();
  statusTimer = window.setInterval(() => void refreshStatus(), 5000);
}

function showFeedback(message, isError = false) {
  const feedback = document.querySelector("#feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `feedback ${isError ? "feedback-error" : "feedback-success"}`;
}

async function api(path, options = {}) {
  if (!sessionToken) throw new Error("Silakan masuk kembali.");
  const response = await fetch(`${apiBaseUrl}/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  if (response.status === 401) {
    sessionStorage.removeItem("wa-history-session");
    sessionToken = null;
    showLogin("Sesi sudah berakhir. Silakan masuk lagi.");
    throw new Error("Sesi sudah berakhir. Silakan masuk lagi.");
  }
  if (!response.ok) {
    let message = `Permintaan gagal (${response.status})`;
    try {
      const result = await response.json();
      message = result.error || message;
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new Error(message);
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.error || "Permintaan gagal.");
  return result;
}

async function refreshStatus() {
  try {
    const result = await api("/wa/status");
    connection = result.data;
    const pill = document.querySelector("#status-pill");
    if (!pill) return;
    pill.className = `status-pill status-${connection.status}`;
    document.querySelector("#status-label").textContent = statusLabel(connection.status);
    document.querySelector("#connection-title").textContent =
      connection.status === "ready" ? "WhatsApp sudah terhubung" :
      connection.status === "qr" ? "Pindai QR dengan WhatsApp" : "Status koneksi";
    document.querySelector("#connection-detail").textContent =
      connection.lastError ||
      (connection.status === "qr"
        ? "Buka WhatsApp di ponsel, pilih Perangkat tertaut, lalu pindai QR."
        : `Pembaruan terakhir: ${formatDate(connection.updatedAt)}`);
    const qrSlot = document.querySelector("#qr-slot");
    if (connection.qrCode) {
      const qrDataUrl = await QRCode.toDataURL(connection.qrCode, { width: 220, margin: 2 });
      qrSlot.className = "qr-wrap";
      qrSlot.innerHTML = `<img alt="QR untuk menautkan WhatsApp" src="${qrDataUrl}">`;
    } else {
      qrSlot.className = "qr-placeholder";
      qrSlot.innerHTML = `<span>${connection.status === "ready" ? "✓" : "▦"}</span><span>${connection.status === "ready" ? "Perangkat tertaut" : "QR akan muncul di sini"}</span>`;
    }
  } catch (error) {
    showFeedback(error.message || "Gagal mengambil status backend.", true);
  }
}

async function loadConversations(offset = 0, append = false, query = "") {
  try {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (query) params.set("q", query);
    const result = await api(`/wa/conversations?${params}`);
    conversations = append ? [...conversations, ...result.data] : result.data;
    conversationOffset = offset;
    hasMoreConversations = result.pagination?.hasMore ?? false;
    renderConversations();
  } catch (error) {
    showFeedback(error.message || "Gagal memuat percakapan.", true);
  }
}

function renderConversations() {
  const list = document.querySelector("#conversation-list");
  if (!list) return;
  document.querySelector("#conversation-count").textContent = String(conversations.length);
  list.innerHTML = conversations.length
    ? conversations.map((item) => {
        const title = item.display_name || item.phone_number;
        const selected = selectedConversation?.id === item.id && !globalSearchActive;
        return `<button class="conversation-item ${selected ? "conversation-selected" : ""}" data-id="${escapeHtml(item.id)}">
          <span class="avatar">${escapeHtml(title.slice(0, 1).toUpperCase())}</span>
          <span class="conversation-copy"><span class="conversation-name">${escapeHtml(title)}</span>
          <span class="conversation-phone">${escapeHtml(item.phone_number)}</span>
          <span class="conversation-date">${escapeHtml(formatDate(item.last_message_at))}</span></span>
        </button>`;
      }).join("")
    : '<p class="empty-state">Belum ada percakapan.</p>';
  list.querySelectorAll(".conversation-item").forEach((button) => {
    button.addEventListener("click", () => {
      const conversation = conversations.find((item) => item.id === button.dataset.id);
      if (conversation) selectConversation(conversation);
    });
  });
  document.querySelector("#more-conversations").classList.toggle("hidden", !hasMoreConversations);
}

async function selectConversation(conversation) {
  selectedConversation = conversation;
  globalSearchActive = false;
  document.querySelector("#chat-search").classList.remove("hidden");
  document.querySelector("#chat-query").value = "";
  document.querySelector("#export-chat").classList.add("hidden");
  renderConversations();
  await loadMessages(conversation);
}

async function loadMessages(conversation, offset = 0, append = false, query = "") {
  try {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (query) params.set("q", query);
    const result = await api(`/wa/conversations/${encodeURIComponent(conversation.id)}/messages?${params}`);
    messages = append ? [...messages, ...result.data] : result.data;
    messageOffset = offset;
    hasMoreMessages = result.pagination?.hasMore ?? false;
    renderMessages();
  } catch (error) {
    showFeedback(error.message || "Gagal memuat riwayat pesan.", true);
  }
}

function renderMessages() {
  const list = document.querySelector("#message-list");
  if (!list) return;
  const isGlobal = globalSearchActive;
  const rows = isGlobal ? globalMessages : messages;
  document.querySelector("#message-eyebrow").textContent = isGlobal ? "PENCARIAN GLOBAL" : "RIWAYAT PESAN";
  document.querySelector("#message-title").textContent = isGlobal
    ? `Hasil: ${document.querySelector("#global-query").value.trim()}`
    : selectedConversation?.display_name || selectedConversation?.phone_number || "Pilih percakapan";
  document.querySelector("#message-count").textContent = String(rows.length);
  document.querySelector("#close-global-search").classList.toggle("hidden", !isGlobal);
  document.querySelector("#export-global").classList.toggle("hidden", !isGlobal || !rows.length);
  document.querySelector("#more-messages").classList.toggle("hidden", isGlobal || !selectedConversation || !hasMoreMessages);
  if (!rows.length) {
    list.innerHTML = isGlobal
      ? '<p class="empty-state">Tidak ada hasil pencarian.</p>'
      : selectedConversation
        ? '<p class="empty-state">Belum ada pesan pada percakapan ini.</p>'
        : '<div class="empty-detail"><h3>Pilih percakapan</h3><p>Pilih percakapan untuk melihat riwayat pesan.</p></div>';
    return;
  }
  list.innerHTML = rows.map((message) => {
    const conversation = conversations.find((item) => item.id === message.conversation_id);
    const sender = isGlobal
      ? `<span class="message-conversation-link">${escapeHtml(conversation?.display_name || conversation?.phone_number || message.conversation_id)}</span>`
      : `<span>${escapeHtml(message.sender_name || (message.direction === "outbound" ? "Akun tertaut" : ""))}</span>`;
    return `<article class="message-row">
      <div class="message-meta"><span class="direction direction-${escapeHtml(message.direction)}">${escapeHtml(message.direction)}</span>${sender}<time>${escapeHtml(formatDate(message.message_at))}</time></div>
      <p class="message-body">${escapeHtml(message.body || "[pesan tanpa teks]")}</p>
      ${message.external_id ? `<code class="message-id">${escapeHtml(message.external_id)}</code>` : ""}
      ${message.metadata?.hasMedia ? '<span class="media-note">Lampiran tidak diunduh</span>' : ""}
    </article>`;
  }).join("");
}

async function searchGlobal(event) {
  event.preventDefault();
  const query = document.querySelector("#global-query").value.trim();
  if (!query) return showFeedback("Isi kata pencarian terlebih dahulu.", true);
  try {
    const params = new URLSearchParams({ q: query, limit: String(pageSize), offset: "0" });
    const result = await api(`/wa/messages?${params}`);
    globalMessages = result.data;
    globalSearchActive = true;
    renderMessages();
  } catch (error) {
    showFeedback(error.message || "Pencarian pesan gagal.", true);
  }
}

async function searchChat(event) {
  event.preventDefault();
  if (!selectedConversation) return;
  const query = document.querySelector("#chat-query").value.trim();
  await loadMessages(selectedConversation, 0, false, query);
  document.querySelector("#export-chat").classList.toggle("hidden", !query || !messages.length);
}

async function exportSearch(query, conversationId) {
  if (!query) return showFeedback("Isi kata pencarian terlebih dahulu.", true);
  try {
    const params = new URLSearchParams({ q: query });
    if (conversationId) params.set("conversationId", conversationId);
    const response = await fetch(`${apiBaseUrl}/api/wa/messages/export?${params}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      cache: "no-store",
    });
    if (!response.ok) {
      let message = `Export gagal (${response.status})`;
      try {
        message = (await response.json()).error || message;
      } catch {
        // Keep the HTTP status message when the response is not JSON.
      }
      throw new Error(message);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "whatsapp-search-results.xlsx";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showFeedback("File Excel hasil pencarian berhasil diunduh.");
  } catch (error) {
    showFeedback(error.message || "Export Excel gagal.", true);
  }
}

async function runAction(action) {
  await withBusy(async () => {
    await api(`/wa/${action}`, { method: "POST" });
    showFeedback(action === "connect" ? "Permintaan koneksi diproses." : "WhatsApp diputus.");
    await refreshStatus();
  });
}

async function runSync() {
  await withBusy(async () => {
    const result = await api("/wa/sync", { method: "POST" });
    const sync = result.data;
    showFeedback(`Sync selesai: ${sync.inserted} pesan baru, ${sync.duplicates} duplikat. ${sync.directChats} dari ${sync.chatsFound} chat diperiksa.`);
    await loadConversations();
    if (selectedConversation) await loadMessages(selectedConversation);
  });
}

async function withBusy(action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll(".connection-actions button").forEach((button) => {
    if (button.id !== "logout-button" && button.id !== "refresh-button") button.disabled = true;
  });
  try {
    await action();
  } catch (error) {
    showFeedback(error.message || "Aksi gagal.", true);
  } finally {
    busy = false;
    document.querySelectorAll(".connection-actions button").forEach((button) => {
      button.disabled = false;
    });
  }
}

if (!sessionToken) {
  showLogin();
} else {
  api("/wa/status")
    .then(() => renderDashboard())
    .catch(() => {
      sessionStorage.removeItem("wa-history-session");
      sessionToken = null;
      showLogin("Sesi sudah berakhir. Silakan masuk lagi.");
    });
}
