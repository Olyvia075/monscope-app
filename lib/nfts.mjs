import { esQuery, hasKey } from './etherscan.mjs'
import { parseAbiItem, parseAbi, getAddress } from 'viem'
import { makeClient } from './chain.mjs'

const ERC721_TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')
const ERC721 = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function name() view returns (string)',
])

// NFT holdings on Monad, read from chain.
//
// Primary path (with an Etherscan key): the wallet's full ERC-721 transfer
// history via `tokennfttx`, netted to what it currently holds, then each token's
// ownership re-checked on-chain with ownerOf. This finds every NFT the wallet
// owns regardless of when it was minted/received — the old getLogs-window scan
// only saw the last ~4000 blocks, which is why long-held NFTs showed as zero.
//
// Fallback (no key): the recent getLogs window, so a keyless deploy still shows
// something real rather than nothing.
export async function getNfts(address) {
  const client = makeClient()
  const a = getAddress(address)
  const al = a.toLowerCase()

  const held = await fromHistory(client, a, al).catch(() => null)
  if (held) return held
  return fromLogs(client, a, al)
}

async function fromHistory(client, a, al) {
  if (!hasKey()) return null

  // pull full ERC-721 transfer history
  const rows = []
  for (let page = 1; page <= 3; page++) {
    const batch = await esQuery({
      module: 'account', action: 'tokennfttx', address: a,
      startblock: '0', endblock: '99999999', page: String(page), offset: '1000', sort: 'asc',
    })
    rows.push(...batch)
    if (batch.length < 1000) break
  }

  // net current holdings: last transfer for each (contract, tokenId) decides
  const owned = new Map()
  for (const t of rows) {
    const cKey = (t.contractAddress + '-' + t.tokenID).toLowerCase()
    if ((t.to || '').toLowerCase() === al) {
      owned.set(cKey, { contract: getAddress(t.contractAddress), tokenId: BigInt(t.tokenID), name: t.tokenName, symbol: t.tokenSymbol })
    } else if ((t.from || '').toLowerCase() === al) {
      owned.delete(cKey)
    }
  }

  // verify each is still held (ownerOf) — batched via the client's multicall
  const candidates = [...owned.values()].slice(0, 60)
  const checks = await Promise.all(candidates.map(c =>
    client.readContract({ address: c.contract, abi: ERC721, functionName: 'ownerOf', args: [c.tokenId] })
      .then(o => (o.toLowerCase() === al ? c : null))
      .catch(() => c) // if ownerOf reverts (e.g. non-standard), trust the netted history
  ))

  return checks.filter(Boolean).map(c => ({
    collection: c.name || c.symbol || 'Unknown collection',
    tokenId: c.tokenId.toString(),
    contract: c.contract,
  })).slice(0, 48)
}

async function fromLogs(client, a, al, windowBlocks = 4000n) {
  const latest = await client.getBlockNumber()
  const logs = await client.getLogs({
    event: ERC721_TRANSFER, args: { to: a },
    fromBlock: latest - windowBlocks, toBlock: latest,
  }).catch(() => [])

  const seen = new Set(), candidates = []
  for (let i = logs.length - 1; i >= 0; i--) {
    const l = logs[i]
    const k = l.address.toLowerCase() + '-' + l.args.tokenId
    if (seen.has(k)) continue
    seen.add(k)
    candidates.push({ contract: l.address, tokenId: l.args.tokenId })
    if (candidates.length >= 24) break
  }

  const held = []
  const nameCache = new Map()
  for (const c of candidates) {
    try {
      const owner = await client.readContract({ address: c.contract, abi: ERC721, functionName: 'ownerOf', args: [c.tokenId] })
      if (owner.toLowerCase() !== al) continue
      let name = nameCache.get(c.contract.toLowerCase())
      if (name === undefined) {
        name = await client.readContract({ address: c.contract, abi: ERC721, functionName: 'name' }).catch(() => null)
        nameCache.set(c.contract.toLowerCase(), name)
      }
      held.push({ collection: name || 'Unknown collection', tokenId: c.tokenId.toString(), contract: c.contract })
    } catch { /* not ERC-721 / read failed */ }
  }
  return held
}
