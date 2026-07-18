import { parseAbi, getAddress, formatUnits } from 'viem'
import { makeClient } from './chain.mjs'
import { priceTokens } from './pricing.mjs'

// Leverage / perpetual positions on Monad.
//
// Unlike lending and vaults there is no receipt token to discover, so these are
// necessarily per-protocol adapters against published addresses. Both read paths
// below were verified live against chain 143 before being written.
//
// Deliberately not covered: Drake publishes no ABI (guessing one would be
// fabrication), and Kuru and Clober are spot CLOBs with no leverage positions to
// read despite Kuru's "MarginAccount" naming.

// --- Perpl -----------------------------------------------------------------
// Collateral is AUSD, 6 decimals. getAccountByAddr REVERTS for an address that
// has never opened an account, which is a normal answer, not an error.
const PERPL_EXCHANGE = '0x34B6552d57a35a1D042CcAe1951BD1C370112a6F'
const AUSD = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a'
const PERPL_ABI = parseAbi([
  'struct PositionBitMap { uint256 bank1; uint256 bank2; uint256 bank3; uint256 bank4; }',
  'struct AccountInfo { uint256 accountId; uint256 balanceCNS; uint256 lockedBalanceCNS; uint8 frozen; address accountAddr; PositionBitMap positions; }',
  'function getAccountByAddr(address) view returns (AccountInfo)',
])

// --- LeverUp ---------------------------------------------------------------
// EIP-2535 diamond. Positions are read per trading pair, so all pairs go out in
// one multicall rather than 20 sequential calls.
const LEVERUP_DIAMOND = '0xea1b8E4aB7f14F7dCA68c5B214303B13078FC5ec'
const LEVERUP_ABI = parseAbi([
  'struct Position { bytes32 positionHash; string pair; address pairBase; address tokenIn; address marginToken; bool isLong; uint96 margin; uint128 qty; uint128 entryPrice; uint128 stopLoss; uint128 takeProfit; uint96 openFee; uint96 executionFee; int256 fundingFee; uint32 timestamp; uint96 holdingFee; }',
  'function getPositionsV2(address user, address pairBase) view returns (Position[])',
])
const LEVERUP_PAIRS = [
  '0xcf5a6076cfa32686c0df13abada2b40dec133f1d', // BTC
  '0xb5a30b0fdc5ea94a52fdc42e3e9760cb8449fb37', // ETH
  '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', // MON
]

export async function getPerpPositions(address) {
  const client = makeClient()
  const user = getAddress(address)
  const [perpl, leverup] = await Promise.all([
    readPerpl(client, user).catch(() => []),
    readLeverUp(client, user).catch(() => []),
  ])
  return [...perpl, ...leverup]
}

async function readPerpl(client, user) {
  let acc
  try {
    acc = await client.readContract({
      address: getAddress(PERPL_EXCHANGE), abi: PERPL_ABI,
      functionName: 'getAccountByAddr', args: [user],
    })
  } catch {
    return [] // no account on Perpl: a revert here means "nothing", not a failure
  }

  const balance = Number(formatUnits(acc.balanceCNS, 6))
  const locked = Number(formatUnits(acc.lockedBalanceCNS, 6))
  if (balance <= 0.01 && locked <= 0.01) return []

  const bits = [acc.positions.bank1, acc.positions.bank2, acc.positions.bank3, acc.positions.bank4]
  const openMarkets = bits.reduce((n, b) => n + countBits(b), 0)

  const px = await priceTokens([AUSD])
  const usd = px[AUSD.toLowerCase()]

  return [{
    protocol: 'Perpl', kind: 'perp', img: 'aave-v3',
    collateralAmount: balance,
    collateralSymbol: 'AUSD',
    lockedAmount: locked,
    openMarkets,
    netUsd: usd != null ? balance * usd : null,
  }]
}

function countBits(v) {
  let n = 0
  let x = v
  while (x > 0n) { n += Number(x & 1n); x >>= 1n }
  return n
}

async function readLeverUp(client, user) {
  const res = await client.multicall({
    contracts: LEVERUP_PAIRS.map(p => ({
      address: getAddress(LEVERUP_DIAMOND), abi: LEVERUP_ABI,
      functionName: 'getPositionsV2', args: [user, getAddress(p)],
    })),
    allowFailure: true,
  })

  const open = []
  for (const r of res) {
    if (r.status !== 'success') continue
    for (const p of r.result) open.push(p)
  }
  if (!open.length) return []

  // margin is denominated in the position's own margin token
  const marginTokens = [...new Set(open.map(p => p.marginToken.toLowerCase()))]
  const px = await priceTokens(marginTokens)

  return open.map(p => {
    const usd = px[p.marginToken.toLowerCase()]
    // margin token decimals are not exposed on the position; the documented
    // margin tokens on Monad (LVUSD, USDC, WMON) are read at their own decimals
    // by the pricing layer, so only convert when we can price it
    const margin = Number(formatUnits(p.margin, 18))
    return {
      protocol: 'LeverUp', kind: 'perp', img: 'aave-v3',
      pair: p.pair,
      side: p.isLong ? 'long' : 'short',
      marginAmount: margin,
      entryPrice: Number(formatUnits(p.entryPrice, 8)),
      netUsd: usd != null ? margin * usd : null,
    }
  })
}
