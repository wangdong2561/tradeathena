import React from 'react'
import { closePosition } from '../api'
import type { Position } from '../types'

interface Props {
  positions: Position[]
  onClose: (id: number, pos?: Position, exitPrice?: number) => void
}

export const PositionsTable: React.FC<Props> = ({ positions, onClose }) => {
  if (positions.length === 0) return <div className="empty-state">暂无持仓</div>

  const handleClose = async (id: number, pos?: Position) => {
    try {
      const r = await closePosition(id)
      onClose(id, pos, r.exit_price)
    } catch (e: any) {
      alert('平仓失败: ' + e.message)
    }
  }

  const formatPL = (v: number) => {
    const s = v >= 0 ? '+' : ''
    return <span className={v >= 0 ? 'positive' : 'negative'}>{s}${v.toFixed(2)}</span>
  }

  const fmtTime = (ts?: number) => {
    if (!ts) return '-'
    return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>编号</th>
          <th>品种</th>
          <th>方向</th>
          <th>手数</th>
          <th>开仓价</th>
          <th>现价</th>
          <th>止损</th>
          <th>止盈</th>
          <th>浮动盈亏</th>
          <th>开仓时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {positions.map(p => (
          <tr key={p.id}>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>{p.id}</td>
            <td>{p.symbol.replace('USDT', '/USDT')}</td>
            <td>
              {p.side === 'buy' ? (
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>多</span>
              ) : (
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>空</span>
              )}
            </td>
            <td>{p.volume.toFixed(2)}</td>
            <td>${p.entry_price.toFixed(2)}</td>
            <td>${p.current_price.toFixed(2)}</td>
            <td>{p.stop_loss > 0 ? '$' + p.stop_loss.toFixed(2) : '-'}</td>
            <td>{p.take_profit > 0 ? '$' + p.take_profit.toFixed(2) : '-'}</td>
            <td>{formatPL(p.unrealized_pl)}</td>
            <td style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtTime(p.created_at)}</td>
            <td>
              <button className="action-btn close" onClick={() => handleClose(p.id, p)}>平仓</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
