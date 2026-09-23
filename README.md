# WealthLens: smart portfolio tracker and analyzer

Track investments across stocks, ETFs, mutual funds, gold, bonds and crypto, and get the analysis a serious investor looks at: money-weighted returns, risk, diversification, a rebalancing plan and the chance of reaching a goal.

**Stack:** React 19 + Vite, Node.js serverless functions on Vercel, MongoDB Atlas, JWT sessions in HttpOnly cookies, bcrypt. Charts are hand-written SVG.

> **Prices are simulated.** There is no live market feed. Each instrument has a base price and a volatility, and its price on any date is a deterministic function of that date, so history and returns are reproducible. Treat every number as a demonstration, not as market data or financial advice.

## Features
- **Portfolios and transactions**: buys, sells and dividends with fees. A transaction is rejected if it would ever leave you holding a negative quantity (this is checked in date order, so backdated sales and deletions are validated too)
- **Holdings** using the average-cost method: quantity, average cost, value, unrealized P&L, today's change and weight
- **XIRR**: the annualised money-weighted return, solved by bisection on the dated cash flows
- **Risk metrics** from daily *time-weighted* returns (so deposits are not mistaken for gains): annualised volatility, maximum drawdown, Sharpe ratio (6% risk-free) and time-weighted return
- **Diversification**: Herfindahl index, an effective number of holdings, a 0-100 score and plain-language warnings (for example one holding above 30%)
- **Allocation** by asset type and sector, plus a **rebalancing plan** toward target weights (buy, sell or hold, with amounts)
- **Watchlist and price alerts** (alerts are evaluated whenever they are read)
- **Goals with Monte Carlo projection**: 800 simulated futures give the probability of reaching a target, a likely range (10th to 90th percentile) and the monthly amount needed to be on track
- **Insights** generated from your data (best and worst holding, concentration, volatility, dividends)

## Correctness
The analytics live in `api/_lib/finance.js` as pure functions and are unit tested against hand-computed values: average-cost realized gains, XIRR of exactly 10% for 1000 in and 1100 out after a year, max drawdown of a known series, a check that deposits do not register as returns, rebalancing amounts, and a seeded Monte Carlo that is deterministic and behaves sensibly at the extremes.

## API
One serverless function (`api/index.js`, reached through a `vercel.json` rewrite) routes every request.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/logout`, `GET /auth/me` |
| Market | `GET /market`, `GET /market/:symbol?days=` |
| Portfolios | `GET/POST /portfolios`, `DELETE /portfolios/:id`, `PUT /portfolios/:id/targets`, `GET /portfolios/:id/summary` |
| Transactions | `GET/POST /portfolios/:id/transactions`, `DELETE /portfolios/:id/transactions/:tid` |
| Tracking | `GET /watchlist`, `PUT /watchlist/:symbol`, `GET/POST /alerts`, `DELETE /alerts/:id`, `GET/POST /goals`, `DELETE /goals/:id`, `POST /demo/seed` |

## Run it locally
```bash
npm install
npm run build
```
The API needs a `MONGODB_URI` environment variable and Vercel's function runtime, so run `vercel dev` (or deploy to Vercel and add `MONGODB_URI`). Data goes to the `portfolio_tracker` database.

This is a public demo database: please do not enter real financial details.
