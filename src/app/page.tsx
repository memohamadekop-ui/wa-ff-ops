"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: { limit: number; offset: number; hasMore: boolean };
};

type ConnectionStatus = {
  status: "starting" | "qr" | "authenticated" | "ready" | "disconnected" | "error";
  qrCode: string | null;
  lastError: string | null;
  updatedAt: string;
};

type Conversation = {
  id: string;
  phone_number: string;
  display_name: string | null;
  last_message_at: string | null;
};

type Message = {
  id: string;
  conversation_id: string;
  message_at: string;
  direction: "inbound" | "outbound" | "system" | "unknown";
  sender_name: string | null;
  body: string;
  external_id: string | null;
  metadata: Record<string, unknown>;
};

const PAGE_SIZE = 50;

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`/api/demo${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  let result: ApiResponse<T>;
  try {
    result = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`Server returned an invalid response (${response.status})`);
  }
  if (!response.ok || !result.success || result.data === undefined) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return result;
}

function formatDate(value: string | null) {
  if (!value) return "Belum ada pesan";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Tanggal tidak valid"
    : new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function exportFileName(query: string) {
  const safeQuery = query
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .trim()
    .replace(/[. ]+$/g, "");
  return `whatsapp-search-results_search_${safeQuery || "results"}.xlsx`;
}

function statusLabel(status: ConnectionStatus["status"]) {
  const labels: Record<ConnectionStatus["status"], string> = {
    starting: "Memulai",
    qr: "Menunggu scan QR",
    authenticated: "Terautentikasi",
    ready: "Terhubung",
    disconnected: "Terputus",
    error: "Ada masalah",
  };
  return labels[status];
}

export default function Home() {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationQuery, setConversationQuery] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageQuery, setMessageQuery] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalMessages, setGlobalMessages] = useState<Message[]>([]);
  const [globalSearchActive, setGlobalSearchActive] = useState(false);
  const [conversationOffset, setConversationOffset] = useState(0);
  const [messageOffset, setMessageOffset] = useState(0);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshStatus = useCallback(async () => {
    try {
      const result = await request<ConnectionStatus>("/wa/status");
      setConnection(result.data!);
      if (result.data!.qrCode) {
        setQrImage(await QRCode.toDataURL(result.data!.qrCode, { width: 220, margin: 2 }));
      } else {
        setQrImage("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal mengambil status WhatsApp");
    }
  }, []);

  const loadConversations = useCallback(
    async (offset = 0, append = false, query = "") => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (query.trim()) params.set("q", query.trim());
      const result = await request<Conversation[]>(`/wa/conversations?${params}`);
      setConversations((current) =>
        append ? [...current, ...(result.data ?? [])] : (result.data ?? []),
      );
      setConversationOffset(offset);
      setHasMoreConversations(result.pagination?.hasMore ?? false);
    },
    [],
  );

  const loadMessages = useCallback(
    async (conversation: Conversation, offset = 0, append = false, query = "") => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (query.trim()) params.set("q", query.trim());
      const result = await request<Message[]>(
        `/wa/conversations/${encodeURIComponent(conversation.id)}/messages?${params}`,
      );
      setMessages((current) => {
        const next = append ? [...current, ...(result.data ?? [])] : (result.data ?? []);
        return [...new Map(next.map((message) => [message.id, message])).values()];
      });
      setMessageOffset(offset);
      setHasMoreMessages(result.pagination?.hasMore ?? false);
    },
    [],
  );

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    void loadConversations().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Gagal memuat percakapan");
    });
  }, [loadConversations]);

  useEffect(() => {
    if (!connection?.qrCode) {
      setQrImage("");
      return;
    }
    void QRCode.toDataURL(connection.qrCode, { width: 220, margin: 2 })
      .then(setQrImage)
      .catch(() => setError("QR tidak dapat ditampilkan"));
  }, [connection?.qrCode]);

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedConversation).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Gagal memuat pesan");
    });
  }, [loadMessages, selectedConversation]);

  useEffect(() => {
    if (connection?.status !== "ready") return;

    const timer = window.setInterval(() => {
      void loadConversations(0, false, conversationQuery).catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "Gagal memuat percakapan"),
      );
      if (globalSearchActive && globalQuery.trim()) {
        const params = new URLSearchParams({
          q: globalQuery.trim(),
          limit: String(PAGE_SIZE),
          offset: "0",
        });
        void request<Message[]>(`/wa/messages?${params}`)
          .then((result) => setGlobalMessages(result.data ?? []))
          .catch((caught: unknown) =>
            setError(caught instanceof Error ? caught.message : "Pencarian pesan gagal"),
          );
      } else if (selectedConversation) {
        void loadMessages(
          selectedConversation,
          0,
          false,
          messageQuery,
        ).catch((caught: unknown) =>
          setError(caught instanceof Error ? caught.message : "Gagal memuat pesan"),
        );
      }
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [
    connection?.status,
    conversationQuery,
    globalQuery,
    globalSearchActive,
    loadConversations,
    loadMessages,
    messageQuery,
    selectedConversation,
  ]);

  const selectedTitle = useMemo(
    () => selectedConversation?.display_name || selectedConversation?.phone_number || "Pilih percakapan",
    [selectedConversation],
  );

  async function runAction(action: "connect" | "disconnect") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/wa/${action}`, { method: "POST" });
      setNotice(action === "connect" ? "Permintaan koneksi diproses." : "WhatsApp diputus.");
      await refreshStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aksi gagal");
    } finally {
      setBusy(false);
    }
  }

  async function runSync() {
    setBusy(true);
    setSyncing(true);
    setError("");
    setNotice("Sinkronisasi berjalan. Mohon tunggu, proses ini dapat memerlukan beberapa menit.");
    try {
      const result = await request<{
        chatsFound: number;
        directChats: number;
        messagesRead: number;
        inserted: number;
        duplicates: number;
      }>("/wa/sync", { method: "POST" });
      const sync = result.data!;
      setNotice(
        `Sync selesai: ${sync.inserted} pesan baru, ${sync.duplicates} duplikat. ` +
          `${sync.directChats} dari ${sync.chatsFound} chat terbaca; ${sync.messagesRead} pesan diperiksa.`,
      );
      await loadConversations();
      if (selectedConversation) await loadMessages(selectedConversation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sinkronisasi WhatsApp gagal");
    } finally {
      setSyncing(false);
      setBusy(false);
    }
  }

  async function searchGlobal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!globalQuery.trim()) {
      setError("Isi kata pencarian terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError("");
    setGlobalSearchActive(true);
    try {
      const params = new URLSearchParams({
        q: globalQuery.trim(),
        limit: String(PAGE_SIZE),
        offset: "0",
      });
      const result = await request<Message[]>(`/wa/messages?${params}`);
      setGlobalMessages(result.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pencarian pesan gagal");
      setGlobalMessages([]);
    } finally {
      setBusy(false);
    }
  }

  async function searchConversationMessages(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversation) return;
    setError("");
    try {
      await loadMessages(selectedConversation, 0, false, messageQuery);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pencarian pesan gagal");
    }
  }

  async function exportSearch(query: string, conversationId?: string) {
    if (!query.trim()) {
      setError("Isi kata pencarian terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (conversationId) params.set("conversationId", conversationId);
      const response = await fetch(`/api/demo/wa/messages/export?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        let message = `Export gagal (${response.status})`;
        try {
          const result = (await response.json()) as ApiResponse<unknown>;
          message = result.error || message;
        } catch {
          // Keep the HTTP status message when the response is not JSON.
        }
        throw new Error(message);
      }
      const file = await response.blob();
      const downloadUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = exportFileName(query);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setNotice("File Excel hasil pencarian berhasil diunduh.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export Excel gagal");
    } finally {
      setBusy(false);
    }
  }

  function selectConversation(conversation: Conversation) {
    setGlobalSearchActive(false);
    setSelectedConversation(conversation);
    setMessageQuery("");
    setMessageOffset(0);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">WA</div>
          <div>
            <p className="eyebrow">OCC · HISTORY CONSOLE</p>
            <h1>WhatsApp History</h1>
          </div>
        </div>
        <div className="connection-actions">
          <span className={`status-pill status-${connection?.status ?? "starting"}`}>
            <span className="status-dot" />
            {statusLabel(connection?.status ?? "starting")}
          </span>
          <button className="button button-secondary" onClick={() => void refreshStatus()}>
            Refresh
          </button>
          <button className="button button-primary" disabled={busy} onClick={() => void runAction("connect")}>
            Hubungkan
          </button>
          <button aria-busy={syncing} className="button button-secondary" disabled={busy || connection?.status !== "ready"} onClick={() => void runSync()}>
            {syncing && <span aria-hidden="true" className="button-spinner" />}
            {syncing ? "Sedang sync..." : "Sync sekarang"}
          </button>
          <button className="button button-danger" disabled={busy} onClick={() => void runAction("disconnect")}>
            Putuskan
          </button>
        </div>
      </header>

      <div className="demo-banner">
        <span className="banner-icon">i</span>
        <p>
          <strong>Demo lokal.</strong> Halaman ini hanya bisa memakai proxy saat server dijalankan
          dengan <code>npm run dev</code> dari mesin yang sama. Tidak ada fitur kirim pesan.
        </p>
      </div>

      {(error || notice) && (
        <div className={`feedback ${error ? "feedback-error" : syncing ? "feedback-loading" : "feedback-success"}`} role="status">
          <span>{error || notice}</span>
          <button
            aria-label="Tutup notifikasi"
            className="feedback-close"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}

      {syncing && (
        <div className="sync-modal-backdrop" role="presentation">
          <section
            aria-labelledby="sync-modal-title"
            aria-describedby="sync-modal-description"
            aria-modal="true"
            className="sync-modal"
            role="dialog"
          >
            <div aria-hidden="true" className="sync-modal-spinner" />
            <p className="eyebrow">SINKRONISASI WHATSAPP</p>
            <h2 id="sync-modal-title">Sedang mengambil data terbaru</h2>
            <p id="sync-modal-description">
              Mohon tunggu. Percakapan dan pesan sedang disinkronkan, proses ini bisa memerlukan beberapa menit.
            </p>
            <div aria-label="Sinkronisasi sedang berlangsung" className="sync-progress-track" role="progressbar">
              <span />
            </div>
            <span className="sync-modal-footnote">Jangan tutup halaman ini</span>
          </section>
        </div>
      )}

      <section className="connection-card">
        <div>
          <p className="eyebrow">KONEKSI PERANGKAT</p>
          <h2>
            {connection?.status === "ready"
              ? "WhatsApp sudah terhubung"
              : connection?.status === "qr"
                ? "Pindai QR dengan WhatsApp"
                : "Status koneksi"}
          </h2>
          <p className="muted">
            {connection?.lastError ||
              (connection?.status === "qr"
                ? "Buka WhatsApp di ponsel, lalu pilih Perangkat tertaut untuk memindai QR."
                : `Pembaruan terakhir: ${formatDate(connection?.updatedAt ?? null)}`)}
          </p>
        </div>
        {qrImage ? (
          <div className="qr-wrap">
            {/* QR is provided by the authenticated backend only while linking a device. */}
            <img src={qrImage} alt="QR untuk menautkan WhatsApp" width="220" height="220" />
          </div>
        ) : (
          <div className="qr-placeholder">
            <span className="qr-placeholder-icon">{connection?.status === "ready" ? "✓" : "▦"}</span>
            <span>{connection?.status === "ready" ? "Perangkat tertaut" : "QR akan muncul di sini"}</span>
          </div>
        )}
      </section>

      <section className="workspace">
        <aside className="conversation-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ARSIP</p>
              <h2>Percakapan</h2>
            </div>
            <span className="count-badge">{conversations.length}</span>
          </div>
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              void loadConversations(0, false, conversationQuery).catch((caught: unknown) =>
                setError(caught instanceof Error ? caught.message : "Pencarian gagal"),
              );
            }}
          >
            <span className="search-icon">⌕</span>
            <input
              aria-label="Cari nomor atau nama percakapan"
              onChange={(event) => setConversationQuery(event.target.value)}
              placeholder="Cari nama atau nomor"
              value={conversationQuery}
            />
            <button aria-label="Cari" className="search-submit" type="submit">
              ↵
            </button>
          </form>
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                className={`conversation-item ${selectedConversation?.id === conversation.id && !globalSearchActive ? "conversation-selected" : ""}`}
                key={conversation.id}
                onClick={() => selectConversation(conversation)}
              >
                <span className="avatar">{(conversation.display_name || conversation.phone_number).slice(0, 1).toUpperCase()}</span>
                <span className="conversation-copy">
                  <span className="conversation-name">{conversation.display_name || conversation.phone_number}</span>
                  <span className="conversation-phone">{conversation.phone_number}</span>
                  <span className="conversation-date">{formatDate(conversation.last_message_at)}</span>
                </span>
              </button>
            ))}
            {!conversations.length && <p className="empty-state">Belum ada percakapan.</p>}
            {hasMoreConversations && (
              <button
                className="load-more"
                onClick={() =>
                  void loadConversations(conversationOffset + PAGE_SIZE, true, conversationQuery).catch((caught: unknown) =>
                    setError(caught instanceof Error ? caught.message : "Gagal memuat halaman berikutnya"),
                  )
                }
              >
                Muat percakapan lainnya
              </button>
            )}
          </div>
        </aside>

        <section className="message-panel">
          <div className="panel-heading message-heading">
            <div>
              <p className="eyebrow">{globalSearchActive ? "PENCARIAN GLOBAL" : "RIWAYAT PESAN"}</p>
              <h2>{globalSearchActive ? `Hasil: ${globalQuery}` : selectedTitle}</h2>
            </div>
            <span className="count-badge">{globalSearchActive ? globalMessages.length : messages.length}</span>
          </div>

          <form className="global-search" onSubmit={searchGlobal}>
            <input
              aria-label="Cari isi pesan atau ID transaksi"
              onChange={(event) => setGlobalQuery(event.target.value)}
              placeholder="Cari isi pesan atau ID transaksi"
              value={globalQuery}
            />
            <button className="button button-primary" disabled={busy} type="submit">
              Cari semua pesan
            </button>
            {globalSearchActive && (
              <button
                className="button button-secondary"
                disabled={busy || !globalQuery.trim() || !globalMessages.length}
                onClick={() => void exportSearch(globalQuery)}
                type="button"
              >
                Export Excel
              </button>
            )}
            {globalSearchActive && (
              <button
                className="button button-secondary"
                onClick={() => {
                  setGlobalSearchActive(false);
                  setGlobalMessages([]);
                }}
                type="button"
              >
                Tutup
              </button>
            )}
          </form>

          {!globalSearchActive && selectedConversation && (
            <form className="conversation-message-search" onSubmit={searchConversationMessages}>
              <input
                aria-label="Cari pesan pada percakapan"
                onChange={(event) => setMessageQuery(event.target.value)}
                placeholder="Cari pesan di percakapan ini"
                value={messageQuery}
              />
              <button className="button button-secondary" type="submit">Cari di percakapan</button>
              {messageQuery.trim() && (
                <button
                  className="button button-secondary"
                  disabled={busy || !messages.length}
                  onClick={() =>
                    void exportSearch(messageQuery, selectedConversation.id)
                  }
                  type="button"
                >
                  Export Excel
                </button>
              )}
            </form>
          )}

          <div className="message-list">
            {globalSearchActive
              ? globalMessages.map((message) => {
                  const conversation = conversations.find((item) => item.id === message.conversation_id);
                  return (
                    <article className="message-row" key={message.id}>
                      <div className="message-meta">
                        <span className={`direction direction-${message.direction}`}>{message.direction}</span>
                        <button
                          className="message-conversation-link"
                          onClick={() => {
                            const match = conversations.find((item) => item.id === message.conversation_id);
                            if (match) selectConversation(match);
                            else setError("Percakapan belum ada di halaman daftar saat ini.");
                          }}
                        >
                          {conversation?.display_name || conversation?.phone_number || message.conversation_id}
                        </button>
                        <time>{formatDate(message.message_at)}</time>
                      </div>
                      <p className="message-body">{message.body || "[pesan tanpa teks]"}</p>
                      {message.external_id && <code className="message-id">{message.external_id}</code>}
                    </article>
                  );
                })
              : messages.map((message) => (
                  <article className={`message-row message-${message.direction}`} key={message.id}>
                    <div className="message-meta">
                      <span className={`direction direction-${message.direction}`}>{message.direction}</span>
                      <span>{message.sender_name || (message.direction === "outbound" ? "Akun tertaut" : "")}</span>
                      <time>{formatDate(message.message_at)}</time>
                    </div>
                    <p className="message-body">{message.body || "[pesan tanpa teks]"}</p>
                    {Boolean(message.metadata?.hasMedia) && <span className="media-note">Lampiran tidak diunduh</span>}
                  </article>
                ))}
            {!globalSearchActive && !selectedConversation && (
              <div className="empty-detail">
                <span className="empty-detail-icon">◷</span>
                <h3>Pilih percakapan</h3>
                <p>Pilih salah satu percakapan untuk melihat riwayat pesannya.</p>
              </div>
            )}
            {globalSearchActive && !globalMessages.length && (
              <p className="empty-state">Tidak ada hasil pencarian.</p>
            )}
            {!globalSearchActive && selectedConversation && !messages.length && (
              <p className="empty-state">Belum ada pesan pada percakapan ini.</p>
            )}
          </div>
          {!globalSearchActive && selectedConversation && hasMoreMessages && (
            <button
              className="load-more message-load-more"
              onClick={() =>
                void loadMessages(selectedConversation, messageOffset + PAGE_SIZE, true).catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : "Gagal memuat halaman berikutnya"),
                )
              }
            >
              Muat pesan lainnya
            </button>
          )}
        </section>
      </section>
      <footer>WhatsApp History API · read-only · data disimpan di Supabase</footer>
    </main>
  );
}
