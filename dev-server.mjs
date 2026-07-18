import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { buildReport } from './lib/report.mjs'
import { resolveImages } from './lib/nftmeta.mjs'
import { getPositions } from './lib/positions.mjs'

// Local mirror of the Netlify function, same shared assembly (lib/report.mjs).
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/api/portfolio') {
    res.setHeader('Content-Type', 'application/json')
    try {
      const report = await buildReport((url.searchParams.get('address') || '').trim())
      res.statusCode = 200
      res.end(JSON.stringify(report))
    } catch (e) {
      res.statusCode = e.message === 'Not a valid address' ? 400 : 502
      res.end(JSON.stringify({ error: e.message || 'read failed' }))
    }
    return
  }
  if (url.pathname === '/api/positions') {
    res.setHeader('Content-Type', 'application/json')
    try {
      const positions = await getPositions((url.searchParams.get('address') || '').trim())
      const positionsNet = positions.reduce((s, p) => s + (p.netUsd || 0), 0)
      const accounted = positions
        .filter(p => typeof p.netUsd === 'number' && p.receiptTokens)
        .flatMap(p => p.receiptTokens)
      res.statusCode = 200
      res.end(JSON.stringify({ positions, positionsNet, accounted }))
    } catch (e) {
      res.statusCode = e.message === 'Not a valid address' ? 400 : 502
      res.end(JSON.stringify({ error: e.message || 'read failed' }))
    }
    return
  }
  if (url.pathname === '/api/nft-images' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json')
    try {
      const body = await new Promise((resolve, reject) => {
        let s = ''
        req.on('data', c => { s += c }).on('end', () => resolve(s)).on('error', reject)
      })
      const { items } = JSON.parse(body || '{}')
      const images = await resolveImages(Array.isArray(items) ? items : [])
      res.statusCode = 200
      res.end(JSON.stringify({ images }))
    } catch (e) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: e.message || 'image read failed' }))
    }
    return
  }
  try {
    const path = url.pathname === '/' ? '/public/index.html' : (url.pathname.startsWith('/public') ? url.pathname : '/public' + url.pathname)
    const body = await readFile('.' + path)
    res.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : 'application/octet-stream')
    res.end(body)
  } catch { res.statusCode = 404; res.end('not found') }
})
server.listen(8877, () => console.log('dev on http://localhost:8877'))
