import { useEffect } from "react";
import { useSearchParams } from "react-router";

import { ScheduleBoard } from "@/components/ScheduleBoard";
import { ProjectSelect, useProjects } from "@/components/pickers";
import { Empty, PageHeader, Spinner } from "@/components/ui";

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const projects = useProjects();
  const projectId = params.get("project") ?? "";
  useEffect(() => {
    if (!projectId && projects.data?.results.length)
      setParams({ project: projects.data.results[0].id }, { replace: true });
  }, [projectId, projects.data, setParams]);

  return (
    <div>
      <PageHeader
        title="Tiến độ thi công"
        subtitle="Dự án → Hạng mục → Công việc → Công tác chi tiết · Gantt, lịch, cảnh báo quá hạn"
        actions={
          <ProjectSelect className="w-72" value={projectId} onChange={(e) => setParams({ project: e.target.value })} />
        }
      />
      {projects.loading && !projects.data ? (
        <Spinner />
      ) : projectId ? (
        <ScheduleBoard projectId={projectId} focusItem={params.get("item")} />
      ) : (
        <Empty>Chưa có dự án nào bạn được tham gia.</Empty>
      )}
    </div>
  );
}
