import { buildReport } from '../../lib/report.mjs'

export default async (req) => {
  const address = (new URL(req.url).searchParams.get('address') || '').trim()
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' }
  try {
    const report = await buildReport(address)
    return new Response(JSON.stringify(report), { status: 200, headers })
  } catch (e) {
    const status = e.message === 'Not a valid address' ? 400 : 502
    return new Response(JSON.stringify({ error: e.message || 'read failed' }), { status, headers })
  }
}

export const config = { path: '/api/portfolio' }
