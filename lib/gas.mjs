import { getAddress, formatEther } from 'viem'
import { makeClient } from './chain.mjs'

// "Gas spent on Monad so far."
//
// Empirically verified on Monad: receipt.gasUsed always equals the tx gas_limit,
// so gasUsed * effectiveGasPrice already IS the true charge (there is no hidden
// overpay vs what explorers report — a claim we tested and discarded).
//
// Lifetime tx count is free (the account nonce). The lifetime gas total needs the
// wallet's full tx history, which Etherscan's multichain API (chainid 143) serves
// in one paginated call. With no key we still show the real tx count.
const ETHERSCAN = 'https://api.etherscan.io/v2/api'

export async function getGas(address) {
  const client = makeClient()
  const a = getAddress(address)

  const txCount = await client.getTransactionCount({ address: a }).catch(() => null)

  const key = process.env.ETHERSCAN_API_KEY
  let gasSpentMon = null, counted = 0
  if (key) {
    try {
      let page = 1, totalWei = 0n
      for (; page <= 10; page++) { // up to 10k txs
        const url = `${ETHERSCAN}?chainid=143&module=account&action=txlist&address=${a}&startblock=0&endblock=99999999&page=${page}&offset=1000&sort=asc&apikey=${key}`
        const r = await fetch(url)
        const d = await r.json()
        if (d.status !== '1' || !Array.isArray(d.result)) break
        for (const tx of d.result) {
          if (tx.from?.toLowerCase() !== a.toLowerCase()) continue // only gas the wallet paid
          totalWei += BigInt(tx.gasUsed || '0') * BigInt(tx.gasPrice || '0')
          counted++
        }
        if (d.result.length < 1000) break
      }
      gasSpentMon = Number(formatEther(totalWei))
    } catch { /* fall back to count only */ }
  }

  if (txCount == null) return null
  return { txCount, gasSpentMon, countedTxs: counted }
}
