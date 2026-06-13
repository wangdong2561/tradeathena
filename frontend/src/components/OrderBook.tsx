import React, { useEffect, useState } from 'react'
import { fetchDepth } from '../api'
import type { Ticker } from '../types'

interface DepthLevel {
  price: number
  volume: number
  total: number
}

interface Props {
  symbol: string
  ticker: Ticker | null
}

export const OrderBook: React.FC<Props> = ({ symbol, ticker }) => {
  const [bids, setBids] = useState<DepthLevel[]>([])
  const [asks, setAsks] = useState<DepthLevel[]>([])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const data = await fetchDepth(symbol, 15)
        if (!mounted) return
        const process = (levels: [string, string][]): DepthLevel[] => {
          let total = 0
          return levels.map(([p, v]) => {
            total += parseFloat(v)
            return { price: parseFloat(p), volume: parseFloat(v), total }
          })
        }
        setBids(process(data.bids).reverse())
        setAsks(process(data.asks))
      } catch { /* ignore */ }
    }
    load()
    const interval = setInterval(load, 5000)
    return () => { mounted = false; clearInterval(interval) }
  }, [symbol])

  const maxTotal = Math.max(
    bids.length > 0 ? bids[bids.length - 1].total : 0,
    asks.length > 0 ? asks[asks.length - 1].total : 0,
  ) || 1

  const spread = ticker ? ticker.ask - ticker.bid : 0
  const spreadPct = ticker && ticker.ask > 0 ? (spread / ticker.ask) * 100 : 0

  const formatPrice = (p: number) => p.toFixed(symbol.includes('USDT') ? 2 : 4)

  return (
    <div className="order-book">
      <div className="section-header">深度行情</div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', padding: '2px 10px', fontSize: 10, color: 'var(--text-muted)' }}>
          <span style={{ textAlign: 'right' }}>价格</span>
          <span style={{ textAlign: 'right' }}>数量</span>
          <span style={{ textAlign: 'right' }}>累计</span>
        </div>
        {asks.map((a, i) => (
          <div key={i} className="row ask" style={{ background: `linear-gradient(to left, rgba(242,68,83,${Math.min(a.total / maxTotal * 0.3, 0.3)}), transparent)` }}>
            <span className="price">{formatPrice(a.price)}</span>
            <span className="volume">{a.volume.toFixed(4)}</span>
            <span className="total">{a.total.toFixed(4)}</span>
          </div>
        ))}
        <div className="spread-row">
          {formatPrice(ticker?.bid || 0)} / {formatPrice(ticker?.ask || 0)}
          {' '}| 点差: {spread.toFixed(2)} ({spreadPct.toFixed(2)}%)
        </div>
        {bids.map((b, i) => (
          <div key={i} className="row bid" style={{ background: `linear-gradient(to left, rgba(46,189,91,${Math.min(b.total / maxTotal * 0.3, 0.3)}), transparent)` }}>
            <span className="price">{formatPrice(b.price)}</span>
            <span className="volume">{b.volume.toFixed(4)}</span>
            <span className="total">{b.total.toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
