/// TradeAthena core engine — PyO3 bindings.
use std::sync::Mutex;

use pyo3::prelude::*;
use pyo3::exceptions::PyRuntimeError;
use pyo3::types::PyDict;

mod matching;
mod types;

use matching::MatchingEngine as CoreEngine;
use types::MarketTick;

/// Helper: create a PyObject dict from pairs.
macro_rules! py_dict {
    ($py:expr, $( $key:expr => $val:expr ),* $(,)?) => {{
        let d = PyDict::new_bound($py);
        $(
            let _ = d.set_item($key, $val);
        )*
        d.into()
    }};
}

#[pyclass(name = "MatchingEngine")]
struct PyMatchingEngine {
    inner: Mutex<CoreEngine>,
}

#[pymethods]
impl PyMatchingEngine {
    #[new]
    #[pyo3(signature = (initial_balance = 10000.0, leverage = 100))]
    fn new(initial_balance: f64, leverage: u32) -> Self {
        PyMatchingEngine {
            inner: Mutex::new(CoreEngine::new(initial_balance, leverage)),
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[pyo3(signature = (symbol, side, order_type, volume, price=0.0, stop_price=0.0, stop_loss=0.0, take_profit=0.0, current_bid=0.0, current_ask=0.0))]
    fn place_order(
        &self,
        py: Python<'_>,
        symbol: &str, side: &str, order_type: &str,
        volume: f64, price: f64, stop_price: f64,
        stop_loss: f64, take_profit: f64,
        current_bid: f64, current_ask: f64,
    ) -> PyResult<PyObject> {
        let mut engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        let r = engine.place_order(
            symbol, side, order_type, volume, price, stop_price,
            stop_loss, take_profit, current_bid, current_ask,
        );
        Ok(py_dict!(py,
            "order_id" => r.order_id as i64,
            "filled" => r.filled,
            "fill_price" => r.fill_price,
            "fill_volume" => r.fill_volume,
            "message" => r.message.clone(),
        ))
    }

    fn on_tick(&self, symbol: &str, bid: f64, ask: f64, last: f64) -> PyResult<Vec<u64>> {
        let mut engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        Ok(engine.on_tick(&MarketTick { symbol: symbol.into(), bid, ask, last }))
    }

    fn get_account(&self, py: Python<'_>) -> PyResult<PyObject> {
        let engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        let a = engine.get_account();
        Ok(py_dict!(py,
            "id" => a.id as i64,
            "balance" => a.balance,
            "equity" => a.equity,
            "margin" => a.margin,
            "free_margin" => a.free_margin,
            "margin_level" => a.margin_level,
            "leverage" => a.leverage as i64,
        ))
    }

    fn get_positions(&self, py: Python<'_>) -> PyResult<PyObject> {
        let engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        let items: Vec<PyObject> = engine.positions().iter().map(|p| {
            py_dict!(py,
                "id" => p.id as i64,
                "symbol" => p.symbol.clone(),
                "side" => p.side.as_str(),
                "volume" => p.volume,
                "entry_price" => p.entry_price,
                "current_price" => p.current_price,
                "stop_loss" => p.stop_loss,
                "take_profit" => p.take_profit,
                "unrealized_pl" => p.unrealized_pl,
            )
        }).collect();
        Ok(items.into_py(py))
    }

    fn get_pending_orders(&self, py: Python<'_>) -> PyResult<PyObject> {
        let engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        let items: Vec<PyObject> = engine.pending_orders().iter().map(|o| {
            py_dict!(py,
                "id" => o.id as i64,
                "symbol" => o.symbol.clone(),
                "side" => o.side.as_str(),
                "order_type" => o.order_type.as_str(),
                "volume" => o.volume,
                "price" => o.price,
                "stop_price" => o.stop_price,
                "status" => o.status.as_str(),
                "filled_volume" => o.filled_volume,
                "filled_price" => o.filled_price,
                "stop_loss" => o.stop_loss,
                "take_profit" => o.take_profit,
            )
        }).collect();
        Ok(items.into_py(py))
    }

    fn cancel_order(&self, order_id: u64) -> PyResult<bool> {
        let mut engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        Ok(engine.cancel_order(order_id))
    }

    fn modify_position(&self, position_id: u64, stop_loss: f64, take_profit: f64) -> PyResult<bool> {
        let mut engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        Ok(engine.modify_position_sl_tp(position_id, stop_loss, take_profit))
    }

    fn close_position(&self, position_id: u64, bid: f64, ask: f64, last: f64) -> PyResult<bool> {
        let mut engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        Ok(engine.close_position_by_id(position_id, &MarketTick { symbol: String::new(), bid, ask, last }))
    }

    fn reset(&self, initial_balance: f64) -> PyResult<()> {
        let mut engine = self.inner.lock().map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        engine.reset(initial_balance);
        Ok(())
    }
}

#[pymodule]
fn toptrader_core(_py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyMatchingEngine>()?;
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    Ok(())
}
