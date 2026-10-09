#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
exec bash scripts/macos.sh dev
