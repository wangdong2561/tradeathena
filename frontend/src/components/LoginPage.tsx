import React, { useState } from 'react'
import { login, register } from '../api'
import type { User } from '../types'

interface Props {
  onLogin: (user: User, token: string) => void
}

export const LoginPage: React.FC<Props> = ({ onLogin }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码')
      return
    }

    if (mode === 'register' && password !== confirm) {
      setError('两次密码输入不一致')
      return
    }

    setLoading(true)
    try {
      if (mode === 'login') {
        const result = await login(username.trim(), password)
        onLogin(result.user, result.token)
      } else {
        await register(username.trim(), password)
        // Switch to login after successful register
        setMode('login')
        setError('注册成功，请登录')
      }
    } catch (err: any) {
      try {
        const msg = JSON.parse(err.message)
        setError(msg.detail || '操作失败')
      } catch {
        setError(err.message || '操作失败')
      }
    } finally {
      setLoading(false)
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
            量化交易终端
          </div>
        </div>

        {/* Mode Tabs */}
        <div style={{ display: 'flex', marginBottom: 20, gap: 0 }}>
          <button onClick={() => { setMode('login'); setError('') }}
            style={{
              flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600,
              background: mode === 'login' ? '#1a1d24' : 'transparent',
              color: mode === 'login' ? '#d1d4dc' : '#5a5f69',
              border: '1px solid', borderColor: mode === 'login' ? '#2962ff' : '#2a2e38',
              borderRadius: '4px 0 0 4px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
            登录
          </button>
          <button onClick={() => { setMode('register'); setError('') }}
            style={{
              flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600,
              background: mode === 'register' ? '#1a1d24' : 'transparent',
              color: mode === 'register' ? '#d1d4dc' : '#5a5f69',
              border: '1px solid', borderColor: mode === 'register' ? '#2962ff' : '#2a2e38',
              borderRadius: '0 4px 4px 0', cursor: 'pointer', fontFamily: 'inherit',
            }}>
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#8a8f99', marginBottom: 4 }}>
              用户名
            </label>
            <input
              value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              placeholder={mode === 'login' ? 'admin' : '至少2个字符'}
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

          <div style={{ marginBottom: mode === 'register' ? 14 : 20 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#8a8f99', marginBottom: 4 }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder={mode === 'login' ? 'admin123' : '至少4个字符'}
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

          {mode === 'register' && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#8a8f99', marginBottom: 4 }}>
                确认密码
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError('') }}
                placeholder="再次输入密码"
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
          )}

          {error && (
            <div style={{
              color: error.includes('成功') ? '#4caf50' : '#f24453',
              fontSize: 12, marginBottom: 12,
              padding: '6px 10px',
              background: error.includes('成功') ? 'rgba(76,175,80,0.1)' : 'rgba(242,68,83,0.1)',
              borderRadius: 4,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 600,
              background: loading ? '#1a3a8a' : '#2962ff', color: '#fff',
              border: 'none', borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {loading ? '请稍候...' : (mode === 'login' ? '登录' : '注册')}
          </button>
        </form>
      </div>
    </div>
  )
}
