import React, { useMemo } from 'react'
import type { Kline, TradeMarker } from '../types'
import { evaluateStrategy, DEFAULT_STRATEGY_CONFIG, type StrategyConfig, type StrategySignal } from '../utils/strategy'

interface Props {
  klineData: Kline[]
  config: StrategyConfig
  onConfigChange: (cfg: StrategyConfig) => void
  lastSignalType: 'buy' | 'sell' | null
  onNewSignal: (signal: StrategySignal) => void
}

export const StrategyPanel: React.FC<Props> = ({
  klineData, config, onConfigChange, lastSignalType, onNewSignal,
}) => {
  const { state, newSignal } = useMemo(
    () => evaluateStrategy(klineData, config, lastSignalType),
    [klineData, config, lastSignalType],
  )

  // Notify parent of new signals — compare by type+time, not object ref
  const signalKey = newSignal ? `${newSignal.type}-${newSignal.time}` : null
  const prevKeyRef = React.useRef<string | null>(null)
  if (signalKey && signalKey !== prevKeyRef.current) {
    prevKeyRef.current = signalKey
    setTimeout(() => onNewSignal(newSignal!), 0)
  }

  const update = (partial: Partial<StrategyConfig>) => {
    onConfigChange({ ...config, ...partial })
  }

  const signalLabel = state.signal
    ? (state.signal.type === 'buy' ? '🟢 做多' : '🔴 做空')
    : '⚪ 无信号'

  const reasonLabel = state.signal?.reason === 'bb_lower_rsi'
    ? '布林下轨 + RSI超卖'
    : state.signal?.reason === 'bb_upper_rsi'
      ? '布林上轨 + RSI超买'
      : ''

  return (
    <div style={{ padding: '6px 10px', fontSize: 11, lineHeight: 1.5, color: 'var(--text-primary)' }}>
      {/* Status section */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>📊 布林带+RSI 策略</span>
        <span style={{ fontSize: 13 }}>{signalLabel}</span>
        {reasonLabel && (
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{reasonLabel}</span>
        )}
      </div>

      {/* Current state */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        <span>价: <b>${state.price.toFixed(2)}</b></span>
        {state.bbMiddle !== null && (
          <>
            <span style={{ color: 'rgba(38,166,154,0.8)' }}>
              中轨: <b>${state.bbMiddle.toFixed(2)}</b>
            </span>
            <span style={{ color: 'rgba(38,166,154,0.6)' }}>
              上轨: <b>${state.bbUpper!.toFixed(2)}</b> 下轨: <b>${state.bbLower!.toFixed(2)}</b>
            </span>
          </>
        )}
        {state.rsi !== null && (
          <span style={{
            color: state.rsi < 30 ? '#2ebd5b' : state.rsi > 70 ? '#f24453' : 'var(--text-muted)',
          }}>
            RSI: <b>{state.rsi.toFixed(1)}</b>
            {state.rsi < 30 ? ' (超卖)' : state.rsi > 70 ? ' (超买)' : ''}
          </span>
        )}
        {state.ema200 !== null && (
          <span>
            EMA200: <b>${state.ema200.toFixed(2)}</b>
            <span style={{ color: state.trend === 'bull' ? '#2ebd5b' : '#f24453', marginLeft: 2 }}>
              {state.trend === 'bull' ? '↑' : state.trend === 'bear' ? '↓' : '—'}
            </span>
          </span>
        )}
      </div>

      {/* Config section */}
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: 'pointer', fontSize: 10, color: 'var(--text-secondary)' }}>
          策略配置
        </summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, padding: 6, background: 'var(--bg-tertiary)', borderRadius: 4 }}>
          <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}>
            <input type="checkbox" checked={config.enabled}
              onChange={e => update({ enabled: e.target.checked })} />
            启用
          </label>
          <label style={{ fontSize: 10 }}>
            BB周期:
            <input type="number" value={config.bbPeriod} min={5} max={100}
              onChange={e => update({ bbPeriod: Math.max(5, +e.target.value) })}
              style={{ width: 36, marginLeft: 2, background: '#0d0e12', color: '#d1d4dc', border: '1px solid #2a2e38', borderRadius: 2, padding: '1px 3px', fontSize: 10 }} />
          </label>
          <label style={{ fontSize: 10 }}>
            BB标准差:
            <input type="number" value={config.bbStdDev} min={0.5} max={5} step={0.5}
              onChange={e => update({ bbStdDev: +e.target.value })}
              style={{ width: 32, marginLeft: 2, background: '#0d0e12', color: '#d1d4dc', border: '1px solid #2a2e38', borderRadius: 2, padding: '1px 3px', fontSize: 10 }} />
          </label>
          <label style={{ fontSize: 10 }}>
            RSI超卖:
            <input type="number" value={config.rsiOversold} min={5} max={50}
              onChange={e => update({ rsiOversold: +e.target.value })}
              style={{ width: 30, marginLeft: 2, background: '#0d0e12', color: '#d1d4dc', border: '1px solid #2a2e38', borderRadius: 2, padding: '1px 3px', fontSize: 10 }} />
          </label>
          <label style={{ fontSize: 10 }}>
            RSI超买:
            <input type="number" value={config.rsiOverbought} min={50} max={95}
              onChange={e => update({ rsiOverbought: +e.target.value })}
              style={{ width: 30, marginLeft: 2, background: '#0d0e12', color: '#d1d4dc', border: '1px solid #2a2e38', borderRadius: 2, padding: '1px 3px', fontSize: 10 }} />
          </label>
          <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}>
            <input type="checkbox" checked={config.useTrendFilter}
              onChange={e => update({ useTrendFilter: e.target.checked })} />
            趋势过滤 (EMA200)
          </label>
          <label style={{ fontSize: 10 }}>
            止损:
            <input type="number" value={config.stopLossPct} min={0.1} max={10} step={0.1}
              onChange={e => update({ stopLossPct: +e.target.value })}
              style={{ width: 36, marginLeft: 2, background: '#0d0e12', color: '#d1d4dc', border: '1px solid #2a2e38', borderRadius: 2, padding: '1px 3px', fontSize: 10 }} />
            %
          </label>
        </div>
      </details>
    </div>
  )
}

/** Generate TradeMarkers from strategy signals */
export function signalToMarker(sig: StrategySignal): TradeMarker {
  return {
    id: `strat-${sig.type}-${sig.time}`,
    type: 'entry',
    side: sig.type,
    price: sig.price,
    time: sig.time as number,
  }
}
