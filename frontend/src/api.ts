import type { Ticker, Kline, Account, Position, PendingOrder, TradeResult, TradeHistory } from './types'

const BASE = '/api/v1'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${detail.slice(0, 200)}`)
  }
  return res.json()
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

// ── Market ────────────────────────────────────────────

export async function fetchKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  const data = await get<{ data: number[][] }>(`/market/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  // Binance kline format: [time, open, high, low, close, volume, ...]
  return data.data.map(k => ({
    time: Math.floor(k[0] / 1000) as any,
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }))
}

export async function fetchSymbols(): Promise<Ticker[]> {
  const data = await get<{ symbols: Ticker[] }>('/market/symbols')
  return data.symbols
}

export async function fetchTicker(symbol: string): Promise<Ticker> {
  return get<Ticker>(`/market/ticker/${symbol}`)
}

export async function fetchNews(): Promise<{news: {title: string; summary: string; url: string; source: string; sentiment: number}[]}> {
  return get('/market/news')
}

export async function subscribeKline(symbol: string, interval: string): Promise<void> {
  await post('/market/subscribe-kline', { symbol, interval })
}

export async function fetchDepth(symbol: string, limit = 20): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
  return get(`/market/depth/${symbol}?limit=${limit}`)
}

// ── Orders ────────────────────────────────────────────

export async function placeOrder(params: {
  symbol: string
  side: string
  order_type: string
  volume: number
  price?: number
  stop_price?: number
  stop_loss?: number
  take_profit?: number
}): Promise<TradeResult> {
  return post('/orders', params)
}

export async function cancelOrder(orderId: number): Promise<{ success: boolean }> {
  return del(`/orders/${orderId}`)
}

export async function getPendingOrders(): Promise<{ orders: PendingOrder[] }> {
  return get('/orders/pending')
}

// ── Positions ─────────────────────────────────────────

export async function getPositions(): Promise<{ positions: Position[]; pending_orders?: PendingOrder[] }> {
  return get('/positions')
}

export async function modifyPosition(positionId: number, sl: number, tp: number): Promise<{ success: boolean }> {
  return put(`/positions/${positionId}`, { stop_loss: sl, take_profit: tp })
}

export async function closePosition(positionId: number): Promise<{ success: boolean; exit_price?: number; side?: string; profit?: number }> {
  return post(`/positions/${positionId}/close`)
}

// ── Account ───────────────────────────────────────────

export async function getAccount(): Promise<Account> {
  return get('/account')
}

export async function resetAccount(): Promise<{ success: boolean; account: Account }> {
  return post('/account/reset')
}

export async function getHistory(page = 1, pageSize = 50): Promise<{ trades: TradeHistory[]; total: number }> {
  return get(`/account/history?page=${page}&page_size=${pageSize}`)
}
