// Pricing lives in exactly one place. Anchors come from CoinGecko; the long tail
// from GeckoTerminal's Monad DEX index. A token we cannot price is UNPRICED, never
// zero, and never counted toward net worth.
const CG = 'https://api.coingecko.com/api/v3'
const GT = 'https://api.geckoterminal.com/api/v2'

const ANCHOR_IDS = {
  monad: 'monad', 'usd-coin': 'usd-coin', usdt0: 'usdt0',
  'wrapped-monad': 'monad', ethereum: 'ethereum', bitcoin: 'bitcoin',
  'wrapped-bitcoin': 'bitcoin', 'coinbase-wrapped-btc': 'bitcoin',
}

export async function priceAnchors() {
  const ids = [...new Set(Object.values(ANCHOR_IDS))].join(',')
  const r = await fetch(`${CG}/simple/price?ids=${ids}&vs_currencies=usd`)
  if (!r.ok) return {}
  return r.json()
}

// GeckoTerminal: up to 30 token addresses per call, returns price + liquidity.
// Chunks run with small-batch concurrency rather than a serial 1.5s-sleep loop:
// wallets holding a long tail of memecoins used to spend 7s+ sleeping here and
// blow the serverless time limit, which surfaced as "read failed". A chunk that
// gets rate-limited simply leaves its tokens unpriced, which is the safe outcome.
const TAIL_CAP = 150      // beyond this the tail is dust; do not stall the report
const CHUNK = 30
const CONCURRENCY = 3

export async function priceTail(addresses) {
  const chunks = []
  for (let i = 0; i < Math.min(addresses.length, TAIL_CAP); i += CHUNK) {
    chunks.push(addresses.slice(i, i + CHUNK).join(','))
  }
  const prices = {}
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async c => {
      try {
        const r = await fetch(`${GT}/networks/monad/tokens/multi/${c}`, { headers: { Accept: 'application/json' } })
        return r.ok ? await r.json() : null
      } catch { return null }
    }))
    for (const d of results) {
      for (const t of d?.data || []) {
        const a = t.attributes
        const addr = a.address?.toLowerCase()
        const px = a.price_usd ? Number(a.price_usd) : null
        // liquidity floor: below this the price is not trustworthy
        const liq = a.total_reserve_in_usd ? Number(a.total_reserve_in_usd) : 0
        if (addr && px && liq >= 1000) prices[addr] = { usd: px, confidence: liq >= 25000 ? 'HIGH' : 'MEDIUM' }
      }
    }
    if (i + CONCURRENCY < chunks.length) await new Promise(r => setTimeout(r, 250))
  }
  return prices
}
