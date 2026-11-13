/** Vietnamese labels and badge colours for every enum the API exposes. */

export type Tone = "gray" | "blue" | "green" | "amber" | "red" | "navy" | "sky" | "violet";

export interface Option {
  value: string;
  label: string;
  tone?: Tone;
}

function opts(list: [string, string, Tone?][]): Option[] {
  return list.map(([value, label, tone]) => ({ value, label, tone }));
}

export const PROJECT_STATUS = opts([
  ["in_progress", "Đang triển khai", "blue"],
  ["paused", "Tạm dừng", "gray"],
  ["delayed", "Chậm tiến độ", "red"],
  ["awaiting_acceptance", "Chờ nghiệm thu", "amber"],
  ["completed", "Hoàn thành", "green"],
]);

export const PROJECT_TYPE = opts([
  ["civil", "Dân dụng"],
  ["industrial", "Công nghiệp / Nhà xưởng"],
  ["infrastructure", "Hạ tầng kỹ thuật"],
  ["transport", "Giao thông"],
  ["mep", "Cơ điện (MEP)"],
  ["interior", "Nội thất / Hoàn thiện"],
  ["other", "Khác"],
]);

export const SCHEDULE_LEVEL = opts([
  ["category", "Hạng mục", "navy"],
  ["task", "Công việc", "sky"],
  ["activity", "Công tác chi tiết", "gray"],
]);

export const PRIORITY = opts([
  ["urgent", "Khẩn cấp", "red"],
  ["high", "Cao", "amber"],
  ["medium", "Trung bình", "blue"],
  ["low", "Thấp", "gray"],
  ["none", "Không", "gray"],
]);

export const SCHEDULE_STATUS = opts([
  ["not_started", "Chưa bắt đầu", "gray"],
  ["in_progress", "Đang thực hiện", "blue"],
  ["paused", "Tạm dừng", "amber"],
  ["completed", "Hoàn thành", "green"],
]);

export const TASK_STATUS = opts([
  ["todo", "Chưa làm", "gray"],
  ["in_progress", "Đang làm", "blue"],
  ["done", "Hoàn thành", "green"],
  ["cancelled", "Đã hủy", "red"],
]);

export const REVIEW_STATUS = opts([
  ["draft", "Nháp", "gray"],
  ["submitted", "Chờ duyệt", "amber"],
  ["approved", "Đã duyệt", "green"],
  ["rejected", "Bị trả lại", "red"],
]);

export const WEATHER = opts([
  ["sunny", "Nắng"],
  ["cloudy", "Nhiều mây"],
  ["rain", "Mưa"],
  ["storm", "Mưa bão"],
]);

export const DOCUMENT_CATEGORY = opts([
  ["drawing", "Bản vẽ"],
  ["method_statement", "Biện pháp thi công"],
  ["acceptance", "Hồ sơ nghiệm thu"],
  ["quality", "QA/QC"],
  ["hse", "An toàn - Môi trường"],
  ["contract", "Hợp đồng"],
  ["bid", "Hồ sơ dự thầu"],
  ["legal", "Pháp lý dự án"],
  ["other", "Khác"],
]);

export const TENDER_STATUS = opts([
  ["screening", "Đánh giá sơ bộ", "violet"],
  ["preparing", "Đang lập HSDT", "blue"],
  ["submitted", "Đã nộp thầu", "amber"],
  ["evaluating", "Đang chấm thầu", "amber"],
  ["won", "Trúng thầu", "green"],
  ["lost", "Không trúng thầu", "red"],
  ["declined", "Không tham dự", "gray"],
  ["cancelled", "Bên mời thầu hủy", "gray"],
]);

export const TENDER_OPEN_STATUSES = ["screening", "preparing", "submitted", "evaluating"];

export const TENDER_DECISION = opts([
  ["pending", "Chưa quyết định", "gray"],
  ["go", "Tham dự", "green"],
  ["no_go", "Không tham dự", "red"],
]);

export const SELECTION_METHOD = opts([
  ["open", "Đấu thầu rộng rãi"],
  ["limited", "Đấu thầu hạn chế"],
  ["direct", "Chỉ định thầu"],
  ["competitive", "Chào hàng cạnh tranh"],
  ["private_rfq", "Mời báo giá (dự án tư nhân)"],
  ["other", "Khác"],
]);

export const PACKAGE_TYPE = opts([
  ["construction", "Thi công xây lắp"],
  ["mep", "Cơ điện (MEP)"],
  ["epc", "EPC / Tổng thầu"],
  ["design_build", "Thiết kế - Thi công"],
  ["supply_install", "Cung cấp & lắp đặt"],
  ["interior", "Hoàn thiện / Nội thất"],
  ["other", "Khác"],
]);

export const SUBMISSION_METHOD = opts([
  ["online", "Qua mạng (e-GP)"],
  ["direct", "Nộp trực tiếp"],
  ["email", "Email / bản mềm"],
]);

export const LOST_REASON = opts([
  ["technical", "Không đạt kỹ thuật"],
  ["capability", "Không đạt năng lực / kinh nghiệm"],
  ["administrative", "Không hợp lệ hành chính"],
  ["other", "Khác"],
]);

export const TENDER_ITEM_CATEGORY = opts([
  ["legal", "Pháp lý / năng lực"],
  ["technical", "Kỹ thuật"],
  ["financial", "Khối lượng / BOQ"],
  ["other", "Khác"],
]);

export const TENDER_ITEM_STATUS = opts([
  ["todo", "Chưa làm", "gray"],
  ["in_progress", "Đang làm", "blue"],
  ["done", "Hoàn thành", "green"],
]);

export const CAPABILITY_CATEGORY = opts([
  ["legal", "Pháp lý doanh nghiệp"],
  ["certificate", "Chứng chỉ năng lực hoạt động xây dựng"],
  ["financial", "Báo cáo tài chính / thuế"],
  ["similar_contract", "Hợp đồng tương tự"],
  ["personnel", "Nhân sự chủ chốt"],
  ["equipment", "Máy móc thiết bị"],
  ["quality", "ISO / Chất lượng - HSE"],
  ["other", "Khác"],
]);

export const EMPLOYEE_STATUS = opts([
  ["active", "Đang làm việc", "green"],
  ["on_leave", "Nghỉ dài hạn", "amber"],
  ["resigned", "Đã nghỉ việc", "gray"],
]);

export const SUPPLIER_STATUS = opts([
  ["active", "Đang giao dịch", "green"],
  ["inactive", "Ngừng giao dịch", "gray"],
]);

export const REQUEST_TYPE = opts([
  ["purchase", "Mua vật tư"],
  ["payment", "Thanh toán"],
  ["advance", "Tạm ứng"],
  ["variation", "Chi phí phát sinh"],
  ["budget_adjustment", "Điều chỉnh ngân sách"],
  ["contract", "Hợp đồng"],
  ["leave", "Nghỉ phép"],
]);

export const REQUEST_STATUS = opts([
  ["draft", "Nháp", "gray"],
  ["pending", "Đang chờ duyệt", "amber"],
  ["approved", "Đã phê duyệt", "green"],
  ["rejected", "Từ chối", "red"],
  ["cancelled", "Đã hủy", "gray"],
]);

export const APPROVER_KIND = opts([
  ["department_head", "Trưởng bộ phận của người đề nghị"],
  ["project_manager", "Trưởng dự án"],
  ["role", "Theo vai trò"],
]);

export const AUDIT_ACTION: Record<string, string> = {
  create: "Tạo mới",
  update: "Cập nhật",
  delete: "Xóa",
  login: "Đăng nhập",
  setup: "Khởi tạo hệ thống",
  submit: "Gửi duyệt",
  submitted: "Gửi duyệt",
  approve: "Phê duyệt",
  approved: "Phê duyệt",
  reject: "Từ chối",
  rejected: "Trả lại",
  cancel: "Hủy",
  upload: "Tải tệp",
  upload_photo: "Tải ảnh",
  create_account: "Tạo tài khoản",
  reset_password: "Đặt lại mật khẩu",
  update_permissions: "Đổi phân quyền",
  add_members: "Thêm thành viên",
  remove_member: "Gỡ thành viên",
};

export const ENTITY_LABEL: Record<string, string> = {
  cx_project_profiles: "Dự án",
  cx_schedule_items: "Tiến độ",
  cx_task_dependencies: "Liên kết tiến độ",
  cx_project_milestones: "Mốc dự án",
  cx_daily_reports: "Nhật ký công trường",
  cx_work_logs: "Giờ công",
  cx_employees: "Nhân sự",
  cx_departments: "Phòng ban",
  cx_roles: "Vai trò",
  cx_documents: "Hồ sơ",
  cx_tenders: "Gói thầu",
  cx_tender_items: "Hồ sơ gói thầu",
  cx_suppliers: "Nhà cung cấp",
  cx_materials: "Vật tư",
  cx_attachments: "Tệp đính kèm",
  cx_approval_requests: "Yêu cầu phê duyệt",
  cx_approval_workflows: "Luồng duyệt",
  issues: "Công việc",
  users: "Tài khoản",
  workspaces: "Công ty",
};

export const MODULE_LABEL: Record<string, string> = {
  dashboard: "Dashboard điều hành",
  project: "Dự án",
  schedule: "Tiến độ thi công",
  task: "Công việc",
  daily_report: "Nhật ký công trường",
  employee: "Nhân sự",
  department: "Phòng ban",
  document: "Hồ sơ kỹ thuật",
  tender: "Đấu thầu",
  material: "Vật tư",
  supplier: "Nhà cung cấp",
  approval: "Yêu cầu phê duyệt",
  approval_config: "Cấu hình luồng duyệt",
  report: "Báo cáo quản trị",
  audit: "Nhật ký hoạt động",
  role: "Phân quyền",
  account: "Tài khoản người dùng",
};

export const ACTION_LABEL: Record<string, string> = {
  view: "Xem",
  create: "Thêm",
  update: "Sửa",
  delete: "Xóa",
  approve: "Duyệt",
};

export function labelOf(list: Option[], value?: string | null) {
  return list.find((o) => o.value === value)?.label ?? value ?? "—";
}

export function toneOf(list: Option[], value?: string | null): Tone {
  return list.find((o) => o.value === value)?.tone ?? "gray";
}
