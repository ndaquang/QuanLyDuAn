# 4. Luồng nghiệp vụ

## 4.1 Phê duyệt (mua vật tư, thanh toán, tạm ứng, phát sinh, điều chỉnh ngân sách, hợp đồng, nghỉ phép)

```mermaid
flowchart TD
  A[Nhân viên tạo yêu cầu<br/>nháp] -->|Gửi duyệt| B{Xác định các bước áp dụng}
  B --> B1[Bước 'Trưởng dự án' chỉ áp dụng<br/>khi yêu cầu gắn dự án]
  B --> B2[Bước có hạn mức chỉ áp dụng<br/>khi số tiền ≥ hạn mức]
  B --> C{Mỗi bước có người duyệt<br/>khác người đề nghị?}
  C -->|Người đề nghị chính là cấp duyệt| S[Ghi 'Bỏ qua bước' vào lịch sử]
  C -->|Không có ai, yêu cầu tài chính| X[Từ chối gửi - không tự duyệt]
  C -->|Có| D[Chờ duyệt bước 1<br/>gửi thông báo người duyệt]
  D --> E{Người duyệt quyết định}
  E -->|Từ chối - bắt buộc ghi lý do| R[Bị từ chối → người đề nghị sửa và gửi lại]
  E -->|Phê duyệt| F{Còn bước tiếp?}
  F -->|Có| D2[Chuyển bước tiếp, thông báo] --> E
  F -->|Không| G[Đã phê duyệt → KHÓA<br/>thông báo người đề nghị]
```

Luồng mặc định cho yêu cầu tài chính (chỉnh được ở _Cài đặt → Luồng phê duyệt_):

1. Trưởng bộ phận của người đề nghị kiểm tra
2. Trưởng dự án xác nhận (nếu gắn dự án)
3. Kế toán kiểm tra ngân sách - **bắt buộc ghi ý kiến**
4. Giám đốc phê duyệt khi số tiền ≥ 50.000.000 đ (hợp đồng và điều chỉnh ngân sách: luôn qua Giám đốc)

Nghỉ phép: Trưởng bộ phận duyệt → Nhân sự ghi nhận.

Mọi hành động lưu vào `cx_approval_history` và nhật ký hoạt động.

## 4.2 Nhật ký công trường

```mermaid
stateDiagram-v2
  [*] --> Nháp: Kỹ sư / HSE lập (1 nhật ký / dự án / ngày)
  Nháp --> Nháp: sửa, chụp ảnh hiện trường
  Nháp --> ChờDuyệt: Gửi duyệt (thông báo người có quyền duyệt)
  ChờDuyệt --> ĐãDuyệt: Duyệt (không phải người lập)
  ChờDuyệt --> BịTrảLại: Trả lại (bắt buộc lý do)
  BịTrảLại --> ChờDuyệt: sửa và gửi lại
  ĐãDuyệt --> [*]: KHÓA - không sửa/xóa
```

Hồ sơ kỹ thuật / nghiệm thu đi cùng quy trình (bắt buộc có tệp đính kèm trước khi gửi; người duyệt nhận thông báo "Hồ sơ cần nghiệm thu").

## 4.3 Lập và theo dõi tiến độ

```mermaid
flowchart LR
  P[Tạo dự án<br/>+ thành viên] --> H[Thêm Hạng mục]
  H --> C[Thêm Công việc<br/>người phụ trách, ngày, trọng số]
  C --> D[Công tác chi tiết]
  C --> L[Liên kết trước - sau<br/>chặn vòng lặp]
  D & C -->|người phụ trách cập nhật %| U[% cộng dồn lên cấp cha]
  U --> K[Dashboard: % kế hoạch vs thực tế]
  K -->|lệch > 10 điểm hoặc quá hạn| W[Cảnh báo chậm tiến độ]
  N[07:15 hằng ngày] --> R1[Nhắc việc sắp đến hạn 2 ngày]
  N --> R2[Báo việc quá hạn cho người phụ trách + trưởng dự án]
  N --> R3[Báo dự án chậm tiến độ - mỗi tuần 1 lần]
```

% kế hoạch tại ngày D của một công việc = số ngày đã trôi qua / tổng số ngày (giới hạn 0-100%); % dự án = trung bình có trọng số của các công việc lá.

## 4.4 Giao việc

```mermaid
sequenceDiagram
  participant TP as Trưởng phòng / người giao
  participant API
  participant NV as Người thực hiện
  TP->>API: Tạo công việc (dự án, người thực hiện là thành viên dự án, hạn, ưu tiên)
  API-->>NV: Thông báo "Công việc mới"
  NV->>API: Đổi trạng thái / bình luận / đính kèm ảnh
  API-->>TP: Thông báo bình luận mới
  Note over API: 07:15 hằng ngày: nhắc sắp đến hạn / quá hạn
```

## 4.5 Đấu thầu

Tạo gói thầu (hạn nộp, bên mời thầu, người phụ trách) → lập danh sách đầu mục hồ sơ (pháp lý, kỹ thuật, tài chính) giao cho từng người, có hạn → cập nhật trạng thái từng đầu mục → tải tệp hồ sơ → cập nhật kết quả (trúng / trượt) → khi trúng thầu: gắn với dự án mới tạo. Dashboard hiển thị các gói sắp đến hạn nộp trong 14 ngày.
