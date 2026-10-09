#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
exec cargo test --manifest-path src-tauri/Cargo.toml --locked
