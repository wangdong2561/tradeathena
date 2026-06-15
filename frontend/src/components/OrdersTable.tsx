import React from 'react'
import { cancelOrder } from '../api'
import type { PendingOrder } from '../types'

interface Props {
  orders: PendingOrder[]
  onCancel: (id: number) => void
}

export const OrdersTable: React.FC<Props> = ({ orders, onCancel }) => {
  if (orders.length === 0) return <div className="empty-state">暂无挂单</div>

  const handleCancel = async (id: number) => {
    try {
      await cancelOrder(id)
      onCancel(id)
    } catch (e: any) {
      alert('撤单失败: ' + e.message)
    }
  }

  const typeLabel = (t: string) => ({ market: '市价', limit: '限价', stop: '止损' }[t] || t)

  const fmtTime = (ts?: number) => {
    if (!ts) return '-'
    return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>编号</th>
          <th>品种</th>
          <th>类型</th>
          <th>方向</th>
          <th>手数</th>
          <th>价格</th>
          <th>触发价</th>
          <th>状态</th>
          <th>下单时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id}>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>{o.id}</td>
            <td>{o.symbol.replace('USDT', '/USDT')}</td>
            <td>{typeLabel(o.order_type)}</td>
            <td style={{ color: o.side === 'buy' ? 'var(--green)' : 'var(--red)' }}>
              {o.side === 'buy' ? '买入' : '卖出'}
            </td>
            <td>{o.volume.toFixed(2)}</td>
            <td>{o.price > 0 ? '$' + o.price.toFixed(2) : '-'}</td>
            <td>{o.stop_price > 0 ? '$' + o.stop_price.toFixed(2) : '-'}</td>
            <td style={{ color: 'var(--text-secondary)' }}>挂单中</td>
            <td style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{fmtTime(o.created_at)}</td>
            <td>
              <button className="action-btn" onClick={() => handleCancel(o.id)}>撤销</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
