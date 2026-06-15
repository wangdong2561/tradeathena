import React, { useEffect, useState } from 'react'
import { getHistory } from '../api'
import type { TradeHistory } from '../types'

export const HistoryTable: React.FC = () => {
  const [trades, setTrades] = useState<TradeHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getHistory(1, 100).then(r => {
      setTrades(r.trades)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="empty-state">加载中...</div>
  if (trades.length === 0) return <div className="empty-state">暂无历史记录</div>

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>品种</th>
          <th>方向</th>
          <th>手数</th>
          <th>开仓价</th>
          <th>平仓价</th>
          <th>盈亏</th>
          <th>开仓时间</th>
          <th>平仓时间</th>
        </tr>
      </thead>
      <tbody>
        {trades.map(t => (
          <tr key={t.id}>
            <td>{t.symbol.replace('USDT', '/USDT')}</td>
            <td style={{ color: t.side === 'buy' ? 'var(--green)' : 'var(--red)' }}>
              {t.side === 'buy' ? '做多' : '做空'}
            </td>
            <td>{t.volume.toFixed(2)}</td>
            <td>${t.entry_price.toFixed(2)}</td>
            <td>${t.exit_price.toFixed(2)}</td>
            <td className={t.profit >= 0 ? 'positive' : 'negative'}>
              {t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}
            </td>
            <td className="text-muted">{new Date(t.open_time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</td>
            <td className="text-muted">{new Date(t.close_time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
