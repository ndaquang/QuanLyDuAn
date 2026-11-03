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

## Chạy thử nhanh trên máy phát triển

Yêu cầu: Python 3.12 + [uv](https://docs.astral.sh/uv/), Node 22 + pnpm, PostgreSQL 15+, Redis/Valkey.

```bash
pnpm install
```

```bash
cd apps/api && uv sync && cp .env.example .env   # sửa DATABASE_URL, REDIS_URL, SECRET_KEY, WEB_URL=http://localhost:3010
```

```bash
cd apps/api && uv run python manage.py migrate
```

Dữ liệu mẫu (chỉ để thử, nằm trong công ty riêng `demo-xay-dung`, tài khoản `<vai trò>@demo.local`):

```bash
cd apps/api && CONSTRUCTION_ALLOW_DEMO=1 uv run python manage.py construction_seed_demo --password "Demo@12345"
```

```bash
cd apps/api && CONSTRUCTION_FILE_STORAGE=local uv run python manage.py runserver 8000
```

```bash
cd apps/erp && pnpm dev    # mở http://localhost:3010/erp/ - đăng nhập giamdoc@demo.local / Demo@12345
```

Tài khoản demo: `giamdoc`, `truongphongda`, `kysuxd`, `kysumep`, `qs`, `hse`, `thumua`, `nhansu`, `ketoan` (đuôi `@demo.local`).

## Kiểm thử

```bash
cd apps/api && uv run pytest plane/tests/contract/construction
```

```bash
cd apps/erp && pnpm test && pnpm check:types && pnpm check:lint
```
