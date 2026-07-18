import { parseAbi, getAddress, formatUnits, isAddress } from 'viem'
import { makeClient, ERC20_ABI } from './chain.mjs'
import { discoverTokens } from './tokenlist.mjs'
import { TOKENS } from './tokens.mjs'
import { priceTokens, NATIVE_SENTINEL } from './pricing.mjs'
import { getNfts } from './nfts.mjs'
import { getLpPositions, UNISWAP_V3_NPM } from './lp.mjs'
import { getPerpPositions } from './perps.mjs'

// DeFi positions, discovered from what the wallet actually holds.
//
// Hardcoding protocols does not scale: Monad has 100+ live DeFi protocols and
// the list changes weekly, so an Aave-only check silently reported "no DeFi
// positions" for wallets with real money at work (a live example: a $24k
// Neverland deposit reported as nothing).
//
// Instead we work backwards from the wallet's own receipt tokens, which is what
// every lending market and vault hands you when you deposit:
//
//   - Aave-style receipts expose POOL(). That pool answers getUserAccountData,
//     which returns collateral, debt and health factor in USD. This covers Aave
//     V3 and every Aave fork (Neverland and friends) with nothing hardcoded.
//   - ERC-4626 vaults expose asset() and convertToAssets(). That covers the
//     large yield/vault family (Euler, Morpho vaults, Beefy, Upshift and so on).
//
// New protocols in either family are picked up automatically.
const AAVE_POOL = '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef' // Aave V3, checked directly too
const MAX_U256 = 2n ** 256n - 1n

const POOL_ABI = parseAbi([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
])
const RECEIPT_ABI = parseAbi([
  'function POOL() view returns (address)',
  'function UNDERLYING_ASSET_ADDRESS() view returns (address)',
])
// just enough to ask "are you a Uniswap-style position manager?"
const NPM_PROBE_ABI = parseAbi(['function factory() view returns (address)'])
const VAULT_ABI = parseAbi([
  'function asset() view returns (address)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
])

// Pools we can name outright. Anything not listed is still reported, named from
// its own receipt token, so an unknown protocol is never dropped.
const KNOWN_POOLS = {
  '0x69a5f9ad4f96ebf0a0c792dd42a01cc5c0102fef': 'Aave V3',
  '0x80f00661b13cc5f6ccd3885be7b4c9c67545d585': 'Neverland',
}

// "Neverland Interest Bearing WMON" -> "Neverland"; "Aave Monad WMON" -> "Aave"
function protocolFromToken(t) {
  const name = t?.name || ''
  const cut = name.split(/\s+(?:interest bearing|variable debt|stable debt)\s+/i)[0]
  const words = cut.trim().split(/\s+/).slice(0, 2).join(' ')
  return words || t?.symbol || 'Unknown protocol'
}

export async function getPositions(address) {
  const client = makeClient()
  const a = getAddress(address)
  const positions = []

  // what the wallet holds, so we know which receipts to interrogate
  let held = []
  try {
    const discovered = await discoverTokens(a)
    const known = new Set(TOKENS.map(t => t.address.toLowerCase()))
    const candidates = [...TOKENS, ...discovered.filter(t => !known.has(t.address.toLowerCase()))]
    const balances = await client.multicall({
      contracts: candidates.map(t => ({
        address: getAddress(t.address), abi: ERC20_ABI, functionName: 'balanceOf', args: [a],
      })),
      allowFailure: true,
    })
    held = candidates
      .map((t, i) => ({ ...t, raw: balances[i]?.status === 'success' ? balances[i].result : 0n }))
      .filter(t => t.raw > 0n)
  } catch { /* fall through: the direct Aave check below still runs */ }

  // --- pools: Aave V3 plus any Aave-style pool behind a receipt we hold ---
  const pools = new Map()       // pool(lower) -> receipt token that pointed at it
  const receiptPool = new Map() // receipt token(lower) -> pool(lower)
  pools.set(AAVE_POOL.toLowerCase(), null)

  if (held.length) {
    const res = await client.multicall({
      contracts: held.map(t => ({ address: getAddress(t.address), abi: RECEIPT_ABI, functionName: 'POOL' })),
      allowFailure: true,
    }).catch(() => [])
    res.forEach((r, i) => {
      if (r?.status !== 'success' || !isAddress(r.result)) return
      const key = r.result.toLowerCase()
      if (!pools.get(key)) pools.set(key, held[i])
      receiptPool.set(held[i].address.toLowerCase(), key)
    })
  }

  const poolKeys = [...pools.keys()]
  const accounts = await client.multicall({
    contracts: poolKeys.map(p => ({
      address: getAddress(p), abi: POOL_ABI, functionName: 'getUserAccountData', args: [a],
    })),
    allowFailure: true,
  }).catch(() => [])

  poolKeys.forEach((p, i) => {
    const r = accounts[i]
    if (r?.status !== 'success') {
      // only flag the pool we always expect to be readable; an unreadable
      // discovered pool is not something the user asked us about
      if (p === AAVE_POOL.toLowerCase()) {
        positions.push({ protocol: 'Aave V3', kind: 'lending', img: 'aave-v3', unavailable: true })
      }
      return
    }
    const d = r.result
    const collateral = Number(formatUnits(d[0], 8))
    const debt = Number(formatUnits(d[1], 8))
    if (collateral <= 0.01 && debt <= 0.01) return
    const hf = d[5] === MAX_U256 ? null : Number(formatUnits(d[5], 18))
    // every receipt token pointing at this pool IS this collateral; the caller
    // uses these to avoid counting the same money twice
    const receipts = held.filter(t => receiptPool.get(t.address.toLowerCase()) === p)
      .map(t => t.address.toLowerCase())
    positions.push({
      protocol: KNOWN_POOLS[p] || protocolFromToken(pools.get(p)),
      kind: 'lending', img: 'aave-v3', receiptTokens: receipts,
      collateralUsd: collateral, debtUsd: debt, netUsd: collateral - debt,
      healthFactor: hf,
      ltv: Number(d[4]) / 10000, liqThreshold: Number(d[3]) / 10000,
    })
  })

  // --- ERC-4626 vaults: any held share token that can price itself ---
  if (held.length) {
    const assets = await client.multicall({
      contracts: held.map(t => ({ address: getAddress(t.address), abi: VAULT_ABI, functionName: 'asset' })),
      allowFailure: true,
    }).catch(() => [])
    const vaults = held
      .map((t, i) => ({ t, asset: assets[i]?.status === 'success' ? assets[i].result : null }))
      .filter(v => v.asset && isAddress(v.asset))

    if (vaults.length) {
      // convertToAssets returns the UNDERLYING amount, which does not have to
      // share the vault token's decimals, so read the underlying's own.
      const reads = await client.multicall({
        contracts: [
          ...vaults.map(v => ({
            address: getAddress(v.t.address), abi: VAULT_ABI,
            functionName: 'convertToAssets', args: [v.t.raw],
          })),
          ...vaults.map(v => ({ address: getAddress(v.asset), abi: ERC20_ABI, functionName: 'decimals' })),
          ...vaults.map(v => ({ address: getAddress(v.asset), abi: ERC20_ABI, functionName: 'symbol' })),
        ],
        allowFailure: true,
      }).catch(() => [])

      const n = vaults.length
      const priced = await priceTokens(vaults.map(v => v.asset.toLowerCase()))

      vaults.forEach((v, i) => {
        const amt = reads[i]
        if (amt?.status !== 'success') return
        const native = v.asset.toLowerCase() === NATIVE_SENTINEL
        // the native sentinel is not a contract, so decimals()/symbol() revert
        const dec = native ? 18 : (reads[n + i]?.status === 'success' ? Number(reads[n + i].result) : v.t.decimals)
        const sym = native ? 'MON' : (reads[2 * n + i]?.status === 'success' ? reads[2 * n + i].result : v.t.symbol)
        const amount = Number(formatUnits(amt.result, dec))
        const px = priced[v.asset.toLowerCase()]
        positions.push({
          protocol: protocolFromToken(v.t),
          kind: 'vault', img: 'aave-v3',
          receiptTokens: [v.t.address.toLowerCase()],
          shares: Number(formatUnits(v.t.raw, v.t.decimals)),
          underlyingAmount: amount,
          underlyingSymbol: sym,
          underlyingToken: v.asset,
          symbol: v.t.symbol,
          // an unpriceable underlying stays null, never 0: a vault worth an
          // unknown amount must not be displayed as a vault worth nothing
          netUsd: px != null ? amount * px : null,
        })
      })
    }
  }

  // --- LP (an NFT, not an ERC-20 receipt) and leverage, in parallel ---
  const [lp, perps] = await Promise.all([
    lpManagers(client, a).then(m => getLpPositions(a, m)).catch(() => []),
    getPerpPositions(a).catch(() => []),
  ])
  positions.push(...lp, ...perps)

  return positions
}

// Uniswap V3 itself, plus any fork whose position NFT the wallet already holds.
// Probing what the wallet holds means a new V3-fork DEX is picked up without
// anyone adding its address here.
async function lpManagers(client, owner) {
  const managers = [UNISWAP_V3_NPM]
  try {
    const nfts = await getNfts(owner)
    const contracts = [...new Set(nfts.map(n => n.contract.toLowerCase()))]
      .filter(c => c !== UNISWAP_V3_NPM.toLowerCase())
      .slice(0, 12)
    if (!contracts.length) return managers
    // one batched probe, not one call per collection: a wallet with a dozen NFT
    // collections was spending most of the positions budget on this check alone
    const checks = await client.multicall({
      contracts: contracts.map(c => ({ address: getAddress(c), abi: NPM_PROBE_ABI, functionName: 'factory' })),
      allowFailure: true,
    })
    contracts.forEach((c, i) => {
      if (checks[i]?.status === 'success' && isAddress(checks[i].result)) managers.push(c)
    })
  } catch { /* fall back to the canonical manager alone */ }
  return managers
}
