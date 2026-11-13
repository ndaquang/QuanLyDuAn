# 6. Hướng dẫn sử dụng

Truy cập: `https://<tên-miền-công-ty>/erp/` trên máy tính, tablet hoặc điện thoại. Trên điện thoại, bấm nút ☰ để mở menu.

## 6.1 Lần đầu (quản trị viên)

1. Quản trị viên chạy `construction_setup` (xem [07-trien-khai.md](07-trien-khai.md)) hoặc đăng nhập ERP bằng tài khoản quản trị công ty và bấm **Khởi tạo hệ thống**. Hệ thống tạo 9 vai trò, 7 phòng ban, 7 luồng phê duyệt mẫu.
2. **Nhân sự → Phòng ban**: sửa phòng ban, chọn **Trưởng phòng** (người duyệt bước "Trưởng bộ phận").
3. **Nhân sự → Thêm nhân sự**: nhập hồ sơ; Giám đốc chọn **Vai trò hệ thống**. Mở hồ sơ → **Tạo tài khoản** (email + mật khẩu ban đầu), gửi riêng cho nhân sự.
4. **Cài đặt & phân quyền**: rà soát ma trận quyền và hạn mức phê duyệt (mặc định Giám đốc duyệt từ 50 triệu).
5. Nhân sự tự đổi mật khẩu: menu tài khoản (góc phải) → **Đổi mật khẩu / hồ sơ cá nhân**.

## 6.2 Màn hình chung

- **Thanh tìm kiếm** phía trên: gõ ≥ 2 ký tự để tìm dự án, công việc, nhân sự, hồ sơ, gói thầu.
- **Chuông thông báo**: công việc mới, sắp đến hạn, quá hạn, yêu cầu phê duyệt, đề xuất mua hàng, hồ sơ cần nghiệm thu, kết quả duyệt, dự án chậm tiến độ. Bấm để mở đúng chỗ.
- **Bảng dữ liệu**: ô tìm kiếm, bộ lọc, phân trang, **Xuất Excel** (xuất đúng theo bộ lọc đang chọn).
- Mọi thao tác **xóa** đều hỏi xác nhận.

## 6.3 Dashboard (Tổng quan)

Chọn khoảng thời gian, dự án, phòng ban. Thẻ số liệu bấm được để mở danh sách tương ứng. Biểu đồ so sánh **% kế hoạch** (tím) với **% thực tế** (xanh) của từng công trình; rê chuột để xem số liệu. Danh sách việc quá hạn, sắp đến hạn 7 ngày, gói thầu sắp hết hạn nộp.

## 6.4 Dự án

- **Thêm dự án**: mã, tên, chủ đầu tư, địa điểm, loại, ngày bắt đầu / kết thúc dự kiến, người phụ trách, phòng ban, giá trị hợp đồng, **thành viên** (chỉ thành viên mới thấy dữ liệu dự án).
- Hồ sơ dự án có 6 tab: **Tổng quan** (thông tin, % tiến độ, mốc quan trọng) · **Tiến độ** · **Công việc** · **Nhân sự** (thêm / gỡ) · **Hồ sơ kỹ thuật** · **Báo cáo / Nhật ký**.
- **Xóa** dự án = lưu trữ; dữ liệu không mất.

## 6.5 Tiến độ thi công

1. **Thêm hạng mục** (VD: HM01 Phần móng).
2. Bấm **+** ở cuối dòng hạng mục để thêm **công việc**, + ở công việc để thêm **công tác chi tiết**. Nhập người phụ trách, ngày bắt đầu/kết thúc, trọng số, ưu tiên.
3. Người phụ trách mở dòng của mình để cập nhật **% hoàn thành**, trạng thái, ghi chú, **ảnh hiện trường**. % cấp cha tự tính.
4. Tab **Liên kết** trong một công việc: chọn việc phải xong trước.
5. Chuyển **Bảng & Gantt** / **Lịch** để xem theo tháng. Lọc "Chỉ việc quá hạn" / "Việc tôi phụ trách". Vạch đỏ trên Gantt là hôm nay.

## 6.6 Công việc (giao việc)

- **Giao việc**: tiêu đề, mô tả, dự án, người thực hiện (thành viên dự án), ngày bắt đầu, hạn, ưu tiên.
- Tab **Việc của tôi / Tôi đã giao / Tất cả**, lọc trạng thái, ưu tiên, chỉ quá hạn.
- Mở công việc: đổi trạng thái, bình luận, đính kèm tệp / chụp ảnh. **Mở trong Plane** để dùng bảng Kanban, lịch nâng cao.

## 6.7 Nhật ký công trường

Dự án → **Báo cáo / Nhật ký** → **Lập nhật ký**: ngày, thời tiết, nhân lực, thiết bị, công việc trong ngày, vướng mắc, an toàn - môi trường, kế hoạch ngày tiếp. Lưu → **Chụp ảnh** / **Tải tệp lên** → **Gửi duyệt**. Trưởng phòng dự án **Duyệt** hoặc **Trả lại** (ghi lý do). Nhật ký đã duyệt bị khóa.

## 6.8 Phê duyệt

- **Tạo yêu cầu**: chọn loại. _Mua vật tư_: thêm từng dòng (vật tư, ĐVT, số lượng, đơn giá) - tổng tiền tự tính. _Nghỉ phép_: chọn ngày. Các loại khác: nhập số tiền. **Lưu nháp** hoặc **Gửi duyệt**. Đính kèm báo giá / chứng từ khi còn ở nháp.
- Tab **Chờ tôi duyệt**: mở yêu cầu → **Phê duyệt** (bước kế toán phải ghi ý kiến ngân sách) hoặc **Từ chối** (ghi lý do). Khung "Quy trình duyệt" cho thấy ai đang phải duyệt và toàn bộ lịch sử.
- Người đề nghị có thể sửa và gửi lại yêu cầu bị từ chối, hoặc **Hủy yêu cầu**.

## 6.9 Đấu thầu, hồ sơ, vật tư

**Đấu thầu** (menu _Đấu thầu_, 3 tab: _Gói thầu_, _Công việc đấu thầu_, _Lịch_):

1. **Thêm gói thầu**: mã, tên, bên mời thầu, hình thức, người phụ trách, các mốc (phát hành HSMT, khảo sát hiện trường, hỏi đáp, **hạn nộp**, mở thầu). Gói mới ở trạng thái _Đánh giá sơ bộ_.
2. Người có quyền Duyệt (mặc định Giám đốc) bấm **Tham dự** hoặc **Không tham dự** (ghi lý do) → gói chuyển sang _Đang lập HSDT_.
3. Tab **Công việc** của gói thầu: **Tạo danh sách việc mẫu** (các đầu việc chuẩn của một HSDT, giao sẵn cho người phụ trách, hạn tính lùi từ hạn nộp) rồi mở từng việc để **đổi người thực hiện**, hạn, mức ưu tiên; hoặc **Giao việc** mới. Người thực hiện nhận thông báo.
4. Người được giao vào _Đấu thầu → Công việc đấu thầu → Việc của tôi_, mở việc, cập nhật **trạng thái**, **bình luận**, **đính kèm tệp**. Có tab _Tôi đã giao_, _Tất cả_, lọc gói thầu / trạng thái / chỉ quá hạn.
5. Tab **Hỏi đáp**: ghi câu hỏi làm rõ và văn bản của bên mời thầu. Tab **Hồ sơ nộp thầu**: chọn hồ sơ năng lực dùng cho gói và tải tài liệu nộp thầu.
6. Khi mọi việc xong: **Đã nộp HSDT** (còn việc chưa xong thì bị chặn; người có quyền Duyệt mới được nộp bất chấp). Sau đó **Chuyển chấm thầu**, rồi **Trúng thầu** hoặc **Không trúng** (chọn lý do). Gói trúng thầu có nút **Tạo dự án từ gói thầu**.
7. Tab **Lịch**: các mốc và hạn việc theo ngày, lọc "việc của tôi".

**Thư viện hồ sơ năng lực** (menu _Hồ sơ năng lực_): giấy phép, chứng chỉ, báo cáo tài chính, hợp đồng tương tự, nhân sự chủ chốt, thiết bị, ISO. Nhập ngày hết hạn để được nhắc trước 30 ngày; đính kèm bản scan.

**Hồ sơ tài liệu**: mọi hồ sơ kỹ thuật, nghiệm thu, QA/QC, HSE, hợp đồng, pháp lý; có phiên bản, gửi duyệt / nghiệm thu, khóa sau duyệt.

**Vật tư & NCC**: danh mục vật tư (đơn vị, quy cách, nhà cung cấp) và nhà cung cấp (MST không trùng).

## 6.10 Nhân sự

Danh sách lọc theo phòng ban, vai trò, trạng thái; hồ sơ nhân sự có ảnh (**Chụp ảnh** bằng camera điện thoại hoặc **Chọn ảnh**), dự án đang tham gia, tạo tài khoản, đặt lại mật khẩu. Nhân sự nghỉ việc: đổi trạng thái "Đã nghỉ việc" thay vì xóa (họ sẽ mất quyền truy cập ngay).

## 6.11 Báo cáo

Ba báo cáo: **Tổng hợp dự án**, **Tiến độ thi công**, **Hiệu quả nhân sự** (việc được giao, đã xong, đúng hạn, đang quá hạn, giờ công, số nhật ký). Lọc theo dự án, phòng ban, thời gian → **Xuất Excel** hoặc **In / Lưu PDF** (trong hộp thoại in chọn "Lưu dưới dạng PDF").

## 6.12 Nhật ký hoạt động

Ai làm gì, lúc nào, từ IP nào; bấm một dòng để xem giá trị cũ → mới của từng trường. Không ai sửa / xóa được nhật ký này.
