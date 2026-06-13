import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { fetchKlines, fetchSymbols, getAccount, getPositions, getPendingOrders, resetAccount, subscribeKline } from '../api'
import { wsClient } from '../websocket'
import type { Ticker, Account, Kline, Position, PendingOrder, TradeResult, TradeMarker } from '../types'

import { TopBar } from './TopBar'
import { MarketWatch } from './MarketWatch'
import { TradingChart } from './TradingChart'
import { OrderBook } from './OrderBook'
import { OrderPanel } from './OrderPanel'
import { PositionsTable } from './PositionsTable'
import { OrdersTable } from './OrdersTable'
import { HistoryTable } from './HistoryTable'
import { AccountInfo } from './AccountInfo'

import '../styles.css'

type Tab = 'trade' | 'positions' | 'orders' | 'history'

export const TradingPage: React.FC = () => {
  // Market state
  const [symbols, setSymbols] = useState<string[]>(['BTCUSDT', 'XAUUSD', 'XAGUSD'])
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT')
  const [ticks, setTicks] = useState<Record<string, Ticker>>({})
  const [klineData, setKlineData] = useState<Kline[]>([])
  const [timeframe, setTimeframe] = useState('1m')

  // Account state
  const [account, setAccount] = useState<Account | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])

  // UI state
  const [terminalTab, setTerminalTab] = useState<Tab>('trade')
  const [connected, setConnected] = useState(false)
  const [orderMessage, setOrderMessage] = useState<string | null>(null)
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([])
  const markerId = useRef(0)

  const selectedRef = useRef(selectedSymbol)
  const timeframeRef = useRef(timeframe)
  selectedRef.current = selectedSymbol
  timeframeRef.current = timeframe

  // ── Initial Data Load ──────────────────────────────────

  useEffect(() => {
    fetchSymbols().then(data => {
      if (data.length > 0) setSymbols(data.map(t => t.symbol))
      const tickMap: Record<string, Ticker> = {}
      data.forEach(t => { tickMap[t.symbol] = t })
      setTicks(tickMap)
    }).catch(() => {})
    getAccount().then(setAccount).catch(() => {})
    getPositions().then(r => setPositions(r.positions)).catch(() => {})
    getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
  }, [])

  // ── Kline Loader ───────────────────────────────────────

  const loadKlines = useCallback(() => {
    fetchKlines(selectedRef.current, timeframeRef.current, 500)
      .then(setKlineData)
      .catch(() => {})
  }, [])

  // Load kline when symbol/timeframe changes
  useEffect(() => {
    loadKlines()
    subscribeKline(selectedSymbol, timeframe).catch(() => {})
  }, [selectedSymbol, timeframe, loadKlines])

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
      getPositions().then(r => setPositions(r.positions)).catch(() => {})
      getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
    })

    const unsubOrder = wsClient.onOrderUpdate(() => {
      getAccount().then(setAccount).catch(() => {})
      getPositions().then(r => setPositions(r.positions)).catch(() => {})
      getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
    })

    const unsubKline = wsClient.onKline(kline => {
      setKlineData(prev => {
        if (prev.length === 0) return prev
        const arr = [...prev]
        const last = arr[arr.length - 1]
        const ktime = Math.floor(kline.time / 1000) as any
        if (ktime === last.time) {
          arr[arr.length - 1] = {
            time: ktime,
            open: kline.open,
            high: Math.max(last.high, kline.high),
            low: Math.min(last.low, kline.low),
            close: kline.close,
            volume: kline.volume,
          }
        } else if (ktime > (last.time as number)) {
          arr.push({
            time: ktime,
            open: kline.open,
            high: kline.high,
            low: kline.low,
            close: kline.close,
            volume: kline.volume,
          })
        }
        return arr
      })
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
      getPositions().then(r => setPositions(r.positions)).catch(() => {})
    }, 5000)
    return () => clearInterval(iv)
  }, [])

  // ── Handlers ───────────────────────────────────────────

  const handleOrderResult = useCallback((result: TradeResult) => {
    setOrderMessage(result.message ? `${result.filled ? '✅ ' : '❌ '}${result.message}` : JSON.stringify(result))
    setTimeout(() => setOrderMessage(null), 4000)
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

  const handleResetAccount = useCallback(async () => {
    try {
      await resetAccount()
      getAccount().then(setAccount).catch(() => {})
      setPositions([])
      setPendingOrders([])
    } catch (e: any) {
      alert('重置失败: ' + e.message)
    }
  }, [])

  const currentTicker = ticks[selectedSymbol] || null

  return (
    <div className="trading-app">
      <TopBar
        symbols={symbols}
        selectedSymbol={selectedSymbol}
        onSymbolChange={setSelectedSymbol}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        account={account}
      />

      <PanelGroup direction="vertical" autoSaveId="main2" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={75} minSize={40}>
          <PanelGroup direction="horizontal" autoSaveId="main-h2" style={{ height: '100%' }}>
            <Panel defaultSize={15} minSize={10} maxSize={25}>
              <MarketWatch ticks={ticks} selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} />
            </Panel>
            <PanelResizeHandle className="resize-handle resize-handle-h" />
            <Panel minSize={40}>
              <TradingChart key={selectedSymbol + timeframe} data={klineData} symbol={selectedSymbol} tradeMarkers={tradeMarkers} bid={currentTicker?.bid} ask={currentTicker?.ask} />
            </Panel>
            <PanelResizeHandle className="resize-handle resize-handle-h" />
            <Panel defaultSize={16} minSize={12} maxSize={25}>
              <div className="right-panel">
                <OrderBook symbol={selectedSymbol} ticker={currentTicker} />
                <AccountInfo account={account} onReset={handleResetAccount} />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="resize-handle resize-handle-v" />

        <Panel defaultSize={25} minSize={12}>
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
            </div>
            <div className="terminal-content">
              {terminalTab === 'trade' && (
                <OrderPanel symbol={selectedSymbol} ticker={currentTicker} account={account} onOrderResult={handleOrderResult} />
              )}
              {terminalTab === 'positions' && (
                <PositionsTable positions={positions} onClose={(_id, pos) => {
                  getPositions().then(r => setPositions(r.positions)).catch(() => {})
                  getAccount().then(setAccount).catch(() => {})
                  // Add exit marker
                  if (pos && klineData.length > 0) {
                    const lastTime = klineData[klineData.length - 1].time as number
                    markerId.current += 1
                    setTradeMarkers(prev => [...prev, {
                      id: `exit-${markerId.current}`,
                      type: 'exit',
                      side: pos.side,
                      price: pos.current_price,
                      time: lastTime,
                    }])
                  }
                }} />
              )}
              {terminalTab === 'orders' && (
                <OrdersTable orders={pendingOrders} onCancel={() => {
                  getPendingOrders().then(r => setPendingOrders(r.orders)).catch(() => {})
                }} />
              )}
              {terminalTab === 'history' && <HistoryTable />}
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
        <span style={{ marginLeft: 'auto' }}>TradeAthena v0.1.0</span>
      </div>
    </div>
  )
}
