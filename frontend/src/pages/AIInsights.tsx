import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Card, Button, Eyebrow, Spinner, EmptyState, Textarea, Badge, Select } from "@/components/ui";

type Conv = { id: number; question: string; answer: string; created_at: string };
type Status = {
  ollama_url: string;
  model: string;
  reachable: boolean;
  model_installed: boolean;
  available_models: { name: string; parameter_size: string | null; family: string | null }[];
};

const SUGGESTIONS = [
  "Which bills increased the most over the past 6 months?",
  "How much would I save if I cut Hulu, Disney+ and Spotify?",
  "What's the optimal debt payoff order — avalanche or snowball?",
  "Project my net worth in 3 years given current trends.",
  "How does my actual income allocation compare to my budget targets?",
];

export function AIInsights() {
  // Transcript is intentionally ephemeral — it lives only in this component's
  // state, never persisted, and is gone when the tab/session ends.
  const [messages, setMessages] = useState<Conv[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function loadStatus() {
    setStatus(await api.get<Status>("/ai/status"));
  }
  useEffect(() => { loadStatus().catch(() => {}); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      // Send the current in-memory transcript so follow-ups have context.
      const r = await api.post<{ question: string; answer: string }>("/ai/chat", {
        question: text,
        history: messages.map((m) => ({ question: m.question, answer: m.answer })),
      });
      setQuestion("");
      setMessages((prev) => [
        ...prev,
        { id: prev.length + 1, question: r.question, answer: r.answer, created_at: "" },
      ]);
    } catch (e) {
      if (e instanceof ApiError) setError(e.payload?.message || e.message);
      else setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
  }

  async function pickModel(name: string) {
    await api.post("/ai/model", { model: name });
    await loadStatus();
  }

  const showModelPicker = !!status && status.reachable && !status.model_installed;
  const statusTone: "success" | "warning" | "danger" =
    !status ? "danger" : !status.reachable ? "danger" : !status.model_installed ? "warning" : "success";
  const statusLabel = !status
    ? "Loading…"
    : !status.reachable
    ? "Ollama not reachable"
    : !status.model_installed
    ? `${status.model} not installed`
    : `${status.model} ready`;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 className="t-h2" style={{ margin: 0 }}>Insights</h1>
          <p style={{ marginTop: 6, color: "var(--fg-2)", fontSize: 14 }}>
            Ask anything about your money. Stays on this machine, and this chat clears when you leave.
          </p>
        </div>
        {status && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearChat} icon="Trash2">Clear</Button>
            )}
            {status.reachable && status.available_models.length > 0 && (
              <div style={{ minWidth: 180 }}>
                <Select value={status.model} onChange={(e) => pickModel(e.target.value)}>
                  {status.available_models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}{m.parameter_size ? ` · ${m.parameter_size}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <Badge tone={statusTone}>{statusLabel}</Badge>
          </div>
        )}
      </div>

      {showModelPicker && (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            background: "var(--warning-soft)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-md)",
            color: "var(--warning)",
            fontSize: 13,
          }}
        >
          {status!.available_models.length > 0
            ? <>The configured model <code style={{ fontFamily: "var(--font-mono)" }}>{status!.model}</code> isn't installed. Pick one from the list above, or run <code style={{ fontFamily: "var(--font-mono)" }}>ollama pull {status!.model}</code>.</>
            : <>No chat-capable models found. Run <code style={{ fontFamily: "var(--font-mono)" }}>ollama pull llama3.2:3b</code> (or any chat model) and refresh.</>
          }
        </div>
      )}

      <Card padding={0} style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 280px)", minHeight: 420 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {messages.length === 0 ? (
            <div style={{ marginTop: "auto", marginBottom: "auto" }}>
              <EmptyState
                icon="Sparkles"
                title="Ask Hearth anything."
                body="Your bills, debt, savings and income are sent as context with each question. This conversation isn't saved."
              />
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--r-md)",
                      padding: "10px 14px",
                      textAlign: "left",
                      fontSize: 13,
                      color: "var(--fg-1)",
                      cursor: "pointer",
                    }}
                  >
                    <Sparkles size={14} strokeWidth={1.75} style={{ marginRight: 8, color: "var(--brand)", verticalAlign: "middle" }} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages
              .map((c) => (
                <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ alignSelf: "flex-end", maxWidth: "80%" }}>
                    <div
                      style={{
                        background: "var(--brand)",
                        color: "var(--brand-fg)",
                        padding: "10px 14px",
                        borderRadius: "var(--r-lg)",
                        fontSize: 14,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {c.question}
                    </div>
                  </div>
                  <div style={{ alignSelf: "flex-start", maxWidth: "80%" }}>
                    <div
                      style={{
                        background: "var(--surface-2)",
                        color: "var(--fg-1)",
                        padding: "12px 16px",
                        borderRadius: "var(--r-lg)",
                        fontSize: 14,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {c.answer || <em style={{ color: "var(--fg-3)" }}>(no answer)</em>}
                    </div>
                  </div>
                </div>
              ))
          )}
        </div>

        {error && (
          <div style={{ padding: "10px 24px", color: "var(--danger)", fontSize: 13 }}>{error}</div>
        )}

        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: 16,
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
          }}
        >
          <div style={{ flex: 1 }}>
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything about your money…"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  ask();
                }
              }}
            />
          </div>
          <Button variant="primary" size="md" onClick={() => ask()} loading={busy} icon="Send">
            Ask
          </Button>
        </div>
      </Card>
    </>
  );
}
