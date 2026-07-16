import { parseAbiItem, parseAbi, getAddress } from 'viem'
import { makeClient } from './chain.mjs'

const ERC721_TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')
const ERC721 = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function name() view returns (string)',
])

// NFT holdings, read straight from chain: discover via ERC-721 Transfer logs to the
// wallet, then verify the wallet is still the owner. No indexer, no API key. Bounded
// to a recent window (older holdings need an indexer, noted honestly in the UI).
export async function getNfts(address, windowBlocks = 4000n) {
  const client = makeClient()
  const a = getAddress(address)
  const latest = await client.getBlockNumber()

  const logs = await client.getLogs({
    event: ERC721_TRANSFER, args: { to: a },
    fromBlock: latest - windowBlocks, toBlock: latest,
  })

  // unique (contract, tokenId), most recent first
  const seen = new Set(), candidates = []
  for (let i = logs.length - 1; i >= 0; i--) {
    const l = logs[i]
    const key = l.address.toLowerCase() + '-' + l.args.tokenId
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ contract: l.address, tokenId: l.args.tokenId })
    if (candidates.length >= 24) break
  }

  const held = []
  const nameCache = new Map()
  for (const c of candidates) {
    try {
      const owner = await client.readContract({ address: c.contract, abi: ERC721, functionName: 'ownerOf', args: [c.tokenId] })
      if (owner.toLowerCase() !== a.toLowerCase()) continue // sold/transferred on
      let name = nameCache.get(c.contract.toLowerCase())
      if (name === undefined) {
        name = await client.readContract({ address: c.contract, abi: ERC721, functionName: 'name' }).catch(() => null)
        nameCache.set(c.contract.toLowerCase(), name)
      }
      held.push({ collection: name || 'Unknown collection', tokenId: c.tokenId.toString(), contract: c.contract })
    } catch { /* not an ERC-721 / read failed: skip */ }
  }
  return held
}
