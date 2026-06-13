import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import {
  createChart, CrosshairMode,
  type IChartApi, type ISeriesApi,
  type CandlestickData, type LineData, type HistogramData,
  type PriceLineOptions,
} from 'lightweight-charts'
import type { Kline, TradeMarker } from '../types'
import { calcEMA, calcRSI } from '../utils/indicators'

interface Props {
  data: Kline[]
  symbol: string
  tradeMarkers?: TradeMarker[]
  bid?: number
  ask?: number
}

type Tool = 'crosshair' | 'horizontal' | 'none' | 'auto'

const LINE_COLORS = ['#2962ff', '#f24453', '#2ebd5b', '#f0ad4e', '#ab47bc', '#26c6da']

// Color themes: [up_done, down_done, up_form, down_form, name]
const COLOR_THEMES: [string, string, string, string, string][] = [
  ['#2962ff', '#f24453', '#00e5ff', '#aa00ff', '蓝红青紫'],  // 默认
  ['#26a69a', '#ef5350', '#80cbc4', '#ef9a9a', '绿红'],       // 绿涨红跌
  ['#4caf50', '#ff5722', '#a5d6a7', '#ffab91', '绿橙'],
  ['#2196f3', '#ff9800', '#90caf9', '#ffe0b2', '蓝橙'],
  ['#9c27b0', '#f44336', '#ce93d8', '#ef9a9a', '紫红'],
]

export const TradingChart: React.FC<Props> = ({ data, symbol, tradeMarkers = [], bid = 0, ask = 0 }) => {
  const [themeIdx, setThemeIdx] = useState(0)
  const colors = COLOR_THEMES[themeIdx]
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeries = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ema20Series = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Series = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiSeries = useRef<ISeriesApi<'Line'> | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>('crosshair')
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const [ohlcv, setOhlcv] = useState<string>('')
  const [horizLines, setHorizLines] = useState<{price: number; color: string}[]>([])
  const [showEMA, setShowEMA] = useState(true)
  const [showRSI, setShowRSI] = useState(true)
  const [crossPoints, setCrossPoints] = useState<{symbol:string;time:any;ema20:number;ema50:number;type:'golden'|'death'}[]>([])
  const isFirstData = useRef(true)
  const crosshairPrice = useRef(0)
  const lineCount = useRef(0)
  const priceLineRefs = useRef<any[]>([])
  const crossLineRefs = useRef<any[]>([])
  const bidLineRef = useRef<any>(null)
  const askLineRef = useRef<any>(null)
  // No timezone conversion — data source uses UTC, chart displays UTC

  // Safe setData wrapper — catches errors, no crash
  const sd = useCallback((series: any, data: any[]) => {
    if (!series) return
    try {
      const sorted = [...data].sort((a: any, b: any) => Number(a.time) - Number(b.time))
      series.setData(sorted)
    } catch {}
  }, [])

  // Calculate indicators
  const ema20Data = useMemo(() => {
    if (data.length < 20) return []
    return calcEMA(data, 20)
  }, [data])
  const ema50Data = useMemo(() => {
    if (data.length < 50) return []
    return calcEMA(data, 50)
  }, [data])
  const rsiData = useMemo(() => {
    if (data.length < 15) return []
    return calcRSI(data, 14)
  }, [data])

  const precision = symbol.includes('USDT') || symbol === 'XAUUSD' ? 2 : 4

  // Create chart (once)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const raf = requestAnimationFrame(() => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const w = Math.max(Math.floor(rect.width), 400)
      const h = Math.max(Math.floor(rect.height), 250)

      const chart = createChart(containerRef.current, {
        width: w, height: h,
        layout: {
          background: { color: '#13161a' },
          textColor: '#8a8f99',
        },
        grid: {
          vertLines: { color: '#1a1d24' },
          horzLines: { color: '#1a1d24' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: '#555', width: 1, style: 2, labelBackgroundColor: '#2962ff' },
          horzLine: { color: '#555', width: 1, style: 2, labelBackgroundColor: '#2962ff' },
        },
        timeScale: {
          borderColor: '#2a2e38',
          timeVisible: true,
        },
        rightPriceScale: {
          borderColor: '#2a2e38',
          visible: true,
          scaleMargins: { top: 0.05, bottom: 0.1 },
        },
        handleScroll: { vertTouchDrag: true, horzTouchDrag: true },
        handleScale: { axisPressedMouse: { time: true, price: true } },
      })

      // Main candlestick series
      const candles = chart.addCandlestickSeries({
        upColor: colors[0], downColor: colors[1],
        borderUpColor: colors[0], borderDownColor: colors[1],
        wickUpColor: colors[0], wickDownColor: colors[1],
        priceFormat: { type: 'price', precision, minMove: 0.01 },
        priceScaleId: 'right',
      })

      // Volume
      const volume = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      })
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

      // EMA 20
      const e20 = chart.addLineSeries({
        color: '#f0ad4e', lineWidth: 1,
        priceScaleId: 'right',
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      })

      // EMA 50
      const e50 = chart.addLineSeries({
        color: '#ab47bc', lineWidth: 1,
        priceScaleId: 'right',
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      })

      chartRef.current = chart
      candleSeries.current = candles
      volumeSeries.current = volume
      ema20Series.current = e20
      ema50Series.current = e50

      // Track crosshair price
      chart.subscribeCrosshairMove(param => {
        if (!param.point || !param.time) { setOhlcv(''); return }
        const cd = param.seriesData.get(candles) as any
        if (cd) {
          crosshairPrice.current = cd.close
          setOhlcv(`O:${cd.open.toFixed(precision)} H:${cd.high.toFixed(precision)} L:${cd.low.toFixed(precision)} C:${cd.close.toFixed(precision)}`)
        }
      })

      // Place horizontal line on click
      chart.subscribeClick(() => {
        if (activeToolRef.current !== 'horizontal' || !candleSeries.current) return
        const price = crosshairPrice.current
        if (price <= 0) return
        const color = LINE_COLORS[lineCount.current % LINE_COLORS.length]
        lineCount.current += 1
        const line = candleSeries.current.createPriceLine({
          price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
        } as PriceLineOptions)
        priceLineRefs.current.push(line)
        setHorizLines(prev => [...prev, { price, color }])
      })

      const observer = new ResizeObserver(entries => {
        for (const e of entries) {
          const { width: cw, height: ch } = e.contentRect
          if (cw > 0 && ch > 0 && chartRef.current) {
            chartRef.current.applyOptions({ width: Math.floor(cw), height: Math.floor(ch) })
          }
        }
      })
      observer.observe(containerRef.current)
      observerRef.current = observer
    })

    return () => {
      cancelAnimationFrame(raf)
      observerRef.current?.disconnect()
      chartRef.current?.remove()
      chartRef.current = null
      candleSeries.current = null
      volumeSeries.current = null
      ema20Series.current = null
      ema50Series.current = null
    }
  }, [])

  // ── Tool handlers ────────────────────────────────────

  const crosshairMode = useRef(0)

  const handleToolClick = useCallback((tool: Tool) => {
    const chart = chartRef.current
    if (!chart) return
    if (tool === 'crosshair') {
      const modes = [CrosshairMode.Normal, CrosshairMode.Magnet, CrosshairMode.Hidden]
      crosshairMode.current = (crosshairMode.current + 1) % modes.length
      chart.applyOptions({ crosshair: { mode: modes[crosshairMode.current] } })
      setActiveTool('crosshair')
    } else if (tool === 'auto') {
      chart.timeScale().fitContent()
      chart.priceScale('right').applyOptions({ autoScale: true })
      setActiveTool('crosshair')
    } else {
      setActiveTool(tool)
    }
  }, [])

  const clearLines = useCallback(() => {
    if (!candleSeries.current) return
    for (const line of priceLineRefs.current) {
      try { candleSeries.current.removePriceLine(line) } catch {}
    }
    priceLineRefs.current = []
    setHorizLines([])
    lineCount.current = 0
  }, [])

  // ── Update candle data (with per-bar colors) ──────────

  useEffect(() => {
    if (!candleSeries.current || !volumeSeries.current || data.length === 0) return

    // Safe copy sorted by time (Lightweight Charts requires ascending order)
    const sorted = [...data].sort((a, b) => (Number(a.time) - Number(b.time)))
    // Timestamps are UTC (as provided by data source)

    // Build candle data with per-bar colors
    const candleData: CandlestickData[] = sorted.map((k, i) => {
      const isForming = i === data.length - 1
      const isUp = k.close >= k.open
      let color: string
      if (isForming) {
        color = isUp ? colors[2] : colors[3]
      } else {
        color = isUp ? colors[0] : colors[1]
      }
      return {
        time: k.time as any,
        open: k.open, high: k.high, low: k.low, close: k.close,
        color,
        borderColor: color,
        wickColor: color,
      }
    })

    const volumeData: HistogramData[] = sorted.map((k: any) => ({
      time: k.time as any, value: k.volume,
      color: k.close >= k.open ? 'rgba(46, 189, 91, 0.3)' : 'rgba(242, 68, 83, 0.3)',
    }))

    sd(candleSeries.current, candleData)
    sd(volumeSeries.current, volumeData)
    if (isFirstData.current) {
      chartRef.current?.timeScale().fitContent()
      isFirstData.current = false
    }
  }, [data, precision])

  // ── Update EMA ───────────────────────────────────────

  useEffect(() => {
    if (!ema20Series.current || !ema50Series.current || data.length < 50) return
    const sorted = [...data].sort((a, b) => (Number(a.time) - Number(b.time)))
    const t = (i: number) => sorted[i].time as any

    const line20: LineData[] = []
    const line50: LineData[] = []
    for (let i = 0; i < sorted.length; i++) {
      if (ema20Data[i] !== null) line20.push({ time: t(i), value: ema20Data[i]! })
      if (ema50Data[i] !== null) line50.push({ time: t(i), value: ema50Data[i]! })
    }
    sd(ema20Series.current, line20)
    sd(ema50Series.current, line50)
    ema20Series.current.applyOptions({ visible: showEMA })
    ema50Series.current.applyOptions({ visible: showEMA })

    // Detect golden cross / death cross
    const crossMarkers: { time: any, ema20: number, ema50: number, type: 'golden' | 'death' }[] = []
    for (let i = 1; i < ema20Data.length; i++) {
      if (ema20Data[i] === null || ema20Data[i-1] === null || ema50Data[i] === null || ema50Data[i-1] === null) continue
      const prev20 = ema20Data[i-1]!, prev50 = ema50Data[i-1]!
      const curr20 = ema20Data[i]!, curr50 = ema50Data[i]!
      // Golden cross: EMA20 crosses ABOVE EMA50
      if (prev20 <= prev50 && curr20 > curr50) {
        crossMarkers.push({ time: t(i), ema20: curr20, ema50: curr50, type: 'golden' })
      }
      // Death cross: EMA20 crosses BELOW EMA50
      if (prev20 >= prev50 && curr20 < curr50) {
        crossMarkers.push({ time: t(i), ema20: curr20, ema50: curr50, type: 'death' })
      }
    }

    // Draw cross markers on chart (use price lines for prominent display)
    setCrossPoints(prev => {
      // Keep existing marks for the same symbol, add new
      const existing = prev.filter(m => m.symbol !== symbol)
      return [...existing, ...crossMarkers.map(m => ({
        symbol,
        time: m.time,
        ema20: m.ema20,
        ema50: m.ema50,
        type: m.type,
      }))]
    })
  }, [data, ema20Data, ema50Data, showEMA])

  // ── RSI pane ─────────────────────────────────────────

  useEffect(() => {
    if (!chartRef.current || data.length < 15) return
    // Create RSI series on first data
    if (!rsiSeries.current) {
      const chart = chartRef.current
      try {
        const rsi = chart.addLineSeries({
          color: '#26c6da', lineWidth: 1,
          priceScaleId: 'rsi',
          lastValueVisible: true,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        })
        chart.priceScale('rsi').applyOptions({
          scaleMargins: { top: 0.65, bottom: 0 },
          visible: showRSI,
        })
        rsiSeries.current = rsi
      } catch {}
    }

    if (!rsiSeries.current) return
    const rsiLine: LineData[] = []
    for (let i = 0; i < data.length; i++) {
      if (rsiData[i] !== null) rsiLine.push({ time: data[i].time as any, value: rsiData[i]! })
    }
    if (rsiLine.length > 0) sd(rsiSeries.current, rsiLine)
  }, [data, rsiData, showRSI])

  // Show/hide RSI scale
  useEffect(() => {
    if (!chartRef.current) return
    try {
      chartRef.current.priceScale('rsi').applyOptions({ visible: showRSI })
    } catch {}
  }, [showRSI])

  // ── Trade markers (entry/exit arrows) ──────────────

  useEffect(() => {
    if (!candleSeries.current) return
    const markers: any[] = []

    // Trade markers (entry: below bar, exit: above bar, with price label)
    for (const m of tradeMarkers) {
      const isBuy = m.side === 'buy'
      const isEntry = m.type === 'entry'
      markers.push({
        time: m.time as any,
        position: isEntry ? 'belowBar' : 'aboveBar',
        shape: isEntry
          ? (isBuy ? 'arrowUp' : 'arrowDown')
          : (isBuy ? 'arrowDown' : 'arrowUp'),
        color: isEntry
          ? (isBuy ? '#2ebd5b' : '#f24453')
          : (isBuy ? '#f24453' : '#2ebd5b'),
        size: 1.5,
        text: `${isEntry ? 'B' : 'S'} $${m.price.toFixed(2)}`,
      })
    }

    // Cross markers (render as diamond-shaped markers)
    for (const c of crossPoints) {
      markers.push({
        time: c.time,
        position: 'aboveBar',
        shape: 'diamond',
        color: c.type === 'golden' ? '#2ebd5b' : '#f24453',
        size: 1.5,
        text: c.type === 'golden' ? '金叉' : '死叉',
      })
    }

    markers.sort((a, b) => Number(a.time) - Number(b.time))
    candleSeries.current.setMarkers(markers)
  }, [tradeMarkers, crossPoints])

  // ── Bid/Ask price lines ────────────────────────────

  useEffect(() => {
    if (!candleSeries.current) return
    // Remove old lines
    if (bidLineRef.current) {
      try { candleSeries.current.removePriceLine(bidLineRef.current) } catch {}
    }
    if (askLineRef.current) {
      try { candleSeries.current.removePriceLine(askLineRef.current) } catch {}
    }
    // Create new lines
    if (bid > 0) {
      bidLineRef.current = candleSeries.current.createPriceLine({
        price: bid,
        color: '#999999',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '卖',
      } as PriceLineOptions)
    }
    if (ask > 0) {
      askLineRef.current = candleSeries.current.createPriceLine({
        price: ask,
        color: '#f24453',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '买',
      } as PriceLineOptions)
    }
    return () => {
      // Cleanup on unmount
      if (bidLineRef.current && candleSeries.current) {
        try { candleSeries.current.removePriceLine(bidLineRef.current) } catch {}
      }
      if (askLineRef.current && candleSeries.current) {
        try { candleSeries.current.removePriceLine(askLineRef.current) } catch {}
      }
    }
  }, [bid, ask])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Toolbar */}
      <div className="chart-toolbar">
        <button className={activeTool === 'crosshair' ? 'active' : ''} onClick={() => handleToolClick('crosshair')}>十字准星</button>
        <button className={activeTool === 'horizontal' ? 'active' : ''} onClick={() => handleToolClick('horizontal')}>
          水平线✎
        </button>
        <span className="separator" />
        <button onClick={() => { chartRef.current?.timeScale().scrollToPosition(-5, false) }}>◁</button>
        <button onClick={() => { chartRef.current?.timeScale().scrollToPosition(0, false) }}>▷</button>
        <span className="separator" />
        <button onClick={() => handleToolClick('auto')}>自适应</button>
        <span className="separator" />
        <button className={showEMA ? 'active' : ''} onClick={() => setShowEMA(!showEMA)}>EMA</button>
        <button className={showRSI ? 'active' : ''} onClick={() => setShowRSI(!showRSI)}>RSI</button>
        <button onClick={() => setThemeIdx((themeIdx + 1) % COLOR_THEMES.length)} title={COLOR_THEMES[(themeIdx + 1) % COLOR_THEMES.length][4]}>
          配色 <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colors[0], marginLeft: 2 }} />
        </button>
        <span className="separator" />
        {horizLines.length > 0 && (
          <button onClick={clearLines} style={{ color: 'var(--red)' }}>清除画线</button>
        )}
      </div>

      {/* OHLCV bar */}
      {ohlcv && (
        <div style={{
          height: 22, lineHeight: '22px', padding: '0 12px',
          background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border)',
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
        }}>
          {activeTool === 'horizontal' ? `✎ 点击画水平线 — ${crosshairPrice.current.toFixed(precision)}` : ohlcv}
        </div>
      )}

      {/* Chart */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative' }} />

      {/* Bottom legend */}
      <div style={{
        height: 18, lineHeight: '18px', padding: '0 12px',
        fontSize: 10, color: 'var(--text-muted)',
        background: 'var(--bg-tertiary)', borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{activeTool === 'horizontal' ? '✎ 点击画水平线 · 滚轮缩放' : '滚轮缩放 · 拖拽平移'}</span>
        <span>
          {showEMA && (
            <span style={{ marginRight: 10 }}>
              <span style={{ color: '#f0ad4e' }}>━</span> EMA20
              <span style={{ color: '#ab47bc', marginLeft: 6 }}>━</span> EMA50
              {crossPoints.filter(c => c.symbol === symbol).length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  {crossPoints.filter(c => c.symbol === symbol && c.type === 'golden').length > 0 &&
                    <span style={{ color: '#2ebd5b' }}>▲{crossPoints.filter(c => c.symbol === symbol && c.type === 'golden').length}</span>
                  }
                  {crossPoints.filter(c => c.symbol === symbol && c.type === 'death').length > 0 &&
                    <span style={{ color: '#f24453', marginLeft: 6 }}>▼{crossPoints.filter(c => c.symbol === symbol && c.type === 'death').length}</span>
                  }
                </span>
              )}
            </span>
          )}
          {symbol.replace('USDT', '/USDT').replace('XAUUSD', 'XAU/USD').replace('XAGUSD', 'XAG/USD')}
        </span>
      </div>

      {/* Horiz lines list */}
      {horizLines.length > 0 && (
        <div style={{
          position: 'absolute', top: 60, right: 12, zIndex: 100,
          background: 'rgba(19,22,26,0.9)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '6px 10px', fontSize: 10,
          fontFamily: 'var(--font-mono)',
        }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 4, fontSize: 9, textTransform: 'uppercase' }}>水平线</div>
          {horizLines.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
              <span style={{ width: 10, height: 2, background: h.color, display: 'inline-block' }} />
              <span style={{ color: 'var(--text-primary)' }}>${h.price.toFixed(precision)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
