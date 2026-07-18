# MonScope

A Monad-only portfolio and safety tracker. Paste any address and see everything
it holds on chain 143 — priced live, read from chain, no signup, no wallet
connection required. Read-only by default.

## What's live (all real, no mock data)

- **Tokens** — native MON + ERC-20 balances via viem + Multicall3 in one round trip.
- **Pricing** — CoinGecko anchors + GeckoTerminal DEX index for the long tail.
  Illiquid / unpriceable tokens are quarantined, never counted toward net worth.
- **DeFi positions** — Aave V3 collateral, debt, health factor, read live.
- **Gas spent** — lifetime MON spent on gas and transaction count, including
  correct handling of EIP-7702 smart-account wallets.
- **Activity** — full lifetime feed: native transfers, contract calls, deploys.
- **NFTs** — every NFT the wallet currently holds, netted from full transfer
  history and re-verified on-chain with `ownerOf`.
- **Security** — token approvals scanner ("revoke.cash for Monad"). Known
  protocols (Uniswap, Aave, Permit2) are labelled and left alone; only unverified
  or scam-flagged spenders are surfaced for revocation. Recent counterparties and
  spenders are checked against the ScamSniffer blacklist.
- **Optional connect-to-revoke** — the only transaction MonScope ever sends is
  `approve(spender, 0)`, on explicit user action, only when the connected wallet
  matches the one being viewed. Uses the wallet's own EIP-1193 provider, no
  third-party connection library.

## Onchain contract

`contracts/MonScopeLens.sol` — a read aggregator deployed on Monad. `scan(owner,
tokens, spenders)` returns native balance, ERC-20 balances and approval
allowances in a single `eth_call`. It also exposes a permissionless `attest`
registry with a public `totalScans` counter for an onchain footprint. No owner,
no admin, no upgrade key. Deployed address is written to `contracts/deployed.json`.

## Architecture

- `netlify/functions/portfolio.mjs` — the serverless read endpoint (`/api/portfolio`).
- `lib/report.mjs` — single source of truth that assembles a wallet report; both
  the function and the dev server call it.
- `lib/` — chain client, pricing, portfolio/positions/activity/nfts/gas/approvals
  adapters, token registry, scam list.
- `public/index.html` — the UI (self-contained, no build step).
- `contracts/`, `scripts/` — the Lens contract, compile, verify and deploy.

## Setup

    npm install
    cp .env.example .env.local     # add your ETHERSCAN_API_KEY
    node dev-server.mjs            # http://localhost:8877

Deploying to Netlify: publish dir `public`, functions `netlify/functions` (already
in `netlify.toml`). Set `ETHERSCAN_API_KEY` in the site's environment variables.

## Contract

    node scripts/compile.mjs                 # solc -> contracts/out/MonScopeLens.json
    node scripts/verify-lens.mjs             # prove it against live Monad state (no deploy)
    node scripts/deploy.mjs testnet          # or: mainnet  (needs PRIVATE_KEY, funded)
