# TradeAthena 系统设计文档

## 1. 项目概述

TradeAthena 是一个专业级量化交易 Web 平台，对标 MT4/MT5。第一期聚焦加密货币模拟交易。

### 核心目标
- 🔴 真实市场数据（Binance API 免费实时流）
- 🔴 MT5 风格的专业交易 UI
- 🔴 **Rust 核心引擎** + Python 胶水层 — 极致性能
- 🔴 模拟交易引擎（基于真实价格撮合）
- 🔴 低延迟 WebSocket 实时推送

## 2. 架构设计

```
┌───────────────────────────────────────────────────────────┐
│                   前端 (React + TypeScript)                 │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌───────┐  │
│  │ 行情面板 │ │ K线图表   │ │ 下单面板 │ │ 持仓管理 │ │ 订单簿 │  │
│  └────┬───┘ └────┬─────┘ └───┬────┘ └───┬────┘ └───┬───┘  │
│       └──────────┼───────────┼──────────┼──────────┘        │
│                  │    WebSocket + REST API                  │
├──────────────────┼─────────────────────────────────────────┤
│            Python FastAPI — Web 层 (异步非阻塞)              │
│  路由 / WebSocket 管理 / Binance 数据源 / 数据库持久化       │
├──────────────────┼─────────────────────────────────────────┤
│   [PyO3 FFI 调用 — 零拷贝, 无 GIL 阻塞]                     │
├──────────────────┼─────────────────────────────────────────┤
│            🔴 Rust 核心引擎 (Native 扩展)                   │
│  撮合引擎 │ 订单簿管理 │ 风控计算 │ 持仓管理 │ 保证金计算    │
│  ───────────────────────────────────────────────────       │
│   ✅ 全内存运算 — 不落盘不走 DB                              │
│   ✅ O(1) 订单匹配 / O(N) 价格扫描                           │
│   ✅ Atomic 自增 ID, 无锁并发                                │
└───────────────────────────────────────────────────────────┘
```

### 为什么用 Rust + Python 混合架构？

| 模块 | 语言 | 理由 |
|:---|:---|:---|
| 撮合引擎（热路径） | Rust | 每笔订单 < 1μs, 价格更新 O(N) 扫描 |
| 风控计算 | Rust | 保证金/盈亏计算浮点密集运算 |
| 订单簿 | Rust | HashMap + Vec 极致性能 |
| Web API | Python (FastAPI) | 开发效率高, 异步生态成熟 |
| WebSocket | Python | FastAPI 原生支持, 足够快 |
| 数据持久化 | Python (SQLAlchemy) | 非热路径, 开发效率优先 |
| Binance 数据源 | Python (httpx/websockets) | IO 密集型, 非计算瓶颈 |
| 用户策略脚本 | Python | 用户编写策略的 DSL |

### 性能指标

| 场景 | 实现方案 | 预期指标 |
|:---|:---|:---|
| 订单撮合 | Rust 内存操作 | < 1μs |
| 价格更新 → 持仓盈亏 | Rust 全量扫描 | < 10μs (1000 品种) |
| 行情推送端到端 | Binance WS → Rust → Python → React | < 100ms |
| 下单确认端到端 | React → API → Rust → WS → React | < 50ms |
| K 线图表渲染 | Lightweight Charts Canvas | 5000 K 线 < 50ms |
| 连接断开重连 | 指数退避 (0.5s → 10s) | 3 次内恢复 |

## 3. 技术选型

| 层级 | 技术 | 版本 |
|:---|:---|:---|
| 核心引擎 | Rust + PyO3 | Rust 2024, PyO3 0.22 |
| 后端框架 | FastAPI (async) | 0.115+ |
| 数据库 | SQLite (aiosqlite) | 零配置部署 |
| 数据源 | Binance REST + WebSocket | 免费, 实时 |
| 构建工具 | maturin | 1.0+ |
| 前端框架 | React + TypeScript | 18+ |
| 图表引擎 | TradingView Lightweight Charts | 4.x |
| UI 布局 | react-resizable-panels | MT5 风格 |
| 构建工具 | Vite | 5.x |

## 4. 核心模块设计

### 4.1 Rust 匹配引擎 (Matching Engine)

```
文件: src/matching.rs, src/types.rs, src/lib.rs

PlaceOrder:
  ├── 市价单 → 立即以当前最优价成交 (O(1))
  │     ├── 检查保证金 → InsufficientMargin → 拒绝
  │     └── 通过 → 开/加仓 → recalc_account
  │
  ├── 限价单 → 挂单 (O(1))
  │     └── 后续 Tick 检查是否可成交
  │
  └── 止损单 → 挂单 (O(1))
        └── 后续 Tick 检查是否触发

OnTick (价格更新):
  ├── 1. 更新所有持仓盈亏 (O(N))
  │     └── 检查 SL/TP → 触发则平仓
  ├── 2. 扫描挂单 (O(M))
  │     └── 限价/止损触发 → 成交
  ├── 3. 重新计算账户权益/保证金
  └── 4. 返回本次变动的订单 ID 列表
```

### 4.2 Python 后端

```
backend/
├── main.py        # FastAPI 应用入口, lifespan 管理
├── config.py      # 配置 (环境变量)
├── database.py    # SQLAlchemy async (只用于持久化)
├── models.py      # ORM 模型 (OrderHistory, TradeHistory)
├── routes/
│   ├── market.py  # 行情 API + WebSocket
│   ├── orders.py  # 下单/撤单/改单
│   ├── account.py # 账户信息 + 历史
│   └── positions.py # 持仓管理
├── services/
│   ├── binance.py # Binance WS 自动重连 + REST
│   └── market.py  # 行情聚合 (内存缓存)
└── ws/
    └── manager.py # WebSocket 连接管理 + 广播
```

**关键设计：Rust 引擎生命周期绑定到 FastAPI lifespan**
- 启动时：创建 MatchingEngine 实例, 注入到 app.state
- 运行时：所有订单操作转发到 Rust 引擎
- 停止时：Rust 引擎自动释放

### 4.3 数据流

```
实时行情流:
  Binance WS → Python BinanceClient → MarketService (缓存)
       │                                        │
       │                                  WebSocket 广播
       │                                        │
       └──→ 价格更新 → Rust MatchingEngine.on_tick()
                            │
                     持仓盈亏更新 / 挂单成交
                            │
                     结果推回 WebSocket → React 更新 UI

下单流:
  React → REST API → Python route handler
       │
       ├── 校验参数 (Pydantic)
       ├── 调用 Rust MatchingEngine.place_order()
       │     ├── 内存撮合 (微秒级)
       │     └── 返回 TradeResult
       ├── 异步写入 OrderHistory (非阻塞)
       └── WebSocket 广播 → React 更新
```

## 5. API 接口设计

### REST API

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| `GET` | `/api/v1/market/klines?symbol=BTCUSDT&interval=1h&limit=500` | 历史 K 线 |
| `GET` | `/api/v1/market/ticker/BTCUSDT` | 24h 行情快照 |
| `GET` | `/api/v1/market/depth/BTCUSDT?limit=20` | 订单簿深度 |
| `GET` | `/api/v1/market/symbols` | 可交易品种 |
| `POST` | `/api/v1/orders` | 创建订单 |
| `DELETE` | `/api/v1/orders/{id}` | 撤销挂单 |
| `GET` | `/api/v1/orders/pending` | 挂单列表 |
| `PUT` | `/api/v1/orders/{id}` | 修改订单 SL/TP |
| `GET` | `/api/v1/positions` | 持仓列表 |
| `PUT` | `/api/v1/positions/{id}` | 修改持仓 SL/TP |
| `POST` | `/api/v1/positions/{id}/close` | 平仓 |
| `GET` | `/api/v1/account` | 账户信息 |
| `POST` | `/api/v1/account/reset` | 重置账户 |
| `GET` | `/api/v1/account/history?page=1&page_size=50` | 交易历史 |

### WebSocket

| 路径 | 推送内容 |
|:---|:---|
| `/ws/market` | 实时 ticker (last/bid/ask/change 每 ~100ms) |
| `/ws/orders` | 订单状态变更 + 账户更新 |

## 6. 前端组件树

```
App
└── TradingPage
    ├── TopBar (工具栏)
    │   ├── Logo + 平台名
    │   ├── 品种选择器
    │   ├── 时间周期选择 (1m/5m/15m/1h/4h/1d)
    │   ├── 图表设置
    │   └── 账户摘要 (余额/净值/保证金)
    │
    ├── MainLayout (react-resizable-panels)
    │   ├── LeftPanel (可折叠, 默认 220px)
    │   │   └── MarketWatch — 行情列表
    │   │       ├── 每行: 品种 | 卖价 | 买价 | 涨跌幅
    │   │       └── 点击切换 K 线图表
    │   │
    │   ├── CenterPanel (弹性宽度)
    │   │   ├── ChartToolbar
    │   │   │   ├── 画线工具 (趋势线/水平线/射线)
    │   │   │   ├── 图表类型切换 (蜡烛/线/条)
    │   │   │   ├── 模板/布局
    │   │   │   └── 时间周期
    │   │   └── TradingChart (Lightweight Charts)
    │   │       ├── 主图: OHLCV 蜡烛图
    │   │       ├── 成交量副图
    │   │       └── 交互: 十字准星 + 价格标签
    │   │
    │   └── RightPanel (可折叠, 默认 280px)
    │       ├── OrderBook (深度行情)
    │       │   ├── 卖盘 (asks, 红色)
    │       │   ├── 买盘 (bids, 绿色)
    │       │   └── 中间价 + 点差
    │       └── AccountInfo (精简)
    │           ├── 余额 / 净值 / 已用保证金
    │           └── 可用保证金 / 保证金比例
    │
    ├── BottomPanel (高度可调)
    │   ├── TerminalTabs: [交易] [持仓] [挂单] [历史]
    │   ├── 交易 Tab: 下单面板
    │   │   ├── 品种 / 方向 (买入/卖出)
    │   │   ├── 订单类型 (市价/限价/止损)
    │   │   ├── 手数 (预设按钮: 0.01/0.1/0.5/1.0)
    │   │   ├── 价格 (限价/止损单)
    │   │   ├── 止损 / 止盈
    │   │   └── [买入] [卖出] 按钮 + 确认
    │   ├── 持仓 Tab: 表格 (虚拟滚动)
    │   │   └── 品种/方向/手数/开仓价/现价/盈亏/止损/止盈/操作
    │   ├── 挂单 Tab: 表格
    │   │   └── 品种/类型/方向/手数/价格/状态/操作
    │   └── 历史 Tab: 分页表格
    │       └── 已平仓/已撤销记录
    │
    └── StatusBar
        ├── 当前品种: BTC/USDT
        ├── 连接状态: Connected/Reconnecting...
        └── 时间: UTC
```

## 7. 数据库设计

仅用于持久化历史记录（热路径全在 Rust 内存）：

```sql
-- 订单历史 (成交/取消)
order_history: id, order_id, symbol, side, type, volume, price,
               filled_price, filled_volume, status, sl, tp,
               created_at, closed_at

-- 交易历史 (已平仓)
trade_history: id, position_id, symbol, side, volume,
               entry_price, exit_price, profit,
               open_time, close_time
```

## 8. 项目结构

```
toptrader/
├── Cargo.toml              # Rust 包配置 📦
├── pyproject.toml          # Python 项目配置 (maturin 构建) 📦
├── Design.md               # 本文档 📄
├── Requirements.md          # 需求文档 📄
│
├── src/                    # 🔴 Rust 核心引擎
│   ├── lib.rs              # PyO3 模块入口 + 绑定
│   ├── types.rs            # 共享数据类型
│   └── matching.rs         # 撮合引擎 (含单元测试)
│
├── backend/                # Python FastAPI 后端
│   ├── __init__.py
│   ├── main.py             # FastAPI 应用
│   ├── config.py           # 配置
│   ├── database.py         # 数据库连接
│   ├── models.py           # ORM 模型
│   ├── routes/             # API 路由
│   ├── services/           # 业务服务
│   └── ws/                 # WebSocket 管理
│
├── frontend/               # React 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api.ts          # API 客户端
│       ├── websocket.ts    # WebSocket 客户端
│       ├── types.ts        # TypeScript 类型
│       ├── components/     # UI 组件
│       └── styles.css      # MT5 风格样式
│
└── .gitignore
```

## 9. 开发路线

### Phase 1 (当前 — MVP, 可运行)
- [x] Rust 匹配引擎 + PyO3 绑定
- [x] Python FastAPI 后端框架
- [x] Binance 实时数据连接
- [ ] WebSocket 实时推送
- [ ] REST API 路由
- [ ] React 前端 MT5 风格 UI
- [ ] 可运行 Demo: 比特币交易

### Phase 2 (后续)
- [ ] 多用户 / 鉴权系统
- [ ] 策略回测模块
- [ ] Python 策略脚本引擎
- [ ] 更多画线工具
- [ ] 跟单系统

---

*文档版本: V1.1 | 更新日期: 2026-06-13 | 架构: Rust Core + Python FastAPI + React*
