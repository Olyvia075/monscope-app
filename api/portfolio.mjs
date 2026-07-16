import { getPortfolio } from '../lib/portfolio.mjs'

export default async function handler(req, res) {
  const address = (req.query?.address || '').trim()
  res.setHeader('Content-Type', 'application/json')
  // read-the-chain-for-truth: short cache so numbers stay live but scrapes stay cheap
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  try {
    const data = await getPortfolio(address)
    data.asOf = Date.now()
    res.status(200).end(JSON.stringify(data))
  } catch (e) {
    res.status(e.message === 'Not a valid address' ? 400 : 502)
       .end(JSON.stringify({ error: e.message || 'read failed' }))
  }
}
