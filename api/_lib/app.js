const { createApp, bad, notFound, oid, clean, str, num, oneOf, created } = require("./http");
const { addAuthRoutes } = require("./authRoutes");
const F = require("./finance");
const Mkt = require("./market");

const DAY = 86400000;
const TYPES = ["stock", "etf", "mf", "gold", "bond", "crypto"];

const app = createApp({
  app: "portfolio-tracker",
  dbName: "portfolio_tracker",
  setup: async (db) => {
    await db.collection("transactions").createIndex({ ownerId: 1, portfolioId: 1, date: 1 });
    await db.collection("watchlist").createIndex({ ownerId: 1, symbol: 1 }, { unique: true });
  },
});
addAuthRoutes(app);

const owned = (user, extra = {}) => ({ ownerId: user.id, ...extra });
async function getPortfolio(db, id, user) {
  const p = await db.collection("portfolios").findOne({ _id: oid(id), ownerId: user.id });
  if (!p) throw notFound("Portfolio not found.");
  return p;
}
const loadTxns = async (db, portfolioId) => (await db.collection("transactions").find({ portfolioId: String(portfolioId) }).toArray()).map((t) => ({ ...t, id: String(t._id) }));

/* ---------- market ---------- */
function quote(inst, now = Date.now()) {
  const price = Mkt.priceAt(inst.symbol, now);
  const prev = Mkt.priceAt(inst.symbol, now - DAY);
  return { symbol: inst.symbol, name: inst.name, type: inst.type, sector: inst.sector, price, change: Math.round((price - prev) * 100) / 100, changePct: Math.round(((price - prev) / prev) * 10000) / 10000 };
}

app.get("/market", { auth: true }, async ({ query }) => {
  const list = Mkt.CATALOGUE.filter((i) => !query.type || i.type === query.type).map((i) => ({ ...quote(i), spark: Mkt.history(i.symbol, 30).filter((_, k) => k % 3 === 0).map((p) => p.price) }));
  return { note: "Prices are simulated, not real market data.", instruments: list };
});

app.get("/market/:symbol", { auth: true }, async ({ params, query }) => {
  const inst = Mkt.instrument(params.symbol);
  if (!inst) throw notFound("Unknown instrument.");
  const days = num(query.days || 365, { min: 7, max: 1095, int: true, label: "Days" });
  return { ...quote(inst), history: Mkt.history(inst.symbol, days) };
});

/* ---------- portfolios ---------- */
app.get("/portfolios", { auth: true }, async ({ db, user }) => {
  const list = await db.collection("portfolios").find({ ownerId: user.id }).sort({ createdAt: 1 }).toArray();
  const out = [];
  for (const p of list) {
    const held = F.replay(await loadTxns(db, p._id));
    let value = 0;
    held.forEach((h, sym) => { if (h.qty > 0) value += h.qty * Mkt.priceAt(sym, Date.now()); });
    out.push({ ...clean(p), value: F.round(value) });
  }
  return out;
});

app.post("/portfolios", { auth: true }, async ({ db, user, body }) => {
  const doc = { ...owned(user), name: str(body.name, { min: 2, max: 50, label: "Name" }), targets: null, createdAt: new Date() };
  const { insertedId } = await db.collection("portfolios").insertOne(doc);
  return created(clean({ _id: insertedId, ...doc }));
});

app.delete("/portfolios/:id", { auth: true }, async ({ db, user, params }) => {
  const p = await getPortfolio(db, params.id, user);
  await db.collection("transactions").deleteMany({ portfolioId: String(p._id) });
  await db.collection("portfolios").deleteOne({ _id: p._id });
  return { ok: true };
});

app.put("/portfolios/:id/targets", { auth: true }, async ({ db, user, params, body }) => {
  const p = await getPortfolio(db, params.id, user);
  const targets = {};
  for (const [k, v] of Object.entries(body.targets || {})) {
    if (!TYPES.includes(k)) throw bad(`Unknown asset type "${k}".`);
    const n = num(v, { min: 0, max: 100, label: `${k} target` });
    if (n > 0) targets[k] = n;
  }
  const sum = Object.values(targets).reduce((s, v) => s + v, 0);
  if (body.targets && Object.keys(targets).length && Math.abs(sum - 100) > 0.5) throw bad(`Targets must add up to 100% (they add up to ${F.round(sum, 1)}%).`);
  await db.collection("portfolios").updateOne({ _id: p._id }, { $set: { targets: Object.keys(targets).length ? targets : null } });
  return { targets: Object.keys(targets).length ? targets : null };
});

/* ---------- transactions ---------- */
app.get("/portfolios/:id/transactions", { auth: true }, async ({ db, user, params }) => {
  const p = await getPortfolio(db, params.id, user);
  return (await loadTxns(db, p._id)).sort((a, b) => new Date(b.date) - new Date(a.date)).map(({ id, _id, ...t }) => ({ id, ...t }));
});

app.post("/portfolios/:id/transactions", { auth: true }, async ({ db, user, params, body }) => {
  const p = await getPortfolio(db, params.id, user);
  const inst = Mkt.instrument(body.symbol);
  if (!inst) throw bad("Pick an instrument from the list.");
  const type = oneOf(body.type, ["buy", "sell", "dividend"], "Type");
  const date = new Date(body.date || Date.now());
  if (Number.isNaN(date.getTime()) || date > new Date(Date.now() + DAY) || date.getFullYear() < 2015) throw bad("Enter a valid date that is not in the future.");
  const qty = num(body.qty, { min: 0.000001, max: 100000000, label: type === "dividend" ? "Shares held" : "Quantity" });
  const price = body.price === undefined || body.price === "" ? Mkt.priceAt(inst.symbol, date) : num(body.price, { min: 0, max: 1000000000, label: type === "dividend" ? "Dividend per unit" : "Price" });
  const fee = body.fee === undefined || body.fee === "" ? 0 : num(body.fee, { min: 0, max: 10000000, label: "Fee" });
  const doc = { ...owned(user), portfolioId: String(p._id), symbol: inst.symbol, type, qty: F.round(qty, 6), price: F.round(price, 4), fee: F.round(fee, 2), date, note: str(body.note, { max: 120 }), createdAt: new Date() };
  const all = await loadTxns(db, p._id);
  try {
    F.replay([...all, { ...doc, id: "new" }]);
  } catch (e) {
    throw bad(e.message);
  }
  const { insertedId } = await db.collection("transactions").insertOne(doc);
  return created(clean({ _id: insertedId, ...doc }));
});

app.delete("/portfolios/:id/transactions/:tid", { auth: true }, async ({ db, user, params }) => {
  const p = await getPortfolio(db, params.id, user);
  const all = await loadTxns(db, p._id);
  if (!all.some((t) => t.id === params.tid)) throw notFound("Transaction not found.");
  try {
    F.replay(all.filter((t) => t.id !== params.tid));
  } catch (e) {
    throw bad(`Removing this would leave a later sale without enough shares. ${e.message}`);
  }
  await db.collection("transactions").deleteOne({ _id: oid(params.tid) });
  return { ok: true };
});

/* ---------- the analysis ---------- */
function summarize(portfolio, txns, now = new Date()) {
  const held = F.replay(txns);
  const holdings = [];
  let realized = 0;
  let dividends = 0;
  let fees = 0;
  held.forEach((h, symbol) => {
    realized += h.realized;
    dividends += h.dividends;
    fees += h.fees;
    if (h.qty <= 0) return;
    const inst = Mkt.instrument(symbol);
    const price = Mkt.priceAt(symbol, now);
    const prev = Mkt.priceAt(symbol, now.getTime() - DAY);
    const value = h.qty * price;
    holdings.push({
      symbol, name: inst.name, type: inst.type, sector: inst.sector, qty: F.round(h.qty, 6), avgCost: F.round(h.cost / h.qty, 2), price, value: F.round(value), cost: F.round(h.cost),
      pnl: F.round(value - h.cost), pnlPct: F.round((value - h.cost) / h.cost, 4), dayChange: F.round(h.qty * (price - prev)),
    });
  });
  const value = holdings.reduce((s, h) => s + h.value, 0);
  holdings.forEach((h) => { h.weight = value ? F.round(h.value / value, 4) : 0; });
  holdings.sort((a, b) => b.value - a.value);
  const invested = holdings.reduce((s, h) => s + h.cost, 0);
  const flows = txns.map((t) => ({ date: t.date, amount: t.type === "buy" ? -(t.qty * t.price + t.fee) : t.type === "sell" ? t.qty * t.price - t.fee : t.qty * t.price })).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (flows.length) flows.push({ date: now, amount: value });
  const xirr = flows.length ? F.xirr(flows) : null;
  const series = txns.length ? F.dailySeries(txns, (s, d) => Mkt.priceAt(s, d), 365, now) : [];
  const first = series.findIndex((p) => p.value > 0);
  const live = first >= 0 ? series.slice(first) : [];
  const risk = F.riskMetrics(live);
  const conc = F.concentration(holdings);
  const byType = F.allocation(holdings, "type");
  const bySector = F.allocation(holdings, "sector");
  const insights = [];
  if (holdings.length) {
    const best = [...holdings].sort((a, b) => b.pnlPct - a.pnlPct)[0];
    const worst = [...holdings].sort((a, b) => a.pnlPct - b.pnlPct)[0];
    if (best.pnlPct > 0) insights.push(`Your best holding is ${best.symbol}, up ${F.round(best.pnlPct * 100, 1)}% on what you paid.`);
    if (worst.pnlPct < 0) insights.push(`${worst.symbol} is down ${F.round(-worst.pnlPct * 100, 1)}% from your average cost.`);
    conc.warnings.forEach((w) => insights.push(w));
    if (risk.volatility !== null && risk.volatility > 0.3) insights.push(`Your portfolio swings a lot (about ${F.round(risk.volatility * 100)}% a year). Bonds, gold or index funds can smooth it.`);
    if (risk.maxDrawdown !== null && risk.maxDrawdown < -0.15) insights.push(`Its worst fall from a peak was ${F.round(-risk.maxDrawdown * 100, 1)}% in the last year.`);
    if (dividends > 0) insights.push(`You have collected ${F.round(dividends)} in dividends.`);
    if (xirr !== null && xirr > 0.12) insights.push(`Your money-weighted return is ${F.round(xirr * 100, 1)}% a year, better than a typical 12% equity expectation.`);
  }
  const rb = portfolio.targets ? F.rebalance(holdings, portfolio.targets) : null;
  const step = Math.max(1, Math.floor(live.length / 90));
  return {
    id: String(portfolio._id), name: portfolio.name, asOf: now,
    totals: { value: F.round(value), invested: F.round(invested), unrealized: F.round(value - invested), unrealizedPct: invested ? F.round((value - invested) / invested, 4) : 0, realized: F.round(realized), dividends: F.round(dividends), fees: F.round(fees), dayChange: F.round(holdings.reduce((s, h) => s + h.dayChange, 0)), xirr: xirr === null ? null : F.round(xirr, 4) },
    holdings, allocation: { type: byType, sector: bySector }, risk: { ...risk, concentration: conc }, history: live.filter((_, i) => i % step === 0 || i === live.length - 1).map((p) => ({ date: p.date, value: p.value })), insights,
    targets: portfolio.targets, rebalance: rb,
  };
}

app.get("/portfolios/:id/summary", { auth: true }, async ({ db, user, params }) => {
  const p = await getPortfolio(db, params.id, user);
  return summarize(p, await loadTxns(db, p._id));
});

/* ---------- watchlist ---------- */
app.get("/watchlist", { auth: true }, async ({ db, user }) => {
  const items = await db.collection("watchlist").find({ ownerId: user.id }).sort({ createdAt: 1 }).toArray();
  return items.map((w) => ({ ...quote(Mkt.instrument(w.symbol)), spark: Mkt.history(w.symbol, 30).filter((_, k) => k % 3 === 0).map((p) => p.price) }));
});

app.put("/watchlist/:symbol", { auth: true }, async ({ db, user, params }) => {
  const inst = Mkt.instrument(params.symbol);
  if (!inst) throw notFound("Unknown instrument.");
  const existing = await db.collection("watchlist").findOne({ ownerId: user.id, symbol: inst.symbol });
  if (existing) {
    await db.collection("watchlist").deleteOne({ _id: existing._id });
    return { watching: false };
  }
  await db.collection("watchlist").insertOne({ ...owned(user), symbol: inst.symbol, createdAt: new Date() });
  return { watching: true };
});

/* ---------- alerts (evaluated whenever they are read) ---------- */
app.get("/alerts", { auth: true }, async ({ db, user }) => {
  const list = await db.collection("alerts").find({ ownerId: user.id }).sort({ createdAt: -1 }).toArray();
  const out = [];
  for (const a of list) {
    const price = Mkt.priceAt(a.symbol, Date.now());
    const crossed = a.direction === "above" ? price >= a.price : price <= a.price;
    if (a.status === "active" && crossed) {
      a.status = "triggered";
      a.triggeredAt = new Date();
      a.triggeredPrice = price;
      await db.collection("alerts").updateOne({ _id: a._id }, { $set: { status: "triggered", triggeredAt: a.triggeredAt, triggeredPrice: price } });
    }
    out.push({ ...clean(a), currentPrice: price });
  }
  return out;
});

app.post("/alerts", { auth: true }, async ({ db, user, body }) => {
  const inst = Mkt.instrument(body.symbol);
  if (!inst) throw bad("Pick an instrument from the list.");
  if ((await db.collection("alerts").countDocuments({ ownerId: user.id })) >= 30) throw bad("You can keep up to 30 alerts.");
  const doc = { ...owned(user), symbol: inst.symbol, direction: oneOf(body.direction, ["above", "below"], "Direction"), price: num(body.price, { min: 0.01, max: 1000000000, label: "Price" }), status: "active", createdAt: new Date() };
  const { insertedId } = await db.collection("alerts").insertOne(doc);
  return created(clean({ _id: insertedId, ...doc }));
});

app.delete("/alerts/:id", { auth: true }, async ({ db, user, params }) => {
  await db.collection("alerts").deleteOne({ _id: oid(params.id), ownerId: user.id });
  return { ok: true };
});

/* ---------- goals ---------- */
async function goalView(db, g) {
  let current = g.current || 0;
  if (g.portfolioId) {
    const p = await db.collection("portfolios").findOne({ _id: oid(g.portfolioId), ownerId: g.ownerId });
    if (p) {
      const held = F.replay(await loadTxns(db, p._id));
      current = 0;
      held.forEach((h, sym) => { if (h.qty > 0) current += h.qty * Mkt.priceAt(sym, Date.now()); });
    }
  }
  const months = Math.max(1, Math.round((new Date(g.targetDate) - Date.now()) / (30.44 * DAY)));
  const projection = F.projectGoal({ current, monthly: g.monthly, months, mu: g.expectedReturn, sigma: g.volatility, target: g.target });
  return { ...clean(g), current: F.round(current), months, projection };
}

app.get("/goals", { auth: true }, async ({ db, user }) => {
  const list = await db.collection("goals").find({ ownerId: user.id }).sort({ targetDate: 1 }).toArray();
  return Promise.all(list.map((g) => goalView(db, g)));
});

app.post("/goals", { auth: true }, async ({ db, user, body }) => {
  const targetDate = new Date(body.targetDate);
  if (Number.isNaN(targetDate.getTime()) || targetDate < new Date(Date.now() + 30 * DAY)) throw bad("Pick a target date at least a month away.");
  let portfolioId = null;
  if (body.portfolioId) portfolioId = String((await getPortfolio(db, body.portfolioId, user))._id);
  const doc = {
    ...owned(user), name: str(body.name, { min: 2, max: 60, label: "Goal name" }), target: num(body.target, { min: 1000, max: 1000000000, label: "Target" }), targetDate,
    monthly: num(body.monthly === undefined || body.monthly === "" ? 0 : body.monthly, { min: 0, max: 100000000, label: "Monthly contribution" }),
    current: num(body.current === undefined || body.current === "" ? 0 : body.current, { min: 0, max: 1000000000, label: "Starting amount" }), portfolioId,
    expectedReturn: num(body.expectedReturn === undefined || body.expectedReturn === "" ? 0.1 : body.expectedReturn, { min: -0.2, max: 0.5, label: "Expected return" }),
    volatility: num(body.volatility === undefined || body.volatility === "" ? 0.15 : body.volatility, { min: 0.01, max: 1, label: "Volatility" }), createdAt: new Date(),
  };
  const { insertedId } = await db.collection("goals").insertOne(doc);
  return created(await goalView(db, { _id: insertedId, ...doc }));
});

app.delete("/goals/:id", { auth: true }, async ({ db, user, params }) => {
  await db.collection("goals").deleteOne({ _id: oid(params.id), ownerId: user.id });
  return { ok: true };
});

/* ---------- sample data ---------- */
app.post("/demo/seed", { auth: true }, async ({ db, user }) => {
  if (await db.collection("portfolios").findOne({ ownerId: user.id })) throw bad("You already have a portfolio.");
  const now = Date.now();
  const at = (daysAgo) => new Date(now - daysAgo * DAY);
  const { insertedId } = await db.collection("portfolios").insertOne({ ...owned(user), name: "Long-term portfolio", targets: { stock: 50, etf: 20, gold: 10, bond: 10, mf: 10 }, createdAt: new Date() });
  const pid = String(insertedId);
  const rows = [
    ["RELIANCE", "buy", 30, 500], ["TCS", "buy", 12, 480], ["HDFCBANK", "buy", 40, 460], ["INFY", "buy", 35, 420], ["NIFTYBEES", "buy", 300, 440], ["GOLDBEES", "buy", 500, 400], ["PPFLEXI", "buy", 600, 380],
    ["ITC", "buy", 150, 300], ["GSEC10Y", "buy", 200, 250], ["TATAMOTORS", "buy", 60, 200], ["SUNPHARMA", "buy", 25, 150], ["BTC", "buy", 0.01, 120], ["INFY", "buy", 20, 90], ["NIFTYBEES", "buy", 150, 60],
    ["HDFCBANK", "sell", 10, 45], ["ITC", "dividend", 150, 40], ["RELIANCE", "dividend", 30, 25], ["ITC", "sell", 50, 20],
  ];
  await db.collection("transactions").insertMany(rows.map(([symbol, type, qty, ago]) => ({
    ...owned(user), portfolioId: pid, symbol, type, qty, price: type === "dividend" ? Math.round(Mkt.priceAt(symbol, at(ago)) * 0.02 * 100) / 100 : Mkt.priceAt(symbol, at(ago)), fee: type === "dividend" ? 0 : 20, date: at(ago), note: "", createdAt: new Date(),
  })));
  await db.collection("watchlist").insertMany(["LT", "ICICIBANK", "ETH", "BANKBEES"].map((symbol) => ({ ...owned(user), symbol, createdAt: new Date() })));
  const px = Mkt.priceAt("TCS", now);
  await db.collection("alerts").insertMany([
    { ...owned(user), symbol: "TCS", direction: "above", price: Math.round(px * 1.05), status: "active", createdAt: new Date() },
    { ...owned(user), symbol: "BTC", direction: "below", price: Math.round(Mkt.priceAt("BTC", now) * 0.9), status: "active", createdAt: new Date() },
  ]);
  await db.collection("goals").insertOne({ ...owned(user), name: "Down payment for a home", target: 5000000, targetDate: new Date(now + 6 * 365 * DAY), monthly: 25000, current: 0, portfolioId: pid, expectedReturn: 0.11, volatility: 0.16, createdAt: new Date() });
  return created({ id: pid });
});

module.exports = app;
module.exports.summarize = summarize;
