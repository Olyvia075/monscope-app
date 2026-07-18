import { getAddress } from 'viem'
import { esQuery, hasKey } from './etherscan.mjs'

// Which ERC-20s has this wallet ever touched? The curated registry in tokens.mjs
// only covers major Monad tokens, so a wallet holding anything else showed an
// empty or partial token list. We pull the full ERC-20 transfer history and use
// it purely as a discovery hint: it tells us WHICH contracts to look at, and
// balances are still read live from chain in portfolio.mjs.
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
  if (!hasKey()) return [] // keyless: registry-only, same as before
  const seen = new Map() // contract(lower) -> token meta
  for (let page = 1; page <= 3; page++) {
    const rows = await esQuery({
      module: 'account', action: 'tokentx', address: a,
      startblock: '0', endblock: '99999999', page: String(page), offset: '1000', sort: 'desc',
    })
    for (const t of rows) {
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
    if (rows.length < 1000) break
  }
  return [...seen.values()].slice(0, MAX_CANDIDATES)
}
