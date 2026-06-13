/** Technical indicator calculations. */
import type { Kline } from '../types'

/** Exponential Moving Average */
export function calcEMA(data: Kline[], period: number): (number | null)[] {
  const k = 2 / (period + 1)
  const result: (number | null)[] = []
  let ema = 0
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      // SMA as initial seed
      let sum = 0
      for (let j = 0; j < period && j < data.length; j++) sum += data[j].close
      ema = sum / Math.min(period, data.length)
    } else {
      ema = data[i].close * k + ema * (1 - k)
    }
    result.push(i >= period - 1 ? ema : null)
  }
  return result
}

/** Relative Strength Index */
export function calcRSI(data: Kline[], period = 14): (number | null)[] {
  const result: (number | null)[] = []
  let gains = 0, losses = 0

  for (let i = 0; i < data.length; i++) {
    if (i === 0) { result.push(null); continue }
    const diff = data[i].close - data[i - 1].close
    const gain = Math.max(diff, 0)
    const loss = Math.max(-diff, 0)

    if (i < period) {
      gains += gain
      losses += loss
      result.push(null)
    } else if (i === period) {
      gains = (gains + gain) / period
      losses = (losses + loss) / period
      const rs = losses === 0 ? 100 : gains / losses
      result.push(100 - 100 / (1 + rs))
    } else {
      gains = (gains * (period - 1) + gain) / period
      losses = (losses * (period - 1) + loss) / period
      const rs = losses === 0 ? 100 : gains / losses
      result.push(100 - 100 / (1 + rs))
    }
  }
  return result
}
