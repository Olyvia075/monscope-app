import { priceAnchors, priceTail } from './prices.mjs'
import { TOKENS } from './tokens.mjs'

// One place that turns a token address into a USD price, so a token is valued
// identically whether it is held directly, sitting in a vault, or one leg of an
// LP position. Anything without a reliable quote is absent, never zero.
const ANCHOR_CG = {
  'usd-coin': 'usd-coin', usdt0: 'usdt0', 'wrapped-monad': 'monad',
  'wrapped-bitcoin': 'bitcoin', 'coinbase-wrapped-btc': 'bitcoin',
  'wormhole-bridged-weth-monad': 'ethereum',
}

// Tokens with a trustworthy CoinGecko quote but no usable DEX liquidity data.
// AUSD is the clearest case: GeckoTerminal knows it but reports zero reserve, so
// the liquidity floor rejects it and a real stablecoin came back unpriced.
const BY_ADDRESS = {
  '0x00000000efe302beaa2b3e6e1b18d08d69a9012a': 'agora-dollar', // AUSD
}

// contracts that hold native MON report this sentinel instead of a token address
export const NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export async function priceTokens(addresses) {
  const out = {}
  const uniq = [...new Set(addresses.map(a => a.toLowerCase()))]
  if (!uniq.length) return out
  try {
    const lookup = uniq.filter(a => a !== NATIVE_SENTINEL)
    const [cg, tail] = await Promise.all([priceAnchors(), priceTail(lookup)])
    const byAddress = new Map(TOKENS.map(t => [t.address.toLowerCase(), t]))
    for (const a of uniq) {
      if (a === NATIVE_SENTINEL) {
        if (cg.monad?.usd != null) out[a] = cg.monad.usd
        continue
      }
      const reg = byAddress.get(a)
      const anchor = BY_ADDRESS[a] || (reg && ANCHOR_CG[reg.coingecko])
      if (anchor && cg[anchor]?.usd != null) out[a] = cg[anchor].usd
      else if (tail[a]) out[a] = tail[a].usd
    }
  } catch { /* unpriced tokens simply stay absent */ }
  return out
}
