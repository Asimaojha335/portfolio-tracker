import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AppShell, AuthProvider, AuthScreen, Badge, Donut, Empty, ErrorNote, Field, Loading, Modal, Stat, ToastProvider,
  api, compact, dateFmt, money, useApi, useAsync, useAuth, useHashRoute, useToast,
} from "./kit.jsx";

const pct = (x, d = 1) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(d)}%`);
const signed = (n) => `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`;
const tone = (n) => (n > 0 ? "var(--ok)" : n < 0 ? "var(--danger)" : "inherit");
const TYPE_LABEL = { stock: "Stocks", etf: "ETFs", mf: "Mutual funds", gold: "Gold", bond: "Bonds", crypto: "Crypto" };

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  if (!user) {
    return (
      <AuthScreen
        title="WealthLens"
        tagline="See what you own, how it is doing, and what to do next."
        points={["Holdings, profit and loss and dividends", "XIRR, volatility, drawdown and Sharpe ratio", "Concentration warnings and rebalancing", "Price alerts and goal projections"]}
      />
    );
  }
  return (
    <PortfolioProvider>
      <Router />
    </PortfolioProvider>
  );
}

/* ---------- selected portfolio ---------- */
const PortfolioCtx = createContext(null);
const usePortfolio = () => useContext(PortfolioCtx);

function PortfolioProvider({ children }) {
  const list = useApi("/portfolios");
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem("portfolio") || ""; } catch { return ""; }
  });
  const current = list.data && (list.data.find((p) => p.id === selected) || list.data[0]);
  useEffect(() => {
    if (current && current.id !== selected) setSelected(current.id);
    try { if (current) localStorage.setItem("portfolio", current.id); } catch { /* storage unavailable */ }
  }, [current, selected]);
  const value = useMemo(() => ({ list, current, select: setSelected }), [list, current]);
  return <PortfolioCtx.Provider value={value}>{children}</PortfolioCtx.Provider>;
}

const NAV = [
  { to: "/", label: "Portfolio" }, { to: "/transactions", label: "Transactions" }, { to: "/analysis", label: "Analysis" },
  { to: "/market", label: "Market" }, { to: "/watchlist", label: "Watchlist" }, { to: "/goals", label: "Goals" },
];

function Router() {
  const { path, go } = useHashRoute("/");
  return (
    <AppShell brand="WealthLens" mark="W" nav={NAV} path={path} go={go}>
      <p className="muted small" style={{ marginTop: 0 }}>Prices are simulated for this demo and are not real market data.</p>
      {path === "/" && <NeedsPortfolio><Overview go={go} /></NeedsPortfolio>}
      {path === "/transactions" && <NeedsPortfolio><Transactions /></NeedsPortfolio>}
      {path === "/analysis" && <NeedsPortfolio><Analysis /></NeedsPortfolio>}
      {path === "/market" && <Market />}
      {path === "/watchlist" && <Watchlist />}
      {path === "/goals" && <Goals />}
    </AppShell>
  );
}

function NeedsPortfolio({ children }) {
  const { list, current } = usePortfolio();
  const [name, setName] = useState("");
  const { busy, run } = useAsync();
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;
  if (!current) {
    return (
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="page-head"><div><h1>Start tracking</h1><p>Create a portfolio and add your buys, or explore with sample data.</p></div></div>
        <div className="card row between wrap"><div><b>Load sample portfolio</b><p className="muted small" style={{ margin: 0 }}>18 transactions over the last year, a watchlist, alerts and a goal.</p></div>
          <button className="btn" disabled={busy} onClick={async () => { await run(() => api("/demo/seed", { method: "POST" }), "Sample data loaded"); list.reload(); }}>Load sample</button></div>
        <form className="card row" onSubmit={async (e) => { e.preventDefault(); await run(() => api("/portfolios", { method: "POST", body: { name } }), "Portfolio created"); setName(""); list.reload(); }}>
          <input className="input" placeholder="Portfolio name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" disabled={busy}>Create</button>
        </form>
      </div>
    );
  }
  return children;
}

function PortfolioPicker() {
  const { list, current, select } = usePortfolio();
  const { run } = useAsync();
  return (
    <div className="row wrap">
      <select className="input" style={{ width: "auto" }} value={current.id} onChange={(e) => select(e.target.value)} aria-label="Portfolio">{list.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button className="btn ghost sm" onClick={async () => { const n = window.prompt("New portfolio name"); if (n) { const p = await run(() => api("/portfolios", { method: "POST", body: { name: n } }), "Portfolio created"); if (p) { await list.reload(true); select(p.id); } } }}>+ New</button>
      <button className="btn ghost sm" onClick={async () => { if (window.confirm(`Delete "${current.name}" and all its transactions?`)) { await run(() => api(`/portfolios/${current.id}`, { method: "DELETE" }), "Deleted"); list.reload(); } }}>Delete</button>
    </div>
  );
}

/* ---------- charts ---------- */
function LineChart({ points, height = 220, color = "var(--accent)", format = compact }) {
  const [hover, setHover] = useState(null);
  if (!points || points.length < 2) return <p className="muted">Not enough history yet.</p>;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 600;
  const H = 200;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => 10 + (1 - (v - min) / span) * (H - 24);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  const stroke = color === "auto" ? (up ? "var(--ok)" : "var(--danger)") : color;
  const idx = hover === null ? points.length - 1 : hover;
  return (
    <div style={{ position: "relative" }}>
      <div className="row between small muted"><span>{points[idx].date}</span><b style={{ color: "var(--text)" }}>{money(points[idx].value)}</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} preserveAspectRatio="none" role="img" aria-label="Value over time"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1))))); }} onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity="0.28" /><stop offset="100%" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="row between small muted"><span>Low {format(min)}</span><span>High {format(max)}</span></div>
    </div>
  );
}

/* ---------- Overview ---------- */
function useSummary() {
  const { current } = usePortfolio();
  return useApi(`/portfolios/${current.id}/summary`, { poll: 20000 });
}

function Overview({ go }) {
  const { data, loading, error, reload } = useSummary();
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const t = data.totals;
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{data.name}</h1><p>Updated {new Date(data.asOf).toLocaleTimeString("en-IN")} · prices refresh every 20 seconds</p></div><PortfolioPicker /></div>
      {data.holdings.length === 0 && <Empty title="No holdings yet"><button className="btn" onClick={() => go("/transactions")}>Add your first transaction</button></Empty>}
      {data.holdings.length > 0 && (
        <>
          <div className="grid cols-4">
            <div className="card stat"><span>Value</span><b>{money(t.value)}</b><i style={{ color: tone(t.dayChange) }}>{signed(t.dayChange)} today</i></div>
            <div className="card stat"><span>Unrealized P&amp;L</span><b style={{ color: tone(t.unrealized) }}>{signed(t.unrealized)}</b><i>{pct(t.unrealizedPct)} on {money(t.invested)} invested</i></div>
            <div className="card stat"><span>Return (XIRR)</span><b style={{ color: tone(t.xirr) }}>{pct(t.xirr)}</b><i>per year, money-weighted</i></div>
            <div className="card stat"><span>Realized + dividends</span><b>{money(t.realized + t.dividends)}</b><i>{money(t.realized)} sales · {money(t.dividends)} dividends</i></div>
          </div>
          <div className="card"><h3>Value over the last year</h3><LineChart points={data.history} color="auto" /></div>
          <div className="grid cols-2">
            <div className="card"><h3>By asset type</h3><Donut data={data.allocation.type.map((a) => ({ label: TYPE_LABEL[a.label] || a.label, value: a.value }))} center={compact(t.value)} /></div>
            <div className="card"><h3>By sector</h3><Donut data={data.allocation.sector.map((a) => ({ label: a.label, value: a.value }))} /></div>
          </div>
          {data.insights.length > 0 && <div className="card stack-sm"><h3>Insights</h3>{data.insights.map((i) => <div key={i} className="small">• {i}</div>)}</div>}
          <div className="table-wrap"><table className="table"><thead><tr><th>Holding</th><th className="num">Qty</th><th className="num">Avg cost</th><th className="num">Price</th><th className="num">Value</th><th className="num">P&amp;L</th><th className="num">Today</th><th className="num">Weight</th></tr></thead>
            <tbody>{data.holdings.map((h) => (
              <tr key={h.symbol}><td><b>{h.symbol}</b><div className="muted small">{h.name}</div></td><td className="num">{h.qty}</td><td className="num">{money(h.avgCost)}</td><td className="num">{money(h.price)}</td><td className="num">{money(h.value)}</td>
                <td className="num" style={{ color: tone(h.pnl) }}>{signed(h.pnl)}<div className="small">{pct(h.pnlPct)}</div></td><td className="num" style={{ color: tone(h.dayChange) }}>{signed(h.dayChange)}</td><td className="num">{pct(h.weight)}</td></tr>))}</tbody></table></div>
        </>
      )}
    </div>
  );
}

/* ---------- Transactions ---------- */
function Transactions() {
  const { current, list } = usePortfolio();
  const tx = useApi(`/portfolios/${current.id}/transactions`);
  const [adding, setAdding] = useState(false);
  const { run } = useAsync();
  if (tx.loading) return <Loading />;
  if (tx.error) return <ErrorNote message={tx.error} onRetry={tx.reload} />;
  const del = async (t) => { if (window.confirm("Delete this transaction?")) { await run(() => api(`/portfolios/${current.id}/transactions/${t.id}`, { method: "DELETE" }), "Deleted"); tx.reload(true); list.reload(true); } };
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Transactions</h1><p>{tx.data.length} in {current.name}</p></div><div className="row"><PortfolioPicker /><button className="btn" onClick={() => setAdding(true)}>+ Add</button></div></div>
      {tx.data.length === 0 ? <Empty title="No transactions">Add a buy to start.</Empty> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Type</th><th>Instrument</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Fee</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{tx.data.map((t) => (
            <tr key={t.id}><td>{dateFmt(t.date)}</td><td><Badge kind={t.type === "buy" ? "accent" : t.type === "sell" ? "warn" : "ok"}>{t.type}</Badge></td><td><b>{t.symbol}</b></td><td className="num">{t.qty}</td><td className="num">{money(t.price)}</td><td className="num">{t.fee ? money(t.fee) : "-"}</td><td className="num">{money(t.qty * t.price)}</td><td className="num"><button className="btn ghost sm" onClick={() => del(t)}>Delete</button></td></tr>))}</tbody></table></div>
      )}
      {adding && <TxForm portfolioId={current.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); tx.reload(true); list.reload(true); }} />}
    </div>
  );
}

function TxForm({ portfolioId, symbol, onClose, onSaved }) {
  const market = useApi("/market");
  const [f, setF] = useState({ symbol: symbol || "TCS", type: "buy", qty: "", price: "", fee: "", date: new Date().toISOString().slice(0, 10) });
  const { busy, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const q = market.data && market.data.instruments.find((i) => i.symbol === f.symbol);
  const save = async (e) => { e.preventDefault(); if (await run(() => api(`/portfolios/${portfolioId}/transactions`, { method: "POST", body: f }), "Transaction added")) onSaved(); };
  return (
    <Modal title="Add transaction" onClose={onClose}>
      <form className="stack-sm" onSubmit={save}>
        <div className="grid cols-2">
          <Field label="Instrument"><select className="input" value={f.symbol} onChange={set("symbol")}>{(market.data ? market.data.instruments : []).map((i) => <option key={i.symbol} value={i.symbol}>{i.symbol} · {i.name}</option>)}</select></Field>
          <Field label="Type"><select className="input" value={f.type} onChange={set("type")}><option value="buy">Buy</option><option value="sell">Sell</option><option value="dividend">Dividend</option></select></Field>
        </div>
        <div className="grid cols-2">
          <Field label={f.type === "dividend" ? "Units held" : "Quantity"}><input className="input" type="number" min="0" step="any" value={f.qty} onChange={set("qty")} /></Field>
          <Field label={f.type === "dividend" ? "Dividend per unit" : "Price per unit"}><input className="input" type="number" min="0" step="any" value={f.price} onChange={set("price")} placeholder={q ? `Market: ${q.price}` : ""} /></Field>
        </div>
        <div className="grid cols-2"><Field label="Fees"><input className="input" type="number" min="0" step="any" value={f.fee} onChange={set("fee")} /></Field><Field label="Date"><input className="input" type="date" value={f.date} onChange={set("date")} max={new Date().toISOString().slice(0, 10)} /></Field></div>
        <p className="muted small" style={{ margin: 0 }}>Leave the price empty to use the simulated market price on that date.</p>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={busy}>Add</button></div>
      </form>
    </Modal>
  );
}

/* ---------- Analysis ---------- */
function Analysis() {
  const { current } = usePortfolio();
  const { data, loading, error, reload } = useSummary();
  const { busy, run } = useAsync();
  const [targets, setTargets] = useState(null);
  useEffect(() => { if (data) setTargets(data.targets || {}); }, [data && data.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading || !targets) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const r = data.risk;
  const total = Object.values(targets).reduce((s, v) => s + Number(v || 0), 0);
  const save = async () => { await run(() => api(`/portfolios/${current.id}/targets`, { method: "PUT", body: { targets } }), "Targets saved"); reload(true); };
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Analysis</h1><p>Risk, diversification and how to get back to your plan.</p></div><PortfolioPicker /></div>
      {data.holdings.length === 0 ? <Empty title="Nothing to analyse yet">Add some transactions first.</Empty> : (
        <>
          <div className="grid cols-4">
            <Stat label="Volatility" value={pct(r.volatility)} hint="annualised" />
            <Stat label="Max drawdown" value={pct(r.maxDrawdown)} hint="worst fall from a peak" />
            <Stat label="Sharpe ratio" value={r.sharpe === null ? "-" : r.sharpe} hint="return per unit of risk, 6% risk-free" />
            <Stat label="Diversification" value={`${r.concentration.score}/100`} hint={`${r.concentration.effective} effective holdings`} />
          </div>
          <div className="grid cols-2">
            <div className="card stack-sm"><h3>Concentration</h3>
              {r.concentration.top && <p style={{ margin: 0 }}>Largest position: <b>{r.concentration.top.symbol}</b> at {pct(r.concentration.top.weight)}.</p>}
              {r.concentration.warnings.length === 0 ? <Badge kind="ok">No concentration warnings</Badge> : r.concentration.warnings.map((w) => <div key={w} className="badge warn" style={{ whiteSpace: "normal" }}>{w}</div>)}
              <p className="muted small" style={{ margin: 0 }}>Time-weighted return over the period: <b>{pct(r.twr)}</b> (ignores when you added or withdrew money).</p></div>
            <div className="card stack-sm"><h3>Target allocation</h3>
              <div className="grid cols-2">{Object.keys(TYPE_LABEL).map((k) => <Field key={k} label={`${TYPE_LABEL[k]} %`}><input className="input" type="number" min="0" max="100" value={targets[k] || ""} onChange={(e) => setTargets({ ...targets, [k]: e.target.value })} /></Field>)}</div>
              <div className="row between"><span className="small" style={{ color: Math.abs(total - 100) <= 0.5 || total === 0 ? "var(--muted)" : "var(--danger)" }}>Total {total}%</span><button className="btn" disabled={busy} onClick={save}>Save targets</button></div></div>
          </div>
          {data.rebalance && (
            <div className="card stack-sm"><h3>Rebalancing plan</h3>
              <div className="table-wrap"><table className="table"><thead><tr><th>Asset type</th><th className="num">Now</th><th className="num">Target</th><th>Action</th><th className="num">Amount</th></tr></thead>
                <tbody>{data.rebalance.map((x) => <tr key={x.type}><td>{TYPE_LABEL[x.type] || x.type}</td><td className="num">{pct(x.currentWeight)}</td><td className="num">{pct(x.targetWeight)}</td><td><Badge kind={x.action === "buy" ? "ok" : x.action === "sell" ? "warn" : ""}>{x.action}</Badge></td><td className="num">{x.action === "hold" ? "-" : money(x.amount)}</td></tr>)}</tbody></table></div>
              <p className="muted small" style={{ margin: 0 }}>Suggestions only. Selling may trigger taxes and fees that are not included here.</p></div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Market ---------- */
function Spark({ values }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${20 - ((v - min) / span) * 18}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return <svg viewBox="0 0 100 22" width="90" height="26" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={up ? "var(--ok)" : "var(--danger)"} strokeWidth="1.8" vectorEffect="non-scaling-stroke" /></svg>;
}

function Market() {
  const { data, loading, error, reload } = useApi("/market", { poll: 30000 });
  const [type, setType] = useState("");
  const [open, setOpen] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const rows = data.instruments.filter((i) => !type || i.type === type);
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Market</h1><p>Simulated instruments. Click one for its chart.</p></div>
        <select className="input" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Instrument</th><th>Type</th><th className="num">Price</th><th className="num">Change</th><th>30 days</th></tr></thead>
        <tbody>{rows.map((i) => (
          <tr key={i.symbol} style={{ cursor: "pointer" }} onClick={() => setOpen(i)}><td><b>{i.symbol}</b><div className="muted small">{i.name}</div></td><td><Badge>{TYPE_LABEL[i.type]}</Badge></td><td className="num">{money(i.price)}</td><td className="num" style={{ color: tone(i.change) }}>{pct(i.changePct, 2)}</td><td><Spark values={i.spark} /></td></tr>))}</tbody></table></div>
      {open && <InstrumentModal inst={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function InstrumentModal({ inst, onClose }) {
  const [days, setDays] = useState(180);
  const hist = useApi(`/market/${inst.symbol}?days=${days}`);
  const wl = useApi("/watchlist");
  const { current } = usePortfolio();
  const toast = useToast();
  const [alertForm, setAlertForm] = useState(null);
  const [buying, setBuying] = useState(false);
  const watching = wl.data && wl.data.some((w) => w.symbol === inst.symbol);
  return (
    <Modal title={`${inst.symbol} · ${inst.name}`} onClose={onClose} wide>
      <div className="stack-sm">
        <div className="row between wrap"><div><b style={{ fontSize: "1.5rem" }}>{money(inst.price)}</b> <span style={{ color: tone(inst.change) }}>{pct(inst.changePct, 2)} today</span></div>
          <div className="tabs" style={{ margin: 0 }}>{[30, 90, 180, 365].map((d) => <button key={d} className={days === d ? "active" : ""} onClick={() => setDays(d)}>{d}D</button>)}</div></div>
        {hist.data ? <LineChart points={hist.data.history.map((p) => ({ date: p.date, value: p.price }))} color="auto" /> : <Loading />}
        <div className="row wrap">
          <button className="btn ghost" onClick={async () => { const r = await api(`/watchlist/${inst.symbol}`, { method: "PUT" }); toast(r.watching ? "Added to watchlist" : "Removed from watchlist"); wl.reload(true); }}>{watching ? "★ Watching" : "☆ Watch"}</button>
          <button className="btn ghost" onClick={() => setAlertForm({ direction: "above", price: Math.round(inst.price * 1.05) })}>Set price alert</button>
          {current && <button className="btn" onClick={() => setBuying(true)}>Add to portfolio</button>}
        </div>
        {alertForm && (
          <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); try { await api("/alerts", { method: "POST", body: { symbol: inst.symbol, ...alertForm } }); toast("Alert created"); setAlertForm(null); } catch (err) { toast(err.message, "error"); } }}>
            <select className="input" style={{ width: "auto" }} value={alertForm.direction} onChange={(e) => setAlertForm({ ...alertForm, direction: e.target.value })}><option value="above">Rises above</option><option value="below">Falls below</option></select>
            <input className="input" style={{ width: 140 }} type="number" step="any" value={alertForm.price} onChange={(e) => setAlertForm({ ...alertForm, price: e.target.value })} /><button className="btn">Create alert</button>
          </form>
        )}
      </div>
      {buying && <TxForm portfolioId={current.id} symbol={inst.symbol} onClose={() => setBuying(false)} onSaved={() => { setBuying(false); toast("Added to your portfolio"); }} />}
    </Modal>
  );
}

/* ---------- Watchlist and alerts ---------- */
function Watchlist() {
  const wl = useApi("/watchlist", { poll: 30000 });
  const alerts = useApi("/alerts", { poll: 30000 });
  const { run } = useAsync();
  const [adding, setAdding] = useState("");
  const market = useApi("/market");
  if (wl.loading || alerts.loading) return <Loading />;
  const add = async (e) => { e.preventDefault(); if (!adding) return; const r = await run(() => api(`/watchlist/${adding}`, { method: "PUT" })); if (r && !r.watching) await api(`/watchlist/${adding}`, { method: "PUT" }); setAdding(""); wl.reload(true); };
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Watchlist</h1><p>Instruments you are keeping an eye on, and your price alerts.</p></div></div>
      <form className="row" onSubmit={add}><select className="input" style={{ maxWidth: 320 }} value={adding} onChange={(e) => setAdding(e.target.value)}><option value="">Add an instrument...</option>{(market.data ? market.data.instruments : []).filter((i) => !(wl.data || []).some((w) => w.symbol === i.symbol)).map((i) => <option key={i.symbol} value={i.symbol}>{i.symbol} · {i.name}</option>)}</select><button className="btn" disabled={!adding}>Watch</button></form>
      {wl.data && wl.data.length === 0 && <Empty title="Nothing on your watchlist">Add instruments above, or from the Market page.</Empty>}
      <div className="auto-grid">{(wl.data || []).map((w) => (
        <div key={w.symbol} className="card stack-sm"><div className="row between"><div><b>{w.symbol}</b><div className="muted small">{w.name}</div></div><button className="icon-btn" aria-label={`Stop watching ${w.symbol}`} onClick={async () => { await api(`/watchlist/${w.symbol}`, { method: "PUT" }); wl.reload(true); }}>×</button></div>
          <div className="row between"><b style={{ fontSize: "1.25rem" }}>{money(w.price)}</b><span style={{ color: tone(w.change) }}>{pct(w.changePct, 2)}</span></div><Spark values={w.spark} /></div>
      ))}</div>
      <h2 style={{ marginBottom: 0 }}>Price alerts</h2>
      {alerts.data && alerts.data.length === 0 && <p className="muted">No alerts yet. Open an instrument on the Market page to create one.</p>}
      {alerts.data && alerts.data.length > 0 && (
        <div className="table-wrap"><table className="table"><thead><tr><th>Instrument</th><th>Condition</th><th className="num">Now</th><th>Status</th><th /></tr></thead>
          <tbody>{alerts.data.map((a) => <tr key={a.id}><td><b>{a.symbol}</b></td><td>{a.direction === "above" ? "Rises above" : "Falls below"} {money(a.price)}</td><td className="num">{money(a.currentPrice)}</td><td><Badge kind={a.status === "triggered" ? "warn" : "accent"}>{a.status}</Badge>{a.triggeredAt && <span className="muted small"> {dateFmt(a.triggeredAt)}</span>}</td><td className="num"><button className="btn ghost sm" onClick={async () => { await api(`/alerts/${a.id}`, { method: "DELETE" }); alerts.reload(true); }}>Delete</button></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

/* ---------- Goals ---------- */
function Goals() {
  const { data, loading, error, reload } = useApi("/goals");
  const { list } = usePortfolio();
  const [adding, setAdding] = useState(false);
  const { run } = useAsync();
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Goals</h1><p>See the chance of reaching a target from 800 simulated futures.</p></div><button className="btn" onClick={() => setAdding(true)}>+ New goal</button></div>
      {data.length === 0 && <Empty title="No goals yet">Set one like "House down payment" to see how you are tracking.</Empty>}
      <div className="auto-grid">{data.map((g) => {
        const p = g.projection;
        return (
          <div key={g.id} className="card stack-sm">
            <div className="row between"><h3 style={{ margin: 0 }}>{g.name}</h3><button className="icon-btn" aria-label="Delete goal" onClick={async () => { await run(() => api(`/goals/${g.id}`, { method: "DELETE" }), "Deleted"); reload(true); }}>×</button></div>
            <div className="muted small">Target {money(g.target)} by {dateFmt(g.targetDate)} · {g.months} months</div>
            <div className="row between"><span>Chance of reaching it</span><Badge kind={p.probability >= 0.75 ? "ok" : p.probability >= 0.4 ? "warn" : "danger"}>{Math.round(p.probability * 100)}%</Badge></div>
            <div className="progress"><i style={{ width: `${Math.min(100, (g.current / g.target) * 100)}%` }} /></div>
            <div className="small muted">Saved so far {money(g.current)}{g.portfolioId ? " (from your portfolio)" : ""} · adding {money(g.monthly)} a month</div>
            <div className="small">Likely range: <b>{money(p.p10)}</b> to <b>{money(p.p90)}</b> (typical {money(p.p50)})</div>
            {p.probability < 0.75 && <div className="badge warn" style={{ whiteSpace: "normal" }}>To be on track, aim for about {money(p.monthlyNeeded)} a month.</div>}
          </div>
        );
      })}</div>
      {adding && <GoalForm portfolios={list.data || []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(true); }} />}
    </div>
  );
}

function GoalForm({ portfolios, onClose, onSaved }) {
  const [f, setF] = useState({ name: "", target: "", targetDate: "", monthly: "", current: "", portfolioId: "", expectedReturn: 0.1, volatility: 0.15 });
  const { busy, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); if (await run(() => api("/goals", { method: "POST", body: f }), "Goal created")) onSaved(); };
  return (
    <Modal title="New goal" onClose={onClose}>
      <form className="stack-sm" onSubmit={save}>
        <Field label="Name"><input className="input" value={f.name} onChange={set("name")} /></Field>
        <div className="grid cols-2"><Field label="Target amount"><input className="input" type="number" min="1000" value={f.target} onChange={set("target")} /></Field><Field label="Target date"><input className="input" type="date" value={f.targetDate} onChange={set("targetDate")} /></Field></div>
        <div className="grid cols-2"><Field label="Monthly contribution"><input className="input" type="number" min="0" value={f.monthly} onChange={set("monthly")} /></Field>
          <Field label="Starting from"><select className="input" value={f.portfolioId} onChange={set("portfolioId")}><option value="">A fixed amount</option>{portfolios.map((p) => <option key={p.id} value={p.id}>Portfolio: {p.name}</option>)}</select></Field></div>
        {!f.portfolioId && <Field label="Starting amount"><input className="input" type="number" min="0" value={f.current} onChange={set("current")} /></Field>}
        <div className="grid cols-2"><Field label="Expected yearly return"><input className="input" type="number" step="0.01" value={f.expectedReturn} onChange={set("expectedReturn")} /></Field><Field label="Yearly volatility"><input className="input" type="number" step="0.01" value={f.volatility} onChange={set("volatility")} /></Field></div>
        <p className="muted small" style={{ margin: 0 }}>Returns are shown as decimals: 0.10 is 10% a year.</p>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={busy}>Create goal</button></div>
      </form>
    </Modal>
  );
}
