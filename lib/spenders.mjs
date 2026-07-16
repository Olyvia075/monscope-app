// Known, legitimate spender contracts on Monad. Approving these (even unlimited) is
// normal and required to use the protocol — we must NOT push users to revoke them.
// This is the safeguard revoke.cash uses: label known spenders, and reserve the
// "revoke" alarm for spenders on a scam list.
export const KNOWN_SPENDERS = {
  '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900': 'Uniswap: SwapRouter02',
  '0x0d97dc33264bfc1c226207428a79b26757fb9dc3': 'Uniswap: Universal Router',
  '0x7197e214c0b767cfb76fb734ab638e2c192f4e53': 'Uniswap: Position Manager',
  '0x661e93cca42afacb172121ef892830ca3b70f08d': 'Uniswap: Quoter',
  '0x204faca1764b154221e35c0d20abb3c525710498': 'Uniswap: V3 Factory',
  '0x000000000022d473030f116ddee9f6b43ac78ba3': 'Permit2',
  '0x69a5f9ad4f96ebf0a0c792dd42a01cc5c0102fef': 'Aave V3: Pool',
}

export function labelSpender(addr) {
  return KNOWN_SPENDERS[(addr || '').toLowerCase()] || null
}
