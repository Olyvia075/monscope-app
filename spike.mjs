import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import { monad } from 'viem/chains'

const client = createPublicClient({
  chain: monad,
  transport: http('https://rpc1.monad.xyz'), // Alchemy: 1000-block getLogs cap
  batch: { multicall: true },
})

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
])

// canonical Monad tokens (verified on-chain earlier)
const TOKENS = {
  WMON:  '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
  USDC:  '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
  USDT0: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d',
}

const addr = process.argv[2] || '0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e'
console.log('reading', addr, 'on chain', await client.getChainId())

// 1. native MON
const mon = await client.getBalance({ address: addr })
console.log('MON (native):', formatUnits(mon, 18))

// 2. ERC-20 balances + metadata via multicall (one round trip)
const calls = []
for (const [sym, token] of Object.entries(TOKENS)) {
  calls.push({ address: token, abi: ERC20, functionName: 'balanceOf', args: [addr] })
  calls.push({ address: token, abi: ERC20, functionName: 'decimals' })
  calls.push({ address: token, abi: ERC20, functionName: 'symbol' })
}
const t0 = Date.now()
const res = await client.multicall({ contracts: calls, allowFailure: true })
console.log(`multicall: ${calls.length} calls in ${Date.now()-t0}ms`)

let i = 0
for (const sym of Object.keys(TOKENS)) {
  const [bal, dec, symbol] = [res[i++], res[i++], res[i++]]
  if (bal.status === 'success') {
    console.log(`${symbol.result || sym}:`, formatUnits(bal.result, dec.result))
  } else {
    console.log(sym, 'read failed:', bal.error?.shortMessage)
  }
}
