import { Building2 } from "lucide-react";

import { Button, useAction } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Shown when the user has no company yet, or the company is not configured for the ERP. */
export function SetupPage() {
  const { status, workspace, logout, refresh, ws } = useSession();
  const { run, busy } = useAction();
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="border-slate-200 shadow-sm w-full max-w-lg rounded-xl border bg-white p-6">
        <div className="mb-4 flex items-center gap-3">
          <Building2 className="text-navy-700 size-8" />
          <h1 className="text-lg text-navy-800 font-semibold">
            {status === "no-workspace" ? "Chưa thuộc công ty nào" : `Khởi tạo hệ thống cho ${workspace?.name}`}
          </h1>
        </div>
        {status === "no-workspace" ? (
          <p className="text-sm text-slate-600">
            Tài khoản của bạn chưa được thêm vào công ty. Vui lòng liên hệ quản trị viên hoặc bộ phận Nhân sự - Hành
            chính để được cấp quyền.
          </p>
        ) : workspace?.is_admin ? (
          <>
            <p className="text-sm text-slate-600 mb-4">
              Hệ thống sẽ tạo danh mục quyền, 9 vai trò mặc định (Giám đốc, Trưởng phòng dự án, Kỹ sư xây dựng, Kỹ sư
              MEP, QS, HSE, Thu mua, Nhân sự - Hành chính, Kế toán), các phòng ban và luồng phê duyệt mẫu. Bạn có thể
              chỉnh sửa tất cả sau đó. Không có dữ liệu giả nào được tạo.
            </p>
            <Button
              loading={busy}
              onClick={async () => {
                if (await run(() => api.post(ws("/setup/")), "Đã khởi tạo hệ thống")) await refresh();
              }}
            >
              Khởi tạo hệ thống
            </Button>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Công ty chưa được quản trị viên khởi tạo phân hệ quản lý xây dựng. Vui lòng liên hệ quản trị viên.
          </p>
        )}
        <div className="border-slate-100 mt-6 border-t pt-4 text-right">
          <Button variant="ghost" onClick={() => void logout()}>
            Đăng xuất
          </Button>
        </div>
      </div>
    </div>
  );
}
