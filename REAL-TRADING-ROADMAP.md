# TradeAthena 实盘交易演进路线图

> 当前状态：**使用实时行情数据的高级纸面交易（模拟）平台**
> 目标状态：**对接真实交易所的量化交易终端**

---

## 一、架构总览：当前 vs 实盘

```
当前架构 (模拟模式):

[前端 React]
    ↕ WebSocket + REST
[Python FastAPI 后端]
    ↕ PyO3 FFI
[Rust 撮合引擎]  ←── 纯本地内存撮合，不接触任何交易所
    ↕ 行情数据源
[Binance WS (只读)]  [Gold-API]  [模拟器]
```

```
实盘架构 (双模式):

[前端 React] ←── 模式切换 (模拟/实盘)
    ↕ WebSocket + REST
[Python FastAPI 后端]
    ├── 风控预检层 (复用 Rust 引擎的保证金/杠杆计算)
    ├── 订单路由分发器
    │   ├── 模拟模式 ──▶ Rust 本地引擎
    │   └── 实盘模式 ──▶ ExchangeClient (真实下单)
    ├── 持仓同步器 (定时从交易所拉取对账)
    └── API Key 加密存储
         ↕
[Binance API] ←── 新增: 签名请求 (下单/撤单/查账户)
```

---

## 二、核心缺失模块 (🔴 必须做)

### 1. 交易所下单接口

当前 `BinanceClient` 完全只读。需要新增以下签名请求：

| 端点 | 用途 | 风险等级 |
|------|------|---------|
| `POST /api/v3/order` | 提交市价/限价/止损单 | 🔴 高 |
| `DELETE /api/v3/order` | 撤单 | 🟡 中 |
| `GET /api/v3/account` | 获取真实余额/持仓 | 🟢 低 |
| `GET /api/v3/openOrders` | 同步挂单状态 | 🟢 低 |
| `GET /api/v3/order` | 查询单笔订单成交详情 | 🟢 低 |
| `GET /api/v3/tradeFee` | 查询实际费率 | 🟢 低 |

所有请求需 **HMAC-SHA256 签名**，参考 Binance 官方文档的签名逻辑。

### 2. API Key 管理

**缺失组件：**
- 用户在 UI 输入 Binance API Key / Secret 的入口
- 服务端加密存储（推荐 `cryptography.fernet`，AES-GCM 加密）
- Key 的权限检测（创建时调用 `GET /api/v3/account` 验证有效性）
- 密钥轮换 / 吊销机制
- 风险提示：告知用户仅开通"交易"权限，不开通"提现"权限

**存储方案：**
```python
# 加密流程
master_key = os.environ["ENCRYPTION_KEY"]  # 从环境变量读取，不落盘
fernet = Fernet(base64.urlsafe_b64encode(master_key.encode().ljust(32)[:32]))
encrypted_secret = fernet.encrypt(user_raw_secret.encode())
db.save(api_key=user_raw_key, secret_ciphertext=encrypted_secret)

# 解密使用
decrypted = fernet.decrypt(stored_ciphertext).decode()
```

### 3. 订单路由架构

需要新增一个**路由分发层**，隔离模拟和实盘逻辑：

```
用户下单请求
    │
    ▼
[路由分发器]
    │
    ├── is_demo=True  ──▶ Rust 本地引擎 (现有逻辑不变)
    │
    └── is_demo=False ──▶ 风控预检 ──▶ ExchangeClient.send()
                                              │
                                              ▼
                                         Binance API
                                              │
                                              ▼
                                    监听 WebSocket 订单更新
                                              │
                                              ▼
                                    同步到 local DB (real_orders)
```

**关键设计决策：Rust 引擎在实盘模式的角色**

推荐方案：Rust 引擎保留做**本地风控预检**：
- 检查保证金是否充足
- 检查是否超过最大持仓限制
- 检查杠杆倍数是否合规
- 预检通过后，路由到交易所执行
- 交易所返回成交结果后，同步到本地数据库（但不写入 Rust 引擎内存状态）

### 4. 订单状态机

```
当前 (模拟):
Pending ──▶ Filled
     └──▶ Cancelled

实盘需要:
New ──▶ PartiallyFilled ──▶ Filled
  │                            │
  ├──▶ Cancelled               ├──▶ Expired
  ├──▶ Rejected                │
  └──▶ Expired                 │
                               │
                     [部分成交可多次，累加至 Filled]
```

需处理的新场景：
- **部分成交**：多次 partial fill 累加
- **交易所拒绝**：原因解析（余额不足、价格不合规、最小交易量等）
- **订单过期**：GTC / IOC / FOK 策略
- **网络超时**：订单已提交但未收到响应 ⇒ 查询确认状态

---

## 三、基础设施缺失 (🟡 建议做)

### 5. 用户认证系统

| 当前 | 实盘要求 |
|------|---------|
| 硬编码 `admin/admin123` | JWT + bcrypt/argon2 密码哈希 |
| 纯前端 localStorage 校验 | 服务端 session + refresh token |
| 单用户 | 多用户隔离（各用户独立数据库记录） |
| 无注册入口 | 注册 / 登录 / 密码重置 |

### 6. 数据库升级

| 现状 (SQLite) | 实盘要求 (PostgreSQL) |
|---------------|----------------------|
| 单文件，无并发 | ACID + 行级锁 + PgBouncer 连接池 |
| 无迁移管理 | Alembic 版本迁移 |
| 重启丢失热数据 | 订单持久化队列 (Transactional Outbox) |
| 2 张表 | 新增: `users`, `api_keys`, `real_orders`, `real_positions`, `real_trades` |

**新增表结构示意：**

```sql
-- API Keys
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    exchange VARCHAR(32) NOT NULL,        -- 'binance'
    api_key VARCHAR(128) NOT NULL,
    secret_ciphertext BYTEA NOT NULL,     -- Fernet 加密
    permissions VARCHAR(64),              -- 'trade' / 'read' / 'withdraw'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- 实盘订单
CREATE TABLE real_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    exchange_order_id VARCHAR(64),        -- 交易所侧订单 ID
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(8) NOT NULL,
    order_type VARCHAR(16) NOT NULL,
    volume DECIMAL(18,8) NOT NULL,
    price DECIMAL(18,8),
    stop_price DECIMAL(18,8),
    status VARCHAR(20) NOT NULL,          -- new/partially_filled/filled/canceled/rejected/expired
    executed_volume DECIMAL(18,8),
    cummulative_quote DECIMAL(28,8),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- 实盘成交明细
CREATE TABLE real_trades (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES real_orders(id),
    trade_id VARCHAR(64),                 -- 交易所成交 ID
    price DECIMAL(18,8) NOT NULL,
    volume DECIMAL(18,8) NOT NULL,
    commission DECIMAL(18,8),
    commission_asset VARCHAR(10),
    trade_time TIMESTAMPTZ NOT NULL
);
```

### 7. 风控预检层

```
下单前检查项:
├── 价格偏离度 —— 当前价格 vs 订单价格偏离 > 5% 则告警/拒绝
├── 单笔最大金额 —— 可配置上限 (如 ≤ 10 BTC)
├── 日累计交易量 —— 可配置上限
├── 交易所精度校验 —— 价格/数量小数位对齐 (如 BTCUSDT 价格 2 位, 数量 5 位)
├── 最小交易量 —— 如 BTCUSDT 最小 0.001
├── 账户杠杆检查 —— 不超过交易所允许的最大值
└── 订单频率限制 —— 防高频 (rate limiting)

运行时监控:
├── 订单超时 —— 挂单超过 N 分钟未成交，推送告警
├── WebSocket 断开 —— 影响止损/止盈触发，需自动重连
├── 交易所 API 状态 —— 429 限频处理，5xx 重试
└── 熔断 —— 连续 N 笔亏损 / 价格剧烈波动时暂停交易
```

### 8. 资金安全

| 功能 | 风险 | 说明 |
|------|------|------|
| 提现到外部地址 | 🔴 极高 | 需要硬件签名 / 多签审批 / 冷钱包 |
| 充值监控 | 🟡 中 | 监听充值地址到账，记录入金 |
| 资金归集 | 🟡 中 | 多账户余额统一管理 |

> **建议：** 初期只做"代为下单"，不做资金托管。API Key 限制为仅开启"交易"权限，不开"提现"权限。

---

## 四、业务功能缺失 (🟡 建议做)

### 9. 持仓对账 (Reconciliation)

```python
# 定时任务示例 (每 30 秒)
async def reconcile_positions(user_id):
    # 1. 从交易所拉取真实持仓
    exchange_positions = await binance_client.get_positions()
    
    # 2. 从本地数据库读取持仓
    local_positions = await db.query(RealPosition).filter_by(user_id=user_id)
    
    # 3. 比对
    for ep in exchange_positions:
        lp = find_local(local_positions, ep.symbol)
        if not lp:
            await create_local(ep)           # 交易所开了单但本地没有
        elif abs(lp.volume - ep.volume) > eps:
            await update_local(ep)           # 数量不一致，以交易所为准
    
    # 4. 记录差异日志
```

### 10. 费用模型

| 项目 | 说明 |
|------|------|
| Maker / Taker 费率 | Binance 现货 0.1% (BNB 抵扣可降低)；U 本位合约 0.02%/0.05% |
| 层级费率 | 根据 30 天交易量有不同费率等级 |
| 资金费率 (Funding Rate) | 永续合约每 8 小时结算 |
| 持仓过夜利息 | 部分品种有 Swap 费用 |

前端需在订单预览中展示预估费用，并在成交记录中展示实际费用。

### 11. 杠杆与保证金对齐

当前 Rust 引擎的保证金逻辑需要验证是否与交易所一致：

| 项目 | Binance 合约 | Rust 引擎 |
|------|-------------|-----------|
| 逐仓 (Isolated) | ✅ | ❌ (未实现) |
| 全仓 (Cross) | ✅ | 部分实现 |
| 强平价格计算 | 按标记价格 | 按最新价，需对齐 |
| 自动减仓 (ADL) | ✅ | ❌ |

### 12. 日志与审计

```
审计日志覆盖:
├── 所有下单/撤单操作 (含用户 IP、User-Agent、时间戳、请求原文)
├── API Key 创建/删除/修改
├── 模式切换 (模拟↔实盘)
├── 登录成功/失败记录
└── 风控规则变更

存储策略:
├── 只追加 (append-only)，不可删除
├── 保留至少 6 个月
└── 定期归档
```

---

## 五、前端变化 (🟢 相对简单)

### 13. 实盘/模拟切换开关

在 TopBar 或 OrderPanel 增加模式选择器：

```
[ 📄 模拟交易 ]   ──▶  [ 💰 真实交易 ]

视觉区分:
- 模拟模式: 灰色/蓝色调，标注 "DEMO"
- 实盘模式: 红色/绿色调，标注 "LIVE"
- 切换时弹出确认对话框
- 切换后清空当前表单
```

### 14. API Key 管理界面

新增设置页面：

```
设置页:
├── 交易所连接
│   ├── 交易所选择器 (Binance / OKX / Bybit ...)
│   ├── API Key 输入框
│   ├── Secret Key 输入框 (password 类型)
│   ├── [测试连接] 按钮 — 调用 GET /api/v3/account 验证
│   └── [保存] 按钮
├── 已保存密钥列表
│   ├── 交易所 | 权限 | 创建时间 | 最后使用
│   └── [删除] [测试]
└── 安全提示
```

### 15. 实盘订单状态展示

当前前端订单状态只有 `Pending / Filled / Cancelled`。需扩展：

```
订单状态标签:
🟡 New           — 已提交等待成交
🔵 PartiallyFilled — 部分成交 (显示已成交数量/总量)
🟢 Filled        — 全部成交
⚪ Cancelled     — 已撤销
🔴 Rejected      — 被交易所拒绝 (显示原因)
⚫ Expired       — 已过期
```

---

## 六、实施路径建议

### Phase 1 — 基础准备 (预计 1-2 周)

```
[1] 用户认证系统
    ├── JWT 签发与验证
    ├── 密码哈希 (bcrypt)
    ├── 注册/登录/登出 API
    └── 前端适配 (移除硬编码 login)

[2] 数据库升级
    ├── SQLite → PostgreSQL 迁移
    ├── Alembic 初始化
    ├── 新增 users / api_keys 表
    └── 现有数据迁移脚本

[3] API Key 加密存储
    ├── Fernet 加密工具类
    ├── CRUD API (create / list / delete)
    ├── "测试连接" 端点
    └── 前端设置页
```

### Phase 2 — 实盘核心 (预计 2-3 周)

```
[4] Binance 签名客户端
    ├── HMAC-SHA256 签名工具
    ├── 下单端点 (POST /api/v3/order)
    ├── 撤单端点 (DELETE /api/v3/order)
    ├── 账户查询 (GET /api/v3/account)
    └── WebSocket 用户数据流 (listenKey)

[5] 订单路由分发
    ├── 模拟/实盘双模式架构
    ├── 风控预检层
    ├── 实盘订单持久化 (real_orders)
    └── 前端模式切换

[6] 实盘订单生命周期管理
    ├── 部分成交累积
    ├── 拒绝/过期处理
    ├── 订单超时监控
    └── 网络异常恢复 (查询重试)
```

### Phase 3 — 加固与合规 (持续)

```
[7] 持仓同步与对账
[8] 费率计算与展示
[9] 审计日志系统
[10] 多交易所支持 (抽象 ExchangeClient 接口)
[11] 风控规则引擎 (可配置)
[12] 合规检查 (根据实际需求)
```

---

## 七、风险清单

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| API Key 泄露 | 🔴 极高 | 加密存储 + IP 白名单提示 + 仅开通交易权限 |
| 交易所 API 变更 | 🟡 中 | 抽象接口层 + 集成测试 |
| 网络延迟导致报价滞后 | 🟡 中 | 多条数据源容错，WS 重连机制 |
| 订单状态不一致 | 🟡 中 | 定时对账 + 人工介入入口 |
| 用户误操作 (如大额下单) | 🟡 中 | 风控预检 + 二次确认 + 限额设置 |
| 监管合规 | 🟡 中 | 明确用户责任，平台仅作为工具 |

---

## 附录：参考文档

- [Binance API 文档](https://binance-docs.github.io/apidocs/spot/cn/#H9d5d2f62ce)
- [Binance 签名认证](https://binance-docs.github.io/apidocs/spot/cn/#1d3f7b3d8b)
- [Fernet 加密 (Python cryptography)](https://cryptography.io/en/latest/fernet/)
- [Binance WebSocket 用户数据流](https://binance-docs.github.io/apidocs/spot/cn/#c5b2e6f1c0)
