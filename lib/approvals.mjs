import { parseAbi, getAddress, formatUnits } from 'viem'
import { makeClient } from './chain.mjs'
import { loadScamSet } from './scamlist.mjs'
import { labelSpender } from './spenders.mjs'

// Token approvals a wallet has granted — the exact surface a drainer exploits.
// Full history via Etherscan's log index (chainid 143), current allowance via RPC.
// MonScope never revokes (that needs a signature); it surfaces the risk.
const ETHERSCAN = 'https://api.etherscan.io/v2/api'
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
const MAX = 2n ** 256n - 1n
const UNLIMITED = MAX / 2n
const ERC20 = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

function pad(addr) { return '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase() }

export async function getApprovals(address) {
  const key = process.env.ETHERSCAN_API_KEY
  const a = getAddress(address)
  const client = makeClient()

  // discover every Approval this wallet ever granted (owner is topic1)
  const pairs = new Map() // token-spender -> {token, spender}
  if (key) {
    for (let page = 1; page <= 5; page++) {
      const url = `${ETHERSCAN}?chainid=143&module=logs&action=getLogs&topic0=${APPROVAL_TOPIC}&topic0_1_opr=and&topic1=${pad(a)}&page=${page}&offset=1000&apikey=${key}`
      let d
      try { d = await (await fetch(url)).json() } catch { break }
      if (d.status !== '1' || !Array.isArray(d.result)) break
      for (const log of d.result) {
        const spenderTopic = log.topics?.[2]
        if (!spenderTopic) continue
        const spender = getAddress('0x' + spenderTopic.slice(26))
        const token = getAddress(log.address)
        pairs.set(token.toLowerCase() + '-' + spender.toLowerCase(), { token, spender })
      }
      if (d.result.length < 1000) break
    }
  }
  if (!pairs.size) return { approvals: [], scanned: !!key }

  // read CURRENT allowance for each pair; keep only live ones
  const list = [...pairs.values()]
  const calls = list.map(p => ({ address: p.token, abi: ERC20, functionName: 'allowance', args: [a, p.spender] }))
  const allowances = await client.multicall({ contracts: calls, allowFailure: true })

  const scam = await loadScamSet()
  // keep live approvals, then batch their token metadata in one multicall
  const liveIdx = []
  for (let i = 0; i < list.length; i++) {
    const r = allowances[i]
    if (r.status === 'success' && r.result > 0n) liveIdx.push(i)
  }
  const uniqTokens = [...new Set(liveIdx.map(i => list[i].token.toLowerCase()))]
  const metaCalls = uniqTokens.flatMap(t => {
    const addr = getAddress(t)
    return [
      { address: addr, abi: ERC20, functionName: 'symbol' },
      { address: addr, abi: ERC20, functionName: 'decimals' },
    ]
  })
  const meta = metaCalls.length ? await client.multicall({ contracts: metaCalls, allowFailure: true }) : []
  const metaMap = {}
  uniqTokens.forEach((t, k) => {
    metaMap[t] = {
      sym: meta[k * 2]?.status === 'success' ? meta[k * 2].result : '?',
      dec: meta[k * 2 + 1]?.status === 'success' ? meta[k * 2 + 1].result : 18,
    }
  })
  const live = liveIdx.map(i => {
    const p = list[i], r = allowances[i], m = metaMap[p.token.toLowerCase()] || { sym: '?', dec: 18 }
    const unlimited = r.result >= UNLIMITED
    const flaggedScam = scam.has(p.spender.toLowerCase())
    const label = labelSpender(p.spender)
    // risk: scam (revoke!) > unverified unlimited (review) > known/limited (fine)
    const risk = flaggedScam ? 'scam' : (label ? 'known' : (unlimited ? 'unverified' : 'limited'))
    return {
      token: m.sym, tokenAddress: p.token, spender: p.spender,
      unlimited,
      amount: unlimited ? null : Number(formatUnits(r.result, m.dec)),
      flaggedScam, spenderLabel: label, risk,
    }
  })
  // riskiest first: scam, then unlimited
  var order = { scam: 0, unverified: 1, known: 2, limited: 3 }
  live.sort((x, y) => (order[x.risk] - order[y.risk]) || (y.unlimited - x.unlimited))
  return { approvals: live, scanned: true }
}
