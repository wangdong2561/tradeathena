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
echo "按 Ctrl+C 停止所有服务"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
