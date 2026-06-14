[![中文](https://img.shields.io/badge/lang-中文-red.svg)](README-zh.md)

# TradeAthena — Quantitative Trading Terminal

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A professional-grade quantitative trading web platform, comparable to MT4/MT5. Supports real-time cryptocurrency, gold, and silver market data with simulated trading — built to help you become a top quantitative trader.

![Screenshot](home.png)

## Tech Stack

| Language | Role | Key Dependencies |
|:---|:---|:---|
| **Rust** 🦀 | Core matching engine — order matching, position management, risk calculation, margin accounting. Pure in-memory execution with microsecond latency. Compiled to a Python native extension via PyO3. | PyO3 |
| **Python** 🐍 | Web API layer — FastAPI async framework providing REST + WebSocket endpoints, market data aggregation, SQLite persistence, Binance/gold API integration. | FastAPI, SQLAlchemy, httpx |
| **TypeScript** 📘 | Frontend logic — React component tree, state management, WebSocket client, chart rendering, technical indicator calculation. | React 18 |
| **CSS** 🎨 | MT5-style dark theme — custom design tokens, Flex/Grid layout, responsive panels. | — |

### Architecture

```
Frontend (TypeScript + React)     ← User Interface Layer
       ↕ WebSocket + REST
Backend (Python + FastAPI)         ← Service Gateway Layer
       ↕ PyO3 FFI
Core Engine (Rust)                 ← High-Performance Computing Layer
```

- **Rust Layer**: Hot path (matching, risk), zero-GC latency, lock-free in-memory operations
- **Python Layer**: I/O-bound tasks (network requests, database, WebSocket management) via async/await
- **TypeScript Layer**: UI rendering, real-time data subscription, chart interaction via Vite HMR

---

## Requirements

- **Python** 3.10+
- **Node.js** 18+
- **Rust** (first-time build only, not needed afterwards)
- **Network** access to `api.binance.com` and `api.gold-api.com`

---

## Installation

```bash
# 1. Enter project directory (replace with your actual path)
cd ~/tradeathena

# 2. Create Python virtual environment
python3 -m venv .venv

# 3. Activate it
source .venv/bin/activate

# 4. Install Python dependencies
pip install -r requirements.txt
pip install maturin

# 5. Build Rust core engine (requires Rust toolchain)
export PATH="$HOME/.cargo/bin:$PATH"
PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 maturin develop --release

# 6. Install frontend dependencies
cd frontend && npm install && cd ..
```

---

## Running

### One-command start

```bash
cd ~/tradeathena
bash run.sh
```

### Separate terminals

**Terminal 1 — Backend (port 8000):**

```bash
cd ~/tradeathena
source .venv/bin/activate
export PATH="$HOME/.cargo/bin:$PATH"
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend (port 5173):**

```bash
cd ~/tradeathena/frontend
npm run dev
```

### Access

| URL | Description |
|:---|:---|
| **http://localhost:5173** | Trading terminal UI |
| **http://localhost:8000/docs** | Backend API docs (Swagger) |

**Default login:** Username `admin` / Password `admin123`

---

## Data Sources

| Symbol | Source | Type | Update Frequency |
|:---|:---|:---|:---|
| **BTC/USDT** | OKX WebSocket | Real-time push | ~100ms |
| **XAU/USD** Gold | gold-api.com REST | Real price | Every 5 min |
| **XAG/USD** Silver | gold-api.com REST | Real price | Every 5 min |

> Gold and silver prices update only on API refresh — no simulated drift, static during market close.

---

## Project Structure

```
tradeathena/
├── src/                        # 🔴 Rust Core Engine (PyO3)
│   ├── lib.rs                 # Python bindings
│   ├── types.rs               # Shared data types
│   └── matching.rs            # Matching engine (with unit tests)
├── backend/                    # 🐍 Python FastAPI Backend
│   ├── main.py                # Application entry + lifecycle
│   ├── config.py              # Configuration
│   ├── database.py            # SQLite async connection
│   ├── models.py              # ORM models
│   ├── app_state.py           # State injection
│   ├── routes/                # API routes
│   ├── services/              # Business services
│   └── ws/                    # WebSocket manager
├── frontend/                   # ⚛️ React + TypeScript Frontend
│   ├── src/
│   │   ├── components/        # UI components (18 files)
│   │   ├── utils/indicators.ts# Technical indicators
│   │   ├── styles.css         # Dark theme
│   │   ├── api.ts             # REST client
│   │   ├── websocket.ts       # WS client
│   │   └── types.ts           # TypeScript definitions
│   └── package.json
├── Design.md                   # Design document
├── README.md                   # This file (English)
├── README-zh.md                # Chinese documentation
├── run.sh                      # Start script
├── Cargo.toml                  # Rust config
├── pyproject.toml              # Python build config
└── requirements.txt            # Python dependencies
```

---

## Features

| Feature | Status | Description |
|:---|:---|:---|
| K-line Chart | ✅ | 1m/5m/15m/30m/1h/4h/6h/12h/1d/1w |
| Dual Charts | ✅ | Side-by-side, independent timeframes, synced time axis |
| Candle Color Themes | ✅ | Multiple color schemes, toggle in toolbar |
| Real-time Push | ✅ | Binance WS → WebSocket → Frontend |
| Candle Colors | ✅ | Forming: Cyan/Purple — Closed: Blue/Red |
| Long/Short Trading | ✅ | Hedging mode, each order independent |
| Market/Limit/Stop Orders | ✅ | Three order types |
| Mandatory SL | ✅ | Auto -10% stop loss on every trade |
| SL/TP Quick Setup | ✅ | Preset % buttons + custom input |
| Real-time P&L Calculator | ✅ | Live position P&L, entry time, per-trade display |
| EMA 20/50 Indicators | ✅ | Toggle display |
| Golden/Death Cross Detection | ✅ | Auto ◆ markers + counters |
| RSI Indicator | ✅ | 14-period, overbought/oversold |
| Bollinger Bands | ✅ | 20,2 with upper/middle/lower bands |
| 200 EMA | ✅ | Long-term trend indicator, toggle display |
| Strategy: BB + RSI | ✅ | Buy/Sell signals on chart, configurable params |
| Strategy Panel | ✅ | Real-time status & parameter tuning |
| Horizontal Line Drawing | ✅ | Click to place, clearable |
| Entry/Exit Markers | ✅ | Auto-arrows on chart |
| Bid/Ask Reference Lines | ✅ | Red=Ask, Gray=Bid |
| Market News Feed | ✅ | Sina Finance Chinese news, auto-refresh |
| Account Management | ✅ | Balance/Equity/Margin/Leverage |
| Trade History | ✅ | SQLite persistent |
| Dark Theme | ✅ | MT5-style professional theme |
| Resizable Panels | ✅ | react-resizable-panels |
| Login Page | ✅ | Default admin/admin123 |
| Symbol Info | ✅ | Trading hours, exchange, specs |
| Error Boundary | ✅ | No black screen on crash |

---

## 📊 Built-in Strategy: Bollinger Bands + RSI

A configurable quantitative strategy that generates buy/sell signals on the chart.

### Entry Conditions

| Signal | Condition 1 | Condition 2 | Optional Filter |
|:---|:---|:---|:---|
| **🟢 Buy** (Long) | Price ≤ BB Lower Band | RSI < 30 (Oversold) | Price above 200 EMA |
| **🔴 Sell** (Short) | Price ≥ BB Upper Band | RSI > 70 (Overbought) | Price below 200 EMA |

### Exit Rules (manual execution guided by panel)

1. **Price returns to middle band** → Close 50% position
2. **Price hits opposite band** → Close 100%
3. **Fixed stop loss** → Default -1.5% (configurable)

### Configuration
- BB Period (default 20) & Standard Deviation (default 2)
- RSI Oversold (default 30) & Overbought (default 70) thresholds
- 200 EMA Trend Filter toggle
- Stop Loss % (default 1.5%)

Signals appear as arrows on the chart. Open the **Strategy** tab in the terminal panel to monitor real-time status and adjust parameters.

---

## Trading Hours (EET)

> System time is Eastern European Time (EET). DST (Mar-Oct): UTC+3, Winter: UTC+2.

| Symbol | Exchange | Trading Hours | Break |
|:---|:---|:---|:---|
| **BTC/USDT** | Binance | 🟢 24h × 7d | None |
| **XAU/USD** | COMEX | 🟡 Mon 06:00→Sat 05:00 (DST) | Daily 05:00-06:00 |
| **XAG/USD** | COMEX | 🟡 Mon 06:00→Sat 05:00 (DST) | Daily 05:00-06:00 |

---

## 💡 Quantitative Trading Wisdom

### Core Principles

1. **Capital Preservation First** — Never risk more than 2% of total capital on a single trade
2. **Follow the Trend** — Don't trade against the major trend; it's your friend
3. **Plan Your Trade, Trade Your Plan** — Define SL/TP before entry, execute strictly
4. **Risk-Reward Mindset** — Only take trades with at least 1:2 risk-reward ratio
5. **Less is More** — Reduce frequency, increase win rate, wait for high-probability setups
6. **Never Martingale** — Stop-loss is a trader's insurance; trading without one is gambling
7. **Journal Every Trade** — An unrecorded trade never happened; review is the ladder to growth

### Key Risks

| Risk Type | Description | Mitigation |
|:---|:---|:---|
| 📉 **Market Risk** | Violent adverse price movement | Strict stop-loss, position sizing |
| ⚡ **Liquidity Risk** | Inability to execute at expected price in extreme conditions | Avoid trading around news events |
| 🔗 **Leverage Risk** | High leverage amplifies losses | Keep leverage under 20x |
| 🌐 **Black Swan** | Unexpected political/economic events crashing markets | Diversify, never full margin |
| 🤖 **System Risk** | Software/network failure preventing trading | Stable connection, backup plan |

### Qualities of a Top Trader

> **"Trading isn't about being right or wrong — it's about how you handle being wrong."**

| Quality | Description |
|:---|:---|
| 🧊 **Discipline** | Follow your system rigorously, don't trade on impulse |
| 🎭 **Emotional Control** | No panic during losses, no greed during wins |
| 📊 **Data-Driven** | Find patterns in historical data, not "gut feelings" |
| 🔄 **Continuous Learning** | Markets evolve; keep learning and adapting |
| 🕰️ **Patience** | Wait for your setup; not every move needs to be caught |
| 📝 **Review Habit** | Weekly trade review to identify mistakes and blind spots |

### Simulated Practice with This Software

**Before trading with real money, complete this simulation program:**

1. **Foundation (100 trades)**: Learn the interface — placing orders, closing positions, setting SL/TP
2. **Strategy (300 trades)**: Define a simple trading rule (e.g. EMA golden cross = long, death cross = short) and follow it strictly
3. **Optimization (500 trades)**: Backtest and optimize your strategy parameters across different timeframes and indicator combinations
4. **Psychology (200 trades)**: Trade with a simulated $100,000 account to experience the psychological pressure of large floating losses

> 💡 **Tip**: Click "Reset Account" to instantly restore initial capital and start a new simulation round without restarting the server.

---

## Notes

1. **Positions** live in Rust engine **memory** — server restart clears them. Trade history is persisted in SQLite.
2. **Gold & Silver** refresh real prices from gold-api.com every 5 minutes with micro-drift between refreshes.
3. **Proxy/VPN** environments may require SSL configuration (already handled in code).
4. **First build** requires the Rust toolchain; subsequent runs do not.

---

## ☕ Sponsor

If this project helps you, consider buying the author a cup of milk tea(¥8-10) ☕

![WeChat Pay (微信支付) — Scan this QR code with the WeChat app to send a tip](pay.jpg)

> 💡 **What is this?** This is a **WeChat Pay** QR code. Open the **WeChat** app on your phone, tap the "+" button → "Scan QR Code", then point your camera at the image above to send a tip. WeChat is the most popular payment app in China.

---

> [中文文档](README-zh.md)
