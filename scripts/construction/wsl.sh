#!/usr/bin/env bash
# Cài đặt và chạy thử phần mềm Quản lý Xây dựng trên Windows (WSL - Ubuntu).
#
#   ./scripts/construction/wsl.sh install   # lần đầu: cài công cụ, tạo database, khởi tạo, nạp dữ liệu mẫu
#   ./scripts/construction/wsl.sh start     # mỗi lần dùng: bật PostgreSQL + Redis, chạy API và giao diện ERP
#
# Chạy lại `install` nhiều lần không sao: bước nào đã xong sẽ được bỏ qua.
# Hướng dẫn đầy đủ: docs/construction/08-cai-dat-windows.md

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/scripts/construction/dev.sh"
NODE_MAJOR=22
PNPM_VERSION="$(sed -n 's/.*"packageManager": "pnpm@\([0-9.]*\).*/\1/p' "$ROOT/package.json")"
UV_VERSION="$(sed -n 's/^required-version = "==\(.*\)"/\1/p' "$ROOT/apps/api/pyproject.toml")"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ! %s\033[0m\n' "$*"; }
die() {
  printf '\033[1;31m ✗ %s\033[0m\n' "$*" >&2
  exit 1
}

export PATH="$HOME/.local/bin:$PATH"

check_location() {
  case "$ROOT" in
    /mnt/*) warn "Code đang nằm trên ổ Windows ($ROOT) - chạy sẽ rất chậm. Nên clone vào ~/QuanLyDuAn." ;;
  esac
  if grep -q $'\r' "$DEV"; then
    die "File script có ký tự xuống dòng kiểu Windows (CRLF). Hãy clone lại repo bên trong Ubuntu (không clone bằng Git trên Windows)."
  fi
}

start_services() {
  say "Bật PostgreSQL và Redis"
  sudo service postgresql start >/dev/null
  sudo service redis-server start >/dev/null
  ok "PostgreSQL và Redis đang chạy"
}

# Official installer first; fall back to the release tarball on GitHub.
install_uv() {
  if curl -fsSL "https://astral.sh/uv/$UV_VERSION/install.sh" 2>/dev/null | sh >/dev/null 2>&1; then
    return
  fi
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$(uname -m)-unknown-linux-gnu.tar.gz" |
    tar -xz -C "$tmp" --strip-components=1
  mkdir -p "$HOME/.local/bin"
  install -m 755 "$tmp/uv" "$tmp/uvx" "$HOME/.local/bin/"
  rm -rf "$tmp"
}

install_tools() {
  say "Cài gói hệ thống (git, curl, PostgreSQL, Redis)"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates postgresql redis-server >/dev/null
  ok "Gói hệ thống"

  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
    say "Cài Node.js $NODE_MAJOR"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
  fi
  ok "Node.js $(node -v)"

  if [ "$(pnpm -v 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
    say "Cài pnpm $PNPM_VERSION"
    sudo npm install -g --silent "pnpm@$PNPM_VERSION"
  fi
  ok "pnpm $(pnpm -v)"

  if [ "$(uv --version 2>/dev/null | awk '{print $2}')" != "$UV_VERSION" ]; then
    say "Cài uv $UV_VERSION"
    install_uv
    hash -r
  fi
  [ "$(uv --version | awk '{print $2}')" = "$UV_VERSION" ] || die "Không cài được uv $UV_VERSION."
  ok "uv $(uv --version | awk '{print $2}')"
}

create_database() {
  say "Tạo database 'plane' (user plane / mật khẩu plane)"
  if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'plane'")" != "1" ]; then
    sudo -u postgres psql -qc "CREATE USER plane WITH PASSWORD 'plane' SUPERUSER;"
  fi
  if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'plane'")" != "1" ]; then
    sudo -u postgres psql -qc "CREATE DATABASE plane OWNER plane;"
  fi
  ok "Database sẵn sàng"
}

cmd_install() {
  check_location
  install_tools
  start_services
  create_database
  "$DEV" setup
  "$DEV" demo
  ok "Cài đặt xong. Chạy: ./scripts/construction/wsl.sh start  rồi mở http://localhost:3010/erp/ trên trình duyệt Windows."
}

cmd_start() {
  check_location
  start_services
  "$DEV" start
}

case "${1:-}" in
  install) cmd_install ;;
  start) cmd_start ;;
  *)
    sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
