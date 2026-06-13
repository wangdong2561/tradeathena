import React from 'react'
import type { Ticker } from '../types'

interface Props {
  ticks: Record<string, Ticker>
  selectedSymbol: string
  onSelect: (s: string) => void
}

export const MarketWatch: React.FC<Props> = ({ ticks, selectedSymbol, onSelect }) => {
  const symbols = Object.keys(ticks)

  return (
    <div className="market-watch">
      <div className="header">
        <span>行情报价</span>
      </div>
      <div className="symbol-list">
        {symbols.map(sym => {
          const t = ticks[sym]
          if (!t) return null
          return (
            <div
              key={sym}
              className={`symbol-item ${sym === selectedSymbol ? 'active' : ''}`}
              onClick={() => onSelect(sym)}
            >
              <span className="symbol-name">{sym.replace('USDT', '/USDT').replace('XAUUSD', 'XAU/USD').replace('XAGUSD', 'XAG/USD')}</span>
              <span className="symbol-bid" style={{ color: t.change_24h >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {t.bid.toFixed(sym.includes('USDT') || sym === 'XAUUSD' ? 2 : 4)}
              </span>
              <span className={`symbol-change ${t.change_24h >= 0 ? 'positive' : 'negative'}`}>
                {t.change_24h >= 0 ? '+' : ''}{t.change_24h.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
