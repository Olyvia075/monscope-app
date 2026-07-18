import { parseAbi, getAddress, formatUnits } from 'viem'
import { makeClient } from './chain.mjs'

// Aave V3 on Monad (from the official bgd-labs address book).
const AAVE_POOL = '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef'
const MAX_U256 = 2n ** 256n - 1n
const AAVE_ABI = parseAbi([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
])

// Adapters return amounts and a summary; they never price in USD terms beyond what
// the protocol itself reports (Aave reports base currency = USD, 8 decimals).
export async function getPositions(address) {
  const client = makeClient()
  const positions = []

  try {
    const d = await client.readContract({ address: AAVE_POOL, abi: AAVE_ABI, functionName: 'getUserAccountData', args: [getAddress(address)] })
    const collateral = Number(formatUnits(d[0], 8))
    const debt = Number(formatUnits(d[1], 8))
    if (collateral > 0.01 || debt > 0.01) {
      const hf = d[5] === MAX_U256 ? null : Number(formatUnits(d[5], 18))
      positions.push({
        protocol: 'Aave V3', kind: 'lending', img: 'aave-v3',
        collateralUsd: collateral, debtUsd: debt, netUsd: collateral - debt,
        healthFactor: hf,
        ltv: Number(d[4]) / 10000, liqThreshold: Number(d[3]) / 10000,
      })
    }
  } catch (e) {
    // A failed read is not the same as "no position". Surfacing it stops an RPC
    // hiccup from being displayed as a confident, empty DeFi section.
    positions.push({ protocol: 'Aave V3', kind: 'lending', img: 'aave-v3', unavailable: true })
  }

  return positions
}
