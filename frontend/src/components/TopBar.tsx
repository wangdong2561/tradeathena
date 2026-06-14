import React, { useState, useEffect, useRef } from 'react'
import type { Account, User } from '../types'
import { AdminPanel } from './AdminPanel'

interface Props {
  symbols: string[]
  selectedSymbol: string
  onSymbolChange: (s: string) => void
  account: Account | null
  user: User
  onLogout: () => void
}

interface SymbolInfo {
  name: string; full_name: string; type: string; exchange: string
  trading_hours: string; trading_hours_cn: string; leverage_max: number
  lot_min: number; description: string
}

export const TopBar: React.FC<Props> = ({
  symbols, selectedSymbol, onSymbolChange, account, user, onLogout,
}) => {
  const [info, setInfo] = useState<SymbolInfo | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/v1/market/symbol-info/${selectedSymbol}`)
      .then(r => r.json())
      .then(d => setInfo(d))
      .catch(() => setInfo(null))
  }, [selectedSymbol])

  useEffect(() => {
    if (!showInfo) return
    const handler = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setShowInfo(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showInfo])

  return (
    <div className="topbar">
      <div className="logo">TradeAthena</div>

      <select value={selectedSymbol} onChange={e => onSymbolChange(e.target.value)}>
        {symbols.map(s => (
          <option key={s} value={s}>
            {s.replace('USDT', '/USDT').replace('XAUUSD', 'XAU/USD').replace('XAGUSD', 'XAG/USD')}
          </option>
        ))}
      </select>

      <button onClick={() => setShowInfo(!showInfo)}
        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: 'pointer' }}
        title="品种信息">ⓘ</button>

      {showInfo && info && (
        <div ref={infoRef} style={{
          position: 'fixed', top: 44, left: 160, zIndex: 2000,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 6, padding: 14, width: 320,
          fontSize: 12, lineHeight: 1.6,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            {info.name} <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{info.full_name}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>类型</span><span>{info.type}</span>
            <span style={{ color: 'var(--text-secondary)' }}>交易所</span><span>{info.exchange}</span>
            <span style={{ color: 'var(--text-secondary)' }}>交易时间</span><span style={{ color: 'var(--green)', fontWeight: 500, whiteSpace: 'pre-line' }}>{info.trading_hours}</span>
            <span style={{ color: 'var(--text-secondary)' }}>休市</span><span style={{ color: 'var(--red)', fontSize: 11 }}>{info.trading_hours_cn}</span>
            <span style={{ color: 'var(--text-secondary)' }}>最大杠杆</span><span>1:{info.leverage_max}</span>
            <span style={{ color: 'var(--text-secondary)' }}>最小手数</span><span>{info.lot_min}</span>
          </div>
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-secondary)' }}>
            {info.description}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
            时间均为北京时间 (CST, UTC+8)
          </div>
        </div>
      )}

      {account && (
        <div className="account-summary">
          <div className="item"><span className="label">余额</span><span className="value">${account.balance.toFixed(2)}</span></div>
          <div className="item"><span className="label">净值</span><span className="value">${account.equity.toFixed(2)}</span></div>
          <div className="item"><span className="label">保证金</span><span className="value">${account.margin.toFixed(2)}</span></div>
          <div className="item"><span className="label">可用</span><span className="value">${account.free_margin.toFixed(2)}</span></div>
          <div className="item"><span className="label">浮动盈亏</span>
            <span className={`value ${account.total_unrealized_pl >= 0 ? 'green' : 'red'}`}>
              ${account.total_unrealized_pl.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {user ? `${user.username}${user.role === 'admin' ? ' 🔧' : ''}` : '未登录'}
        </span>
        <button onClick={() => setShowAdmin(true)}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>
          {user ? '管理' : '登录'}
        </button>
        <button onClick={onLogout}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>
          退出
        </button>
      </div>

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  )
}
