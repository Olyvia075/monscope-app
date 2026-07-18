// Uniswap V3 tick math, ported to BigInt.
//
// A V3 LP position stores liquidity between two ticks, not token amounts, so the
// only way to know what it is actually worth is to reconstruct the amounts from
// the pool's current price. These are the standard TickMath / LiquidityAmounts
// routines; the magic constants are the canonical ones from the Uniswap core
// contracts and must not be "tidied up".
const Q96 = 2n ** 96n
const MIN_TICK = -887272
const MAX_TICK = 887272

export function getSqrtRatioAtTick(tick) {
  const t = Number(tick)
  if (t < MIN_TICK || t > MAX_TICK) throw new Error('tick out of range')
  const abs = BigInt(Math.abs(t))

  let ratio = (abs & 0x1n) !== 0n
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n

  const muls = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ]
  for (const [bit, mul] of muls) {
    if ((abs & bit) !== 0n) ratio = (ratio * mul) >> 128n
  }

  if (t > 0) ratio = ((2n ** 256n) - 1n) / ratio
  // round up from Q128.128 to Q128.96
  return (ratio >> 32n) + ((ratio % (1n << 32n)) === 0n ? 0n : 1n)
}

// How much token0 / token1 a position is actually holding right now.
export function getAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity) {
  if (liquidity === 0n) return { amount0: 0n, amount1: 0n }
  let sqrtA = getSqrtRatioAtTick(tickLower)
  let sqrtB = getSqrtRatioAtTick(tickUpper)
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]

  if (sqrtPriceX96 <= sqrtA) {
    // entirely below the range: the position is all token0
    return { amount0: amount0For(sqrtA, sqrtB, liquidity), amount1: 0n }
  }
  if (sqrtPriceX96 < sqrtB) {
    // in range: a mix of both
    return {
      amount0: amount0For(sqrtPriceX96, sqrtB, liquidity),
      amount1: amount1For(sqrtA, sqrtPriceX96, liquidity),
    }
  }
  // entirely above the range: the position is all token1
  return { amount0: 0n, amount1: amount1For(sqrtA, sqrtB, liquidity) }
}

function amount0For(sqrtA, sqrtB, liquidity) {
  return ((liquidity << 96n) * (sqrtB - sqrtA)) / sqrtB / sqrtA
}

function amount1For(sqrtA, sqrtB, liquidity) {
  return (liquidity * (sqrtB - sqrtA)) / Q96
}
