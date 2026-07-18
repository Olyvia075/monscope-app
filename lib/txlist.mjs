import { getAddress } from 'viem'

// Single source of truth for a wallet's on-chain transaction history on Monad
// (chainid 143). Etherscan's multichain API serves the full paginated list; we
// fetch it once per address per request and let both gas accounting and the
// activity feed read from it, so the two can never disagree (the "35 txs but 0
// activity" mismatch came from gas using this list while activity used a tiny
// getLogs window).
const ETHERSCAN = 'https://api.etherscan.io/v2/api'
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

async function fetchTxList(a) {
  const apikey = process.env.ETHERSCAN_API_KEY
  if (!apikey) return []
  const all = []
  for (let page = 1; page <= 10; page++) { // up to 10k txs
    const url = `${ETHERSCAN}?chainid=143&module=account&action=txlist&address=${a}&startblock=0&endblock=99999999&page=${page}&offset=1000&sort=desc&apikey=${apikey}`
    const r = await fetch(url)
    const d = await r.json()
    if (d.status !== '1' || !Array.isArray(d.result)) break
    all.push(...d.result)
    if (d.result.length < 1000) break
  }
  return all
}
