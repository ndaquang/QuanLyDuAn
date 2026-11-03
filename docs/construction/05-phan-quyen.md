# 5. Phân quyền người dùng

## 5.1 Ba lớp kiểm tra (đều thực hiện ở máy chủ)

1. **Thành viên công ty** - tài khoản phải là thành viên đang hoạt động của workspace. Quản trị viên workspace (admin Plane) là _quản trị hệ thống_, có mọi quyền chức năng.
2. **Quyền theo vai trò** - mỗi nhân sự có một vai trò; vai trò có tập quyền `<phân hệ>.<thao tác>` với thao tác Xem / Thêm / Sửa / Xóa / Duyệt. Ma trận chỉnh trực tiếp ở _Cài đặt & phân quyền_, có hiệu lực ngay.
3. **Quyền theo dự án** - nhân sự chỉ thấy dữ liệu (tiến độ, công việc, nhật ký, hồ sơ, tệp, báo cáo) của dự án mình là thành viên. Vai trò có cờ "Xem được tất cả dự án" bỏ qua lớp này.

Ngoài ra có các quy tắc nghiệp vụ: không tự duyệt; người phụ trách / người thực hiện được cập nhật tiến độ, trạng thái việc của mình; người lập yêu cầu mới được sửa / hủy yêu cầu; quyền duyệt một bước phê duyệt do luồng quyết định (trưởng bộ phận, trưởng dự án, vai trò), không phải do ma trận.

## 5.2 Ma trận mặc định

X = Xem, T = Thêm, S = Sửa, Xóa, D = Duyệt.

| Phân hệ              | Giám đốc        | Trưởng phòng dự án | Kỹ sư xây dựng | Kỹ sư MEP | Nhân viên QS | Nhân viên HSE | Nhân viên thu mua, gọi thầu | Nhân sự - Hành chính | Kế toán |
| -------------------- | --------------- | ------------------ | -------------- | --------- | ------------ | ------------- | --------------------------- | -------------------- | ------- |
| Dashboard điều hành  | X               | X                  | X              | X         | X            | X             | X                           | X                    | X       |
| Dự án                | X, T, S, Xóa    | X, T, S, Xóa       | X              | X         | X            | X             | X                           | X                    | X       |
| Tiến độ thi công     | X, T, S, Xóa    | X, T, S, Xóa       | X, T, S        | X, T, S   | X            | X             | X                           | X                    | X       |
| Công việc            | X, T, S, Xóa    | X, T, S, Xóa       | X, T, S        | X, T, S   | X, T, S      | X, T, S       | X, T, S                     | X, T, S              | X       |
| Nhật ký công trường  | X, T, S, Xóa, D | X, T, S, Xóa, D    | X, T, S        | X, T, S   | X            | X, T, S       | —                           | —                    | —       |
| Nhân sự              | X, T, S, Xóa    | X                  | X              | X         | —            | X             | —                           | X, T, S, Xóa         | —       |
| Phòng ban            | X, T, S, Xóa    | X                  | —              | —         | —            | —             | —                           | X, T, S, Xóa         | —       |
| Hồ sơ kỹ thuật       | X, T, S, Xóa, D | X, T, S, Xóa, D    | X, T, S        | X, T, S   | X, T, S      | X, T, S       | X, T                        | X, T, S, Xóa, D      | X       |
| Đấu thầu             | X, T, S, Xóa    | X                  | —              | —         | X, T, S      | —             | X, T, S, Xóa                | X                    | X       |
| Vật tư               | X, T, S, Xóa    | X                  | X              | X         | X, T, S      | —             | X, T, S, Xóa                | —                    | X       |
| Nhà cung cấp         | X, T, S, Xóa    | X                  | —              | —         | X            | —             | X, T, S, Xóa                | —                    | X       |
| Yêu cầu phê duyệt    | X, T            | X, T               | X, T           | X, T      | X, T         | X, T          | X, T                        | X, T                 | X, T    |
| Cấu hình luồng duyệt | X, S            | —                  | —              | —         | —            | —             | —                           | —                    | —       |
| Báo cáo quản trị     | X               | X                  | X              | X         | X            | X             | X                           | X                    | X       |
| Nhật ký hoạt động    | X               | X                  | —              | —         | —            | —             | —                           | X                    | —       |
| Phân quyền           | X, S            | —                  | —              | —         | —            | —             | —                           | —                    | —       |
| Tài khoản người dùng | T, S            | —                  | —              | —         | —            | —             | —                           | T, S                 | —       |

Xem tất cả dự án: Giám đốc, Trưởng phòng dự án, Nhân sự - Hành chính, Kế toán

Ghi chú:

- "Yêu cầu phê duyệt - Xem" chỉ hiển thị yêu cầu của chính mình, yêu cầu mình đã/đang duyệt; Giám đốc (có "Cấu hình luồng duyệt - Xem") thấy toàn bộ.
- Nhân sự - Hành chính quản lý hồ sơ nhân sự và tạo tài khoản, nhưng **gán vai trò** cần quyền "Phân quyền - Sửa" (mặc định chỉ Giám đốc) - tách bạch việc cấp quyền.
- Báo cáo hiệu quả nhân sự cần thêm quyền "Nhân sự - Xem".

## 5.3 Khóa dữ liệu

| Dữ liệu             | Khóa khi                   | Hậu quả                               |
| ------------------- | -------------------------- | ------------------------------------- |
| Nhật ký công trường | Gửi duyệt, Đã duyệt        | Không sửa / xóa / đổi ảnh (409)       |
| Hồ sơ tài liệu      | Gửi duyệt, Đã duyệt        | Muốn thay đổi: tạo phiên bản mới      |
| Yêu cầu phê duyệt   | Đang chờ, Đã duyệt, Đã hủy | Chỉ sửa được khi Nháp hoặc Bị từ chối |
| Nhật ký hoạt động   | Luôn luôn                  | Không có API sửa / xóa                |
| Dự án               | Xóa = lưu trữ              | Dữ liệu con vẫn còn để tra cứu        |

## 5.4 Kiểm thử phân quyền tự động

`apps/api/plane/tests/contract/construction/test_access_control.py` kiểm tra: người ngoài công ty (404), thành viên chưa có vai trò (403), kỹ sư không tạo được dự án, dữ liệu dự án bị ẩn với người không tham gia (kể cả tiến độ, công việc, tệp), đổi ma trận quyền có hiệu lực ngay, nhật ký hoạt động không xóa được, không tham chiếu được dữ liệu công ty khác.
