// Portfolio analytics as pure functions (no database, no clock unless passed in) so every number can be unit tested.
const DAY = 86400000;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/* Replays transactions (oldest first) using the average-cost method.
   Returns Map(symbol -> { qty, cost (total cost of what is held), realized, dividends, fees }). Throws if a sell exceeds the holding. */
function replay(transactions, upTo = null) {
  const list = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id || "").localeCompare(String(b.id || "")));
  const map = new Map();
  for (const t of list) {
    if (upTo && new Date(t.date) > new Date(upTo)) break;
    const h = map.get(t.symbol) || { qty: 0, cost: 0, realized: 0, dividends: 0, fees: 0 };
    if (t.type === "buy") {
      h.qty += t.qty;
      h.cost += t.qty * t.price + (t.fee || 0);
    } else if (t.type === "sell") {
      if (t.qty > h.qty + 1e-9) throw new Error(`Cannot sell ${t.qty} ${t.symbol}: only ${round(h.qty, 6)} held on ${dayKey(t.date)}.`);
      const avg = h.qty ? h.cost / h.qty : 0;
      h.realized += t.qty * (t.price - avg) - (t.fee || 0);
      h.cost -= avg * t.qty;
      h.qty -= t.qty;
      if (h.qty < 1e-9) { h.qty = 0; h.cost = 0; }
    } else if (t.type === "dividend") {
      h.dividends += t.qty * t.price;
    }
    h.fees += t.fee || 0;
    map.set(t.symbol, h);
  }
  return map;
}

// Money-weighted annualised return (XIRR). flows: [{ date, amount }], money in is negative, money out (and final value) positive.
function xirr(flows) {
  const f = flows.filter((x) => x.amount !== 0);
  if (f.length < 2 || !f.some((x) => x.amount > 0) || !f.some((x) => x.amount < 0)) return null;
  const t0 = new Date(f[0].date).getTime();
  const npv = (r) => f.reduce((s, x) => s + x.amount / (1 + r) ** ((new Date(x.date).getTime() - t0) / (365 * DAY)), 0);
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// Daily portfolio value and cash flow. priceFn(symbol, date) -> price. Returns [{ date, value, flow }] for the last `days` days.
function dailySeries(transactions, priceFn, days, now = new Date()) {
  const end = new Date(now);
  end.setUTCHours(12, 0, 0, 0);
  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const out = [];
  for (let i = days; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * DAY);
    const key = dayKey(d);
    const held = replay(sorted, `${key}T23:59:59Z`);
    let value = 0;
    held.forEach((h, symbol) => { if (h.qty > 0) value += h.qty * priceFn(symbol, d); });
    const flow = sorted.filter((t) => dayKey(t.date) === key).reduce((s, t) => s + (t.type === "buy" ? t.qty * t.price + (t.fee || 0) : t.type === "sell" ? -(t.qty * t.price - (t.fee || 0)) : 0), 0);
    out.push({ date: key, value: round(value), flow: round(flow) });
  }
  return out;
}

// Time-weighted daily returns strip out the effect of the money you put in or took out.
function riskMetrics(series, riskFree = 0.06) {
  const rets = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1].value;
    if (prev > 0) rets.push((series[i].value - series[i].flow) / prev - 1);
  }
  if (rets.length < 5) return { volatility: null, sharpe: null, maxDrawdown: null, twr: null, days: rets.length };
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1));
  const vol = sd * Math.sqrt(252);
  const twr = rets.reduce((p, r) => p * (1 + r), 1) - 1;
  // drawdown on the cumulative time-weighted index, so deposits are not mistaken for gains
  let idx = 1;
  let peak = 1;
  let maxDd = 0;
  rets.forEach((r) => { idx *= 1 + r; peak = Math.max(peak, idx); maxDd = Math.min(maxDd, idx / peak - 1); });
  const annual = mean * 252;
  return { volatility: round(vol, 4), sharpe: vol > 0 ? round((annual - riskFree) / vol, 2) : null, maxDrawdown: round(maxDd, 4), twr: round(twr, 4), days: rets.length };
}

function allocation(holdings, key) {
  const total = holdings.reduce((s, h) => s + h.value, 0) || 1;
  const m = new Map();
  holdings.forEach((h) => m.set(h[key], (m.get(h[key]) || 0) + h.value));
  return [...m.entries()].map(([label, value]) => ({ label, value: round(value), weight: round(value / total, 4) })).sort((a, b) => b.value - a.value);
}

// Herfindahl-Hirschman index of position weights: 1/N (perfectly spread) up to 1 (everything in one holding).
function concentration(holdings) {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (!total) return { hhi: 0, effective: 0, top: null, score: 0, warnings: [] };
  const w = holdings.map((h) => ({ symbol: h.symbol, weight: h.value / total })).sort((a, b) => b.weight - a.weight);
  const hhi = w.reduce((s, x) => s + x.weight ** 2, 0);
  const warnings = [];
  if (w[0].weight > 0.3) warnings.push(`${w[0].symbol} is ${Math.round(w[0].weight * 100)}% of your portfolio, which is a lot in one holding.`);
  if (holdings.length < 5) warnings.push("You hold fewer than 5 instruments; adding more reduces single-holding risk.");
  const sectors = allocation(holdings, "sector");
  if (sectors[0] && sectors[0].weight > 0.45 && sectors.length > 1) warnings.push(`${sectors[0].label} makes up ${Math.round(sectors[0].weight * 100)}% of your portfolio.`);
  // 100 = perfectly diversified across the positions held, 0 = a single position
  const n = w.length;
  const score = n <= 1 ? 0 : Math.round(((1 - hhi) / (1 - 1 / n)) * 100);
  return { hhi: round(hhi, 4), effective: round(1 / hhi, 2), top: { symbol: w[0].symbol, weight: round(w[0].weight, 4) }, score, warnings };
}

// targets: { type: percent } summing to about 100. Returns what to buy or sell (in money) per asset type to reach them.
function rebalance(holdings, targets, extraCash = 0) {
  const total = holdings.reduce((s, h) => s + h.value, 0) + extraCash;
  const pct = Object.values(targets).reduce((s, v) => s + v, 0);
  if (!total || Math.abs(pct - 100) > 0.5) return null;
  const current = new Map();
  holdings.forEach((h) => current.set(h.type, (current.get(h.type) || 0) + h.value));
  const types = new Set([...Object.keys(targets), ...current.keys()]);
  return [...types].map((type) => {
    const want = ((targets[type] || 0) / 100) * total;
    const have = current.get(type) || 0;
    const diff = want - have;
    return { type, current: round(have), target: round(want), currentWeight: round(have / total, 4), targetWeight: round((targets[type] || 0) / 100, 4), action: Math.abs(diff) < total * 0.005 ? "hold" : diff > 0 ? "buy" : "sell", amount: round(Math.abs(diff)) };
  }).sort((a, b) => b.amount - a.amount);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Monte Carlo projection of reaching a goal with monthly contributions. Deterministic for a given seed.
function projectGoal({ current, monthly, months, mu, sigma, target, paths = 800, seed = 7 }) {
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const mM = mu / 12;
  const sM = sigma / Math.sqrt(12);
  const finals = [];
  for (let p = 0; p < paths; p += 1) {
    let v = current;
    for (let m = 0; m < months; m += 1) v = Math.max(0, v * (1 + mM - (sM * sM) / 2 + sM * gauss()) + monthly);
    finals.push(v);
  }
  finals.sort((a, b) => a - b);
  const pick = (q) => finals[Math.min(finals.length - 1, Math.floor(q * finals.length))];
  const expected = current * (1 + mM) ** months + (mM ? monthly * (((1 + mM) ** months - 1) / mM) : monthly * months);
  // monthly amount needed to reach the target on the expected path
  const growth = current * (1 + mM) ** months;
  const factor = mM ? ((1 + mM) ** months - 1) / mM : months;
  const needed = months > 0 ? Math.max(0, (target - growth) / factor) : 0;
  return { probability: round(finals.filter((v) => v >= target).length / finals.length, 3), p10: round(pick(0.1)), p50: round(pick(0.5)), p90: round(pick(0.9)), expected: round(expected), monthlyNeeded: round(needed) };
}

module.exports = { round, replay, xirr, dailySeries, riskMetrics, allocation, concentration, rebalance, projectGoal, mulberry32, dayKey };
