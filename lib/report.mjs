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

// Serverless functions get roughly 10s. A very active wallet can outrun that on
// one slow section and previously took the whole request down as "read failed".
// Each optional section now falls back to its empty value at the deadline, so a
// slow wallet returns a partial report (flagged below) instead of an error.
const SECTION_DEADLINE_MS = 6500

function withDeadline(promise, fallback) {
  let timer
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true, value: fallback }), SECTION_DEADLINE_MS)
    timer.unref?.()
  })
  return Promise.race([
    promise.then(value => ({ timedOut: false, value })).catch(() => ({ timedOut: false, value: fallback })),
    timeout,
  ]).finally(() => clearTimeout(timer))
}

export async function buildReport(address) {
  // portfolio is the core of the report; if it fails there is nothing to show.
  // Everything is kicked off together so the sections run concurrently with it.
  const portfolioPromise = getPortfolio(address)
  const sectionsPromise = Promise.all([
    withDeadline(getPositions(address), []),
    withDeadline(getActivity(address), []),
    withDeadline(getGas(address), null),
    withDeadline(getNfts(address), []),
    withDeadline(getRewards(address), []),
    withDeadline(getApprovals(address), { approvals: [], scanned: false }),
  ])
  const [portfolio, sections] = await Promise.all([portfolioPromise, sectionsPromise])
  const [positions, activity, gas, nfts, rewards, approvalsRes] = sections.map(s => s.value)
  const incomplete = sections.some(s => s.timedOut)
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
    incomplete, // true when a section hit its deadline; the report is partial
    asOf: Date.now(),
  }
}
