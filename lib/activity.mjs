import { parseAbiItem, getAddress, formatUnits, pad } from 'viem'
import { makeClient } from './chain.mjs'
import { TOKENS } from './tokens.mjs'

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const META = new Map(TOKENS.map(t => [t.address.toLowerCase(), t]))

// Recent ERC-20 movements involving the address, any token, read straight from
// logs (no indexer). One window keeps it within the getLogs block cap.
export async function getActivity(address, windowBlocks = 900n) {
  const client = makeClient()
  const latest = await client.getBlockNumber()
  const fromBlock = latest - windowBlocks
  const a = getAddress(address)
  const topicAddr = pad(a.toLowerCase())

  const [out, incoming] = await Promise.all([
    client.getLogs({ event: TRANSFER, args: { from: a }, fromBlock, toBlock: latest }),
    client.getLogs({ event: TRANSFER, args: { to: a }, fromBlock, toBlock: latest }),
  ])

  const rows = []
  for (const [dir, logs] of [['out', out], ['in', incoming]]) {
    for (const l of logs) {
      const meta = META.get(l.address.toLowerCase())
      if (!meta) continue // unknown token: skip to avoid spam noise
      const amt = Number(formatUnits(l.args.value, meta.decimals))
      if (amt <= 1e-9) continue
      rows.push({
        dir, symbol: meta.symbol, img: meta.symbol,
        amount: amt, block: Number(l.blockNumber),
        counterparty: dir === 'out' ? l.args.to : l.args.from,
        tx: l.transactionHash,
      })
    }
  }
  rows.sort((x, y) => y.block - x.block)
  return rows.slice(0, 25)
}
