export type { Page } from "./api";

export interface UserBrief {
  id: string;
  display_name: string;
  email: string;
}

export interface WorkspaceInfo {
  id: string;
  slug: string;
  name: string;
  is_admin: boolean;
  is_configured: boolean;
}

export interface AccessContext {
  workspace: { id: string; slug: string; name: string };
  is_admin: boolean;
  sees_all_projects: boolean;
  employee_id: string | null;
  role: { id: string; code: string; name: string } | null;
  permissions: string[];
  user: UserBrief;
  is_configured: boolean;
  employee?: { id: string; full_name: string };
}

export interface ProjectProgress {
  actual: number;
  planned: number;
  items: number;
  overdue: number;
  is_behind: boolean;
}

export interface ProjectMemberInfo extends UserBrief {
  project_role: number;
  employee_id: string | null;
  position: string;
  business_role: string | null;
}

export interface Project {
  id: string;
  profile_id: string;
  identifier: string;
  code: string;
  name: string;
  investor: string;
  location: string;
  project_type: string;
  start_date: string;
  planned_end_date: string;
  actual_end_date: string | null;
  manager: string | null;
  manager_detail: UserBrief | null;
  department: string | null;
  department_name: string | null;
  status: string;
  contract_value: string;
  description: string;
  members: ProjectMemberInfo[] | null;
  progress: ProjectProgress | null;
  created_at: string;
}

export interface ScheduleItem {
  id: string;
  project: string;
  project_name: string;
  parent: string | null;
  level: "category" | "task" | "activity";
  code: string;
  name: string;
  assignee: string | null;
  assignee_detail: UserBrief | null;
  start_date: string;
  end_date: string;
  duration_days: number;
  progress: string;
  weight: string;
  priority: string;
  status: string;
  note: string;
  sort_order: number;
  is_overdue: boolean;
  has_children: boolean;
}

export interface Task {
  id: string;
  key: string;
  title: string;
  description: string;
  project: string;
  project_name: string;
  project_code: string;
  assigner: UserBrief | null;
  assignees: UserBrief[];
  start_date: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  is_overdue: boolean;
  comment_count: number | null;
  attachment_count: number;
  created_at: string;
  comments?: { id: string; author: UserBrief; text: string; created_at: string }[];
}

export interface WorkspaceUser extends UserBrief {
  employee_id: string | null;
  full_name: string | null;
  role: string | null;
  department: string | null;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  head: string | null;
  head_detail: UserBrief | null;
  description: string;
  employee_count: number;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  see_all_projects: boolean;
  permissions: string[];
  employee_count: number;
}

export interface Employee {
  id: string;
  user: string | null;
  user_detail: UserBrief | null;
  code: string;
  full_name: string;
  email: string;
  phone: string;
  position: string;
  department: string | null;
  department_name: string | null;
  role: string | null;
  role_name: string | null;
  status: string;
  date_of_birth: string | null;
  join_date: string | null;
  id_number: string;
  address: string;
  notes: string;
  photo_url: string | null;
  projects: { id: string; name: string; code: string }[];
}

export interface Attachment {
  id: string;
  file_name: string;
  content_type: string;
  size: number;
  uploaded_by: UserBrief | null;
  url: string;
  created_at: string;
}

export interface DailyReport {
  id: string;
  project: string;
  project_name: string;
  report_date: string;
  weather: string;
  manpower_count: number;
  equipment: string;
  work_performed: string;
  issues: string;
  hse_notes: string;
  next_plan: string;
  status: string;
  reviewed_by_detail: UserBrief | null;
  reviewed_at: string | null;
  review_comment: string;
  attachment_count: number;
  created_by_detail: UserBrief | null;
}

export interface DocumentItem {
  id: string;
  project: string | null;
  project_name: string | null;
  tender: string | null;
  tender_name: string | null;
  category: string;
  code: string;
  title: string;
  version: string;
  description: string;
  status: string;
  reviewed_by_detail: UserBrief | null;
  review_comment: string;
  attachment_count: number;
  created_by_detail: UserBrief | null;
  created_at: string;
}

export interface Tender {
  id: string;
  code: string;
  name: string;
  investor: string;
  location: string;
  source: string;
  selection_method: string;
  package_type: string;
  owner: string | null;
  owner_detail: UserBrief | null;
  project: string | null;
  project_name: string | null;
  release_date: string | null;
  site_visit_date: string | null;
  pre_bid_meeting_date: string | null;
  clarification_deadline: string | null;
  submission_deadline: string;
  opening_date: string | null;
  submission_method: string;
  bid_validity_days: number | null;
  submitted_at: string | null;
  decision: string;
  decision_by_detail: UserBrief | null;
  decision_at: string | null;
  decision_note: string;
  status: string;
  status_label: string;
  result_date: string | null;
  winner_name: string;
  lost_reason: string;
  result_note: string;
  capability_document_ids: string[];
  checklist: { total: number; done: number; percent: number; overdue: number };
  counts: { clarifications_open: number; documents: number } | null;
  is_locked: boolean;
  created_at: string;
}

export interface TenderItem {
  id: string;
  tender: string;
  tender_code: string;
  tender_name: string;
  name: string;
  description: string;
  category: string;
  priority: string;
  assignee: string | null;
  assignee_detail: UserBrief | null;
  created_by_detail: UserBrief | null;
  due_date: string | null;
  status: string;
  completed_at: string | null;
  note: string;
  is_overdue: boolean;
  comment_count: number;
  attachment_count: number;
  created_at: string;
}

export interface TenderComment {
  id: string;
  text: string;
  author: UserBrief | null;
  created_at: string;
}

export interface TenderClarification {
  id: string;
  tender: string;
  kind: string;
  reference: string;
  question: string;
  asked_date: string | null;
  answer: string;
  answered_date: string | null;
  is_answered: boolean;
  created_by_detail: UserBrief | null;
}

export interface CapabilityDoc {
  id: string;
  category: string;
  title: string;
  number: string;
  issuer: string;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string;
  is_active: boolean;
  is_expired: boolean;
  days_to_expiry: number | null;
  attachment_count: number;
  tender_count: number;
}

export interface TenderStats {
  total: number;
  by_status: { status: string; label: string; count: number }[];
  open: number;
  due_7_days: number;
  won: number;
  lost: number;
  win_rate: number | null;
  lost_reasons: { reason: string; label: string; count: number }[];
  tasks: { open: number; overdue: number; done: number; mine_open: number; mine_overdue: number };
}

export interface TenderEvent {
  tender_id: string;
  code: string;
  name: string;
  kind: string;
  label: string;
  date: string;
  at: string | null;
  owner: UserBrief | null;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  tax_code: string;
  category: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  status: string;
  notes: string;
  material_count: number;
}

export interface Material {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  specification: string;
  supplier: string | null;
  supplier_name: string | null;
  reference_price: string;
  is_active: boolean;
}

export interface ApprovalStep {
  id?: string;
  order: number;
  name: string;
  approver_kind: string;
  approver_role: string | null;
  approver_role_name?: string | null;
  min_amount: string | null;
  requires_budget_check: boolean;
}

export interface Workflow {
  id: string;
  request_type: string;
  name: string;
  is_financial: boolean;
  is_active: boolean;
  steps: ApprovalStep[];
}

export interface ApprovalRequest {
  id: string;
  code: string;
  request_type: string;
  request_type_label: string;
  project: string | null;
  project_name: string | null;
  title: string;
  description: string;
  amount: string;
  details: {
    lines?: { name: string; unit?: string; quantity: number; unit_price: number }[];
    from?: string;
    to?: string;
    [k: string]: unknown;
  };
  requester: string;
  requester_detail: UserBrief;
  status: string;
  status_label: string;
  current_step_name: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  history:
    | {
        id: string;
        step_name: string;
        actor_detail: UserBrief | null;
        action: string;
        action_label: string;
        comment: string;
        created_at: string;
      }[]
    | null;
  can_act: boolean;
  current_approvers: UserBrief[];
  created_at: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  type_label: string;
  title: string;
  message: string;
  link: string;
  read_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_detail: UserBrief | null;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  changes: Record<string, { old?: unknown; new?: unknown } | unknown>;
  ip_address: string | null;
  created_at: string;
}
