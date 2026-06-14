/** Strategy signal engine — Bollinger Bands + RSI strategy. */
import type { Kline } from '../types'
import { calcBollingerBands, calcRSI, calcEMA } from './indicators'

export interface StrategySignal {
  type: 'buy' | 'sell'
  time: number
  price: number
  reason: string
}

export interface StrategyState {
  signal: StrategySignal | null
  bbUpper: number | null
  bbMiddle: number | null
  bbLower: number | null
  rsi: number | null
  ema200: number | null
  price: number
  trend: 'bull' | 'bear' | 'neutral'
}

export interface StrategyConfig {
  enabled: boolean
  bbPeriod: number
  bbStdDev: number
  rsiPeriod: number
  rsiOversold: number
  rsiOverbought: number
  useTrendFilter: boolean
  stopLossPct: number
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  enabled: true,
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  useTrendFilter: false,
  stopLossPct: 1.5,
}

export function evaluateStrategy(
  klines: Kline[],
  config: StrategyConfig,
  lastSignalType: 'buy' | 'sell' | null,
): { state: StrategyState; newSignal: StrategySignal | null } {
  if (!config.enabled || klines.length < Math.max(config.bbPeriod, config.rsiPeriod, 200)) {
    return {
      state: { signal: null, bbUpper: null, bbMiddle: null, bbLower: null,
               rsi: null, ema200: null, price: 0, trend: 'neutral' },
      newSignal: null,
    }
  }

  const bb = calcBollingerBands(klines, config.bbPeriod, config.bbStdDev)
  const rsi = calcRSI(klines, config.rsiPeriod)
  const ema200 = calcEMA(klines, 200)
  const last = klines.length - 1
  const close = klines[last].close
  const time = klines[last].time as number
  const u = bb.upper[last], m = bb.middle[last], l = bb.lower[last]
  const r = rsi[last], e200 = ema200[last]
  const trend: 'bull' | 'bear' | 'neutral' = e200 !== null ? (close >= e200 ? 'bull' : 'bear') : 'neutral'

  const state: StrategyState = {
    signal: null, bbUpper: u, bbMiddle: m, bbLower: l,
    rsi: r, ema200: e200, price: close, trend,
  }
  if (u === null || m === null || l === null || r === null || e200 === null) return { state, newSignal: null }

  const buyOk = close <= l && r < config.rsiOversold && (!config.useTrendFilter || trend === 'bull')
  const sellOk = close >= u && r > config.rsiOverbought && (!config.useTrendFilter || trend === 'bear')

  let newSignal: StrategySignal | null = null
  if (buyOk && lastSignalType !== 'buy') {
    newSignal = { type: 'buy', time, price: close, reason: 'bb_lower_rsi' }
    state.signal = newSignal
  } else if (sellOk && lastSignalType !== 'sell') {
    newSignal = { type: 'sell', time, price: close, reason: 'bb_upper_rsi' }
    state.signal = newSignal
  }
  return { state, newSignal }
}
