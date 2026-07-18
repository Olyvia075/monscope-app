// Every Etherscan call in the app goes through this one gate.
//
// The free tier allows ~5 requests/second. Four different modules (txlist,
// tokenlist, nfts, approvals) hit the API for a single wallet report, and once
// those ran concurrently the API started returning NOTOK. Each module caught the
// error and returned an empty array, so a rate-limited request was indistinguishable
// from a wallet that genuinely holds nothing: the token list silently went blank.
//
// So: one shared token bucket across all callers, retry with backoff on a
// rate-limit answer, and throw (never quietly return empty) when a call really
// fails, so callers can tell "nothing found" apart from "could not look".
const ETHERSCAN = 'https://api.etherscan.io/v2/api'
const CHAIN_ID = 143
const MIN_INTERVAL_MS = 220   // ~4.5 req/s, just under the free-tier ceiling
const MAX_ATTEMPTS = 3
// A request with no timeout can hang the whole report: Etherscan takes 18-20s to
// answer "Query Timeout" for heavy addresses, and with retries that ran for
// minutes. Nothing we ask for is worth more than a few seconds.
const REQUEST_TIMEOUT_MS = 6000

let queue = Promise.resolve()

// Serialize every request through a shared chain with a minimum spacing, so the
// aggregate rate is bounded no matter how many modules call in parallel.
function schedule(fn) {
  const run = queue.then(fn, fn)
  // these timers are deliberately NOT unref'd: they are the pacing mechanism and
  // must keep the event loop alive while a report is still being assembled
  const space = () => new Promise(r => setTimeout(r, MIN_INTERVAL_MS))
  queue = run.then(space, space)
  return run
}

export function hasKey() {
  return !!process.env.ETHERSCAN_API_KEY
}

// Returns the `result` array for a successful call, or [] when the API reports
// "No transactions found". Throws on a genuine failure.
export async function esQuery(params) {
  const apikey = process.env.ETHERSCAN_API_KEY
  if (!apikey) throw new Error('no etherscan key')
  const qs = new URLSearchParams({ chainid: String(CHAIN_ID), ...params, apikey })
  const url = `${ETHERSCAN}?${qs}`

  let lastErr = 'unknown'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const d = await schedule(async () => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)
      try {
        const r = await fetch(url, { signal: ac.signal })
        return await r.json()
      } catch (e) {
        return { status: '0', message: 'fetch failed: ' + e.message }
      } finally { clearTimeout(timer) }
    })

    if (d.status === '1' && Array.isArray(d.result)) return d.result
    // an empty history is a legitimate answer, not an error
    if (d.status === '0' && /no transactions found|no records found/i.test(d.message || '')) return []

    lastErr = d.message || d.result || 'NOTOK'
    // Retrying an identical query that the API already gave up on just burns the
    // budget three times over. The caller should fall back to what it has.
    if (/query timeout|smaller result/i.test(String(lastErr))) {
      throw new Error(`etherscan ${params.action} too heavy: ${lastErr}`)
    }
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 400 * attempt
      await new Promise(r => setTimeout(r, backoff))
    }
  }
  throw new Error(`etherscan ${params.action} failed: ${lastErr}`)
}
