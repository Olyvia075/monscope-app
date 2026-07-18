import { parseAbi, getAddress, formatUnits } from 'viem'
const { makeClient } = await import('/Users/user/monscope-app/lib/chain.mjs')
const A = getAddress('0x8D5cCD5275141De22650D9570f4f56DB87807425')
const c = makeClient()
const POOL = '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef'
console.log('pool has code?', ((await c.getBytecode({address: POOL})) || '0x').length > 2)
const ABI = parseAbi(['function getUserAccountData(address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'])
try {
  const d = await c.readContract({ address: POOL, abi: ABI, functionName: 'getUserAccountData', args: [A] })
  console.log('collateralBase', formatUnits(d[0],8), 'debtBase', formatUnits(d[1],8), 'hf', d[5].toString())
} catch (e) { console.log('READ FAILED:', e.shortMessage || e.message) }
const { getPositions } = await import('/Users/user/monscope-app/lib/positions.mjs')
console.log('getPositions ->', JSON.stringify(await getPositions(A)))
