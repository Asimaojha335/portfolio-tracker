// Simulated market. There is no live data feed: each instrument has a base price and a volatility, and its price at any moment
// is a smooth deterministic function of time. The same instrument gives the same price for the same date every time,
// so history, charts and returns are reproducible (and testable).

const CATALOGUE = [
  { symbol: "RELIANCE", name: "Reliance Industries", type: "stock", sector: "Energy", base: 2900 },
  { symbol: "TCS", name: "Tata Consultancy Services", type: "stock", sector: "IT", base: 3900 },
  { symbol: "INFY", name: "Infosys", type: "stock", sector: "IT", base: 1600 },
  { symbol: "HDFCBANK", name: "HDFC Bank", type: "stock", sector: "Banking", base: 1700 },
  { symbol: "ICICIBANK", name: "ICICI Bank", type: "stock", sector: "Banking", base: 1200 },
  { symbol: "ITC", name: "ITC Limited", type: "stock", sector: "FMCG", base: 450 },
  { symbol: "TATAMOTORS", name: "Tata Motors", type: "stock", sector: "Auto", base: 950 },
  { symbol: "SUNPHARMA", name: "Sun Pharma", type: "stock", sector: "Pharma", base: 1650 },
  { symbol: "LT", name: "Larsen & Toubro", type: "stock", sector: "Infrastructure", base: 3600 },
  { symbol: "NIFTYBEES", name: "Nifty 50 Index ETF", type: "etf", sector: "Index", base: 260 },
  { symbol: "BANKBEES", name: "Bank Index ETF", type: "etf", sector: "Index", base: 520 },
  { symbol: "GOLDBEES", name: "Gold ETF", type: "gold", sector: "Commodity", base: 62 },
  { symbol: "PPFLEXI", name: "Flexi Cap Mutual Fund", type: "mf", sector: "Diversified", base: 78 },
  { symbol: "SMALLCAP", name: "Small Cap Mutual Fund", type: "mf", sector: "Small cap", base: 145 },
  { symbol: "GSEC10Y", name: "Government Bond 10Y", type: "bond", sector: "Government", base: 101 },
  { symbol: "BTC", name: "Bitcoin", type: "crypto", sector: "Crypto", base: 5500000 },
  { symbol: "ETH", name: "Ethereum", type: "crypto", sector: "Crypto", base: 280000 },
];

const VOL = { stock: 0.28, etf: 0.15, mf: 0.16, gold: 0.13, bond: 0.05, crypto: 0.7 };
const DRIFT = { stock: 0.12, etf: 0.11, mf: 0.13, gold: 0.08, bond: 0.07, crypto: 0.25 };
const EPOCH = Date.UTC(2024, 0, 1);
const DAY = 86400000;

const bySymbol = new Map(CATALOGUE.map((c) => [c.symbol, c]));
const instrument = (symbol) => bySymbol.get(String(symbol).toUpperCase()) || null;

function hash(text) {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// price of an instrument at a timestamp (ms), rounded to 2 decimals
function priceAt(symbol, when) {
  const inst = instrument(symbol);
  if (!inst) return null;
  const t = (new Date(when).getTime() - EPOCH) / DAY;
  const v = VOL[inst.type];
  const s1 = hash(`${symbol}a`) * 6.28;
  const s2 = hash(`${symbol}b`) * 6.28;
  const s3 = hash(`${symbol}c`) * 6.28;
  const wave = v * (0.55 * Math.sin(t / 47 + s1) + 0.3 * Math.sin(t / 19 + s2) + 0.15 * Math.sin(t / 5.5 + s3));
  const trend = 1 + (DRIFT[inst.type] * t) / 365;
  // day-to-day noise, fixed for each calendar day so the same date always gives the same price
  const noise = (hash(`${symbol}:${Math.floor(t)}`) - 0.5) * 2 * v * 0.11;
  return Math.max(0.01, Math.round(inst.base * trend * (1 + wave * 0.6 + noise) * 100) / 100);
}

// Series of end-of-day prices for the last `days` days (oldest first).
function history(symbol, days, now = Date.now()) {
  const out = [];
  const end = new Date(now);
  end.setUTCHours(12, 0, 0, 0);
  for (let i = days; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * DAY);
    out.push({ date: d.toISOString().slice(0, 10), price: priceAt(symbol, d) });
  }
  return out;
}

module.exports = { CATALOGUE, instrument, priceAt, history, VOL, DRIFT, DAY };
