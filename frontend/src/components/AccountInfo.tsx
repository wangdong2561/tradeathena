import React from 'react'
import type { Account } from '../types'

interface Props {
  account: Account | null
  onReset: () => void
}

const $ = (v: any, d = 2) => (v !== null && v !== undefined ? Number(v).toFixed(d) : '0.00')
const $0 = (v: any) => (v !== null && v !== undefined ? Number(v).toFixed(0) : '0')

export const AccountInfo: React.FC<Props> = ({ account, onReset }) => {
  if (!account || account.balance === undefined) {
    return <div className="account-info"><div className="empty-state">加载中...</div></div>
  }

  const marginLevel = Number(account.margin_level) || 0
  const pl = Number(account.total_unrealized_pl) || 0

  return (
    <div className="account-info">
      <div className="section-header">账户信息</div>
      <div style={{ padding: '8px 10px' }}>
        <div className="row">
          <span className="label">余额</span>
          <span className="value">${$(account.balance)}</span>
        </div>
        <div className="row">
          <span className="label">净值</span>
          <span className="value">${$(account.equity)}</span>
        </div>
        <div className="row">
          <span className="label">已用保证金</span>
          <span className="value">${$(account.margin)}</span>
        </div>
        <div className="row">
          <span className="label">可用保证金</span>
          <span className="value">${$(account.free_margin)}</span>
        </div>
        <div className="separator" />
        <div className="row">
          <span className="label">保证金比例</span>
          <span className="value" style={{ color: marginLevel > 100 ? 'var(--green)' : marginLevel > 50 ? '#f0ad4e' : 'var(--red)' }}>
            {$(account.margin_level)}%
          </span>
        </div>
        <div className="row">
          <span className="label">杠杆</span>
          <span className="value">1:{account.leverage || 100}</span>
        </div>
        <div className="row">
          <span className="label">浮动盈亏</span>
          <span className={`value ${pl >= 0 ? 'green' : 'red'}`}>
            ${$(account.total_unrealized_pl)}
          </span>
        </div>
        <div className="row">
          <span className="label">持仓数</span>
          <span className="value">{account.open_positions ?? 0}</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            onClick={onReset}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              padding: '4px 12px',
              fontSize: 11,
              cursor: 'pointer',
              borderRadius: 3,
              width: '100%',
              fontFamily: 'var(--font-sans)',
            }}
          >
            重置账户 (${$0(account.balance)})
          </button>
        </div>
      </div>
    </div>
  )
}
