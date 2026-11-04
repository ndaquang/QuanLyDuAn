# Phần mềm Quản lý Công ty Xây dựng (bản riêng dựa trên Plane)

Đây là bản **độc lập** xây dựng trên mã nguồn mở [Plane](https://github.com/makeplane/plane) (giấy phép AGPL-3.0). Plane cung cấp sẵn nền tảng tài khoản, đăng nhập, công ty (workspace), dự án, giao việc (work item), bình luận và lưu trữ tệp. Phần mở rộng **Quản lý Xây dựng** thêm toàn bộ nghiệp vụ của công ty xây dựng ~20 nhân sự, giao diện tiếng Việt.

| Thành phần                     | Vị trí trong repo                                                          | Vai trò                                                               |
| ------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Phân hệ backend `construction` | `apps/api/plane/construction/`                                             | Mô hình dữ liệu, API, phân quyền, luồng phê duyệt, báo cáo, nhắc việc |
| Ứng dụng ERP (giao diện)       | `apps/erp/`                                                                | React + TypeScript + Tailwind + Recharts, chạy tại `/erp/`            |
| Plane (giữ nguyên)             | `apps/web`, `apps/admin`, ...                                              | Bảng công việc nâng cao, trang quản trị hệ thống `/god-mode/`         |
| Kiểm thử                       | `apps/api/plane/tests/contract/construction/`, `apps/erp/src/**/*.test.ts` | Kiểm thử nghiệp vụ, phân quyền, phê duyệt                             |

## Tài liệu

1. [Phân tích nghiệp vụ & phạm vi theo giai đoạn](01-phan-tich-nghiep-vu.md)
2. [Kiến trúc hệ thống](02-kien-truc.md)
3. [Thiết kế cơ sở dữ liệu](03-co-so-du-lieu.md)
4. [Sơ đồ luồng nghiệp vụ](04-quy-trinh-nghiep-vu.md)
5. [Phân quyền người dùng](05-phan-quyen.md)
6. [Hướng dẫn sử dụng](06-huong-dan-su-dung.md)
7. [Triển khai, sao lưu, bảo mật](07-trien-khai.md)

## Khởi tạo và chạy trên máy phát triển

### 0. Yêu cầu

| Thành phần     | Phiên bản                                                             | Ghi chú                                        |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Python         | 3.12                                                                  | do `uv` quản lý                                |
| uv             | **0.12.21** (đúng `required-version` trong `apps/api/pyproject.toml`) | `uv self update 0.12.21`                       |
| Node.js        | 22.x                                                                  | `node -v`                                      |
| pnpm           | 11.10.0                                                               | `corepack enable` hoặc cài theo `package.json` |
| PostgreSQL     | 15 hoặc 16                                                            | tạo sẵn user và database                       |
| Redis / Valkey | 6+                                                                    | cache và giới hạn đăng nhập                    |

Trên Ubuntu/Debian:

```bash
sudo apt install -y postgresql redis-server
```

### 1. Cài dependency

```bash
cd /đường/dẫn/QuanLyDuAn
pnpm install
```

```bash
cd apps/api && uv sync
```

### 2. Tạo database

```bash
sudo -u postgres psql -c "CREATE USER plane WITH PASSWORD 'plane' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE plane OWNER plane;"
```

Khởi động Redis (nếu chưa chạy):

```bash
redis-server --daemonize yes
```

### 3. Biến môi trường

Repo **không tự đọc** file `.env` khi chạy `manage.py`, nên cần nạp biến vào shell. Tạo file `apps/api/.env.local` (không commit):

```bash
cat > apps/api/.env.local <<'EOF'
DJANGO_SETTINGS_MODULE=plane.settings.local
SECRET_KEY=doi-thanh-chuoi-ngau-nhien-dai-it-nhat-50-ky-tu
DEBUG=1
DATABASE_URL=postgresql://plane:plane@localhost:5432/plane
REDIS_URL=redis://localhost:6379/
WEB_URL=http://localhost:3010
APP_BASE_URL=http://localhost:3010
CORS_ALLOWED_ORIGINS=http://localhost:3010
CONSTRUCTION_FILE_STORAGE=local
CONSTRUCTION_MEDIA_ROOT=/duong/dan/tuy-y/construction-media
EOF
```

Nạp biến cho mỗi cửa sổ terminal dùng backend:

```bash
cd apps/api && set -a && source .env.local && set +a
```

- `SECRET_KEY`: bắt buộc đổi. Chuỗi mặc định bị chặn ở chế độ production.
- `WEB_URL` và `APP_BASE_URL` phải trùng cổng của ERP (3010) để đăng nhập và chuyển hướng đúng.
- `CONSTRUCTION_FILE_STORAGE=local` lưu tệp trên đĩa máy, không cần MinIO/S3. Khi đưa lên máy chủ thật, dùng `s3` như trong [07-trien-khai.md](07-trien-khai.md).

### 4. Migrate database

```bash
cd apps/api && set -a && source .env.local && set +a
uv run python manage.py migrate
```

Lệnh này tạo toàn bộ bảng của Plane và bảng `cx_*` của phân hệ xây dựng, đồng thời nạp danh mục quyền (migration `0002`, `0004`).

Kiểm tra nhanh:

```bash
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run   # phải in: No changes detected
```

### 5. Chọn một trong hai cách khởi tạo dữ liệu

**Cách A - Công ty thật (khuyến nghị, không có dữ liệu giả):**

```bash
uv run python manage.py construction_setup \
  --workspace cong-ty-abc \
  --name "Công ty Xây dựng ABC" \
  --admin-email giamdoc@congty.vn \
  --admin-name "Nguyễn Văn A"
```

Lệnh sẽ hỏi mật khẩu quản trị (nhập ẩn). Lệnh chỉ nạp danh mục quyền, 9 vai trò mặc định, phòng ban và luồng phê duyệt, rồi gắn tài khoản giám đốc với vai trò Giám đốc.

**Cách B - Dữ liệu mẫu để thử nghiệm:**

```bash
CONSTRUCTION_ALLOW_DEMO=1 uv run python manage.py construction_seed_demo --password "Demo@12345"
```

Dữ liệu nằm trong công ty `demo-xay-dung`, tài khoản dạng `<vai-trò>@demo.local` (ví dụ `giamdoc@demo.local`, `truongphongda@demo.local`, `kysuxd@demo.local`, `thumua@demo.local`). Lệnh từ chối chạy nếu slug không bắt đầu bằng `demo-`.

### 6. Chạy backend

Cửa sổ terminal 1:

```bash
cd apps/api && set -a && source .env.local && set +a
uv run python manage.py runserver 0.0.0.0:8000
```

Kiểm tra: `curl -i http://localhost:8000/api/construction/me/` phải trả `401` (chưa đăng nhập là đúng).

### 7. Chạy giao diện ERP

Cửa sổ terminal 2:

```bash
cd apps/erp && pnpm dev
```

Mở trình duyệt tại **http://localhost:3010/erp/** rồi đăng nhập. Vite tự chuyển `/api` sang cổng 8000. Nếu backend chạy ở máy khác, đặt `ERP_API_TARGET=http://ten-may:8000` trước khi chạy `pnpm dev`.

### 8. Nhắc việc tự động (tùy chọn)

Nhắc việc chạy bằng Celery và cần RabbitMQ. Khi phát triển có thể bỏ qua. Để chạy thử một lần, gọi trực tiếp hàm (không cần worker):

```bash
cd apps/api && set -a && source .env.local && set +a
uv run python manage.py shell -c "from plane.construction.tasks import run_reminders; print(run_reminders())"
```

### 9. Lỗi thường gặp

| Triệu chứng                                                    | Nguyên nhân và cách xử lý                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `uv: required version ==0.12.21 does not match`                | `uv self update 0.12.21`, rồi mở lại terminal                                                         |
| `DisallowedHost` hoặc trang 400 khi gọi API                    | Thiếu `ALLOWED_HOSTS`; để mặc định `*` trong môi trường phát triển                                    |
| `APP_BASE_URL or WEB_URL is not set`                           | Chưa nạp `.env.local` trong terminal đó                                                               |
| `Connection refused` ở cổng 5432 hoặc 6379                     | Postgres hoặc Redis chưa chạy (`pg_lsclusters`, `redis-cli ping`)                                     |
| Đăng nhập ERP báo "Origin không được phép"                     | Mở ERP bằng `localhost:3010`, không mở bằng IP; thêm origin vào `CORS_ALLOWED_ORIGINS`                |
| Đăng nhập được nhưng màn hình trống, báo "chưa được cấp quyền" | Tài khoản chưa có nhân sự với vai trò; chạy lại `construction_setup` hoặc gán vai trò trong _Nhân sự_ |
| Tải ảnh báo lỗi 500                                            | Thư mục `CONSTRUCTION_MEDIA_ROOT` không ghi được; tạo thư mục và cấp quyền                            |

## Kiểm thử

```bash
cd apps/api && set -a && source .env.local && set +a && uv run pytest plane/tests/contract/construction
```

```bash
cd apps/erp && pnpm test && pnpm check:types && pnpm check:lint
```
