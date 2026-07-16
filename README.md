# MonScope

A Monad-only portfolio tracker. Paste any address and see its holdings priced
live from chain 143 — no signup, no wallet connection, read-only.

## What's live
- Native MON + ERC-20 balances read via viem + Multicall3 (one round trip)
- Pricing: CoinGecko anchors + GeckoTerminal DEX index for the long tail
- Unpriced / illiquid tokens are quarantined, never counted toward net worth
- Real allocation breakdown

## Architecture
- `api/portfolio.mjs` — serverless read + price (Vercel Node function)
- `lib/` — chain client, pricing, portfolio assembly (pricing lives in one place;
  adapters would return amounts only)
- `lib/tokens.mjs` — Monad token registry (generated from GeckoTerminal)
- `public/index.html` — the UI

## Roadmap
DeFi position adapters (Aave, Euler, Morpho, Pendle, Uniswap V4, LSTs and the
Monad-native lenders), trade positions, NFTs at best-bid, and liquidation alerts.
Those sections currently show sample data.

## Dev
    npm install
    node dev-server.mjs   # http://localhost:8877
