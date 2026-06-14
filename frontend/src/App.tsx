import React, { useState } from 'react'
import { LoginPage } from './components/LoginPage'
import { TradingPage } from './components/TradingPage'
import type { User } from './types'

export const App: React.FC = () => {
  // Clean up legacy keys from previous versions
  localStorage.removeItem('ta_login')

  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('ta_user')
      if (!stored) return null
      const parsed = JSON.parse(stored)
      return parsed && parsed.username && parsed.role ? parsed : null
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
