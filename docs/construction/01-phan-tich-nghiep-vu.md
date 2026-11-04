# 1. Phân tích nghiệp vụ & phạm vi

## 1.1 Bối cảnh

Công ty xây dựng ~20 nhân sự, 10-15 tài khoản sử dụng, nhiều công trình chạy song song. Vấn đề cần giải quyết:

- Dữ liệu dự án, tiến độ, nhật ký, hồ sơ nằm rải rác ở Excel / Zalo / email → không có số liệu tổng hợp tin cậy cho giám đốc.
- Giao việc và nhắc hạn bằng miệng → việc quá hạn không ai biết.
- Đề xuất mua hàng, thanh toán, tạm ứng duyệt bằng giấy → không truy vết được ai duyệt, duyệt khi nào, theo hạn mức nào.
- Hồ sơ dự thầu chuẩn bị bởi nhiều bộ phận, dễ trễ hạn nộp.

## 1.2 Nguyên tắc thiết kế

| Nguyên tắc                              | Cách đáp ứng                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Sản phẩm vận hành thật, không phải demo | Mọi nút gọi API thật; dữ liệu lưu PostgreSQL; báo cáo tính từ dữ liệu thực                                                 |
| Tận dụng nguồn mở, chạy bản riêng       | Dùng lại Plane (đăng nhập, công ty, dự án, giao việc, lưu tệp); phần xây dựng là phân hệ riêng `cx_*`, không sửa lõi Plane |
| Dữ liệu tập trung, liên kết             | Mọi bảng gắn `workspace` (công ty) và phần lớn gắn `project` (dự án Plane)                                                 |
| Không trùng lặp dữ liệu                 | Ràng buộc duy nhất ở CSDL (mã dự án, mã NV, mã NCC, MST, 1 nhật ký/ngày/dự án...) + kiểm tra ở API                         |
| Phân quyền kiểm tra ở backend           | `ConstructionPermission` + kiểm tra dự án cho từng truy vấn; UI chỉ ẩn nút                                                 |
| Không mất dữ liệu                       | Xóa mềm (`deleted_at`), dự án bị xóa chỉ được lưu trữ; nhật ký hoạt động không thể sửa/xóa                                 |
| Khóa dữ liệu sau phê duyệt              | Nhật ký công trường, hồ sơ, yêu cầu phê duyệt đã duyệt → API trả lỗi 409 khi sửa/xóa                                       |
| Tách dữ liệu mẫu                        | Dữ liệu mẫu chỉ được tạo trong công ty có mã `demo-*`, cần cờ `CONSTRUCTION_ALLOW_DEMO=1`                                  |

## 1.3 Đối tượng sử dụng

Giám đốc, Trưởng phòng dự án, Kỹ sư xây dựng, Kỹ sư MEP, Nhân viên QS, Nhân viên HSE, Nhân viên thu mua - gọi thầu, Nhân sự - Hành chính, Kế toán. Chi tiết quyền: [05-phan-quyen.md](05-phan-quyen.md).

## 1.4 Phạm vi theo giai đoạn

Trạng thái: ✅ đã làm trong bản này · 🟡 làm một phần · ⏳ giai đoạn sau.

### Giai đoạn 1 - Nền tảng

| Hạng mục                                     | Trạng thái | Ghi chú                                                                          |
| -------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| Kiến trúc, CSDL                              | ✅         | Tài liệu 02, 03                                                                  |
| Đăng nhập                                    | ✅         | Dùng cơ chế phiên của Plane; API đăng nhập JSON cho ERP; quên mật khẩu qua Plane |
| Phân quyền (vai trò, dự án, X/T/S/Xóa/Duyệt) | ✅         | Ma trận quyền chỉnh được trên giao diện                                          |
| Nhật ký hoạt động                            | ✅         | Ghi mọi thao tác tạo/sửa/xóa/duyệt/đăng nhập kèm giá trị cũ - mới, IP            |
| Dashboard điều hành                          | ✅         | KPI, biểu đồ tiến độ, việc quá hạn, sắp đến hạn, lọc thời gian/dự án/phòng ban   |
| Quản lý dự án (hồ sơ + 6 tab)                | ✅         | Tổng quan, Tiến độ, Công việc, Nhân sự, Hồ sơ kỹ thuật, Báo cáo                  |

### Giai đoạn 2 - Điều hành

| Hạng mục                                                    | Trạng thái | Ghi chú                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tiến độ thi công (Hạng mục → Công việc → Công tác chi tiết) | ✅         | Gantt, lịch tháng, liên kết phụ thuộc, % cộng dồn theo trọng số, mốc                                                                                                                                                                   |
| Cảnh báo quá hạn / chậm tiến độ, thông báo người phụ trách  | ✅         | Tác vụ Celery hằng ngày 07:15 (giờ VN) + thông báo tức thời khi giao việc                                                                                                                                                              |
| Công việc & giao việc                                       | ✅         | Dựa trên work item của Plane: người giao, người thực hiện, hạn, ưu tiên, bình luận, tệp                                                                                                                                                |
| Nhật ký công trường                                         | ✅         | Ảnh hiện trường chụp từ điện thoại, gửi duyệt, khóa sau duyệt                                                                                                                                                                          |
| Nhân sự, phòng ban, ảnh nhân sự                             | ✅         | Tạo tài khoản đăng nhập không cần máy chủ email                                                                                                                                                                                        |
| Quản lý đấu thầu: giao việc chuẩn bị HSDT                   | ✅         | Quyết định tham dự, công việc giao cho từng người (hạn, ưu tiên, bình luận, tệp), hỏi đáp HSMT, thư viện hồ sơ năng lực, lịch, nhắc hạn, kết quả, tạo dự án khi trúng. **Không lưu giá** (giá dự thầu, báo giá, bảo lãnh) theo yêu cầu |
| Phê duyệt cấu hình được (7 loại yêu cầu)                    | ✅         | Hạn mức, kiểm tra ngân sách, không tự duyệt                                                                                                                                                                                            |

### Giai đoạn 3 - Vật tư, kho, mua hàng

| Hạng mục                                                                                                 | Trạng thái |
| -------------------------------------------------------------------------------------------------------- | ---------- |
| Danh mục vật tư, nhà cung cấp                                                                            | ✅         |
| Đề xuất mua hàng (qua luồng phê duyệt, có dòng vật tư)                                                   | ✅         |
| Kho (`warehouses`), xuất nhập tồn (`inventory_transactions`), đơn mua hàng (`purchase_orders`), thiết bị | ⏳         |

### Giai đoạn 4 - Tài chính

`budgets`, `project_costs`, `revenues`, `contracts`, `contract_payments`, `invoices`, `receivables`, `payables`, cảnh báo "chi phí vượt ngân sách" (loại thông báo đã có sẵn) - ⏳. Hiện tại Dashboard dùng **giá trị hợp đồng** của dự án làm doanh thu dự kiến, có ghi rõ trên giao diện.

### Giai đoạn 5 - Chất lượng & hồ sơ

Hồ sơ kỹ thuật / nghiệm thu với quy trình duyệt ✅; biên bản kiểm tra chất lượng (`quality_inspections`), biên bản nghiệm thu có cấu trúc (`acceptance_records`) ⏳; 3 báo cáo quản trị ✅ (Excel + In/Lưu PDF).

### Giai đoạn 6 - Hoàn thiện

Kiểm thử nghiệp vụ tự động ✅ (backend 40+ ca, frontend), giao diện điện thoại ✅, triển khai Docker ✅, kiểm thử tải 20 người dùng đồng thời và đánh giá bảo mật độc lập ⏳.

## 1.5 Quy tắc nghiệp vụ quan trọng (đã cài đặt)

1. Một dự án chỉ có **một** nhật ký công trường cho mỗi ngày; không lập nhật ký cho ngày tương lai.
2. Người lập nhật ký / hồ sơ / yêu cầu **không được tự duyệt**.
3. Yêu cầu tài chính (mua vật tư, thanh toán, tạm ứng, phát sinh, điều chỉnh ngân sách, hợp đồng) **không bao giờ tự duyệt**: thiếu người duyệt ở một bước → không gửi được.
4. Bước "Kế toán kiểm tra ngân sách" bắt buộc ghi ý kiến.
5. Bước "Giám đốc" chỉ áp dụng khi số tiền ≥ hạn mức (mặc định 50 triệu; hợp đồng và điều chỉnh ngân sách luôn qua Giám đốc).
6. Người phụ trách một công việc tiến độ được cập nhật % / trạng thái / ghi chú của việc mình dù vai trò không có quyền sửa tiến độ.
7. Người thực hiện một công việc được đổi trạng thái việc của mình.
8. Đổi vai trò (phân quyền) của nhân sự cần quyền "Phân quyền", tách khỏi quyền quản lý hồ sơ nhân sự.
9. % hoàn thành của Hạng mục / Công việc cha tự tính từ con theo trọng số. Dự án "chậm tiến độ" khi % thực tế thấp hơn % kế hoạch quá 10 điểm, hoặc quá ngày kết thúc mà chưa xong.
