import { getPortfolio } from '../../lib/portfolio.mjs'
import { getPositions } from '../../lib/positions.mjs'
import { getActivity } from '../../lib/activity.mjs'
import { getGas } from '../../lib/gas.mjs'
import { getNfts } from '../../lib/nfts.mjs'
import { getRewards } from '../../lib/rewards.mjs'
import { getApprovals } from '../../lib/approvals.mjs'

export default async (req) => {
  const address = (new URL(req.url).searchParams.get('address') || '').trim()
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' }
  try {
    const [portfolio, positions, activity, gas, nfts, rewards, approvalsRes] = await Promise.all([
      getPortfolio(address),
      getPositions(address).catch(() => []),
      getActivity(address).catch(() => []),
      getGas(address).catch(() => null),
      getNfts(address).catch(() => []),
      getRewards(address).catch(() => []),
      getApprovals(address).catch(() => ({ approvals: [], scanned: false })),
    ])
    const approvals = approvalsRes.approvals || []
    const security = {
      approvals: approvals.length,
      unlimited: approvals.filter(x => x.unlimited).length,
      scamApprovals: approvals.filter(x => x.flaggedScam).length,
      scamActivity: (activity || []).filter(x => x.flaggedScam).length,
      scanned: approvalsRes.scanned,
    }
    const positionsNet = positions.reduce((s, p) => s + (p.netUsd || 0), 0)
    return new Response(JSON.stringify({
      ...portfolio, positions, activity, gas, nfts, rewards, approvals, security,
      netWorth: portfolio.netWorth + positionsNet,
      tokensNetWorth: portfolio.netWorth,
      asOf: Date.now(),
    }), { status: 200, headers })
  } catch (e) {
    const status = e.message === 'Not a valid address' ? 400 : 502
    return new Response(JSON.stringify({ error: e.message || 'read failed' }), { status, headers })
  }
}

export const config = { path: '/api/portfolio' }
