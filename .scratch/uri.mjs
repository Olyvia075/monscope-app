import { parseAbi, getAddress } from 'viem'
const { makeClient } = await import('/Users/user/monscope-app/lib/chain.mjs')
const { getNfts } = await import('/Users/user/monscope-app/lib/nfts.mjs')
const c = makeClient()
const ABI = parseAbi(['function tokenURI(uint256) view returns (string)'])
const nfts = await getNfts('0x8D5cCD5275141De22650D9570f4f56DB87807425')
console.log('held:', nfts.length)
const uniq = [...new Map(nfts.map(n => [n.contract, n])).values()]
console.log('distinct collections:', uniq.length)
for (const n of uniq) {
  try {
    const u = await c.readContract({ address: n.contract, abi: ABI, functionName: 'tokenURI', args: [BigInt(n.tokenId)] })
    console.log((n.collection||'?').padEnd(22), '|', u.slice(0, 110))
  } catch (e) { console.log((n.collection||'?').padEnd(22), '| tokenURI FAILED:', (e.shortMessage||e.message).slice(0,60)) }
}
