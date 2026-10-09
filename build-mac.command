#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
rustup target add aarch64-apple-darwin x86_64-apple-darwin
exec bash scripts/macos.sh build --target universal-apple-darwin
