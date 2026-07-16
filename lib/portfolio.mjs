import { formatUnits, isAddress, getAddress } from 'viem'
import { makeClient, ERC20_ABI } from './chain.mjs'
import { priceAnchors, priceTail } from './prices.mjs'
import { TOKENS } from './tokens.mjs'

const ANCHOR_CG = {
  'usd-coin': 'usd-coin', usdt0: 'usdt0', 'wrapped-monad': 'monad',
  'wrapped-bitcoin': 'bitcoin', 'coinbase-wrapped-btc': 'bitcoin',
  'wormhole-bridged-weth-monad': 'ethereum',
}

// Balances are always read live from chain; the indexer only ever tells us WHICH
// tokens to look at. Here the "which" is the curated registry.
export async function getPortfolio(input) {
  if (!isAddress(input)) throw new Error('Not a valid address')
  const address = getAddress(input)
  const client = makeClient()

  const [native, cg] = await Promise.all([client.getBalance({ address }), priceAnchors()])

  const calls = TOKENS.flatMap(t => [
    { address: getAddress(t.address), abi: ERC20_ABI, functionName: 'balanceOf', args: [address] },
  ])
  const balances = await client.multicall({ contracts: calls, allowFailure: true })

  // which tokens are held, and which need a DEX price (no CG anchor)
  const held = []
  const needTail = []
  TOKENS.forEach((t, i) => {
    const b = balances[i]
    if (b.status !== 'success' || b.result === 0n) return
    const amount = Number(formatUnits(b.result, t.decimals))
    if (amount <= 0) return
    const anchor = ANCHOR_CG[t.coingecko]
    held.push({ ...t, amount, raw: b.result.toString(), anchor })
    if (!anchor) needTail.push(t.address.toLowerCase())
  })

  const tail = needTail.length ? await priceTail(needTail) : {}
  const monUsd = cg.monad?.usd ?? null

  const priced = []
  const unpriced = []
  for (const t of held) {
    let usd = null, confidence = null
    if (t.anchor && cg[t.anchor]?.usd != null) { usd = cg[t.anchor].usd; confidence = 'HIGH' }
    else if (tail[t.address.toLowerCase()]) { usd = tail[t.address.toLowerCase()].usd; confidence = tail[t.address.toLowerCase()].confidence }
    const row = { symbol: t.symbol, name: t.name, address: t.address, amount: t.amount, decimals: t.decimals }
    if (usd != null) priced.push({ ...row, priceUsd: usd, valueUsd: t.amount * usd, confidence })
    else unpriced.push({ ...row, reason: 'no_reliable_price' })
  }

  const nativeAmount = Number(formatUnits(native, 18))
  if (monUsd != null) priced.unshift({ symbol: 'MON', name: 'Monad', address: 'native', amount: nativeAmount, decimals: 18, priceUsd: monUsd, valueUsd: nativeAmount * monUsd, confidence: 'HIGH' })
  else unpriced.unshift({ symbol: 'MON', name: 'Monad', address: 'native', amount: nativeAmount, decimals: 18, reason: 'no_reliable_price' })

  priced.sort((a, b) => b.valueUsd - a.valueUsd)
  const netWorth = priced.reduce((s, t) => s + t.valueUsd, 0)

  return {
    address,
    chainId: 143,
    netWorth,
    tokens: priced,
    unpriced,
    counts: { priced: priced.length, unpriced: unpriced.length },
    asOf: null, // stamped by the caller
  }
}
