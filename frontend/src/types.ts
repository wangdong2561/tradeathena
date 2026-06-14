export interface Ticker {
  symbol: string
  bid: number
  ask: number
  last: number
  change_24h: number
  volume_24h: number
  high_24h: number
  low_24h: number
  updated_at?: string
}

export interface Kline {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Account {
  id: number
  balance: number
  equity: number
  margin: number
  free_margin: number
  margin_level: number
  leverage: number
  open_positions: number
  total_unrealized_pl: number
}

export interface Position {
  id: number
  symbol: string
  side: 'buy' | 'sell'
  volume: number
  entry_price: number
  current_price: number
  stop_loss: number
  take_profit: number
  unrealized_pl: number
  created_at?: number
}

export interface PendingOrder {
  id: number
  symbol: string
  side: 'buy' | 'sell'
  order_type: 'market' | 'limit' | 'stop'
  volume: number
  price: number
  stop_price: number
  status: string
  filled_volume: number
  filled_price: number
  stop_loss: number
  take_profit: number
}

export interface TradeResult {
  order_id: number
  filled: boolean
  fill_price: number
  fill_volume: number
  message: string
  side?: string
}

export interface TradeHistory {
  id: number
  symbol: string
  side: string
  volume: number
  entry_price: number
  exit_price: number
  profit: number
  open_time: string
  close_time: string
}

export interface User {
  id: number
  username: string
  balance: number
  role: 'admin' | 'user'
}

export type OrderSide = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop'

export interface TradeMarker {
  id: string
  type: 'entry' | 'exit'
  side: 'buy' | 'sell'
  price: number
  time: number  // kline timestamp (seconds)
}
