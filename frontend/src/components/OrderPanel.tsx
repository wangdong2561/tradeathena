import React, { useState, useCallback, useEffect } from 'react'
import { placeOrder } from '../api'
import type { Ticker, Account, TradeResult } from '../types'

interface Props {
  symbol: string
  ticker: Ticker | null
  account: Account | null
  onOrderResult: (r: TradeResult) => void
}

const SL_PCTS = [5, 10, 20, 30]       // -5%, -10%, -20%, -30%
const TP_MULTS = [1, 2, 3, 5]          // 1x, 2x, 3x, 5x

const SYM_VOLUMES: Record<string, {def:number; presets:number[]}> = {
  BTCUSDT: { def: 0.3, presets: [0.1, 0.3, 0.5, 1.0, 2.0] },
  XAUUSD:  { def: 0.2, presets: [0.05, 0.1, 0.2, 0.5, 1.0] },
  XAGUSD:  { def: 0.05, presets: [0.01, 0.05, 0.1, 0.5, 1.0] },
}

export const OrderPanel: React.FC<Props> = ({ symbol, ticker, account, onOrderResult }) => {
  const [orderType, setOrderType] = useState<string>('market')
  const defVol = SYM_VOLUMES[symbol]?.def || 0.3
  const [volume, setVolume] = useState(defVol)

  // Reset volume on symbol change
  useEffect(() => { setVolume(SYM_VOLUMES[symbol]?.def || 0.3) }, [symbol])
  const [price, setPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [slCustom, setSlCustom] = useState('')
  const [tpCustom, setTpCustom] = useState('')

  const buyPrice = ticker?.ask || 0
  const sellPrice = ticker?.bid || 0
  const midPrice = buyPrice > 0 && sellPrice > 0 ? (buyPrice + sellPrice) / 2 : (buyPrice || sellPrice)

  // ── SL/TP presets ──────────────────────────────────

  // Track current side for SL/TP direction
  const [activeSide, setActiveSide] = useState<'buy' | 'sell'>('buy')

  const applySL = useCallback((pct: number) => {
    if (midPrice > 0) {
      // For buy: SL below price; for sell: SL above price
      const mult = activeSide === 'buy' ? (1 - pct / 100) : (1 + pct / 100)
      setStopLoss((midPrice * mult).toFixed(2))
    }
  }, [midPrice, activeSide])

  const applyTP = useCallback((mult: number) => {
    const sl = parseFloat(stopLoss)
    if (sl > 0 && midPrice > 0) {
      const risk = midPrice - sl
      setTakeProfit((midPrice + risk * mult).toFixed(2))
    } else if (midPrice > 0) {
      const risk = midPrice * 0.1
      setTakeProfit((midPrice + risk * mult).toFixed(2))
    }
  }, [midPrice, stopLoss])

  const handleSubmit = async (side: 'buy' | 'sell') => {
    // Default SL: -10% if not set
    const entryPrice = side === 'buy' ? buyPrice : sellPrice
    const slPrice = stopLoss ? parseFloat(stopLoss) : (entryPrice > 0
      ? (side === 'buy' ? entryPrice * 0.9 : entryPrice * 1.1)
      : 0)
    try {
      const result = await placeOrder({
        symbol,
        side,
        order_type: orderType,
        volume,
        price: price ? parseFloat(price) : 0,
        stop_price: stopPrice ? parseFloat(stopPrice) : 0,
        stop_loss: slPrice,
        take_profit: takeProfit ? parseFloat(takeProfit) : 0,
      })
      onOrderResult(result)
    } catch (err: any) {
      onOrderResult({ filled: false, message: err.message, order_id: 0, fill_price: 0, fill_volume: 0 })
    }
  }

  const precision = symbol.includes('USDT') || symbol === 'XAUUSD' ? 2 : 4

  return (
    <div className="order-panel">
      <h3>{symbol.replace('USDT', '/USDT').replace('XAUUSD', 'XAU/USD').replace('XAGUSD', 'XAG/USD')}</h3>

      <div className="field">
        <label>订单类型</label>
        <select value={orderType} onChange={e => setOrderType(e.target.value)}>
          <option value="market">市价单</option>
          <option value="limit">限价单</option>
          <option value="stop">止损单</option>
        </select>
      </div>

      <div className="field">
        <label>手数</label>
        <input type="number" step={0.01} min={0.001} value={volume} onChange={e => setVolume(parseFloat(e.target.value) || 0)} />
        <div className="volume-btns">
          {(SYM_VOLUMES[symbol]?.presets || [0.1, 0.3, 0.5, 1.0]).map(v => (
            <button key={v} className={volume === v ? 'active' : ''} onClick={() => setVolume(v)}>{v}</button>
          ))}
        </div>
      </div>

      {orderType === 'limit' && (
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>限价</label>
          <input type="number" step={0.01} value={price} onChange={e => setPrice(e.target.value)} placeholder={buyPrice ? String(buyPrice.toFixed(precision)) : ''} />
        </div>
      )}

      {orderType === 'stop' && (
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>止损触发价</label>
          <input type="number" step={0.01} value={stopPrice} onChange={e => setStopPrice(e.target.value)} placeholder={buyPrice ? String(buyPrice.toFixed(precision)) : ''} />
        </div>
      )}

      {/* SL/TP preset buttons (compact, last slot = custom input) */}
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 24 }}>SL</span>
          {SL_PCTS.map(p => (
            <button key={p} onClick={() => applySL(p)} className={stopLoss ? 'active' : ''}
              style={{ flex: 1, padding: '2px 0', fontSize: 10, background: 'var(--bg-tertiary)', color: 'var(--red)', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
              -{p}%
            </button>
          ))}
          <input type="number" placeholder="%" min={0} max={99}
            value={slCustom} onChange={e => setSlCustom(e.target.value)}
            onBlur={() => { if (slCustom) applySL(parseFloat(slCustom)) }}
            style={{ width: 44, padding: '2px 4px', fontSize: 10, background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 2, outline: 'none', fontFamily: 'var(--font-mono)' }} />
          <button onClick={() => { setStopLoss(''); setTakeProfit(''); setSlCustom(''); setTpCustom('') }}
            style={{ padding: '2px 6px', fontSize: 10, background: 'transparent', color: 'var(--text-muted)', border: 'none', borderRadius: 2, cursor: 'pointer' }}>
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 24 }}>TP</span>
          {TP_MULTS.map(m => (
            <button key={m} onClick={() => applyTP(m)} className={takeProfit ? 'active' : ''}
              style={{ flex: 1, padding: '2px 0', fontSize: 10, background: 'var(--bg-tertiary)', color: 'var(--green)', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
              {m}x
            </button>
          ))}
          <input type="number" placeholder="x" min={0} max={99} step={0.1}
            value={tpCustom} onChange={e => setTpCustom(e.target.value)}
            onBlur={() => { if (tpCustom) applyTP(parseFloat(tpCustom)) }}
            style={{ width: 44, padding: '2px 4px', fontSize: 10, background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 2, outline: 'none', fontFamily: 'var(--font-mono)' }} />
        </div>
        {(stopLoss || takeProfit) && buyPrice > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
            SL ${parseFloat(stopLoss || '0').toFixed(precision)} · TP ${parseFloat(takeProfit || '0').toFixed(precision)}
          </div>
        )}
      </div>

      {/* 买卖按钮 (prominent, always visible) */}
      <div className="action-btns" style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        <button className="btn-buy" onClick={() => handleSubmit('buy')}
          onMouseEnter={() => setActiveSide('buy')}
          style={{ padding: '10px 0', fontSize: 15, fontWeight: 700 }}>
          ▲ 买入 {buyPrice > 0 ? `$${buyPrice.toFixed(precision)}` : ''}
        </button>
        <button className="btn-sell" onClick={() => handleSubmit('sell')}
          onMouseEnter={() => setActiveSide('sell')}
          style={{ padding: '10px 0', fontSize: 15, fontWeight: 700 }}>
          ▼ 卖出 {sellPrice > 0 ? `$${sellPrice.toFixed(precision)}` : ''}
        </button>
      </div>
    </div>
  )
}
