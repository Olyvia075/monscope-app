// Proves the compiled MonScopeLens works against REAL Monad state without
// deploying: eth_call with a `code` state-override runs the contract's runtime
// bytecode at a scratch address, then we cross-check its output against direct
// balanceOf / allowance reads.
import { readFileSync } from 'node:fs'
import { encodeFunctionData, decodeFunctionResult, getAddress } from 'viem'
import { makeClient } from '../lib/chain.mjs'
import { TOKENS } from '../lib/tokens.mjs'

const artifact = JSON.parse(readFileSync(new URL('../contracts/out/MonScopeLens.json', import.meta.url)))
const client = makeClient()

const owner = getAddress(process.argv[2] || '0x8D5cCD5275141De22650D9570f4f56DB87807425')
const tokens = TOKENS.slice(0, 6).map((t) => getAddress(t.address))
const spender = getAddress('0x754704bc059f8c67012fed69bc8a327a5aafb603') // USDC, an arbitrary spender to probe
const spenders = tokens.map(() => spender)
const LENS = getAddress('0x000000000000000000000000000000000000a1e5') // scratch address for the override

const data = encodeFunctionData({ abi: artifact.abi, functionName: 'scan', args: [owner, tokens, spenders] })
const res = await client.call({
  to: LENS,
  data,
  stateOverride: [{ address: LENS, code: artifact.deployedBytecode }],
})
const snap = decodeFunctionResult({ abi: artifact.abi, functionName: 'scan', data: res.data })

// Ground truth via direct reads
const nativeTruth = await client.getBalance({ address: owner })
console.log('native  lens:', snap.nativeBalance.toString(), ' direct:', nativeTruth.toString(),
  snap.nativeBalance === nativeTruth ? 'OK' : 'MISMATCH')

let pass = snap.nativeBalance === nativeTruth
for (let i = 0; i < tokens.length; i++) {
  const bal = await client.readContract({
    address: tokens[i], abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
    functionName: 'balanceOf', args: [owner],
  }).catch(() => 0n)
  const ok = snap.balances[i] === bal
  pass = pass && ok
  console.log(`${TOKENS[i].symbol.padEnd(6)} lens:`, snap.balances[i].toString().padEnd(24), 'direct:', bal.toString().padEnd(24), ok ? 'OK' : 'MISMATCH')
}
console.log('\nallowances (owner -> USDC):', snap.allowances.map((a) => a.toString()))
console.log(pass ? '\nPASS: lens output matches chain state' : '\nFAIL')
process.exit(pass ? 0 : 1)
