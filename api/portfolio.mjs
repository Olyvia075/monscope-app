import { getPortfolio } from '../lib/portfolio.mjs'
import { getPositions } from '../lib/positions.mjs'
import { getActivity } from '../lib/activity.mjs'
import { getGas } from '../lib/gas.mjs'
import { getNfts } from '../lib/nfts.mjs'
import { getRewards } from '../lib/rewards.mjs'

export default async function handler(req, res) {
  const address = (req.query?.address || '').trim()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  try {
    const [portfolio, positions, activity, gas, nfts, rewards] = await Promise.all([
      getPortfolio(address),
      getPositions(address).catch(() => []),
      getActivity(address).catch(() => []),
      getGas(address).catch(() => null),
      getNfts(address).catch(() => []),
      getRewards(address).catch(() => []),
    ])
    // net worth includes DeFi position net value, read live
    const positionsNet = positions.reduce((s, p) => s + (p.netUsd || 0), 0)
    res.status(200).end(JSON.stringify({
      ...portfolio,
      positions,
      activity,
      netWorth: portfolio.netWorth + positionsNet,
      tokensNetWorth: portfolio.netWorth,
      gas,
      nfts,
      rewards,
      asOf: Date.now(),
    }))
  } catch (e) {
    res.status(e.message === 'Not a valid address' ? 400 : 502)
       .end(JSON.stringify({ error: e.message || 'read failed' }))
  }
}
