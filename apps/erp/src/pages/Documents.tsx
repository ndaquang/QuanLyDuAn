import { useSearchParams } from "react-router";

import { DocumentList } from "@/components/DocumentList";
import { PageHeader } from "@/components/ui";

export function DocumentsPage() {
  const [params] = useSearchParams();
  return (
    <div>
      <PageHeader
        title="Hồ sơ & tài liệu"
        subtitle="Hồ sơ kỹ thuật, nghiệm thu, pháp lý, hợp đồng, hồ sơ dự thầu - có quy trình duyệt và khóa sau khi duyệt"
      />
      <DocumentList openId={params.get("id")} />
    </div>
  );
}
