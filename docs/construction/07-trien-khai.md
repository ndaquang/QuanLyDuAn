# 7. Triển khai bản riêng, sao lưu, bảo mật

## 7.1 Yêu cầu máy chủ (20 người dùng đồng thời)

- 4 vCPU, 8 GB RAM, 100 GB SSD (tăng theo dung lượng ảnh / hồ sơ), Ubuntu 22.04+ có Docker và Docker Compose.
- Tên miền trỏ về máy chủ (Caddy tự cấp chứng chỉ HTTPS Let's Encrypt).

## 7.2 Cài đặt bằng Docker Compose

```bash
git clone <repo-của-công-ty> quanlyduan && cd quanlyduan
```

```bash
./setup.sh    # tạo .env và apps/api/.env từ file mẫu
```

Sửa tối thiểu trong `.env` và `apps/api/.env`:

| Biến                                                              | Giá trị                                         |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| `SECRET_KEY`                                                      | chuỗi ngẫu nhiên dài (bắt buộc đổi)             |
| `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`, `AWS_SECRET_ACCESS_KEY` | mật khẩu mạnh, khác mặc định                    |
| `SITE_ADDRESS`                                                    | tên miền, VD `erp.congty.vn`                    |
| `WEB_URL`, `APP_BASE_URL`                                         | `https://erp.congty.vn`                         |
| `CORS_ALLOWED_ORIGINS`                                            | `https://erp.congty.vn`                         |
| `FILE_SIZE_LIMIT`                                                 | VD `52428800` (50 MB cho bản vẽ, hồ sơ)         |
| `CONSTRUCTION_FILE_STORAGE`                                       | `s3` (mặc định, dùng MinIO đi kèm) hoặc `local` |
| `DEBUG`                                                           | `0`                                             |

```bash
docker compose up -d --build
```

Dịch vụ `erp` (giao diện xây dựng) được build từ `apps/erp/Dockerfile.erp`; proxy định tuyến `/erp/` tới nó, `/api/` và `/auth/` tới API.

Khởi tạo hệ thống (lần đầu):

1. Mở `https://erp.congty.vn/god-mode/` để thiết lập phiên bản Plane (tài khoản quản trị hệ thống, bật đăng nhập email + mật khẩu, cấu hình SMTP nếu muốn gửi email quên mật khẩu).
2. Tạo công ty và tài khoản Giám đốc bằng lệnh (không tạo dữ liệu giả):

```bash
docker compose exec api python manage.py construction_setup --workspace cong-ty-abc --name "Công ty Xây dựng ABC" --admin-email giamdoc@congty.vn --admin-name "Nguyễn Văn A"
```

3. Đăng nhập `https://erp.congty.vn/erp/` và làm theo [Hướng dẫn sử dụng 6.1](06-huong-dan-su-dung.md#61-lần-đầu-quản-trị-viên).

> Muốn có môi trường đào tạo: chạy `construction_seed_demo` với `CONSTRUCTION_ALLOW_DEMO=1` - dữ liệu nằm ở công ty `demo-xay-dung`, tài khoản `@demo.local`, hoàn toàn tách khỏi công ty thật. Không chạy lệnh này trên máy chủ thật nếu không cần.

## 7.3 Tác vụ định kỳ

Dịch vụ `beat-worker` + `worker` chạy `plane.construction.tasks.construction_daily_reminders` lúc 00:15 UTC (07:15 giờ Việt Nam): nhắc việc sắp đến hạn (2 ngày), quá hạn, dự án chậm tiến độ. Có chống gửi trùng trong ngày.

## 7.4 Sao lưu & khôi phục

Sao lưu hằng đêm (cron trên máy chủ), giữ ≥ 14 bản, chép 1 bản ra ngoài máy chủ (NAS / cloud):

```bash
docker compose exec -T plane-db pg_dump -U plane -Fc plane > /backup/db-$(date +%F).dump
```

```bash
docker run --rm -v quanlyduan_uploads:/data -v /backup:/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

Khôi phục:

```bash
docker compose exec -T plane-db pg_restore -U plane -d plane --clean --if-exists < /backup/db-YYYY-MM-DD.dump
```

Nếu dùng `CONSTRUCTION_FILE_STORAGE=local`, sao lưu thêm thư mục `CONSTRUCTION_MEDIA_ROOT` (mặc định `apps/api/plane/construction-media` trong container API - nên gắn volume riêng).

Kiểm tra khôi phục thử mỗi quý trên máy khác.

## 7.5 Bảo mật

- Toàn bộ kiểm tra quyền ở API (vai trò + dự án), dữ liệu dự án không tham gia trả 404.
- Đăng nhập giới hạn 10 lần/phút/IP (`AUTHENTICATION_RATE_LIMIT`), kiểm tra Origin chống CSRF đăng nhập; mật khẩu kiểm tra độ mạnh.
- Ghi có cookie phiên chỉ chấp nhận từ cùng nguồn gốc (cơ chế của Plane).
- Tệp: chỉ nhận định dạng trong danh sách cho phép (ảnh, PDF, Office, DWG/DXF, nén), kiểu nội dung suy ra từ phần mở rộng, tải xuống qua API sau khi kiểm tra quyền; ảnh được hiển thị inline, loại khác buộc tải về.
- Xuất Excel chống chèn công thức (giá trị bắt đầu bằng `=`, `+`, `-`, `@`).
- Không lưu mật khẩu, khóa bí mật trong mã nguồn; dùng biến môi trường.
- Bật HTTPS (Caddy), sao lưu mã hóa khi chép ra ngoài.

## 7.6 Nâng cấp

1. Sao lưu (7.4).
2. `git pull` (hoặc hợp nhất bản Plane mới: các điểm nối của phân hệ xây dựng chỉ gồm `settings/common.py` - `INSTALLED_APPS` và `CELERY_IMPORTS`, `urls.py`, `celery.py`, `docker-compose.yml`, `apps/proxy/Caddyfile.ce`).
3. `docker compose up -d --build` - migration chạy tự động bởi dịch vụ `migrator`.

## 7.7 Giấy phép

Plane phát hành theo AGPL-3.0; bản phái sinh này giữ nguyên giấy phép. Nếu cho người ngoài công ty truy cập qua mạng, phải cung cấp mã nguồn (kể cả phần sửa đổi) cho họ khi được yêu cầu. Không dùng tên / logo "Plane" để quảng bá sản phẩm riêng.
