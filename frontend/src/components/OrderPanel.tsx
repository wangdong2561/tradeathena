import React, { useState, useCallback } from 'react'
import { placeOrder } from '../api'
import type { Ticker, Account, TradeResult } from '../types'

interface Props {
  symbol: string
  ticker: Ticker | null
  account: Account | null
  onOrderResult: (r: TradeResult) => void
}

const VOLUMES = [0.01, 0.05, 0.1, 0.5, 1.0]
const SL_PCTS = [5, 10, 20, 30]       // -5%, -10%, -20%, -30%
const TP_MULTS = [1, 2, 3, 5]          // 1x, 2x, 3x, 5x

export const OrderPanel: React.FC<Props> = ({ symbol, ticker, account, onOrderResult }) => {
  const [orderType, setOrderType] = useState<string>('market')
  const [volume, setVolume] = useState(0.1)
  const [price, setPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')

  const buyPrice = ticker?.ask || 0
  const sellPrice = ticker?.bid || 0
  const midPrice = buyPrice > 0 && sellPrice > 0 ? (buyPrice + sellPrice) / 2 : (buyPrice || sellPrice)

  // ── SL/TP presets ──────────────────────────────────

  const applySL = useCallback((pct: number) => {
    if (midPrice > 0) {
      setStopLoss((midPrice * (1 - pct / 100)).toFixed(2))
    }
  }, [midPrice])

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
    try {
      const result = await placeOrder({
        symbol,
        side,
        order_type: orderType,
        volume,
        price: price ? parseFloat(price) : 0,
        stop_price: stopPrice ? parseFloat(stopPrice) : 0,
        stop_loss: stopLoss ? parseFloat(stopLoss) : 0,
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
          {VOLUMES.map(v => (
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

      {/* ═══ 止损 (SL) 快速设置 ═══ */}
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label>止损 SL</label>
        <input
          type="number" step={0.01}
          value={stopLoss} onChange={e => setStopLoss(e.target.value)}
          placeholder="手动输入价格"
          style={{ marginBottom: 4 }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {SL_PCTS.map(p => (
            <button
              key={p}
              onClick={() => applySL(p)}
              style={{
                flex: 1, minWidth: 50, padding: '3px 2px', fontSize: 10,
                background: 'var(--bg-tertiary)', color: 'var(--red)',
                border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
              }}
            >
              -{p}%
            </button>
          ))}
          <button
            onClick={() => { setStopLoss(''); setTakeProfit('') }}
            style={{
              padding: '3px 8px', fontSize: 10,
              background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer',
            }}
          >
            清除
          </button>
        </div>
        {stopLoss && buyPrice > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            ≈ ${parseFloat(stopLoss).toFixed(precision)} ({((parseFloat(stopLoss) / buyPrice - 1) * 100).toFixed(1)}%)
          </div>
        )}
      </div>

      {/* ═══ 止盈 (TP) 快速设置 ═══ */}
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label>止盈 TP</label>
        <input
          type="number" step={0.01}
          value={takeProfit} onChange={e => setTakeProfit(e.target.value)}
          placeholder="手动输入价格"
          style={{ marginBottom: 4 }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TP_MULTS.map(m => (
            <button
              key={m}
              onClick={() => applyTP(m)}
              style={{
                flex: 1, minWidth: 40, padding: '3px 2px', fontSize: 10,
                background: 'var(--bg-tertiary)', color: 'var(--green)',
                border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {m}x
            </button>
          ))}
        </div>
        {takeProfit && buyPrice > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            ≈ ${parseFloat(takeProfit).toFixed(precision)} ({((parseFloat(takeProfit) / buyPrice - 1) * 100).toFixed(1)}%)
          </div>
        )}
      </div>

      <div className="field">
        <label>杠杆</label>
        <span className="font-mono">1:{account?.leverage || 100}</span>
      </div>

      {/* 买卖按钮 */}
      <div className="action-btns">
        <button className="btn-buy" onClick={() => handleSubmit('buy')}>
          买入 / 做多 {buyPrice > 0 ? `$${buyPrice.toFixed(precision)}` : ''}
        </button>
        <button className="btn-sell" onClick={() => handleSubmit('sell')}>
          卖出 / 做空 {sellPrice > 0 ? `$${sellPrice.toFixed(precision)}` : ''}
        </button>
      </div>
    </div>
  )
}
