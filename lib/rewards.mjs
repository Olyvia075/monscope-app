import { parseAbi, getAddress, formatUnits } from 'viem'
import { makeClient } from './chain.mjs'

// Aave V3 incentives on Monad. Claimable rewards accrue per aToken/debtToken; the
// RewardsController aggregates them for a user across those assets.
const POOL = '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef'
const INCENTIVES = '0x6f275486dC3EF07691B846E500556774B2D98F59'

const POOL_ABI = parseAbi([
  'function getReservesList() view returns (address[])',
  'function getReserveData(address) view returns ((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address,uint128,uint128,uint128))',
])
const INC_ABI = parseAbi([
  'function getAllUserRewards(address[] assets, address user) view returns (address[] rewardsList, uint256[] unclaimedAmounts)',
])
const ERC20 = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)'])

export async function getRewards(address) {
  const client = makeClient()
  const a = getAddress(address)
  try {
    const reserves = await client.readContract({ address: POOL, abi: POOL_ABI, functionName: 'getReservesList' })
    // collect aToken + variableDebtToken for every reserve (these are the reward-bearing assets)
    const assets = []
    const rd = await client.multicall({
      contracts: reserves.map(r => ({ address: POOL, abi: POOL_ABI, functionName: 'getReserveData', args: [r] })),
      allowFailure: true,
    })
    for (const r of rd) if (r.status === 'success') { assets.push(r.result[8], r.result[10]) }
    if (!assets.length) return []

    const [list, amounts] = await client.readContract({ address: INCENTIVES, abi: INC_ABI, functionName: 'getAllUserRewards', args: [assets, a] })
    const rewards = []
    for (let i = 0; i < list.length; i++) {
      if (amounts[i] === 0n) continue
      const [sym, dec] = await Promise.all([
        client.readContract({ address: list[i], abi: ERC20, functionName: 'symbol' }).catch(() => '?'),
        client.readContract({ address: list[i], abi: ERC20, functionName: 'decimals' }).catch(() => 18),
      ])
      rewards.push({ protocol: 'Aave V3', img: 'aave-v3', token: sym, amount: Number(formatUnits(amounts[i], dec)) })
    }
    return rewards
  } catch { return [] }
}
