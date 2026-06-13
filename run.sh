#!/bin/bash
# TradeAthena — 一键启动
# Usage: bash run.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="$HOME/.cargo/bin:$PATH"

echo "╔══════════════════════════════════════════╗"
echo "║      TradeAthena 量化交易终端            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check venv
if [ ! -f ".venv/bin/uvicorn" ]; then
    echo "❌ 未找到虚拟环境，请先运行:"
    echo "   python3 -m venv .venv"
    echo "   source .venv/bin/activate && pip install -r requirements.txt"
    echo "   pip install maturin && maturin develop --release"
    exit 1
fi

echo "🚀 启动后端 (端口 8000)..."
.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "🚀 启动前端 (端口 5173)..."
cd frontend
npx vite --host &
FRONTEND_PID=$!
cd ..

echo ""
echo "══════════════════════════════════════════"
echo "  后端 API:  http://localhost:8000"
echo "  前端界面:  http://localhost:5173"
echo "  API 文档:  http://localhost:8000/docs"
echo "  登录:      admin / admin123"
echo "══════════════════════════════════════════"
echo ""
echo "  [Ctrl+C] 停止所有服务并退出"
echo ""

cleanup() {
    echo ""
    echo "🛑 正在停止服务..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "✅ 服务已停止"
    exit 0
}

trap cleanup SIGINT SIGTERM

wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
