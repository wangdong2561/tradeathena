/// Shared types for the TradeAthena core engine.

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    pub fn opposite(self) -> Self {
        match self {
            Side::Buy => Side::Sell,
            Side::Sell => Side::Buy,
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "buy" => Side::Buy,
            "sell" => Side::Sell,
            _ => Side::Buy,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Side::Buy => "buy",
            Side::Sell => "sell",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OrderType {
    Market,
    Limit,
    Stop,
}

impl OrderType {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "market" => OrderType::Market,
            "limit" => OrderType::Limit,
            "stop" => OrderType::Stop,
            _ => OrderType::Market,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            OrderType::Market => "market",
            OrderType::Limit => "limit",
            OrderType::Stop => "stop",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OrderStatus {
    Pending,
    Filled,
    Cancelled,
    Expired,
}

impl OrderStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            OrderStatus::Pending => "pending",
            OrderStatus::Filled => "filled",
            OrderStatus::Cancelled => "cancelled",
            OrderStatus::Expired => "expired",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Order {
    pub id: u64,
    pub account_id: u64,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub volume: f64,
    pub price: f64,
    pub stop_price: f64,
    pub filled_price: f64,
    pub filled_volume: f64,
    pub status: OrderStatus,
    pub stop_loss: f64,
    pub take_profit: f64,
}

#[derive(Debug, Clone)]
pub struct Position {
    pub id: u64,
    pub account_id: u64,
    pub symbol: String,
    pub side: Side,
    pub volume: f64,
    pub entry_price: f64,
    pub current_price: f64,
    pub stop_loss: f64,
    pub take_profit: f64,
    pub unrealized_pl: f64,
}

#[derive(Debug, Clone)]
pub struct Account {
    pub id: u64,
    pub balance: f64,
    pub equity: f64,
    pub margin: f64,
    pub free_margin: f64,
    pub margin_level: f64,
    pub leverage: u32,
}

#[derive(Debug, Clone)]
pub struct TradeResult {
    pub order_id: u64,
    pub filled: bool,
    pub fill_price: f64,
    pub fill_volume: f64,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct MarketTick {
    pub symbol: String,
    pub bid: f64,
    pub ask: f64,
    pub last: f64,
}

/// Margin calculation result.
#[derive(Debug, Clone)]
pub struct MarginInfo {
    pub used_margin: f64,
    pub equity: f64,
    pub free_margin: f64,
    pub margin_level: f64,
}
