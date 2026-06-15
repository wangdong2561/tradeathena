import type { Ticker, Kline, Account, Position, PendingOrder, TradeResult, TradeHistory, User } from './types'

const BASE = '/api/v1'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('ta_token')
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

async function get<T>(path: string, auth = false): Promise<T> {
  const headers: Record<string, string> = auth ? authHeaders() : {}
  const res = await fetch(`${BASE}${path}`, { headers })
  if (res.status === 401) { localStorage.removeItem('ta_token'); localStorage.removeItem('ta_user'); window.location.reload() }
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(auth ? authHeaders() : {}) }
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) { localStorage.removeItem('ta_token'); localStorage.removeItem('ta_user'); window.location.reload() }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(detail.slice(0, 200) || `API error ${res.status}`)
  }
  return res.json()
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

async function put<T>(path: string, body: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(auth ? authHeaders() : {}) }
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
  if (res.status === 401) { localStorage.removeItem('ta_token'); localStorage.removeItem('ta_user'); window.location.reload() }
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

// ── Market ────────────────────────────────────────────

export async function fetchKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  const data = await get<{ data: number[][] }>(`/market/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  // OKX kline format: [time_ms, open, high, low, close, volume, ...]
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

// ── Auth ───────────────────────────────────────────────

export async function login(username: string, password: string): Promise<{ token: string; user: User }> {
  return post('/auth/login', { username, password })
}

export async function register(username: string, password: string): Promise<User> {
  return post('/auth/register', { username, password })
}

export async function fetchMe(): Promise<User> {
  return get('/auth/me', true)
}

export async function reloadEngine(): Promise<{ success: boolean; balance: number }> {
  return post('/auth/reload', undefined, true)
}

// ── Admin ──────────────────────────────────────────────

export async function fetchUsers(): Promise<{ users: User[] & { created_at?: string }[] }> {
  return get('/admin/users', true)
}

export async function updateUserBalance(userId: number, balance: number): Promise<{ success: boolean; balance: number }> {
  return put(`/admin/users/${userId}/balance`, { balance }, true)
}
