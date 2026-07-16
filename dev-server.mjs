import { createServer } from 'http'
import { readFile } from 'fs/promises'
import handler from './api/portfolio.mjs'

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/api/portfolio') {
    req.query = Object.fromEntries(url.searchParams)
    res.status = (c) => { res.statusCode = c; return res }
    return handler(req, res)
  }
  try {
    const path = url.pathname === '/' ? '/public/index.html' : (url.pathname.startsWith('/public') ? url.pathname : '/public' + url.pathname)
    const body = await readFile('.' + path)
    res.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : 'application/octet-stream')
    res.end(body)
  } catch { res.statusCode = 404; res.end('not found') }
})
server.listen(8877, () => console.log('dev on http://localhost:8877'))
