import { parseAbiItem, getAddress, formatUnits, formatEther, pad } from 'viem'
import { makeClient } from './chain.mjs'
import { TOKENS } from './tokens.mjs'
import { loadScamSet } from './scamlist.mjs'
import { getTxList } from './txlist.mjs'

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const META = new Map(TOKENS.map(t => [t.address.toLowerCase(), t]))

// Recent wallet activity. Two complementary sources, merged and de-duped by tx
// hash so the feed can never say "0 activity" while gas shows dozens of txs:
//
//  1. Full transaction history (txlist.mjs) — the same source gas uses. Gives
//     every native MON transfer and contract call across the wallet's lifetime.
//  2. ERC-20 Transfer logs in a recent window — adds token symbol/amount detail
//     that the raw tx list does not carry.
//
// Counterparties are checked against the scam blacklist either way.
export async function getActivity(address, windowBlocks = 900n) {
  const client = makeClient()
  const a = getAddress(address)
  const al = a.toLowerCase()

  const [txs, scam, logs] = await Promise.all([
    getTxList(a),
    loadScamSet(),
    (async () => {
      const latest = await client.getBlockNumber()
      const fromBlock = latest - windowBlocks
      const [out, incoming] = await Promise.all([
        client.getLogs({ event: TRANSFER, args: { from: a }, fromBlock, toBlock: latest }).catch(() => []),
        client.getLogs({ event: TRANSFER, args: { to: a }, fromBlock, toBlock: latest }).catch(() => []),
      ])
      return { out, incoming }
    })().catch(() => ({ out: [], incoming: [] })),
  ])

  // Token detail keyed by tx hash, so a native tx that also moved a known token
  // gets labelled with the token instead of raw MON.
  const tokenByTx = new Map()
  for (const [dir, ls] of [['out', logs.out], ['in', logs.incoming]]) {
    for (const l of ls) {
      const meta = META.get(l.address.toLowerCase())
      if (!meta) continue
      const amt = Number(formatUnits(l.args.value, meta.decimals))
      if (amt <= 1e-9) continue
      tokenByTx.set(l.transactionHash?.toLowerCase(), {
        dir, symbol: meta.symbol, img: meta.symbol, amount: amt,
        counterparty: dir === 'out' ? l.args.to : l.args.from,
      })
    }
  }

  const rows = []
  const seen = new Set()

  for (const tx of txs) {
    const hash = tx.hash?.toLowerCase()
    if (!hash || seen.has(hash)) continue
    seen.add(hash)
    const from = (tx.from || '').toLowerCase()
    const to = (tx.to || '').toLowerCase()
    const outgoing = from === al
    const counterparty = outgoing ? (tx.to || '') : (tx.from || '')
    const token = tokenByTx.get(hash)
    let kind, symbol, img, amount
    if (token) {
      kind = token.dir === 'out' ? 'send' : 'receive'
      symbol = token.symbol; img = token.img; amount = token.amount
    } else if (!tx.to) {
      kind = 'deploy'; symbol = null; img = 'contract'; amount = 0
    } else {
      const native = Number(formatEther(BigInt(tx.value || '0')))
      const isCall = (tx.input && tx.input !== '0x') || (tx.functionName && tx.functionName !== '')
      if (native > 1e-9) { kind = outgoing ? 'send' : 'receive'; symbol = 'MON'; img = 'MON'; amount = native }
      else { kind = 'contract'; symbol = null; img = 'contract'; amount = 0 }
      if (isCall && native <= 1e-9) kind = 'contract'
    }
    rows.push({
      dir: outgoing ? 'out' : 'in', kind, symbol, img, amount,
      block: Number(tx.blockNumber || 0),
      ts: tx.timeStamp ? Number(tx.timeStamp) * 1000 : null,
      counterparty,
      method: tx.functionName ? tx.functionName.split('(')[0] : null,
      failed: tx.isError === '1',
      flaggedScam: scam.has((counterparty || '').toLowerCase()),
      tx: tx.hash,
    })
  }

  // Fallback for keyless environments (no txlist): use the ERC-20 logs alone so
  // the feed still shows something real rather than empty.
  if (!rows.length) {
    for (const [dir, ls] of [['out', logs.out], ['in', logs.incoming]]) {
      for (const l of ls) {
        const meta = META.get(l.address.toLowerCase())
        if (!meta) continue
        const amt = Number(formatUnits(l.args.value, meta.decimals))
        if (amt <= 1e-9) continue
        const cp = dir === 'out' ? l.args.to : l.args.from
        rows.push({
          dir, kind: dir === 'out' ? 'send' : 'receive', symbol: meta.symbol, img: meta.symbol,
          amount: amt, block: Number(l.blockNumber), ts: null, counterparty: cp,
          method: null, failed: false,
          flaggedScam: scam.has((cp || '').toLowerCase()), tx: l.transactionHash,
        })
      }
    }
  }

  rows.sort((x, y) => y.block - x.block)
  return rows.slice(0, 25)
}
