import { getPortfolio } from './portfolio.mjs'
import { getActivity } from './activity.mjs'
import { getGas } from './gas.mjs'
import { getNfts } from './nfts.mjs'
import { getRewards } from './rewards.mjs'
import { getApprovals } from './approvals.mjs'
import { getTxList } from './txlist.mjs'
import { discoverTokens } from './tokenlist.mjs'

// Single source of truth for a wallet report. Both the Netlify function and the
// local dev server call this, so the shape can never drift between them (an
// earlier divergence between two hand-maintained handlers caused a real bug).

// Serverless functions get roughly 10s. A very active wallet can outrun that on
// one slow section and previously took the whole request down as "read failed".
// Each optional section now falls back to its empty value at the deadline, so a
// slow wallet returns a partial report (flagged below) instead of an error.
const SECTION_DEADLINE_MS = 6500
function withDeadline(promise, fallback, ms = SECTION_DEADLINE_MS) {
  let timer
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true, value: fallback }), ms)
    timer.unref?.()
  })
  return Promise.race([
    promise.then(value => ({ timedOut: false, value })).catch(() => ({ timedOut: false, value: fallback })),
    timeout,
  ]).finally(() => clearTimeout(timer))
}

export async function buildReport(address) {
  // Start the two shared Etherscan reads first so they take the front of the
  // rate-gated queue instead of landing behind the NFT and approvals traffic
  // (positions was blowing its deadline waiting on a token list that only takes
  // a second on its own).
  //
  // Kicked off but deliberately NOT awaited: the point is queue position, not
  // the result. Both are promise-cached, so every section that needs them joins
  // the same in-flight request instead of queueing a fresh one behind the NFT
  // and approvals traffic. Awaiting here just added their latency to the total.
  getTxList(address).catch(() => [])
  discoverTokens(address).catch(() => [])

  // portfolio is the core of the report; if it fails there is nothing to show.
  // Everything is kicked off together so the sections run concurrently with it.
  const portfolioPromise = getPortfolio(address)
  const sectionsPromise = Promise.all([
    withDeadline(getActivity(address), []),
    withDeadline(getGas(address), null),
    withDeadline(getNfts(address), []),
    withDeadline(getRewards(address), []),
    withDeadline(getApprovals(address), { approvals: [], scanned: false }),
  ])
  const [portfolio, sections] = await Promise.all([portfolioPromise, sectionsPromise])
  const [activity, gas, nfts, rewards, approvalsRes] = sections.map(s => s.value)
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
  // DeFi positions now load from /api/positions, so this net worth is tokens
  // only. The client adds the DeFi net once it arrives, de-duplicating any
  // receipt token a position already accounts for.
  return {
    ...portfolio,
    positions: null, // signals "still loading" rather than "none"
    activity,
    netWorth: portfolio.netWorth,
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
