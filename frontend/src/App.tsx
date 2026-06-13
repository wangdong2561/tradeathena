import React, { useState } from 'react'
import { LoginPage } from './components/LoginPage'
import { TradingPage } from './components/TradingPage'

export const App: React.FC = () => {
  const [loggedIn, setLoggedIn] = useState(() => localStorage.getItem('ta_login') === '1')
  const handleLogin = () => {
    localStorage.setItem('ta_login', '1')
    setLoggedIn(true)
  }
  if (!loggedIn) return <LoginPage onLogin={handleLogin} />
  return <TradingPage />
}
