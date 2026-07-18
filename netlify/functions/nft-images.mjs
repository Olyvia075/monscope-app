import { isAddress } from 'viem'
import { resolveImages } from '../../lib/nftmeta.mjs'

// Artwork lookup, kept off the main report path on purpose: IPFS gateways are
// slow and frequently unreachable, and a hanging gateway must never be able to
// cost the user their wallet report. The UI renders NFTs immediately and calls
// this afterwards to fill in images.
export default async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=600, stale-while-revalidate=3600' }
  try {
    const { items } = await req.json()
    if (!Array.isArray(items)) return new Response(JSON.stringify({ error: 'items required' }), { status: 400, headers })
    const clean = items
      .filter(i => i && isAddress(i.contract) && /^\d+$/.test(String(i.tokenId)))
      .map(i => ({ contract: i.contract, tokenId: String(i.tokenId) }))
    const images = await resolveImages(clean)
    return new Response(JSON.stringify({ images }), { status: 200, headers })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'image read failed' }), { status: 502, headers })
  }
}

export const config = { path: '/api/nft-images' }
