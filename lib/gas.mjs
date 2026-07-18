import { getAddress, formatEther } from 'viem'
import { makeClient } from './chain.mjs'
import { getTxList } from './txlist.mjs'

// "Gas spent on Monad so far."
//
// Empirically verified on Monad: receipt.gasUsed always equals the tx gas_limit,
// so gasUsed * effectiveGasPrice already IS the true charge (there is no hidden
// overpay vs what explorers report — a claim we tested and discarded).
//
// Lifetime tx count is free (the account nonce). The lifetime gas total needs the
// wallet's full tx history (shared via txlist.mjs). With no key we still show the
// real tx count.
//
// Account type: a wallet can carry bytecode and still be a normal gas-paying EOA.
// EIP-7702 delegated accounts store a `0xef0100 || impl` designator as their code
// — these are smart-account EOAs, they sign and pay gas like any wallet. Only real
// deployed contracts (any other bytecode) don't originate txs / pay gas.
const EIP7702_PREFIX = '0xef0100'

export async function getGas(address) {
  const client = makeClient()
  const a = getAddress(address)

  const [txCount, code, txs] = await Promise.all([
    client.getTransactionCount({ address: a }).catch(() => null),
    client.getBytecode({ address: a }).catch(() => null),
    getTxList(a),
  ])

  const hasCode = !!(code && code.length > 2)
  const isDelegated = hasCode && code.toLowerCase().startsWith(EIP7702_PREFIX)
  const isContract = hasCode && !isDelegated // a plain deployed contract does not pay gas

  let gasSpentMon = null, counted = 0
  if (txs.length) {
    let totalWei = 0n
    for (const tx of txs) {
      if (tx.from?.toLowerCase() !== a.toLowerCase()) continue // only gas the wallet paid
      totalWei += BigInt(tx.gasUsed || '0') * BigInt(tx.gasPrice || '0')
      counted++
    }
    gasSpentMon = Number(formatEther(totalWei))
  }

  if (txCount == null) return null
  return { txCount, gasSpentMon, countedTxs: counted, isContract, isDelegated }
}
