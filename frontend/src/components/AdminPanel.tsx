import React, { useEffect, useState } from 'react'
import { fetchUsers, register, updateUserBalance } from '../api'
import type { User } from '../types'

interface Props {
  onClose: () => void
}

export const AdminPanel: React.FC<Props> = ({ onClose }) => {
  const [users, setUsers] = useState<(User & { created_at?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Register new user form
  const [newUser, setNewUser] = useState('')
  const [newPass, setNewPass] = useState('')

  // Balance edit state: { userId: newBalance }
  const [editBalances, setEditBalances] = useState<Record<number, string>>({})

  const loadUsers = async () => {
    setLoading(true)
    try {
      const data = await fetchUsers()
      setUsers(data.users || [])
    } catch (err: any) {
      setError(err.message || '加载用户失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  const handleRegister = async () => {
    if (!newUser.trim() || !newPass.trim()) { setError('请输入用户名和密码'); return }
    setError('')
    try {
      await register(newUser.trim(), newPass)
      setNewUser(''); setNewPass('')
      setMessage(`用户 ${newUser.trim()} 创建成功`)
      loadUsers()
    } catch (err: any) {
      try { const d = JSON.parse(err.message); setError(d.detail || '注册失败') }
      catch { setError(err.message || '注册失败') }
    }
  }

  const handleUpdateBalance = async (userId: number) => {
    const val = editBalances[userId]
    if (!val) return
    const balance = parseFloat(val)
    if (isNaN(balance) || balance < 0) { setError('请输入有效余额'); return }
    setError('')
    try {
      await updateUserBalance(userId, balance)
      setMessage(`用户余额已更新为 $${balance.toFixed(2)}`)
      setEditBalances(prev => { const n = { ...prev }; delete n[userId]; return n })
      loadUsers()
    } catch (err: any) {
      try { const d = JSON.parse(err.message); setError(d.detail || '更新失败') }
      catch { setError(err.message || '更新失败') }
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#13161a', border: '1px solid #2a2e38', borderRadius: 8,
        padding: 24, width: 560, maxHeight: '80vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#d1d4dc' }}>⚙️ 管理面板</span>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#5a5f69', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Create User */}
        <div style={{ marginBottom: 20, padding: 16, background: '#1a1d24', borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8f99', marginBottom: 10 }}>创建新用户</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input placeholder="用户名" value={newUser} onChange={e => setNewUser(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', fontSize: 12, background: '#0d0e12', color: '#d1d4dc', border: '1px solid #2a2e38', borderRadius: 4, outline: 'none' }} />
            <input placeholder="密码" type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', fontSize: 12, background: '#0d0e12', color: '#d1d4dc', border: '1px solid #2a2e38', borderRadius: 4, outline: 'none' }} />
            <button onClick={handleRegister}
              style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: '#2962ff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              创建
            </button>
          </div>
        </div>

        {/* User List */}
        <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8f99', marginBottom: 8 }}>用户列表</div>

        {error && (
          <div style={{ color: '#f24453', fontSize: 11, marginBottom: 8, padding: '4px 8px', background: 'rgba(242,68,83,0.1)', borderRadius: 4 }}>
            {error}
          </div>
        )}
        {message && (
          <div style={{ color: '#4caf50', fontSize: 11, marginBottom: 8, padding: '4px 8px', background: 'rgba(76,175,80,0.1)', borderRadius: 4 }}>
            {message}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#5a5f69', fontSize: 12, textAlign: 'center', padding: 20 }}>加载中...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: '#5a5f69', borderBottom: '1px solid #2a2e38' }}>
                <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 500 }}>ID</th>
                <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 500 }}>用户名</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 500 }}>余额</th>
                <th style={{ textAlign: 'center', padding: '6px 4px', fontWeight: 500 }}>角色</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 500 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid #1a1d24' }}>
                  <td style={{ padding: '6px 4px', color: '#5a5f69' }}>{u.id}</td>
                  <td style={{ padding: '6px 4px', color: '#d1d4dc' }}>
                    {u.username}
                    {u.role === 'admin' && <span style={{ color: '#2962ff', marginLeft: 4, fontSize: 10 }}>管理员</span>}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: '#d1d4dc' }}>
                    ${u.balance.toFixed(2)}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <span style={{ color: u.role === 'admin' ? '#2962ff' : '#8a8f99', fontSize: 11 }}>
                      {u.role === 'admin' ? '管理' : '用户'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                    {u.role !== 'admin' && (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <input
                          type="number"
                          placeholder="新余额"
                          value={editBalances[u.id] ?? ''}
                          onChange={e => setEditBalances(prev => ({ ...prev, [u.id]: e.target.value }))}
                          style={{ width: 80, padding: '3px 6px', fontSize: 11, background: '#0d0e12', color: '#d1d4dc', border: '1px solid #2a2e38', borderRadius: 3, outline: 'none' }}
                        />
                        <button onClick={() => handleUpdateBalance(u.id)}
                          style={{ padding: '3px 8px', fontSize: 11, background: '#f0b400', color: '#0d0e12', border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}>
                          修改
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
