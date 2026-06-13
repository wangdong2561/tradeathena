import type { Ticker, Account } from './types'

type MarketCallback = (tick: Ticker) => void
type AccountCallback = (acc: Account) => void
type OrderCallback = (data: any) => void
type KlineCallback = (kline: any) => void

class WSClient {
  private marketWs: WebSocket | null = null
  private orderWs: WebSocket | null = null
  private marketCbs: MarketCallback[] = []
  private accountCbs: AccountCallback[] = []
  private orderCbs: OrderCallback[] = []
  private klineCbs: KlineCallback[] = []
  private reconnectTimer: number | null = null

  connect() {
    this.connectMarket()
    this.connectOrders()
  }

  private connectMarket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = location.host
    this.marketWs = new WebSocket(`${protocol}//${host}/ws/market`)

    this.marketWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'ticker') {
          this.marketCbs.forEach(cb => cb(msg.data))
        } else if (msg.type === 'kline') {
          this.klineCbs.forEach(cb => cb(msg.data))
        }
      } catch { /* ignore */ }
    }

    this.marketWs.onclose = () => {
      this.reconnectTimer = window.setTimeout(() => {
        if (this.marketWs?.readyState === WebSocket.CLOSED) this.connectMarket()
      }, 3000)
    }

    this.marketWs.onerror = () => {
      this.marketWs?.close()
    }
  }

  private connectOrders() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = location.host
    this.orderWs = new WebSocket(`${protocol}//${host}/ws/orders`)

    this.orderWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'account_update') {
          this.accountCbs.forEach(cb => cb(msg.data))
        } else {
          this.orderCbs.forEach(cb => cb(msg.data))
        }
      } catch { /* ignore */ }
    }

    this.orderWs.onclose = () => {
      this.reconnectTimer = window.setTimeout(() => {
        if (this.orderWs?.readyState === WebSocket.CLOSED) this.connectOrders()
      }, 3000)
    }

    this.orderWs.onerror = () => {
      this.orderWs?.close()
    }
  }

  onMarketTick(cb: MarketCallback) {
    this.marketCbs.push(cb)
    return () => { this.marketCbs = this.marketCbs.filter(c => c !== cb) }
  }

  onKline(cb: KlineCallback) {
    this.klineCbs.push(cb)
    return () => { this.klineCbs = this.klineCbs.filter(c => c !== cb) }
  }

  onAccountUpdate(cb: AccountCallback) {
    this.accountCbs.push(cb)
    return () => { this.accountCbs = this.accountCbs.filter(c => c !== cb) }
  }

  onOrderUpdate(cb: OrderCallback) {
    this.orderCbs.push(cb)
    return () => { this.orderCbs = this.orderCbs.filter(c => c !== cb) }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.marketWs?.close()
    this.orderWs?.close()
  }
}

export const wsClient = new WSClient()
