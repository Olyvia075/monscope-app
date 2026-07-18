import { getAddress } from 'viem'

// Which ERC-20s has this wallet ever touched? The curated registry in tokens.mjs
// only covers major Monad tokens, so a wallet holding anything else showed an
// empty or partial token list. We pull the full ERC-20 transfer history and use
// it purely as a discovery hint: it tells us WHICH contracts to look at, and
// balances are still read live from chain in portfolio.mjs.
const ETHERSCAN = 'https://api.etherscan.io/v2/api'
const MAX_CANDIDATES = 200
const cache = new Map() // address(lower) -> Promise<token[]>

export function discoverTokens(address) {
  const a = getAddress(address)
  const key = a.toLowerCase()
  if (cache.has(key)) return cache.get(key)
  const p = fetchTokenTx(a).catch(() => [])
  cache.set(key, p)
  setTimeout(() => cache.delete(key), 30_000).unref?.()
  return p
}

async function fetchTokenTx(a) {
  const apikey = process.env.ETHERSCAN_API_KEY
  if (!apikey) return [] // keyless: registry-only, same as before
  const seen = new Map() // contract(lower) -> token meta
  for (let page = 1; page <= 10; page++) {
    const url = `${ETHERSCAN}?chainid=143&module=account&action=tokentx&address=${a}&startblock=0&endblock=99999999&page=${page}&offset=1000&sort=desc&apikey=${apikey}`
    const r = await fetch(url)
    const d = await r.json()
    if (d.status !== '1' || !Array.isArray(d.result)) break
    for (const t of d.result) {
      const c = (t.contractAddress || '').toLowerCase()
      const decimals = Number(t.tokenDecimal)
      // a missing/absurd decimals field means this is not a sane ERC-20 row
      if (!c || seen.has(c) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue
      seen.set(c, {
        address: c,
        symbol: t.tokenSymbol || '?',
        name: t.tokenName || t.tokenSymbol || 'Unknown token',
        decimals,
        coingecko: null, // discovered tokens have no anchor; DEX-priced or quarantined
      })
    }
    if (d.result.length < 1000) break
  }
  return [...seen.values()].slice(0, MAX_CANDIDATES)
}
