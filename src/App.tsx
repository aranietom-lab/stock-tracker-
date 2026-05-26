import { useState, useCallback, useEffect, useRef } from "react";

const DEFAULT_WATCHLIST = ["AAPL", "TSLA", "NVDA"];
const ANTHROPIC_KEY = "TU_API_KEY_AQUI"; // 👈 reemplaza esto con tu sk-ant-...

const SIGNAL_COLORS = {
  BUY:  { bg: "#eaf3de", text: "#3b6d11", border: "#639922" },
  SELL: { bg: "#fcebeb", text: "#a32d2d", border: "#e24b4a" },
  HOLD: { bg: "#faeeda", text: "#854f0b", border: "#ba7517" },
};

function SignalBadge({ signal }) {
  const c = SIGNAL_COLORS[signal] || { bg: "#f1efe8", text: "#5f5e5a", border: "#b4b2a9" };
  return (
    <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 6, padding: "2px 10px", fontSize: 13, fontWeight: 600 }}>
      {signal}
    </span>
  );
}

function TradingViewWidget({ ticker }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.innerHTML = JSON.stringify({
      symbol: ticker, interval: "D", width: "100%", height: 320,
      timezone: "Etc/UTC", theme: "light", style: "1", locale: "es",
      studies: ["RSI@tv-basicstudies", "MASimple@tv-basicstudies"],
      support_host: "https://www.tradingview.com"
    });
    ref.current.appendChild(s);
  }, [ticker]);
  return <div ref={ref} style={{ width: "100%", minHeight: 320, borderRadius: 8, overflow: "hidden" }} />;
}

async function analyzeWithSearch(ticker) {
  const today = new Date().toISOString().split("T")[0];
  const prompt = `Today is ${today}. Use web search to find REAL, CURRENT data for stock ticker ${ticker}.
Search for: current price, recent news (last 7 days), analyst ratings.
Respond ONLY with this JSON (no markdown):
{
  "price": <number>,
  "changePercent": <number>,
  "signal": "BUY"|"SELL"|"HOLD",
  "confidence": "High"|"Medium"|"Low",
  "priceTarget": "<string>",
  "technicalSummary": "<string>",
  "newsSentiment": "Positive"|"Neutral"|"Negative",
  "newsSummary": "<string>",
  "reasoning": "<string>",
  "keyRisks": "<string>",
  "news": [{"title":"<string>","publisher":"<string>","time":"<string>"}]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  const match = text.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Error al parsear respuesta");
  return JSON.parse(match[0]);
}

const SENT_COLOR = { Positive: "#3b6d11", Neutral: "#854f0b", Negative: "#a32d2d" };

function StockCard({ ticker, onRemove, autoRefreshInterval }) {
  const [state, setState] = useState({ status: "idle", data: null, error: null });
  const [showChart, setShowChart] = useState(false);
  const [tab, setTab] = useState("analysis");
  const [lastUpdated, setLastUpdated] = useState(null);

  const analyze = useCallback(async () => {
    setState(s => ({ ...s, status: "loading", error: null }));
    setTab("analysis");
    try {
      const ai = await analyzeWithSearch(ticker);
      setState({ status: "done", data: { ai }, error: null });
      setLastUpdated(new Date().toLocaleTimeString("es-ES"));
    } catch (e) {
      setState(s => ({ ...s, status: "error", error: e.message }));
    }
  }, [ticker]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefreshInterval) return;
    const id = setInterval(analyze, autoRefreshInterval * 60 * 1000);
    return () => clearInterval(id);
  }, [analyze, autoRefreshInterval]);

  const { status, data, error } = state;

  return (
    <div style={{ background: "#fff", border: "1px solid #e0dfd8", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ padding: "0.85rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", borderBottom: status !== "idle" ? "1px solid #e0dfd8" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>{ticker}</span>
          {status === "done" && data && (
            <>
              <span style={{ fontSize: 15 }}>${data.ai.price?.toFixed(2)}</span>
              <span style={{ fontSize: 13, color: data.ai.changePercent >= 0 ? "#3b6d11" : "#a32d2d", fontWeight: 500 }}>
                {data.ai.changePercent >= 0 ? "▲" : "▼"} {Math.abs(data.ai.changePercent).toFixed(2)}%
              </span>
              {lastUpdated && <span style={{ fontSize: 11, color: "#999" }}>· {lastUpdated}</span>}
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {status === "done" && data && <SignalBadge signal={data.ai.signal} />}
          <button onClick={() => setShowChart(v => !v)}>{showChart ? "Ocultar" : "📊 Gráfico"}</button>
          <button onClick={analyze} disabled={status === "loading"}>{status === "loading" ? "…" : status === "idle" ? "Analizar" : "↻"}</button>
          <button onClick={onRemove} style={{ color: "#999", border: "none", background: "transparent" }}>✕</button>
        </div>
      </div>

      {showChart && <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #e0dfd8" }}><TradingViewWidget ticker={ticker} /></div>}

      {status === "loading" && (
        <div style={{ padding: "1rem 1.25rem" }}>
          <div style={{ fontSize: 13, color: "#666" }}>🔍 Buscando precio y noticias reales…</div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>Puede tardar 10-20 segundos</div>
        </div>
      )}

      {status === "error" && <div style={{ padding: "0.75rem 1.25rem", fontSize: 13, color: "#a32d2d" }}>{error}</div>}

      {status === "done" && data && (
        <div style={{ padding: "0.75rem 1.25rem", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["analysis", "news"].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                fontSize: 12, padding: "4px 12px",
                background: tab === t ? "#1a1a1a" : "#f5f5f0",
                color: tab === t ? "#fff" : "#666",
                fontWeight: tab === t ? 600 : 400, border: "none"
              }}>
                {t === "analysis" ? "📊 Análisis" : `📰 Noticias (${data.ai.news?.length || 0})`}
              </button>
            ))}
          </div>

          {tab === "analysis" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#666", flexWrap: "wrap" }}>
                <span>Confianza <b style={{ color: "#1a1a1a" }}>{data.ai.confidence}</b></span>
                <span>Noticias <b style={{ color: SENT_COLOR[data.ai.newsSentiment] }}>{data.ai.newsSentiment}</b></span>
                {data.ai.priceTarget && <span>Target <b style={{ color: "#1a1a1a" }}>{data.ai.priceTarget}</b></span>}
              </div>
              <div><div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", marginBottom: 3 }}>Precio y momentum</div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>{data.ai.technicalSummary}</div></div>
              <div><div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", marginBottom: 3 }}>Noticias</div>
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>{data.ai.newsSummary}</div></div>
              <div style={{ background: "#f5f5f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, lineHeight: 1.6 }}>
                <b>Conclusión:</b> {data.ai.reasoning}</div>
              <div style={{ fontSize: 12, color: "#666", background: "#f5f5f0", borderRadius: 6, padding: "6px 10px" }}>⚠ Riesgo: {data.ai.keyRisks}</div>
              <div style={{ fontSize: 11, color: "#bbb" }}>No es asesoramiento financiero. Solo con fines informativos.</div>
            </div>
          )}

          {tab === "news" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(!data.ai.news || data.ai.news.length === 0)
                ? <div style={{ fontSize: 13, color: "#666" }}>No hay noticias disponibles.</div>
                : data.ai.news.map((n, i) => (
                  <div key={i} style={{ background: "#f5f5f0", borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5 }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: "#999", marginTop: 3 }}>{n.publisher} · {n.time}</div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(0); // minutes, 0 = off

  const add = () => {
    const t = input.trim().toUpperCase().replace(/[^A-Z.]/g, "");
    if (!t) return;
    if (watchlist.includes(t)) { setErr(`${t} ya está en tu watchlist`); return; }
    setWatchlist(w => [...w, t]);
    setInput(""); setErr("");
  };

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>📈 AI Stock Signal Tracker</h1>
        <p style={{ fontSize: 13, color: "#888", margin: "4px 0 0" }}>Precios reales · TradingView · Señal BUY/SELL/HOLD con IA</p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <input value={input} onChange={e => { setInput(e.target.value.toUpperCase()); setErr(""); }}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder="Añadir ticker, ej. ALAB" style={{ width: 200 }} />
        <button onClick={add} style={{ padding: "6px 16px" }}>+ Añadir</button>
        <select value={autoRefresh} onChange={e => setAutoRefresh(Number(e.target.value))}
          style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #d0cfc8", borderRadius: 6, background: "#fff" }}>
          <option value={0}>Sin auto-refresh</option>
          <option value={5}>Cada 5 min</option>
          <option value={15}>Cada 15 min</option>
          <option value={30}>Cada 30 min</option>
        </select>
        {err && <span style={{ fontSize: 12, color: "#a32d2d" }}>{err}</span>}
      </div>

      {watchlist.length === 0 && <div style={{ color: "#888", fontSize: 14 }}>Tu watchlist está vacía.</div>}

      {watchlist.map(t => (
        <StockCard key={t} ticker={t}
          onRemove={() => setWatchlist(w => w.filter(x => x !== t))}
          autoRefreshInterval={autoRefresh} />
      ))}
    </div>
  );
}