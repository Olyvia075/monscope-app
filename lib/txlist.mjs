import { getAddress } from 'viem'
import { esQuery, hasKey } from './etherscan.mjs'

// Single source of truth for a wallet's on-chain transaction history on Monad
// (chainid 143). Etherscan's multichain API serves the full paginated list; we
// fetch it once per address per request and let both gas accounting and the
// activity feed read from it, so the two can never disagree (the "35 txs but 0
// activity" mismatch came from gas using this list while activity used a tiny
// getLogs window).
const cache = new Map() // address(lower) -> Promise<tx[]>

export function getTxList(address) {
  const a = getAddress(address)
  const key = a.toLowerCase()
  if (cache.has(key)) return cache.get(key)
  const p = fetchTxList(a).catch(() => [])
  cache.set(key, p)
  // best-effort TTL so a long-lived process does not pin stale history
  setTimeout(() => cache.delete(key), 30_000).unref?.()
  return p
}

// Capped at 4 pages (4k txs). All Etherscan traffic is rate-gated in etherscan.mjs,
// so deep pagination costs real wall-clock; 4k txs covers any realistic wallet and
// keeps the request inside the serverless time limit.
const PAGES = 4

async function fetchTxList(a) {
  if (!hasKey()) return []
  const all = []
  for (let page = 1; page <= PAGES; page++) {
    const rows = await esQuery({
      module: 'account', action: 'txlist', address: a,
      startblock: '0', endblock: '99999999', page: String(page), offset: '1000', sort: 'desc',
    })
    all.push(...rows)
    if (rows.length < 1000) break
  }
  return all
}
