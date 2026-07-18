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

// Prices are identical for every visitor, so they are cached process-wide rather
// than refetched per wallet. Without this, CoinGecko and GeckoTerminal both
// rate-limit us under normal traffic and tokens silently fall to UNPRICED.
const TTL_MS = 60_000
const anchorCache = { at: 0, value: null }
const tailCache = new Map() // token address(lower) -> { at, value }

// Retry a rate-limited price call instead of quietly giving up on it.
async function getJson(url, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } })
      if (r.ok) return await r.json()
      if (r.status !== 429 && r.status < 500) return null
    } catch { /* retry */ }
    if (i < attempts) await new Promise(r => setTimeout(r, 500 * i))
  }
  return null
}

export async function priceAnchors() {
  if (anchorCache.value && Date.now() - anchorCache.at < TTL_MS) return anchorCache.value
  const ids = [...new Set(Object.values(ANCHOR_IDS))].join(',')
  const d = await getJson(`${CG}/simple/price?ids=${ids}&vs_currencies=usd`)
  // on failure keep serving the last good anchors rather than zeroing net worth
  if (!d) return anchorCache.value || {}
  anchorCache.at = Date.now()
  anchorCache.value = d
  return d
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
  const now = Date.now()
  const prices = {}
  const misses = []
  for (const a of addresses) {
    const hit = tailCache.get(a)
    if (hit && now - hit.at < TTL_MS) { if (hit.value) prices[a] = hit.value }
    else misses.push(a)
  }

  const chunks = []
  for (let i = 0; i < Math.min(misses.length, TAIL_CAP); i += CHUNK) {
    chunks.push(misses.slice(i, i + CHUNK))
  }

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(c =>
      getJson(`${GT}/networks/monad/tokens/multi/${c.join(',')}`)
    ))
    results.forEach((d, j) => {
      if (!d) return // call failed; leave these uncached so the next read retries
      for (const t of d.data || []) {
        const a = t.attributes
        const addr = a.address?.toLowerCase()
        const px = a.price_usd ? Number(a.price_usd) : null
        // liquidity floor: below this the price is not trustworthy
        const liq = a.total_reserve_in_usd ? Number(a.total_reserve_in_usd) : 0
        if (!addr) continue
        const value = (px && liq >= 1000) ? { usd: px, confidence: liq >= 25000 ? 'HIGH' : 'MEDIUM' } : null
        if (value) prices[addr] = value
        tailCache.set(addr, { at: Date.now(), value })
      }
      // tokens the index does not know about: cache the miss so we stop asking
      for (const addr of batch[j]) {
        if (!tailCache.has(addr)) tailCache.set(addr, { at: Date.now(), value: null })
      }
    })
    if (i + CONCURRENCY < chunks.length) await new Promise(r => setTimeout(r, 250))
  }
  return prices
}
