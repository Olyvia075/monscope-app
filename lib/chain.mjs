import { createPublicClient, http, fallback, parseAbi } from 'viem'
import { monad } from 'viem/chains'

// Never single-source the chain. Fallback across providers with retries so a 429 on
// one RPC transparently rolls to the next. rpc1 (Alchemy) first for its wide getLogs cap.
const RPCS = ['https://rpc1.monad.xyz', 'https://rpc3.monad.xyz', 'https://rpc.monad.xyz', 'https://rpc2.monad.xyz']

export function makeClient() {
  return createPublicClient({
    chain: monad,
    transport: fallback(
      RPCS.map(url => http(url, { retryCount: 2, retryDelay: 400, timeout: 12000 })),
      { rank: false },
    ),
    batch: { multicall: { wait: 16 } },
  })
}

export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])
export const NATIVE = '0x0000000000000000000000000000000000000000'
