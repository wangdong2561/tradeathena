import React, { useState } from 'react'
import { LoginPage } from './components/LoginPage'
import { TradingPage } from './components/TradingPage'
import type { User } from './types'

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('ta_user')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })

  const handleLogin = (user: User, token: string) => {
    localStorage.setItem('ta_token', token)
    localStorage.setItem('ta_user', JSON.stringify(user))
    setUser(user)
  }

  const handleLogout = () => {
    localStorage.removeItem('ta_token')
    localStorage.removeItem('ta_user')
    setUser(null)
  }

  if (!user) return <LoginPage onLogin={handleLogin} />
  return <TradingPage user={user} onLogout={handleLogout} />
}
