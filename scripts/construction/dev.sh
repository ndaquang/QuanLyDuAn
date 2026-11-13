#!/usr/bin/env bash
# Khởi tạo và chạy phần mềm Quản lý Xây dựng trên máy phát triển.
#
#   ./scripts/construction/dev.sh setup      # lần đầu: kiểm tra công cụ, tạo .env.local, cài thư viện, migrate
#   ./scripts/construction/dev.sh demo       # nạp dữ liệu mẫu (công ty demo-xay-dung, tài khoản @demo.local)
#   ./scripts/construction/dev.sh company --workspace cong-ty-abc --name "Công ty ABC" --admin-email gd@abc.vn
#                                             # tạo công ty thật (không có dữ liệu giả)
#   ./scripts/construction/dev.sh start      # chạy API (cổng 8000) + giao diện ERP (cổng 3010)
#   ./scripts/construction/dev.sh check      # chạy toàn bộ kiểm tra: lint, kiểu dữ liệu, kiểm thử
#
# Biến có thể đặt trước khi chạy `setup` (chỉ dùng khi .env.local chưa có):
#   DATABASE_URL (mặc định postgresql://plane:plane@localhost:5432/plane)
#   REDIS_URL    (mặc định redis://localhost:6379/)
#   ERP_PORT     (mặc định 3010)   API_PORT (mặc định 8000)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API="$ROOT/apps/api"
ERP="$ROOT/apps/erp"
ENV_FILE="$API/.env.local"
ERP_PORT="${ERP_PORT:-3010}"
API_PORT="${API_PORT:-8000}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31m ✗ %s\033[0m\n' "$*" >&2
  exit 1
}

load_env() {
  [ -f "$ENV_FILE" ] || die "Chưa có $ENV_FILE - chạy '$0 setup' trước."
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

check_tools() {
  say "Kiểm tra công cụ"
  local need
  for need in uv node pnpm python3 psql redis-cli; do
    command -v "$need" >/dev/null 2>&1 || die "Thiếu '$need'. Xem docs/construction/README.md mục 0."
  done
  local want have
  want="$(sed -n 's/^required-version = "==\(.*\)"/\1/p' "$API/pyproject.toml")"
  have="$(uv --version | awk '{print $2}')"
  [ -z "$want" ] || [ "$want" = "$have" ] || die "uv $have, cần đúng $want: chạy 'uv self update $want'."
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || die "Cần Node.js 22 trở lên."
  ok "uv $have, node $(node -v), pnpm $(pnpm -v)"
}

write_env() {
  if [ -f "$ENV_FILE" ]; then
    ok "Đã có $ENV_FILE (giữ nguyên)"
    return
  fi
  say "Tạo $ENV_FILE"
  local secret
  secret="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')"
  cat >"$ENV_FILE" <<EOF
DJANGO_SETTINGS_MODULE=plane.settings.local
SECRET_KEY=$secret
DEBUG=1
DATABASE_URL=${DATABASE_URL:-postgresql://plane:plane@localhost:5432/plane}
REDIS_URL=${REDIS_URL:-redis://localhost:6379/}
WEB_URL=http://localhost:$ERP_PORT
APP_BASE_URL=http://localhost:$ERP_PORT
CORS_ALLOWED_ORIGINS=http://localhost:$ERP_PORT
CONSTRUCTION_FILE_STORAGE=local
CONSTRUCTION_MEDIA_ROOT=$API/plane/construction-media
EOF
  ok "Đã tạo (SECRET_KEY ngẫu nhiên, file này không được commit)"
}

check_services() {
  say "Kiểm tra PostgreSQL và Redis"
  psql "$DATABASE_URL" -tAc 'select 1' >/dev/null 2>&1 || die "Không kết nối được PostgreSQL theo DATABASE_URL.
   Tạo user và database (Ubuntu):
     sudo -u postgres psql -c \"CREATE USER plane WITH PASSWORD 'plane' SUPERUSER;\"
     sudo -u postgres psql -c \"CREATE DATABASE plane OWNER plane;\""
  ok "PostgreSQL"
  redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1 || die "Không kết nối được Redis ($REDIS_URL). Chạy: redis-server --daemonize yes"
  ok "Redis"
}

cmd_setup() {
  check_tools
  write_env
  load_env
  check_services
  say "Cài thư viện giao diện (pnpm install)"
  (cd "$ROOT" && pnpm install --frozen-lockfile)
  say "Cài thư viện backend (uv sync)"
  (cd "$API" && uv sync)
  mkdir -p "$CONSTRUCTION_MEDIA_ROOT"
  say "Tạo bảng dữ liệu (migrate)"
  (cd "$API" && uv run python manage.py migrate --no-input)
  (cd "$API" && uv run python manage.py check)
  ok "Khởi tạo xong. Tiếp theo: '$0 demo' (dữ liệu mẫu) hoặc '$0 company ...' (công ty thật), rồi '$0 start'."
}

cmd_demo() {
  load_env
  say "Nạp dữ liệu mẫu vào công ty demo-xay-dung"
  (cd "$API" && CONSTRUCTION_ALLOW_DEMO=1 uv run python manage.py construction_seed_demo --password "${DEMO_PASSWORD:-Demo@12345}")
  ok "Đăng nhập: giamdoc@demo.local / ${DEMO_PASSWORD:-Demo@12345} (các vai trò khác: truongphongda, kysuxd, kysumep, qs, hse, thumua, nhansu, ketoan)"
}

cmd_company() {
  load_env
  say "Khởi tạo công ty (danh mục quyền, vai trò, phòng ban, luồng duyệt)"
  (cd "$API" && uv run python manage.py construction_setup "$@")
}

SERVER_PIDS=()
STOPPED=0

# Stop a process and all its descendants (pnpm -> vite, uv -> python ...).
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$1" 2>/dev/null || true
}

stop_servers() {
  [ "$STOPPED" = 1 ] && return
  STOPPED=1
  say "Dừng máy chủ"
  local pid
  for pid in "${SERVER_PIDS[@]:-}"; do
    [ -n "$pid" ] && kill_tree "$pid"
  done
}

cmd_start() {
  load_env
  check_services
  trap stop_servers EXIT
  trap 'stop_servers; exit 130' INT TERM
  say "Chạy API tại http://localhost:$API_PORT"
  (cd "$API" && exec uv run python manage.py runserver "0.0.0.0:$API_PORT") &
  SERVER_PIDS+=($!)
  say "Chạy giao diện ERP tại http://localhost:$ERP_PORT/erp/ (Ctrl+C để dừng)"
  (cd "$ERP" && ERP_API_TARGET="http://localhost:$API_PORT" exec pnpm exec vite --port "$ERP_PORT" --strictPort --host 0.0.0.0) &
  SERVER_PIDS+=($!)
  wait
}

cmd_check() {
  load_env
  say "Backend: ruff + kiểm thử phân hệ xây dựng"
  (cd "$API" && uv run ruff check plane/construction plane/tests/contract/construction)
  (cd "$API" && uv run python manage.py makemigrations --check --dry-run)
  (cd "$API" && DJANGO_SETTINGS_MODULE=plane.settings.test uv run pytest plane/tests/contract/construction -q -p no:cacheprovider)
  say "Giao diện: kiểu dữ liệu, lint, định dạng, kiểm thử, build"
  (cd "$ERP" && pnpm check:types && pnpm check:lint && pnpm check:format && pnpm test && pnpm exec vite build)
  ok "Tất cả kiểm tra đều đạt"
}

case "${1:-}" in
  setup) cmd_setup ;;
  demo) cmd_demo ;;
  company) shift && cmd_company "$@" ;;
  start) cmd_start ;;
  check) cmd_check ;;
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
