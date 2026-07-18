import solc from 'solc'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'contracts/MonScopeLens.sol'), 'utf8')

const input = {
  language: 'Solidity',
  sources: { 'MonScopeLens.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun', // Monad targets a Cancun-equivalent EVM
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
}

const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errs = (out.errors || []).filter((e) => e.severity === 'error')
for (const e of out.errors || []) console.log(e.formattedMessage)
if (errs.length) { console.error('COMPILE FAILED'); process.exit(1) }

const c = out.contracts['MonScopeLens.sol']['MonScopeLens']
mkdirSync(join(root, 'contracts/out'), { recursive: true })
writeFileSync(
  join(root, 'contracts/out/MonScopeLens.json'),
  JSON.stringify({
    abi: c.abi,
    bytecode: '0x' + c.evm.bytecode.object,
    deployedBytecode: '0x' + c.evm.deployedBytecode.object,
  }, null, 2)
)
console.log('OK  bytecode bytes:', c.evm.bytecode.object.length / 2, ' abi entries:', c.abi.length)
