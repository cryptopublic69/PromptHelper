#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS 构建需要在 Mac 上运行。" >&2
  exit 1
fi
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null; then
  echo "请先安装 Rust：https://rustup.rs" >&2
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
build_mode="${1:-dev}"
shift || true
case "$build_mode" in
  dev) exec npm run tauri -- dev "$@" ;;
  build) exec npm run tauri -- build "$@" -- --locked ;;
  *) echo "用法：bash scripts/macos.sh [dev|build] [Tauri 参数]" >&2; exit 1 ;;
esac
