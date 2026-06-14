/// Core matching engine — all operations are O(1) or O(n) for pending orders scan.
///
/// This engine processes orders against market ticks entirely in memory.
/// No database I/O on the hot path.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::types::*;

static NEXT_ORDER_ID: AtomicU64 = AtomicU64::new(100_000_000);
static NEXT_POSITION_ID: AtomicU64 = AtomicU64::new(1);

/// The matching engine holds all runtime state.
pub struct MatchingEngine {
    account: Account,
    positions: Vec<Position>,
    pending_orders: Vec<Order>,
    symbol_index: HashMap<String, Vec<usize>>,
}

impl MatchingEngine {
    pub fn new(initial_balance: f64, leverage: u32) -> Self {
        let balance = initial_balance.max(100.0);
        MatchingEngine {
            account: Account {
                id: 1,
                balance,
                equity: balance,
                margin: 0.0,
                free_margin: balance,
                margin_level: 0.0,
                leverage: leverage.max(1),
            },
            positions: Vec::with_capacity(16),
            pending_orders: Vec::with_capacity(32),
            symbol_index: HashMap::new(),
        }
    }

    // ── Account ────────────────────────────────────────────

    pub fn get_account(&self) -> &Account {
        &self.account
    }

    /// Recalculate equity, margin, free margin after a price change.
    fn recalc_account(&mut self) {
        let mut total_margin = 0.0_f64;
        let mut unrealized = 0.0_f64;

        for pos in &self.positions {
            let notional = pos.entry_price * pos.volume;
            total_margin += notional / self.account.leverage as f64;
            unrealized += pos.unrealized_pl;
        }

        let equity = (self.account.balance + unrealized).max(0.0);
        let free_margin = (equity - total_margin).max(0.0);
        let margin_level = if total_margin > 0.0 {
            (equity / total_margin) * 100.0
        } else {
            0.0
        };

        self.account.equity = equity;
        self.account.margin = total_margin;
        self.account.free_margin = free_margin;
        self.account.margin_level = margin_level;
    }

    // ── Order Placement ────────────────────────────────────

    pub fn place_order(
        &mut self,
        symbol: &str,
        side: &str,
        order_type: &str,
        volume: f64,
        price: f64,
        stop_price: f64,
        stop_loss: f64,
        take_profit: f64,
        current_bid: f64,
        current_ask: f64,
    ) -> TradeResult {
        let side = Side::from_str(side);
        let order_type = OrderType::from_str(order_type);

        if volume <= 0.0 {
            return TradeResult {
                order_id: 0,
                filled: false,
                fill_price: 0.0,
                fill_volume: 0.0,
                message: "Volume must be positive".into(),
            };
        }

        let order_id = NEXT_ORDER_ID.fetch_add(1, Ordering::Relaxed);

        // Market orders: try to fill immediately
        if order_type == OrderType::Market {
            return self.fill_market_order(
                order_id, symbol, side, volume, stop_loss, take_profit, current_bid, current_ask,
            );
        }

        // Limit/Stop orders: add to pending
        let order = Order {
            id: order_id,
            account_id: 1,
            symbol: symbol.to_string(),
            side,
            order_type,
            volume,
            price,
            stop_price,
            filled_price: 0.0,
            filled_volume: 0.0,
            status: OrderStatus::Pending,
            stop_loss,
            take_profit,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64,
        };

        let idx = self.pending_orders.len();
        self.pending_orders.push(order);
        self.symbol_index.entry(symbol.to_lowercase()).or_default().push(idx);

        TradeResult {
            order_id,
            filled: false,
            fill_price: 0.0,
            fill_volume: 0.0,
            message: "Order placed, pending".into(),
        }
    }

    fn fill_market_order(
        &mut self,
        order_id: u64,
        symbol: &str,
        side: Side,
        volume: f64,
        stop_loss: f64,
        take_profit: f64,
        current_bid: f64,
        current_ask: f64,
    ) -> TradeResult {
        let fill_price = match side {
            Side::Buy => current_ask,
            Side::Sell => current_bid,
        };

        if fill_price <= 0.0 {
            return TradeResult {
                order_id,
                filled: false,
                fill_price: 0.0,
                fill_volume: 0.0,
                message: "No market price available".into(),
            };
        }

        // Check margin
        let notional = fill_price * volume;
        let required_margin = notional / self.account.leverage as f64;
        if required_margin > self.account.free_margin + 1e-9 {
            return TradeResult {
                order_id,
                filled: false,
                fill_price,
                fill_volume: 0.0,
                message: format!(
                    "Insufficient margin: need {:.2}, have {:.2}",
                    required_margin, self.account.free_margin
                ),
            };
        }

        self.open_or_add_position(symbol, side, volume, fill_price, stop_loss, take_profit);
        // In hedging mode, opposite-side positions are NOT closed here.
        // Use close_position_by_id to close specific positions.

        TradeResult {
            order_id,
            filled: true,
            fill_price,
            fill_volume: volume,
            message: "Filled".into(),
        }
    }

    // ── Position Management ─────────────────────────────────

    fn open_or_add_position(
        &mut self,
        symbol: &str,
        side: Side,
        volume: f64,
        price: f64,
        stop_loss: f64,
        take_profit: f64,
    ) {
        // Hedging mode: each order creates a NEW position.
        // No merging, no opposite-side closing. Close only via close_position_by_id.
        if volume > 0.0 {
            self.positions.push(Position {
                id: NEXT_POSITION_ID.fetch_add(1, Ordering::Relaxed),
                account_id: 1,
                symbol: symbol.to_string(),
                side,
                volume,
                entry_price: price,
                current_price: price,
                stop_loss,
                take_profit,
                unrealized_pl: 0.0,
                created_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default().as_secs() as i64,
            });
        }

        self.recalc_account();
    }

    fn close_opposite_position(
        &mut self,
        symbol: &str,
        side: Side,
        volume: &mut f64,
        price: f64,
    ) {
        let opp_side = side.opposite();
        let mut i = 0;
        while i < self.positions.len() && *volume > 0.0 {
            if self.positions[i].symbol == symbol && self.positions[i].side == opp_side {
                let pos_vol = self.positions[i].volume;
                let close_vol = pos_vol.min(*volume);
                let realized_pl = Self::calc_unrealized_pl(
                    opp_side,
                    close_vol,
                    self.positions[i].entry_price,
                    price,
                );
                self.account.balance += realized_pl;
                *volume -= close_vol;

                if close_vol >= pos_vol {
                    self.positions.swap_remove(i);
                } else {
                    self.positions[i].volume -= close_vol;
                    self.positions[i].unrealized_pl = Self::calc_unrealized_pl(
                        opp_side,
                        self.positions[i].volume,
                        self.positions[i].entry_price,
                        price,
                    );
                    i += 1;
                }
            } else {
                i += 1;
            }
        }
    }

    fn calc_unrealized_pl(side: Side, volume: f64, entry: f64, current: f64) -> f64 {
        match side {
            Side::Buy => (current - entry) * volume,
            Side::Sell => (entry - current) * volume,
        }
    }

    // ── Price Update ────────────────────────────────────────

    /// Process a price tick from the market.
    /// Returns list of filled/cancelled order IDs.
    pub fn on_tick(&mut self, tick: &MarketTick) -> Vec<u64> {
        let symbol = tick.symbol.to_lowercase();
        let mut changed_ids: Vec<u64> = Vec::new();

        // 1. Update position prices, P&L, and check SL/TP
        //    Collect close IDs first to avoid double borrow
        let mut close_ids: Vec<u64> = Vec::new();
        for pos in &mut self.positions {
            if pos.symbol.to_lowercase() != symbol {
                continue;
            }
            pos.current_price = match pos.side {
                Side::Buy => tick.bid.max(tick.last),
                Side::Sell => tick.ask.max(tick.last),
            };
            pos.unrealized_pl =
                Self::calc_unrealized_pl(pos.side, pos.volume, pos.entry_price, pos.current_price);

            // SL check
            if pos.stop_loss > 0.0 {
                let hit = match pos.side {
                    Side::Buy => tick.bid <= pos.stop_loss,
                    Side::Sell => tick.ask >= pos.stop_loss,
                };
                if hit {
                    close_ids.push(pos.id);
                    continue;
                }
            }
            // TP check
            if pos.take_profit > 0.0 {
                let hit = match pos.side {
                    Side::Buy => tick.ask >= pos.take_profit,
                    Side::Sell => tick.bid <= pos.take_profit,
                };
                if hit {
                    close_ids.push(pos.id);
                }
            }
        }

        // Execute position closes
        for id in close_ids {
            if self.close_position_by_id(id, tick) {
                changed_ids.push(id);
            }
        }

        // 2. Check pending limit/stop orders
        if let Some(indices) = self.symbol_index.get(&symbol).cloned() {
            // Collect fill info first to avoid borrow issues
            struct FillInfo {
                idx: usize,
                symbol: String,
                side: Side,
                volume: f64,
                fill_price: f64,
                stop_loss: f64,
                take_profit: f64,
            }
            let mut to_fill: Vec<FillInfo> = Vec::new();
            let mut to_remove: Vec<usize> = Vec::new();

            for &idx in &indices {
                if idx >= self.pending_orders.len() {
                    continue;
                }
                if self.pending_orders[idx].status != OrderStatus::Pending {
                    continue;
                }
                let order = &self.pending_orders[idx];

                let trigger = match order.order_type {
                    OrderType::Limit => match order.side {
                        Side::Buy => tick.ask <= order.price,
                        Side::Sell => tick.bid >= order.price,
                    },
                    OrderType::Stop => match order.side {
                        Side::Buy => tick.last >= order.stop_price,
                        Side::Sell => tick.last <= order.stop_price,
                    },
                    OrderType::Market => false,
                };

                if trigger {
                    let fill_price = match order.side {
                        Side::Buy => tick.ask,
                        Side::Sell => tick.bid,
                    };
                    to_fill.push(FillInfo {
                        idx,
                        symbol: order.symbol.clone(),
                        side: order.side,
                        volume: order.volume,
                        fill_price,
                        stop_loss: order.stop_loss,
                        take_profit: order.take_profit,
                    });
                    to_remove.push(idx);
                    changed_ids.push(order.id);
                }
            }

            // Execute fills
            for fill in &to_fill {
                self.open_or_add_position(
                    &fill.symbol,
                    fill.side,
                    fill.volume,
                    fill.fill_price,
                    fill.stop_loss,
                    fill.take_profit,
                );
            }

            // Remove filled orders (reverse order for swap_remove safety)
            for &idx in to_remove.iter().rev() {
                if idx < self.pending_orders.len() {
                    self.pending_orders.swap_remove(idx);
                }
            }
            self.rebuild_symbol_index();
        }

        self.recalc_account();
        changed_ids
    }

    fn rebuild_symbol_index(&mut self) {
        self.symbol_index.clear();
        for (i, order) in self.pending_orders.iter().enumerate() {
            if order.status == OrderStatus::Pending {
                self.symbol_index
                    .entry(order.symbol.to_lowercase())
                    .or_default()
                    .push(i);
            }
        }
    }

    // ── Position / Order Queries ────────────────────────────

    pub fn positions(&self) -> &[Position] {
        &self.positions
    }

    pub fn pending_orders(&self) -> &[Order] {
        &self.pending_orders
    }

    pub fn close_position_by_id(&mut self, id: u64, tick: &MarketTick) -> bool {
        if let Some(idx) = self.positions.iter().position(|p| p.id == id) {
            let pos = &self.positions[idx];
            let close_price = match pos.side {
                Side::Buy => tick.bid,
                Side::Sell => tick.ask,
            };
            let realized_pl =
                Self::calc_unrealized_pl(pos.side, pos.volume, pos.entry_price, close_price);
            self.account.balance += realized_pl;
            self.positions.swap_remove(idx);
            self.recalc_account();
            true
        } else {
            false
        }
    }

    pub fn cancel_order(&mut self, order_id: u64) -> bool {
        if let Some(idx) = self.pending_orders.iter().position(|o| o.id == order_id) {
            self.pending_orders.swap_remove(idx);
            self.rebuild_symbol_index();
            true
        } else {
            false
        }
    }

    pub fn modify_position_sl_tp(
        &mut self,
        position_id: u64,
        stop_loss: f64,
        take_profit: f64,
    ) -> bool {
        if let Some(pos) = self
            .positions
            .iter_mut()
            .find(|p| p.id == position_id)
        {
            if stop_loss > 0.0 {
                pos.stop_loss = stop_loss;
            }
            if take_profit > 0.0 {
                pos.take_profit = take_profit;
            }
            true
        } else {
            false
        }
    }

    pub fn reset(&mut self, initial_balance: f64) {
        self.positions.clear();
        self.pending_orders.clear();
        self.symbol_index.clear();
        self.account.balance = initial_balance;
        self.account.equity = initial_balance;
        self.account.margin = 0.0;
        self.account.free_margin = initial_balance;
        self.account.margin_level = 0.0;
    }

    /// Restore state from persistent storage (after restart).
    /// Takes ownership of provided vectors — no copying on hot path.
    pub fn restore_state(
        &mut self,
        positions: Vec<Position>,
        pending_orders: Vec<Order>,
        balance: f64,
    ) {
        self.positions = positions;
        self.pending_orders = pending_orders;
        self.account.balance = balance;

        // Rebuild symbol index for pending orders
        self.rebuild_symbol_index();

        // Set current_price = entry_price for each position;
        // recalc_account will compute unrealized P&L correctly.
        for pos in &mut self.positions {
            pos.current_price = pos.entry_price;
            pos.unrealized_pl = 0.0;
        }

        self.recalc_account();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_market_buy() {
        let mut engine = MatchingEngine::new(10000.0, 10);
        let result = engine.place_order(
            "BTCUSDT", "buy", "market", 0.1, 0.0, 0.0, 0.0, 0.0, 50000.0, 50010.0,
        );
        assert!(result.filled, "Market buy should fill: {:?}", result.message);
        assert_eq!(engine.positions().len(), 1);
        assert!((engine.positions()[0].volume - 0.1).abs() < 1e-9);
    }

    #[test]
    fn test_limit_order_trigger() {
        let mut engine = MatchingEngine::new(10000.0, 10);
        engine.place_order(
            "BTCUSDT", "buy", "limit", 0.1, 49000.0, 0.0, 0.0, 0.0, 50000.0, 50010.0,
        );
        assert_eq!(engine.pending_orders().len(), 1);

        let tick = MarketTick {
            symbol: "BTCUSDT".into(),
            bid: 48900.0,
            ask: 48950.0,
            last: 48950.0,
        };
        let filled = engine.on_tick(&tick);
        assert!(!filled.is_empty(), "Limit should fill when ask <= price");
        assert_eq!(engine.positions().len(), 1);
        assert!((engine.positions()[0].entry_price - 48950.0).abs() < 0.01);
    }

    #[test]
    fn test_stop_loss_trigger() {
        let mut engine = MatchingEngine::new(10000.0, 10);
        engine.place_order(
            "BTCUSDT", "buy", "market", 0.1, 0.0, 0.0, 49000.0, 0.0, 50000.0, 50010.0,
        );
        assert_eq!(engine.positions().len(), 1);

        let tick = MarketTick {
            symbol: "BTCUSDT".into(),
            bid: 48800.0,
            ask: 48850.0,
            last: 48800.0,
        };
        let filled = engine.on_tick(&tick);
        assert!(!filled.is_empty(), "Stop loss should trigger");
        assert!(engine.positions().is_empty(), "Position should be closed");
    }

    #[test]
    fn test_insufficient_margin() {
        let mut engine = MatchingEngine::new(1000.0, 1);
        let result = engine.place_order(
            "BTCUSDT", "buy", "market", 10.0, 0.0, 0.0, 0.0, 0.0, 50000.0, 50010.0,
        );
        assert!(!result.filled, "Should reject: margin too low");
    }

    #[test]
    fn test_buy_sell_close() {
        let mut engine = MatchingEngine::new(10000.0, 10);
        engine.place_order(
            "BTCUSDT", "buy", "market", 0.1, 0.0, 0.0, 0.0, 0.0, 50000.0, 50010.0,
        );
        assert_eq!(engine.positions().len(), 1);

        // Sell same amount to close
        engine.place_order(
            "BTCUSDT", "sell", "market", 0.1, 0.0, 0.0, 0.0, 0.0, 50000.0, 50010.0,
        );
        assert!(engine.positions().is_empty(), "Should be flat");
    }
}
