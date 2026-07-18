import { getPositions } from '../../lib/positions.mjs'

// DeFi positions are their own request, not part of /api/portfolio.
//
// They are the most expensive thing the app reads (token discovery, then lending
// pools, ERC-4626 vaults, Uniswap LP maths and two perp venues) and they grow
// every time a protocol family is added. Sharing one 10s serverless budget with
// the wallet report meant each new adapter made the report likelier to time out.
// Split, each gets its own budget and the report stays fast.
export default async (req) => {
  const address = (new URL(req.url).searchParams.get('address') || '').trim()
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' }
  try {
    const positions = await getPositions(address)
    const positionsNet = positions.reduce((s, p) => s + (p.netUsd || 0), 0)
    // tokens already represented by a valued position, so the client can avoid
    // counting the same money twice in net worth
    const accounted = positions
      .filter(p => typeof p.netUsd === 'number' && p.receiptTokens)
      .flatMap(p => p.receiptTokens)
    return new Response(JSON.stringify({ positions, positionsNet, accounted }), { status: 200, headers })
  } catch (e) {
    const status = e.message === 'Not a valid address' ? 400 : 502
    return new Response(JSON.stringify({ error: e.message || 'read failed' }), { status, headers })
  }
}

export const config = { path: '/api/positions' }
