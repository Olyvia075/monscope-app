// Known scam/drainer addresses (ScamSniffer's public blacklist). Drainer contracts
// are frequently reused across EVM chains, so this carries real signal on Monad.
// Cached in module scope for the function's warm lifetime.
const SRC = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json'
let SET = null

export async function loadScamSet() {
  if (SET) return SET
  try {
    const r = await fetch(SRC)
    const arr = await r.json()
    SET = new Set(arr.map(a => a.toLowerCase()))
  } catch { SET = new Set() }
  return SET
}

export async function isScam(address) {
  const set = await loadScamSet()
  return set.has((address || '').toLowerCase())
}
