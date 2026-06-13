import React, { useState } from 'react'

const DEFAULT_USER = 'admin'
const DEFAULT_PASS = 'admin123'

interface Props {
  onLogin: () => void
}

export const LoginPage: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码')
      return
    }
    if (username === DEFAULT_USER && password === DEFAULT_PASS) {
      onLogin()
    } else {
      setError('用户名或密码错误')
    }
  }

  return (
    <div style={{
      height: '100vh', width: '100vw',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0d0e12',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        background: '#13161a', border: '1px solid #2a2e38', borderRadius: 8,
        padding: '40px 36px', width: 340,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            fontSize: 22, fontWeight: 700, color: '#2962ff',
            letterSpacing: '-0.5px', marginBottom: 6,
          }}>
            TradeAthena
          </div>
          <div style={{ fontSize: 12, color: '#5a5f69' }}>
            量化交易终端 v0.1.0
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#8a8f99', marginBottom: 4 }}>
              用户名
            </label>
            <input
              value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              placeholder="admin"
              style={{
                width: '100%', padding: '8px 10px', fontSize: 13,
                background: '#1a1d24', color: '#d1d4dc',
                border: '1px solid #2a2e38', borderRadius: 4, outline: 'none',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.borderColor = '#2962ff'}
              onBlur={e => e.target.style.borderColor = '#2a2e38'}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#8a8f99', marginBottom: 4 }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="admin123"
              style={{
                width: '100%', padding: '8px 10px', fontSize: 13,
                background: '#1a1d24', color: '#d1d4dc',
                border: '1px solid #2a2e38', borderRadius: 4, outline: 'none',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.borderColor = '#2962ff'}
              onBlur={e => e.target.style.borderColor = '#2a2e38'}
            />
          </div>

          {error && (
            <div style={{
              color: '#f24453', fontSize: 12, marginBottom: 12,
              padding: '6px 10px', background: 'rgba(242,68,83,0.1)',
              borderRadius: 4,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 600,
              background: '#2962ff', color: '#fff', border: 'none', borderRadius: 4,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            登录
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 11, color: '#5a5f69', textAlign: 'center' }}>
          默认账户: admin / admin123
        </div>
      </div>
    </div>
  )
}
