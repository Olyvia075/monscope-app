import { getPortfolio } from './portfolio.mjs'
import { getPositions } from './positions.mjs'
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
// Positions get longer: they wait on token discovery before they can even start
// reading, and a missed DeFi position is a wrong answer, not just a thinner page.
// Everything else here is cosmetic by comparison.
const POSITIONS_DEADLINE_MS = 8500

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
    withDeadline(getPositions(address), [], POSITIONS_DEADLINE_MS),
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
  // A deposit shows up twice: once as the receipt token in the wallet (nWMON,
  // aprMON, wnUSDC) and once as the position that token represents. Counting
  // both would inflate net worth, so when a position carries a real value we
  // drop its receipt tokens from the token total and let the position stand —
  // the position is the better number, since it includes accrued interest and
  // any debt. A position we could not value leaves its token counted instead.
  const accounted = new Set()
  for (const p of positions) {
    if (typeof p.netUsd === 'number' && p.receiptTokens) {
      for (const t of p.receiptTokens) accounted.add(t)
    }
  }
  let doubleCounted = 0
  for (const t of portfolio.tokens) {
    if (t.address && accounted.has(t.address.toLowerCase())) {
      t.countedInPosition = true
      doubleCounted += t.valueUsd || 0
    }
  }
  const tokensNet = portfolio.netWorth - doubleCounted
  const positionsNet = positions.reduce((s, p) => s + (p.netUsd || 0), 0)
  return {
    ...portfolio,
    positions,
    activity,
    netWorth: tokensNet + positionsNet, // includes live DeFi net value
    tokensNetWorth: tokensNet,
    gas,
    nfts,
    rewards,
    approvals,
    security,
    incomplete, // true when a section hit its deadline; the report is partial
    asOf: Date.now(),
  }
}
