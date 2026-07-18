import { parseAbi, getAddress } from 'viem'
import { makeClient } from './chain.mjs'

// NFT artwork, resolved separately from the wallet report.
//
// Image resolution means reading tokenURI on chain and then fetching metadata
// JSON, usually from an IPFS gateway. That is slow and unpredictable, so it is
// deliberately NOT part of buildReport: a slow gateway would eat the report's
// time budget and cost the user their whole NFT list. The UI renders the list
// first and fills artwork in afterwards through this path.
const ERC721 = parseAbi(['function tokenURI(uint256) view returns (string)'])
const ERC1155 = parseAbi(['function uri(uint256) view returns (string)'])

const GATEWAY = 'https://ipfs.io/ipfs/'
const TTL_MS = 10 * 60_000   // metadata is effectively immutable
// These are external fetches we do not rate-limit, so the whole set runs in one
// wide batch: wall-clock is then a single timeout regardless of how many NFTs the
// wallet holds, instead of timeout x number-of-batches. That buys a timeout long
// enough for slow-but-alive gateways without risking the serverless limit.
// (Genuinely dead pins never respond on any gateway; those just fall back.)
const FETCH_TIMEOUT_MS = 5000
const CONCURRENCY = 48
const MAX_ITEMS = 48

const cache = new Map() // "contract-tokenId" -> { at, image }

const keyOf = (c, id) => c.toLowerCase() + '-' + id

// ipfs://CID/path and bare-gateway variants all normalise to one https URL
function toHttp(uri) {
  if (!uri) return null
  if (uri.startsWith('ipfs://')) return GATEWAY + uri.slice(7).replace(/^ipfs\//, '')
  if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:')) return uri
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}/.test(uri) || uri.startsWith('bafy')) return GATEWAY + uri
  return null
}

function decodeDataUri(uri) {
  try {
    const comma = uri.indexOf(',')
    if (comma < 0) return null
    const meta = uri.slice(5, comma)
    const body = uri.slice(comma + 1)
    const text = meta.includes(';base64')
      ? Buffer.from(body, 'base64').toString('utf8')
      : decodeURIComponent(body)
    return JSON.parse(text)
  } catch { return null }
}

async function fetchJson(url) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } })
    if (!r.ok) return null
    return await r.json()
  } catch { return null } finally { clearTimeout(t) }
}

// Read tokenURI for each item in one multicall, falling back to ERC-1155 uri().
async function readTokenUris(client, items) {
  const contracts = items.map(i => ({
    address: getAddress(i.contract), abi: ERC721,
    functionName: 'tokenURI', args: [BigInt(i.tokenId)],
  }))
  const res = await client.multicall({ contracts, allowFailure: true })

  const out = res.map(r => (r.status === 'success' ? r.result : null))
  const missing = out.map((v, i) => (v ? -1 : i)).filter(i => i >= 0)
  if (!missing.length) return out

  const alt = await client.multicall({
    contracts: missing.map(i => ({
      address: getAddress(items[i].contract), abi: ERC1155,
      functionName: 'uri', args: [BigInt(items[i].tokenId)],
    })),
    allowFailure: true,
  })
  // ERC-1155 allows an {id} template in the uri
  missing.forEach((idx, j) => {
    const r = alt[j]
    if (r.status !== 'success' || !r.result) return
    out[idx] = r.result.replace('{id}', BigInt(items[idx].tokenId).toString(16).padStart(64, '0'))
  })
  return out
}

async function resolveOne(uri) {
  if (!uri) return null
  const meta = uri.startsWith('data:') ? decodeDataUri(uri) : await fetchJson(toHttp(uri))
  if (!meta) return null
  // different collections use different field names for the same thing
  const img = meta.image || meta.image_url || meta.imageUrl || meta.animation_url
  return toHttp(typeof img === 'string' ? img : null)
}

// items: [{ contract, tokenId }] -> { "contract-tokenId": imageUrl|null }
export async function resolveImages(items) {
  const list = items.slice(0, MAX_ITEMS)
  const now = Date.now()
  const result = {}
  const todo = []

  for (const it of list) {
    const k = keyOf(it.contract, it.tokenId)
    const hit = cache.get(k)
    if (hit && now - hit.at < TTL_MS) result[k] = hit.image
    else todo.push(it)
  }
  if (!todo.length) return result

  const client = makeClient()
  const uris = await readTokenUris(client, todo).catch(() => todo.map(() => null))

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const slice = todo.slice(i, i + CONCURRENCY)
    const images = await Promise.all(
      slice.map((_, j) => resolveOne(uris[i + j]).catch(() => null))
    )
    slice.forEach((it, j) => {
      const k = keyOf(it.contract, it.tokenId)
      result[k] = images[j]
      // cache misses too, so one broken gateway is not retried on every load
      cache.set(k, { at: Date.now(), image: images[j] })
    })
  }
  return result
}
