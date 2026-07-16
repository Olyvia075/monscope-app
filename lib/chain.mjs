import { createPublicClient, http, parseAbi } from 'viem'
import { monad } from 'viem/chains'

// Two providers, failover. rpc1 (Alchemy) has the widest getLogs cap; rpc3 (Ankr)
// backs it up. We only do balance reads here, so either is fine.
const RPCS = ['https://rpc1.monad.xyz', 'https://rpc3.monad.xyz', 'https://rpc.monad.xyz']

export function makeClient(i = 0) {
  return createPublicClient({
    chain: monad,
    transport: http(RPCS[i % RPCS.length]),
    batch: { multicall: { wait: 16 } },
  })
}

export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

export const NATIVE = '0x0000000000000000000000000000000000000000'
