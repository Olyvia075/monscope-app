import { parseAbi, getAddress, formatUnits, isAddress } from 'viem'
import { makeClient, ERC20_ABI } from './chain.mjs'
import { getAmountsForLiquidity } from './univ3math.mjs'
import { priceTokens } from './pricing.mjs'

// Uniswap-V3-style concentrated liquidity positions.
//
// These are the one class of DeFi position that is invisible to both of the
// other adapters: the position is an NFT, not an ERC-20 receipt, and it stores
// liquidity between two ticks rather than token amounts. The amounts only exist
// relative to the pool's current price, so they have to be reconstructed
// (univ3math.mjs) from slot0.
//
// Verified on Monad mainnet: the position manager below reports itself as
// "Uniswap V3 Positions NFT-V1" and its factory() matches the factory address.
// Any V3 fork is also picked up, because callers can pass extra managers that
// were discovered from the NFTs a wallet actually holds.
export const UNISWAP_V3_NPM = '0x7197E214c0b767cFB76Fb734ab638E2c192F4E53'

const NPM_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function factory() view returns (address)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
])
const FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
])
const POOL_ABI = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
])

const MAX_POSITIONS = 40

// How many token1 one token0 buys, at the pool's current price, in human units.
function poolPriceToken1PerToken0(sqrtPriceX96, dec0, dec1) {
  const s = Number(sqrtPriceX96) / 2 ** 96
  return s * s * 10 ** (dec0 - dec1)
}

// Does this contract behave like a V3 position manager? Used to pick up forks
// from the NFTs a wallet already holds, without hardcoding every DEX on Monad.
export async function isPositionManager(client, address) {
  try {
    const f = await client.readContract({ address: getAddress(address), abi: NPM_ABI, functionName: 'factory' })
    return isAddress(f) ? f : null
  } catch { return null }
}

export async function getLpPositions(address, managers = [UNISWAP_V3_NPM]) {
  const client = makeClient()
  const owner = getAddress(address)
  const out = []

  for (const manager of managers) {
    try {
      const rows = await readManager(client, owner, getAddress(manager))
      out.push(...rows)
    } catch { /* one broken manager must not sink the others */ }
  }
  return out
}

async function readManager(client, owner, manager) {
  const [count, factory] = await Promise.all([
    client.readContract({ address: manager, abi: NPM_ABI, functionName: 'balanceOf', args: [owner] }),
    client.readContract({ address: manager, abi: NPM_ABI, functionName: 'factory' }),
  ])
  const n = Number(count)
  if (!n) return []

  const idx = Array.from({ length: Math.min(n, MAX_POSITIONS) }, (_, i) => BigInt(i))
  const ids = await client.multicall({
    contracts: idx.map(i => ({ address: manager, abi: NPM_ABI, functionName: 'tokenOfOwnerByIndex', args: [owner, i] })),
    allowFailure: true,
  })
  const tokenIds = ids.filter(r => r.status === 'success').map(r => r.result)
  if (!tokenIds.length) return []

  const posRes = await client.multicall({
    contracts: tokenIds.map(id => ({ address: manager, abi: NPM_ABI, functionName: 'positions', args: [id] })),
    allowFailure: true,
  })

  const positions = []
  posRes.forEach((r, i) => {
    if (r.status !== 'success') return
    const p = r.result
    const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , owed0, owed1] = p
    // a closed position still exists as an NFT but holds nothing
    if (liquidity === 0n && owed0 === 0n && owed1 === 0n) return
    positions.push({ tokenId: tokenIds[i], token0, token1, fee, tickLower, tickUpper, liquidity, owed0, owed1 })
  })
  if (!positions.length) return []

  // resolve each position's pool, then that pool's current price
  const pools = await client.multicall({
    contracts: positions.map(p => ({
      address: getAddress(factory), abi: FACTORY_ABI, functionName: 'getPool',
      args: [p.token0, p.token1, p.fee],
    })),
    allowFailure: true,
  })
  const withPool = positions
    .map((p, i) => ({ ...p, pool: pools[i]?.status === 'success' ? pools[i].result : null }))
    .filter(p => p.pool && isAddress(p.pool) && !/^0x0{40}$/i.test(p.pool))
  if (!withPool.length) return []

  const slots = await client.multicall({
    contracts: withPool.map(p => ({ address: getAddress(p.pool), abi: POOL_ABI, functionName: 'slot0' })),
    allowFailure: true,
  })

  // token metadata for both legs of every position
  const tokenSet = [...new Set(withPool.flatMap(p => [p.token0.toLowerCase(), p.token1.toLowerCase()]))]
  const meta = await client.multicall({
    contracts: [
      ...tokenSet.map(t => ({ address: getAddress(t), abi: ERC20_ABI, functionName: 'decimals' })),
      ...tokenSet.map(t => ({ address: getAddress(t), abi: ERC20_ABI, functionName: 'symbol' })),
    ],
    allowFailure: true,
  })
  const info = new Map(tokenSet.map((t, i) => [t, {
    decimals: meta[i]?.status === 'success' ? Number(meta[i].result) : 18,
    symbol: meta[tokenSet.length + i]?.status === 'success' ? meta[tokenSet.length + i].result : '?',
  }]))
  const prices = await priceTokens(tokenSet)

  const rows = []
  withPool.forEach((p, i) => {
    const s = slots[i]
    if (s?.status !== 'success') return
    const sqrtPriceX96 = s.result[0]
    const tick = Number(s.result[1])

    let amounts
    try {
      amounts = getAmountsForLiquidity(sqrtPriceX96, Number(p.tickLower), Number(p.tickUpper), p.liquidity)
    } catch { return }

    const a = info.get(p.token0.toLowerCase())
    const b = info.get(p.token1.toLowerCase())
    // uncollected fees are part of what the position is worth
    const amt0 = Number(formatUnits(amounts.amount0 + p.owed0, a.decimals))
    const amt1 = Number(formatUnits(amounts.amount1 + p.owed1, b.decimals))
    let px0 = prices[p.token0.toLowerCase()]
    let px1 = prices[p.token1.toLowerCase()]

    // The pool's own price IS the exchange rate between the two legs, so one
    // known price implies the other. This is what lets a real position like
    // AUSD/USDC be valued when only USDC has an external quote — without it,
    // pricing a single leg would understate the position by roughly half.
    const ratio = poolPriceToken1PerToken0(sqrtPriceX96, a.decimals, b.decimals)
    if (ratio > 0 && Number.isFinite(ratio)) {
      if (px0 == null && px1 != null) px0 = px1 * ratio
      else if (px1 == null && px0 != null) px1 = px0 / ratio
    }

    // with neither leg priced and no way to derive one, we genuinely do not
    // know what this is worth: null, never a misleading zero
    const netUsd = (px0 != null && px1 != null) ? amt0 * px0 + amt1 * px1 : null
    const inRange = tick >= Number(p.tickLower) && tick < Number(p.tickUpper)

    rows.push({
      protocol: 'Uniswap V3', kind: 'lp', img: 'aave-v3',
      pair: a.symbol + ' / ' + b.symbol,
      feeTier: Number(p.fee) / 10000,
      tokenId: p.tokenId.toString(),
      amount0: amt0, amount1: amt1,
      symbol0: a.symbol, symbol1: b.symbol,
      inRange,
      netUsd,
    })
  })
  return rows
}
