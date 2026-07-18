const tests = {
  'Meowwnads': 'bafybeicf2u2qdetj6ri3g6rgujbg24qp3nvllgu7gid6dmuodvd4alpmoq/83.json',
  'Spiky':     'bafybeice6toeyaq73anm4vybm362566rlnuzo6bjukemu7e65pnydcueeq/310.json',
}
const gws = ['https://ipfs.io/ipfs/','https://cloudflare-ipfs.com/ipfs/','https://dweb.link/ipfs/','https://gateway.pinata.cloud/ipfs/','https://nftstorage.link/ipfs/','https://4everland.io/ipfs/']
for (const [n,p] of Object.entries(tests)) {
  for (const g of gws) {
    const s = Date.now(); const ac = new AbortController(); const t = setTimeout(()=>ac.abort(), 6000)
    try { const r = await fetch(g+p, {signal:ac.signal}); console.log(n.padEnd(11), g.padEnd(38), r.status, (Date.now()-s)+'ms') }
    catch(e){ console.log(n.padEnd(11), g.padEnd(38), 'FAIL', (Date.now()-s)+'ms', e.name) }
    finally { clearTimeout(t) }
  }
}
// direct https ones
for (const u of ['https://bafybeidwxneyck3rf6sernas7hjtgmhwnbwxxffsgqxmbfbx5miyiidvzi.ipfs.w3s.link/450.json','https://alert-gold-tern.myfilebase.com/ipfs/QmUJesyUv4jtZWnJH4x19t7vv7X7AcL7yJ4MhfuUNiZFDJ/447']) {
  const s=Date.now(); try { const r = await fetch(u); console.log('direct'.padEnd(11), u.slice(0,50).padEnd(38), r.status, (Date.now()-s)+'ms') } catch(e){ console.log('direct FAIL', u.slice(0,50), e.name) }
}
