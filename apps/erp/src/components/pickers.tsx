import type { SelectHTMLAttributes } from "react";

import { useFetch } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Department, Page, Project, Role, WorkspaceUser } from "@/lib/types";

import { Select } from "./ui";

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & { placeholder?: string };

export function useUsers(projectId?: string | null) {
  const { ws } = useSession();
  return useFetch<WorkspaceUser[]>(ws("/users/"), projectId ? { project: projectId } : undefined);
}

export function UserSelect({
  projectId,
  placeholder = "— Chọn người —",
  ...rest
}: SelectProps & { projectId?: string | null }) {
  const { data } = useUsers(projectId);
  const options = (data ?? []).map((u) => ({
    value: u.id,
    label: `${u.full_name || u.display_name}${u.role ? ` · ${u.role}` : ""}`,
  }));
  return <Select {...rest} placeholder={placeholder} options={options} />;
}

export function useProjects() {
  const { ws, can } = useSession();
  return useFetch<Page<Project>>(can("project.view") ? ws("/projects/") : null, { page_size: 200 });
}

export function ProjectSelect({ placeholder = "— Chọn dự án —", ...rest }: SelectProps) {
  const { data } = useProjects();
  const options = (data?.results ?? []).map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }));
  return <Select {...rest} placeholder={placeholder} options={options} />;
}

export function useDepartments() {
  const { ws } = useSession();
  return useFetch<Page<Department>>(ws("/departments/"), { page_size: 200 });
}

export function DepartmentSelect({ placeholder = "— Phòng ban —", ...rest }: SelectProps) {
  const { data } = useDepartments();
  return (
    <Select
      {...rest}
      placeholder={placeholder}
      options={(data?.results ?? []).map((d) => ({ value: d.id, label: d.name }))}
    />
  );
}

export function useRoles() {
  const { ws } = useSession();
  return useFetch<Role[]>(ws("/roles/"));
}

export function RoleSelect({ placeholder = "— Vai trò —", ...rest }: SelectProps) {
  const { data } = useRoles();
  return (
    <Select {...rest} placeholder={placeholder} options={(data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
  );
}
