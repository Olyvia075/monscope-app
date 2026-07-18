const { getNfts } = await import('/Users/user/monscope-app/lib/nfts.mjs')
const { resolveImages } = await import('/Users/user/monscope-app/lib/nftmeta.mjs')
const nfts = await getNfts('0x8D5cCD5275141De22650D9570f4f56DB87807425')
let s = Date.now()
const imgs = await resolveImages(nfts)
console.log('cold', Date.now()-s, 'ms')
let ok=0
for (const n of nfts) {
  const u = imgs[n.contract.toLowerCase()+'-'+n.tokenId]
  if (u) ok++
  console.log((n.collection||'?').slice(0,18).padEnd(19), (u||'NO IMAGE').slice(0,88))
}
console.log('\nresolved', ok+'/'+nfts.length)
s = Date.now(); await resolveImages(nfts); console.log('warm', Date.now()-s, 'ms')
