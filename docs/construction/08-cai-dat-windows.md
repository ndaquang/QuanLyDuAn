# 8. Cài đặt chạy thử trên Windows

Hướng dẫn chạy toàn bộ hệ thống (API + giao diện ERP + dữ liệu mẫu) trên một máy Windows 10/11 để dùng thử. Hệ thống chạy trong **Ubuntu trên Windows (WSL)**, mở bằng trình duyệt Windows như một trang web bình thường.

Yêu cầu máy: Windows 10 (bản 2004 trở lên) hoặc Windows 11, RAM từ 8 GB, trống 10 GB ổ C, có Internet.

## 8.1 Cài Ubuntu (làm một lần)

1. Bấm chuột phải vào nút **Start** → chọn **Terminal (Admin)** hoặc **Windows PowerShell (Admin)**.
2. Gõ lệnh sau rồi Enter:

```powershell
wsl --install -d Ubuntu
```

3. Khởi động lại máy khi được yêu cầu.
4. Sau khi khởi động lại, cửa sổ **Ubuntu** tự mở (nếu không, vào Start, gõ `Ubuntu`). Đặt **tên đăng nhập** và **mật khẩu** Linux (gõ mật khẩu sẽ không hiện ký tự - bình thường). Ghi nhớ mật khẩu này, các bước sau sẽ hỏi lại.

Từ đây trở đi, **mọi lệnh đều gõ trong cửa sổ Ubuntu**, không gõ trong PowerShell.

## 8.2 Tải mã nguồn (làm một lần)

```bash
sudo apt update && sudo apt install -y git
```

```bash
git clone https://github.com/ndaquang/QuanLyDuAn.git ~/QuanLyDuAn
```

Nếu repo để riêng tư, Git hỏi `Username` (tên GitHub) và `Password`: dán **Personal Access Token** (GitHub → Settings → Developer settings → Personal access tokens → Generate new token, chọn quyền đọc repo), không phải mật khẩu GitHub.

## 8.3 Cài đặt tự động (làm một lần, 5-15 phút)

```bash
cd ~/QuanLyDuAn && ./scripts/construction/wsl.sh install
```

Script tự làm: cài PostgreSQL, Redis, Node.js 22, pnpm, uv; tạo database `plane`; cài thư viện; tạo bảng; nạp dữ liệu mẫu. Khi hỏi `[sudo] password`, gõ mật khẩu Linux ở bước 8.1. Kết thúc thành công khi thấy dòng **"Cài đặt xong"**. Chạy lại lệnh này nhiều lần không sao.

## 8.4 Chạy và đăng nhập (mỗi lần dùng)

```bash
cd ~/QuanLyDuAn && ./scripts/construction/wsl.sh start
```

Đợi đến khi thấy dòng `Chạy giao diện ERP tại http://localhost:3010/erp/`, mở **Chrome/Edge trên Windows** vào:

**http://localhost:3010/erp/**

| Vai trò               | Email                      | Mật khẩu     |
| --------------------- | -------------------------- | ------------ |
| Giám đốc (toàn quyền) | `giamdoc@demo.local`       | `Demo@12345` |
| Trưởng phòng dự án    | `truongphongda@demo.local` | `Demo@12345` |
| Kỹ sư xây dựng        | `kysuxd@demo.local`        | `Demo@12345` |
| Kỹ sư MEP             | `kysumep@demo.local`       | `Demo@12345` |
| QS (khối lượng)       | `qs@demo.local`            | `Demo@12345` |
| An toàn - Môi trường  | `hse@demo.local`           | `Demo@12345` |
| Thu mua               | `thumua@demo.local`        | `Demo@12345` |
| Nhân sự               | `nhansu@demo.local`        | `Demo@12345` |
| Kế toán               | `ketoan@demo.local`        | `Demo@12345` |

Đăng nhập bằng các vai trò khác nhau để kiểm tra phân quyền (mỗi vai trò thấy menu và dữ liệu khác nhau, xem [Phân quyền](05-phan-quyen.md)).

**Dừng:** bấm `Ctrl+C` trong cửa sổ Ubuntu. Dữ liệu vẫn được giữ cho lần chạy sau.

## 8.5 Gợi ý kịch bản thử

1. `giamdoc@demo.local`: xem Dashboard, mở **Dự án** → một công trình → tab Tiến độ, Công việc, Hồ sơ.
2. `kysuxd@demo.local`: tạo một đề xuất ở **Phê duyệt**, đính kèm tệp; xem đề xuất đang chờ ai duyệt.
3. Đăng nhập tài khoản của người duyệt đó, duyệt đề xuất; kiểm tra thông báo (chuông góc phải).
4. `giamdoc@demo.local`: xem **Nhật ký hoạt động** để thấy lịch sử thao tác.
5. Thử trên điện thoại cùng mạng Wi-Fi: xem mục 8.6.

## 8.6 Câu hỏi thường gặp

| Hiện tượng                                                   | Cách xử lý                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wsl --install` báo lỗi ảo hóa (Virtualization / 0x80370102) | Bật **Virtualization** (Intel VT-x / AMD-V) trong BIOS, rồi chạy lại lệnh.                                                                                                                                                                                                        |
| `Permission denied` khi chạy `./scripts/...`                 | `chmod +x scripts/construction/*.sh` rồi chạy lại.                                                                                                                                                                                                                                |
| Báo "ký tự xuống dòng kiểu Windows (CRLF)"                   | Repo bị clone bằng Git trên Windows. Xóa thư mục đó, clone lại **trong Ubuntu** theo 8.2.                                                                                                                                                                                         |
| Báo code nằm trên ổ Windows (`/mnt/c/...`), chạy chậm        | Clone vào `~/QuanLyDuAn` trong Ubuntu theo 8.2.                                                                                                                                                                                                                                   |
| Trình duyệt báo không kết nối được `localhost:3010`          | Cửa sổ Ubuntu chạy `wsl.sh start` phải đang mở. Thử `http://127.0.0.1:3010/erp/`.                                                                                                                                                                                                 |
| Báo cổng 3010 hoặc 8000 đang bị dùng                         | Có một lần chạy cũ chưa tắt: đóng cửa sổ Ubuntu cũ, hoặc chạy `wsl --shutdown` trong PowerShell rồi mở lại Ubuntu.                                                                                                                                                                |
| Đăng nhập báo "Origin không được phép"                       | Mở bằng `localhost:3010`, không mở bằng địa chỉ IP.                                                                                                                                                                                                                               |
| Muốn xóa dữ liệu thử, làm lại từ đầu                         | `sudo -u postgres psql -c "DROP DATABASE plane;"` rồi chạy lại `./scripts/construction/wsl.sh install`.                                                                                                                                                                           |
| Cập nhật bản mới nhất                                        | `cd ~/QuanLyDuAn && git pull && ./scripts/construction/wsl.sh install`                                                                                                                                                                                                            |
| Cho điện thoại / máy khác trong mạng LAN truy cập            | Windows 11: thêm `networkingMode=mirrored` vào mục `[wsl2]` của file `%UserProfile%\.wslconfig`, chạy `wsl --shutdown`, mở lại; truy cập `http://<IP-máy-Windows>:3010/erp/` và thêm origin đó vào `CORS_ALLOWED_ORIGINS`, `WEB_URL`, `APP_BASE_URL` trong `apps/api/.env.local`. |

Chạy kiểm thử tự động (lint, kiểu dữ liệu, kiểm thử backend và giao diện): `./scripts/construction/dev.sh check`.
