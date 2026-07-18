// Deploy MonScopeLens to Monad.
//
//   node scripts/deploy.mjs testnet     # chain 10143, free faucet MON
//   node scripts/deploy.mjs mainnet     # chain 143, real MON
//
// Signing key comes from PRIVATE_KEY in the environment (put it in .env.local,
// which is gitignored). This script never prints the key. After deploy it runs
// one `attest` call as a live smoke test and writes the address to
// contracts/deployed.json for the app to read.
import { readFileSync, writeFileSync } from 'node:fs'
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monad, monadTestnet } from 'viem/chains'

const net = (process.argv[2] || 'testnet').toLowerCase()
const chain = net === 'mainnet' ? monad : monadTestnet
const explorer = net === 'mainnet' ? 'https://monadscan.com' : 'https://testnet.monadscan.com'

const pk = process.env.PRIVATE_KEY
if (!pk) { console.error('Set PRIVATE_KEY in the environment (.env.local). Never commit it.'); process.exit(1) }
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk)

const artifact = JSON.parse(readFileSync(new URL('../contracts/out/MonScopeLens.json', import.meta.url)))
const transport = http(chain.rpcUrls.default.http[0])
const wallet = createWalletClient({ account, chain, transport })
const pub = createPublicClient({ chain, transport })

console.log(`Deployer:  ${account.address}`)
const bal = await pub.getBalance({ address: account.address })
console.log(`Balance:   ${Number(bal) / 1e18} MON on ${chain.name} (${chain.id})`)
if (bal === 0n) { console.error('Deployer has 0 MON. Fund it first.'); process.exit(1) }

console.log('Deploying MonScopeLens...')
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode })
console.log(`  tx: ${explorer}/tx/${hash}`)
const rcpt = await pub.waitForTransactionReceipt({ hash })
const address = rcpt.contractAddress
console.log(`Deployed:  ${address}`)
console.log(`Explorer:  ${explorer}/address/${address}`)

// live smoke test: one attest, then read the counter back
console.log('Smoke test: attest(self)...')
const at = await wallet.writeContract({ address, abi: artifact.abi, functionName: 'attest', args: [account.address] })
await pub.waitForTransactionReceipt({ hash: at })
const total = await pub.readContract({ address, abi: artifact.abi, functionName: 'totalScans' })
console.log(`  totalScans now: ${total}`)

writeFileSync(
  new URL('../contracts/deployed.json', import.meta.url),
  JSON.stringify({ network: net, chainId: chain.id, address, explorer: `${explorer}/address/${address}`, deployedTx: hash }, null, 2)
)
console.log('Wrote contracts/deployed.json')
