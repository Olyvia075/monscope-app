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
export async function priceTail(addresses) {
  const prices = {}
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30).join(',')
    const r = await fetch(`${GT}/networks/monad/tokens/multi/${chunk}`, { headers: { Accept: 'application/json' } })
    if (!r.ok) continue
    const d = await r.json()
    for (const t of d.data || []) {
      const a = t.attributes
      const addr = a.address?.toLowerCase()
      const px = a.price_usd ? Number(a.price_usd) : null
      // liquidity floor: below this the price is not trustworthy
      const liq = a.total_reserve_in_usd ? Number(a.total_reserve_in_usd) : 0
      if (addr && px && liq >= 1000) prices[addr] = { usd: px, confidence: liq >= 25000 ? 'HIGH' : 'MEDIUM' }
    }
    if (i + 30 < addresses.length) await new Promise(r => setTimeout(r, 1500))
  }
  return prices
}
