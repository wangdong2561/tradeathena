import React, { useState } from 'react'
import { LoginPage } from './components/LoginPage'
import { TradingPage } from './components/TradingPage'

export const App: React.FC = () => {
  const [loggedIn, setLoggedIn] = useState(false)
  if (!loggedIn) return <LoginPage onLogin={() => setLoggedIn(true)} />
  return <TradingPage />
}
