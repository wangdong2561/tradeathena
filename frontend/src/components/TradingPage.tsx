import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { fetchKlines, fetchSymbols, getAccount, getPositions, getPendingOrders, subscribeKline, fetchNews } from '../api'
import { wsClient } from '../websocket'
import type { Ticker, Account, Kline, Position, PendingOrder, TradeResult, TradeMarker } from '../types'
import { StrategyPanel, signalToMarker } from './StrategyPanel'
import { DEFAULT_STRATEGY_CONFIG, type StrategyConfig, type StrategySignal } from '../utils/strategy'

import { TopBar } from './TopBar'
import { MarketWatch } from './MarketWatch'
import { TradingChart } from './TradingChart'
import { OrderPanel } from './OrderPanel'
import { PositionsTable } from './PositionsTable'
import { OrdersTable } from './OrdersTable'
import { HistoryTable } from './HistoryTable'

import '../styles.css'

type Tab = 'trade' | 'positions' | 'orders' | 'history' | 'strategy'

export const TradingPage: React.FC = () => {
  // Clocks: UTC in marketwatch, Beijing in statusbar
  const [utcClock, setUtcClock] = useState('')
  const [bjClock, setBjClock] = useState('')
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setUtcClock(d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC')
      setBjClock(d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [])
  // Market state
  const [symbols, setSymbols] = useState<string[]>(['BTCUSDT', 'XAUUSD', 'XAGUSD'])
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT')
  const [ticks, setTicks] = useState<Record<string, Ticker>>({})
  const [klineData, setKlineDataSorted] = useState<Kline[]>([])
  const [klineData2, setKlineData2] = useState<Kline[]>([])
  // Left chart = 1m (波动, 找成交时机)  |  Right chart = 1h (趋势, 看方向)
  const [timeframe, setTimeframe] = useState('1m')   // left - entry timing
  const [timeframe2, setTimeframe2] = useState('1h') // right - trend direction

  // Auto-calculate: when right chart changes, sync left accordingly
  const tfMap: Record<string, string> = {
    '1m': '1m', '3m': '1m', '5m': '1m', '15m': '1m', '30m': '1m',
    '1h': '1m', '2h': '1m', '4h': '1m', '6h': '1m', '12h': '1m', '1d': '1m',
  }
  const updateTimeframe2 = useCallback((tf: string) => {
    setTimeframe2(tf)
    setTimeframe(tfMap[tf] || '1m')
  }, [])

  // Account state
  const [account, setAccount] = useState<Account | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])

  // UI state
  const [terminalTab, setTerminalTab] = useState<Tab>('trade')
  const [connected, setConnected] = useState(false)
  const [orderMessage, setOrderMessage] = useState<string | null>(null)
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([])
  const [newsItems, setNewsItems] = useState<{title:string;summary:string;url:string;source:string;sentiment:number}[]>([])
  const markerId = useRef(0)

  // Strategy state
  const [strategyConfig, setStrategyConfig] = useState<StrategyConfig>(DEFAULT_STRATEGY_CONFIG)
  const lastSignalType = useRef<'buy' | 'sell' | null>(null)
  const [strategyMarkers, setStrategyMarkers] = useState<TradeMarker[]>([])

  const selectedRef = useRef(selectedSymbol)
  const timeframeRef = useRef(timeframe)
  selectedRef.current = selectedSymbol
  timeframeRef.current = timeframe
  const selectedRef2 = useRef(selectedSymbol)
  const timeframeRef2 = useRef(timeframe2)
  selectedRef2.current = selectedSymbol
  timeframeRef2.current = timeframe2

  // ── Initial Data Load ──────────────────────────────────

  useEffect(() => {
    fetchSymbols().then(data => {
      if (data.length > 0) setSymbols(data.map(t => t.symbol))
      const tickMap: Record<string, Ticker> = {}
      data.forEach(t => { tickMap[t.symbol] = t })
      setTicks(tickMap)
    }).catch(() => {})
    getAccount().then(setAccount).catch(() => {})
    getPositions().then(r => { setPositions(r.positions); if (r.pending_orders) setPendingOrders(r.pending_orders) }).catch(() => {})
    getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
  }, [])

  // ── Kline Loader ───────────────────────────────────────

  // Sort-safe setter: ensures data is always in ascending time order
  const setKlineDataSortedSorted = useCallback((data: Kline[] | ((prev: Kline[]) => Kline[])) => {
    if (typeof data === 'function') {
      setKlineDataSorted(prev => {
        const result = data(prev)
        return result.sort((a, b) => (Number(a.time) - Number(b.time)))
      })
    } else {
      setKlineDataSorted(data.sort((a, b) => (Number(a.time) - Number(b.time))))
    }
  }, [])

  const loadKlines = useCallback(() => {
    const limit = timeframeRef.current === '1h' ? 48 : timeframeRef.current === '1d' ? 7 : 200
    fetchKlines(selectedRef.current, timeframeRef.current, limit)
      .then(d => setKlineDataSortedSorted(d))
      .catch(() => {})
  }, [setKlineDataSortedSorted])

  const loadKlines2 = useCallback(() => {
    fetchKlines(selectedRef2.current, timeframeRef2.current, 200)
      .then(setKlineData2)
      .catch(() => {})
  }, [])

  // Load kline when symbol/timeframe changes
  useEffect(() => {
    loadKlines()
    subscribeKline(selectedSymbol, timeframe).catch(() => {})
  }, [selectedSymbol, timeframe, loadKlines])

  useEffect(() => {
    loadKlines2()
    subscribeKline(selectedSymbol, timeframe2).catch(() => {})
  }, [selectedSymbol, timeframe2, loadKlines2])

  // ── News ────────────────────────────────────────────────
  useEffect(() => {
    fetchNews().then(d => setNewsItems(d.news)).catch(() => {})
    const iv = setInterval(() => {
      fetchNews().then(d => setNewsItems(d.news)).catch(() => {})
    }, 300000)
    return () => clearInterval(iv)
  }, [])

  // ── WebSocket ──────────────────────────────────────────

  useEffect(() => {
    wsClient.connect()
    setConnected(true)

    let wsConnected = true
    const statusCheck = setInterval(() => {
      setConnected(wsConnected)
      wsConnected = false
    }, 5000)

    const unsubTicker = wsClient.onMarketTick(tick => {
      wsConnected = true
      setConnected(true)
      setTicks(prev => ({ ...prev, [tick.symbol]: tick }))
    })

    const unsubAccount = wsClient.onAccountUpdate(acc => {
      wsConnected = true
      setConnected(true)
      setAccount(acc)
      getPositions().then(r => { setPositions(r.positions); if (r.pending_orders) setPendingOrders(r.pending_orders) }).catch(() => {})
      getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
    })

    const unsubOrder = wsClient.onOrderUpdate(() => {
      getAccount().then(setAccount).catch(() => {})
      getPositions().then(r => { setPositions(r.positions); if (r.pending_orders) setPendingOrders(r.pending_orders) }).catch(() => {})
      getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
    })

    // Helper: update a kline data array with incoming WS kline
    const updateKlineArr = (prev: Kline[], kline: any): Kline[] => {
      if (prev.length === 0) return prev
      const arr = [...prev]
      const last = arr[arr.length - 1]
      const ktime = Math.floor(kline.time / 1000) as number
      const lastTime = last.time as number

      if (ktime === lastTime) {
        arr[arr.length - 1] = {
          time: ktime, open: kline.open,
          high: Math.max(last.high, kline.high),
          low: Math.min(last.low, kline.low),
          close: kline.close, volume: kline.volume,
        }
      } else if (ktime > lastTime) {
        arr.push({ time: ktime, open: kline.open, high: kline.high, low: kline.low, close: kline.close, volume: kline.volume })
      } else {
        const idx = arr.findIndex(c => (c.time as number) === ktime)
        if (idx >= 0) {
          arr[idx] = { time: ktime, open: kline.open, high: Math.max(arr[idx].high, kline.high), low: Math.min(arr[idx].low, kline.low), close: kline.close, volume: kline.volume }
        }
      }
      return arr
    }

    const unsubKline = wsClient.onKline(kline => {
      if (kline.symbol && selectedRef.current !== kline.symbol) return
      const interval = kline.interval || ''
      // Route to correct chart based on interval
      if (interval === timeframeRef.current) {
        setKlineDataSorted(prev => updateKlineArr(prev, kline))
      }
      if (interval === timeframeRef2.current) {
        setKlineData2(prev => updateKlineArr(prev, kline))
      }
    })

    return () => {
      wsClient.disconnect()
      unsubTicker()
      unsubAccount()
      unsubOrder()
      unsubKline()
      clearInterval(statusCheck)
    }
  }, [])

  // ── Fallback polling ───────────────────────────────────

  useEffect(() => {
    const iv = setInterval(() => {
      getAccount().then(setAccount).catch(() => {})
      getPositions().then(r => { setPositions(r.positions); if (r.pending_orders) setPendingOrders(r.pending_orders) }).catch(() => {})
    }, 5000)
    return () => clearInterval(iv)
  }, [])

  // ── Handlers ───────────────────────────────────────────

  const handleOrderResult = useCallback((result: TradeResult) => {
    setOrderMessage(result.message ? `${result.filled ? '✅ ' : '❌ '}${result.message}` : JSON.stringify(result))
    setTimeout(() => setOrderMessage(null), 4000)
    // Refresh account and positions
    getAccount().then(setAccount).catch(() => {})
    getPositions().then(r => { setPositions(r.positions); if (r.pending_orders) setPendingOrders(r.pending_orders) }).catch(() => {})
    getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
    // Add entry marker on filled order
    if (result.filled && klineData.length > 0 && result.side) {
      const lastTime = klineData[klineData.length - 1].time as number
      markerId.current += 1
      setTradeMarkers(prev => [...prev, {
        id: `entry-${markerId.current}`,
        type: 'entry',
        side: result.side as 'buy' | 'sell',
        price: result.fill_price,
        time: lastTime,
      }])
    }
  }, [klineData])

  const currentTicker = ticks[selectedSymbol] || null

  return (
    <div className="trading-app">
      <TopBar
        symbols={symbols}
        selectedSymbol={selectedSymbol}
        onSymbolChange={setSelectedSymbol}
        account={account}
      />

      <PanelGroup direction="vertical" autoSaveId="main5" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={55} minSize={35}>
          <PanelGroup direction="horizontal" autoSaveId="charts-h" style={{ height: '100%' }}>
            <Panel defaultSize={12} minSize={8} maxSize={20}>
              <MarketWatch ticks={ticks} selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} clock={utcClock} />
            </Panel>
            <PanelResizeHandle className="resize-handle resize-handle-h" />
            <Panel minSize={30}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{selectedSymbol.replace('USDT', '/USDT').replace('XAUUSD', 'XAU/USD').replace('XAGUSD', 'XAG/USD')}</span>
                  <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600, marginLeft: 4 }}>1m 波动</span>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <TradingChart key={selectedSymbol + timeframe} data={klineData} symbol={selectedSymbol}
                    tradeMarkers={[...tradeMarkers, ...strategyMarkers]} bid={currentTicker?.bid} ask={currentTicker?.ask} />
                </div>
                <div style={{ height: 80, padding: '4px 10px', background: 'var(--bg-primary)', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, overflowY: 'auto' }}>
                  <div style={{ fontWeight: 600, fontSize: 9, color: 'var(--text-secondary)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.5px' }}>实时盈亏</div>
                  {positions.length > 0 ? positions.map(p => {
                    const tick = ticks[p.symbol]
                    const curr = tick ? (p.side === 'buy' ? tick.bid : tick.ask) : p.current_price
                    const pl = p.side === 'buy' ? (curr - p.entry_price) * p.volume : (p.entry_price - curr) * p.volume
                    return (
                      <div key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '1px 0', fontSize: 10 }}>
                        <span style={{ color: p.side === 'buy' ? 'var(--green)' : 'var(--red)', fontWeight: 600, width: 24 }}>{p.side === 'buy' ? '多' : '空'}</span>
                        <span style={{ width: 44 }}>{p.symbol.replace('USDT','').replace('XAUUSD','XAU').replace('XAGUSD','XAG')}</span>
                        <span style={{ color: 'var(--text-muted)', width: 82 }}>开 {p.entry_price.toFixed(2)}</span>
                        <span style={{ color: 'var(--text-muted)', width: 80 }}>现 {curr.toFixed(2)}</span>
                        <span style={{ width: 40 }}>{p.volume.toFixed(3)}</span>
                        <span style={{ fontWeight: 600, color: pl >= 0 ? 'var(--green)' : 'var(--red)', width: 56 }}>${pl.toFixed(2)}</span>
                        <span style={{ color: 'var(--text-muted)', width: 65, fontSize: 9, fontFamily: 'var(--font-mono)' }}>
                          {p.created_at ? new Date(p.created_at * 1000).toISOString().slice(11, 16) + ' UTC' : ''}
                        </span>
                      </div>
                    )
                  }) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, padding: '4px 0' }}>暂无持仓</div>
                  )}
                </div>
              </div>
            </Panel>
            <PanelResizeHandle className="resize-handle resize-handle-h" />
            <Panel defaultSize={35} minSize={25}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{selectedSymbol.replace('USDT', '/USDT').replace('XAUUSD', 'XAU/USD').replace('XAGUSD', 'XAG/USD')}</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {['1m','5m','15m','1h','4h','1d'].map(t => (
                      <button key={t} onClick={() => updateTimeframe2(t)}
                        style={{ background: 'transparent', border: 'none', color: timeframe2 === t ? 'var(--accent)' : 'var(--text-secondary)', padding: '1px 5px', fontSize: 10, cursor: 'pointer', borderRadius: 2 }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <TradingChart key={'c2'+selectedSymbol+timeframe2} data={klineData2} symbol={selectedSymbol} tradeMarkers={[]} />
                </div>
                {/* News ticker at chart bottom */}
                <div style={{ height: 48, padding: '3px 10px', background: 'var(--bg-primary)', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: 14, overflowX: 'auto', whiteSpace: 'nowrap', height: '100%', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>📰 影响因素</span>
                    {newsItems.length > 0 ? newsItems.slice(0, 8).map((item, i) => (
                      <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer' }}>{item.title.slice(0, 50)}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 8 }}>{item.source}</span>
                      </a>
                    )) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>加载中...</span>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="resize-handle resize-handle-v" />

        <Panel defaultSize={45} minSize={30}>
          <div className="terminal">
            <div className="terminal-tabs">
              <button className={terminalTab === 'trade' ? 'active' : ''} onClick={() => setTerminalTab('trade')}>交易</button>
              <button className={terminalTab === 'positions' ? 'active' : ''} onClick={() => setTerminalTab('positions')}>
                持仓 {positions.length > 0 ? `(${positions.length})` : ''}
              </button>
              <button className={terminalTab === 'orders' ? 'active' : ''} onClick={() => setTerminalTab('orders')}>
                挂单 {pendingOrders.length > 0 ? `(${pendingOrders.length})` : ''}
              </button>
              <button className={terminalTab === 'history' ? 'active' : ''} onClick={() => setTerminalTab('history')}>历史</button>
              <button className={terminalTab === 'strategy' ? 'active' : ''} onClick={() => setTerminalTab('strategy')}>策略</button>
            </div>
            <div className="terminal-content">
              {terminalTab === 'trade' && (
                <OrderPanel symbol={selectedSymbol} ticker={currentTicker} account={account} onOrderResult={handleOrderResult} />
              )}
              {terminalTab === 'positions' && (
                <PositionsTable positions={positions} onClose={() => {
                  getPositions().then(r => { setPositions(r.positions); if (r.pending_orders) setPendingOrders(r.pending_orders) }).catch(() => {})
                  getAccount().then(setAccount).catch(() => {})
                  setTradeMarkers([])  // clear all markers after close
                }} />
              )}
              {terminalTab === 'orders' && (
                <OrdersTable orders={pendingOrders} onCancel={() => {
                  getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
                }} />
              )}
              {terminalTab === 'history' && <HistoryTable />}
              {terminalTab === 'strategy' && (
                <StrategyPanel
                  klineData={klineData}
                  config={strategyConfig}
                  onConfigChange={setStrategyConfig}
                  lastSignalType={lastSignalType.current}
                  onNewSignal={(sig) => {
                    lastSignalType.current = sig.type
                    setStrategyMarkers(prev => [...prev, signalToMarker(sig)])
                  }}
                />
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>

      {/* Toast */}
      {orderMessage && (
        <div style={{
          position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
          padding: '8px 20px', borderRadius: 6, zIndex: 2000,
          fontSize: 13, color: 'var(--text-primary)',
        }}>
          {orderMessage}
        </div>
      )}

      <div className="statusbar">
        <span>
          <span className={`status-dot ${connected ? 'connected' : 'reconnecting'}`} />
          {connected ? '已连接' : '重连中...'}
        </span>
        <span>{selectedSymbol.replace('USDT', '/USDT').replace('XAUUSD', 'XAU/USD').replace('XAGUSD', 'XAG/USD')}</span>
        {currentTicker && (
          <>
            <span>买 {currentTicker.bid.toFixed(2)}</span>
            <span>卖 {currentTicker.ask.toFixed(2)}</span>
            <span>涨跌 <span className={currentTicker.change_24h >= 0 ? 'green' : 'red'}>
              {currentTicker.change_24h >= 0 ? '+' : ''}{currentTicker.change_24h.toFixed(2)}%
            </span></span>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>{bjClock} 北京</span>
      </div>
    </div>
  )
}
