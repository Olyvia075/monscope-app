import { getPortfolio } from './portfolio.mjs'
import { getPositions } from './positions.mjs'
import { getActivity } from './activity.mjs'
import { getGas } from './gas.mjs'
import { getNfts } from './nfts.mjs'
import { getRewards } from './rewards.mjs'
import { getApprovals } from './approvals.mjs'

// Single source of truth for a wallet report. Both the Netlify function and the
// local dev server call this, so the shape can never drift between them (an
// earlier divergence between two hand-maintained handlers caused a real bug).
export async function buildReport(address) {
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
    known: approvals.filter(x => x.risk === 'known').length,
    unverified: approvals.filter(x => x.risk === 'unverified').length,
    scamApprovals: approvals.filter(x => x.flaggedScam).length,
    scamActivity: (activity || []).filter(x => x.flaggedScam).length,
    scanned: approvalsRes.scanned,
  }
  const positionsNet = positions.reduce((s, p) => s + (p.netUsd || 0), 0)
  return {
    ...portfolio,
    positions,
    activity,
    netWorth: portfolio.netWorth + positionsNet, // includes live DeFi net value
    tokensNetWorth: portfolio.netWorth,
    gas,
    nfts,
    rewards,
    approvals,
    security,
    asOf: Date.now(),
  }
}
