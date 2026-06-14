/** Technical indicator calculations. */
import type { Kline } from '../types'

/** Simple Moving Average */
export function calcSMA(data: Kline[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sum = 0
    for (let j = 0; j < period; j++) sum += data[i - j].close
    result.push(sum / period)
  }
  return result
}

/** Bollinger Bands (20, 2 by default) */
export function calcBollingerBands(
  data: Kline[], period = 20, stdDev = 2,
): { middle: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const sma = calcSMA(data, period)
  const middle: (number | null)[] = []
  const upper: (number | null)[] = []
  const lower: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    const m = sma[i]
    if (m === null) { middle.push(null); upper.push(null); lower.push(null); continue }
    let sumSq = 0
    for (let j = 0; j < period; j++) {
      const diff = data[i - j].close - m
      sumSq += diff * diff
    }
    const sd = Math.sqrt(sumSq / period)
    middle.push(m)
    upper.push(m + sd * stdDev)
    lower.push(m - sd * stdDev)
  }
  return { middle, upper, lower }
}

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
