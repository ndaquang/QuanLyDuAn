# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Data model of the construction ERP module.

Every table is prefixed ``cx_`` and scoped to a Plane workspace (= one company).
Plane's own tables are reused instead of duplicated:

* ``users``            -> accounts / authentication
* ``workspaces``       -> the company
* ``workspace_members``-> who belongs to the company (Plane role: admin/member/guest)
* ``projects``         -> a construction project (extended 1:1 by ``cx_project_profiles``)
* ``project_members``  -> who may see a project (per-project access control)
* ``issues``           -> assigned work items ("Công việc", module 6)
"""

import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

from plane.db.models import BaseModel

ZERO = Decimal("0")
HUNDRED = Decimal("100")


class WorkspaceScopedModel(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="+")

    class Meta:
        abstract = True


# ---------------------------------------------------------------------------
# Roles & permissions
# ---------------------------------------------------------------------------


class Permission(models.Model):
    """Static catalogue of ``<module>.<action>`` permissions (seeded by migration)."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    code = models.CharField(max_length=64, unique=True)
    module = models.CharField(max_length=32)
    action = models.CharField(max_length=16)
    name = models.CharField(max_length=255)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "cx_permissions"
        ordering = ("sort_order", "code")

    def __str__(self):
        return self.code


class Role(WorkspaceScopedModel):
    """Business role (Giám đốc, Trưởng phòng dự án, Kỹ sư MEP, QS, ...)."""

    code = models.SlugField(max_length=64)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    is_system = models.BooleanField(default=False)
    # Roles that oversee the whole company (director, project-department head) see every project;
    # everyone else only sees projects they are a member of.
    see_all_projects = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    permissions = models.ManyToManyField(Permission, through="RolePermission", related_name="roles")

    class Meta:
        db_table = "cx_roles"
        ordering = ("sort_order", "name")
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], condition=Q(deleted_at__isnull=True), name="cx_role_unique_code"
            )
        ]

    def __str__(self):
        return self.name


class RolePermission(models.Model):
    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="role_permissions")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cx_role_permissions"
        constraints = [models.UniqueConstraint(fields=["role", "permission"], name="cx_role_permission_unique")]


# ---------------------------------------------------------------------------
# Organisation & HR
# ---------------------------------------------------------------------------


class Department(WorkspaceScopedModel):
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=255)
    head = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    description = models.TextField(blank=True, default="")

    class Meta:
        db_table = "cx_departments"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], condition=Q(deleted_at__isnull=True), name="cx_department_unique_code"
            )
        ]

    def __str__(self):
        return self.name


class Employee(WorkspaceScopedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Đang làm việc"
        ON_LEAVE = "on_leave", "Nghỉ phép dài hạn"
        RESIGNED = "resigned", "Đã nghỉ việc"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="cx_employees"
    )
    code = models.CharField(max_length=32)
    full_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=32, blank=True, default="")
    position = models.CharField(max_length=255, blank=True, default="", help_text="Chức vụ")
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True, related_name="employees"
    )
    role = models.ForeignKey(Role, on_delete=models.SET_NULL, null=True, blank=True, related_name="employees")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    date_of_birth = models.DateField(null=True, blank=True)
    join_date = models.DateField(null=True, blank=True)
    id_number = models.CharField(max_length=32, blank=True, default="", help_text="Số CCCD")
    address = models.CharField(max_length=500, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    photo = models.ForeignKey(
        "construction.Attachment", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "cx_employees"
        ordering = ("full_name",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], condition=Q(deleted_at__isnull=True), name="cx_employee_unique_code"
            ),
            models.UniqueConstraint(
                fields=["workspace", "user"],
                condition=Q(deleted_at__isnull=True, user__isnull=False),
                name="cx_employee_unique_user",
            ),
        ]

    def __str__(self):
        return self.full_name


# ---------------------------------------------------------------------------
# Projects & schedule
# ---------------------------------------------------------------------------


class ProjectProfile(WorkspaceScopedModel):
    """Construction-specific data for a Plane project (1:1)."""

    class Status(models.TextChoices):
        IN_PROGRESS = "in_progress", "Đang triển khai"
        PAUSED = "paused", "Tạm dừng"
        DELAYED = "delayed", "Chậm tiến độ"
        AWAITING_ACCEPTANCE = "awaiting_acceptance", "Chờ nghiệm thu"
        COMPLETED = "completed", "Hoàn thành"

    class ProjectType(models.TextChoices):
        CIVIL = "civil", "Dân dụng"
        INDUSTRIAL = "industrial", "Công nghiệp / Nhà xưởng"
        INFRASTRUCTURE = "infrastructure", "Hạ tầng kỹ thuật"
        TRANSPORT = "transport", "Giao thông"
        MEP = "mep", "Cơ điện (MEP)"
        INTERIOR = "interior", "Nội thất / Hoàn thiện"
        OTHER = "other", "Khác"

    project = models.OneToOneField("db.Project", on_delete=models.CASCADE, related_name="construction_profile")
    code = models.CharField(max_length=32)
    investor = models.CharField(max_length=255, help_text="Chủ đầu tư")
    location = models.CharField(max_length=500, blank=True, default="")
    project_type = models.CharField(max_length=32, choices=ProjectType.choices, default=ProjectType.CIVIL)
    start_date = models.DateField()
    planned_end_date = models.DateField()
    actual_end_date = models.DateField(null=True, blank=True)
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.IN_PROGRESS)
    contract_value = models.DecimalField(
        max_digits=18, decimal_places=0, default=ZERO, validators=[MinValueValidator(0)]
    )
    description = models.TextField(blank=True, default="")

    class Meta:
        db_table = "cx_project_profiles"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], condition=Q(deleted_at__isnull=True), name="cx_project_unique_code"
            )
        ]

    def __str__(self):
        return f"{self.code} - {self.project.name}"


class ScheduleItem(WorkspaceScopedModel):
    """WBS node: Hạng mục -> Công việc -> Công tác chi tiết (table ``project_tasks`` in the spec)."""

    class Level(models.TextChoices):
        CATEGORY = "category", "Hạng mục"
        TASK = "task", "Công việc"
        ACTIVITY = "activity", "Công tác chi tiết"

    class Priority(models.TextChoices):
        LOW = "low", "Thấp"
        MEDIUM = "medium", "Trung bình"
        HIGH = "high", "Cao"
        URGENT = "urgent", "Khẩn cấp"

    class Status(models.TextChoices):
        NOT_STARTED = "not_started", "Chưa bắt đầu"
        IN_PROGRESS = "in_progress", "Đang thực hiện"
        PAUSED = "paused", "Tạm dừng"
        COMPLETED = "completed", "Hoàn thành"

    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="cx_schedule_items")
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="children")
    level = models.CharField(max_length=16, choices=Level.choices)
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=255)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    start_date = models.DateField()
    end_date = models.DateField()
    duration_days = models.PositiveIntegerField(default=1)
    progress = models.DecimalField(
        max_digits=5, decimal_places=2, default=ZERO, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    weight = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("1"), validators=[MinValueValidator(0)]
    )
    priority = models.CharField(max_length=16, choices=Priority.choices, default=Priority.MEDIUM)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NOT_STARTED)
    note = models.TextField(blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "cx_schedule_items"
        ordering = ("sort_order", "code")
        constraints = [
            models.UniqueConstraint(
                fields=["project", "code"], condition=Q(deleted_at__isnull=True), name="cx_schedule_item_unique_code"
            ),
            models.CheckConstraint(condition=Q(end_date__gte=models.F("start_date")), name="cx_schedule_item_dates"),
        ]

    def save(self, *args, **kwargs):
        if self.start_date and self.end_date:
            self.duration_days = (self.end_date - self.start_date).days + 1
        if self.progress is not None and Decimal(self.progress) >= HUNDRED:
            self.status = self.Status.COMPLETED
            self.completed_at = self.completed_at or timezone.now()
        elif self.status == self.Status.COMPLETED:
            self.status = self.Status.IN_PROGRESS
            self.completed_at = None
        elif self.progress and Decimal(self.progress) > ZERO and self.status == self.Status.NOT_STARTED:
            self.status = self.Status.IN_PROGRESS
        super().save(*args, **kwargs)

    @property
    def is_overdue(self):
        return self.status != self.Status.COMPLETED and self.end_date < timezone.localdate()

    def __str__(self):
        return f"{self.code} {self.name}"


class TaskDependency(BaseModel):
    class Type(models.TextChoices):
        FS = "FS", "Kết thúc - Bắt đầu"
        SS = "SS", "Bắt đầu - Bắt đầu"
        FF = "FF", "Kết thúc - Kết thúc"
        SF = "SF", "Bắt đầu - Kết thúc"

    predecessor = models.ForeignKey(ScheduleItem, on_delete=models.CASCADE, related_name="successor_links")
    successor = models.ForeignKey(ScheduleItem, on_delete=models.CASCADE, related_name="predecessor_links")
    dependency_type = models.CharField(max_length=2, choices=Type.choices, default=Type.FS)
    lag_days = models.IntegerField(default=0)

    class Meta:
        db_table = "cx_task_dependencies"
        constraints = [
            models.UniqueConstraint(
                fields=["predecessor", "successor"],
                condition=Q(deleted_at__isnull=True),
                name="cx_task_dependency_unique",
            )
        ]


class Milestone(WorkspaceScopedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Chưa đạt"
        ACHIEVED = "achieved", "Đã đạt"
        MISSED = "missed", "Trễ mốc"

    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="cx_milestones")
    name = models.CharField(max_length=255)
    due_date = models.DateField()
    achieved_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    description = models.TextField(blank=True, default="")

    class Meta:
        db_table = "cx_project_milestones"
        ordering = ("due_date",)


class DailyReport(WorkspaceScopedModel):
    """Nhật ký công trường."""

    class Weather(models.TextChoices):
        SUNNY = "sunny", "Nắng"
        CLOUDY = "cloudy", "Nhiều mây"
        RAIN = "rain", "Mưa"
        STORM = "storm", "Mưa bão"

    class Status(models.TextChoices):
        DRAFT = "draft", "Nháp"
        SUBMITTED = "submitted", "Chờ duyệt"
        APPROVED = "approved", "Đã duyệt"
        REJECTED = "rejected", "Bị trả lại"

    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="cx_daily_reports")
    report_date = models.DateField()
    weather = models.CharField(max_length=16, choices=Weather.choices, default=Weather.SUNNY)
    manpower_count = models.PositiveIntegerField(default=0)
    equipment = models.TextField(blank=True, default="")
    work_performed = models.TextField()
    issues = models.TextField(blank=True, default="")
    hse_notes = models.TextField(blank=True, default="")
    next_plan = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_comment = models.TextField(blank=True, default="")

    class Meta:
        db_table = "cx_daily_reports"
        ordering = ("-report_date",)
        constraints = [
            models.UniqueConstraint(
                fields=["project", "report_date"],
                condition=Q(deleted_at__isnull=True),
                name="cx_daily_report_unique_date",
            )
        ]

    @property
    def is_locked(self):
        return self.status == self.Status.APPROVED


class WorkLog(WorkspaceScopedModel):
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="cx_work_logs")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    schedule_item = models.ForeignKey(ScheduleItem, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    work_date = models.DateField()
    hours = models.DecimalField(
        max_digits=5, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(24)]
    )
    description = models.TextField(blank=True, default="")

    class Meta:
        db_table = "cx_work_logs"
        ordering = ("-work_date",)


# ---------------------------------------------------------------------------
# Materials, suppliers, tenders & documents
# ---------------------------------------------------------------------------


class Supplier(WorkspaceScopedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Đang giao dịch"
        INACTIVE = "inactive", "Ngừng giao dịch"

    code = models.CharField(max_length=32)
    name = models.CharField(max_length=255)
    tax_code = models.CharField(max_length=32, blank=True, default="")
    category = models.CharField(max_length=255, blank=True, default="", help_text="Nhóm cung cấp")
    contact_person = models.CharField(max_length=255, blank=True, default="")
    phone = models.CharField(max_length=32, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "cx_suppliers"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], condition=Q(deleted_at__isnull=True), name="cx_supplier_unique_code"
            ),
            models.UniqueConstraint(
                fields=["workspace", "tax_code"],
                condition=Q(deleted_at__isnull=True) & ~Q(tax_code=""),
                name="cx_supplier_unique_tax_code",
            ),
        ]

    def __str__(self):
        return self.name


class Material(WorkspaceScopedModel):
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=255)
    unit = models.CharField(max_length=32)
    category = models.CharField(max_length=255, blank=True, default="")
    specification = models.TextField(blank=True, default="")
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="materials")
    reference_price = models.DecimalField(
        max_digits=18, decimal_places=0, default=ZERO, validators=[MinValueValidator(0)]
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "cx_materials"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], condition=Q(deleted_at__isnull=True), name="cx_material_unique_code"
            )
        ]


class CapabilityDocument(WorkspaceScopedModel):
    """Thư viện hồ sơ năng lực dùng chung cho mọi gói thầu (giấy phép, chứng chỉ, BCTC, HĐ tương tự...)."""

    class Category(models.TextChoices):
        LEGAL = "legal", "Pháp lý doanh nghiệp"
        CERTIFICATE = "certificate", "Chứng chỉ năng lực hoạt động xây dựng"
        FINANCIAL = "financial", "Báo cáo tài chính / thuế"
        SIMILAR_CONTRACT = "similar_contract", "Hợp đồng tương tự"
        PERSONNEL = "personnel", "Nhân sự chủ chốt"
        EQUIPMENT = "equipment", "Máy móc thiết bị"
        QUALITY = "quality", "ISO / Quản lý chất lượng - HSE"
        OTHER = "other", "Khác"

    category = models.CharField(max_length=32, choices=Category.choices)
    title = models.CharField(max_length=255)
    number = models.CharField(max_length=128, blank=True, default="", help_text="Số hiệu văn bản")
    issuer = models.CharField(max_length=255, blank=True, default="", help_text="Cơ quan cấp / chủ đầu tư")
    issue_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "cx_capability_documents"
        ordering = ("category", "title")

    def __str__(self):
        return self.title

    @property
    def is_expired(self):
        return bool(self.expiry_date and self.expiry_date < timezone.localdate())


class Tender(WorkspaceScopedModel):
    """Gói thầu: từ khi nhận thông tin mời thầu đến khi có kết quả."""

    class Status(models.TextChoices):
        SCREENING = "screening", "Đánh giá sơ bộ"
        PREPARING = "preparing", "Đang lập HSDT"
        SUBMITTED = "submitted", "Đã nộp thầu"
        EVALUATING = "evaluating", "Đang chấm thầu / thương thảo"
        WON = "won", "Trúng thầu"
        LOST = "lost", "Không trúng thầu"
        DECLINED = "declined", "Không tham dự"
        CANCELLED = "cancelled", "Bên mời thầu hủy"

    class Decision(models.TextChoices):
        PENDING = "pending", "Chưa quyết định"
        GO = "go", "Tham dự"
        NO_GO = "no_go", "Không tham dự"

    class SelectionMethod(models.TextChoices):
        OPEN = "open", "Đấu thầu rộng rãi"
        LIMITED = "limited", "Đấu thầu hạn chế"
        DIRECT = "direct", "Chỉ định thầu"
        COMPETITIVE = "competitive", "Chào hàng cạnh tranh"
        PRIVATE_RFQ = "private_rfq", "Mời thầu nội bộ (dự án tư nhân)"
        OTHER = "other", "Khác"

    class PackageType(models.TextChoices):
        CONSTRUCTION = "construction", "Thi công xây lắp"
        MEP = "mep", "Cơ điện (MEP)"
        EPC = "epc", "EPC / Tổng thầu"
        DESIGN_BUILD = "design_build", "Thiết kế - Thi công"
        SUPPLY_INSTALL = "supply_install", "Cung cấp & lắp đặt"
        INTERIOR = "interior", "Hoàn thiện / Nội thất"
        OTHER = "other", "Khác"

    class SubmissionMethod(models.TextChoices):
        ONLINE = "online", "Qua mạng (e-GP)"
        DIRECT = "direct", "Nộp trực tiếp"
        EMAIL = "email", "Email / bản mềm"

    class LostReason(models.TextChoices):
        TECHNICAL = "technical", "Không đạt kỹ thuật"
        CAPABILITY = "capability", "Không đạt năng lực / kinh nghiệm"
        ADMINISTRATIVE = "administrative", "Không hợp lệ hành chính"
        OTHER = "other", "Khác"

    OPEN_STATUSES = (Status.SCREENING, Status.PREPARING, Status.SUBMITTED, Status.EVALUATING)

    code = models.CharField(max_length=32)
    name = models.CharField(max_length=255)
    investor = models.CharField(max_length=255)
    location = models.CharField(max_length=500, blank=True, default="")
    source = models.CharField(max_length=255, blank=True, default="", help_text="Nguồn thông tin mời thầu")
    selection_method = models.CharField(max_length=16, choices=SelectionMethod.choices, default=SelectionMethod.OPEN)
    package_type = models.CharField(max_length=16, choices=PackageType.choices, default=PackageType.CONSTRUCTION)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    project = models.ForeignKey(
        "db.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="cx_tenders"
    )
    # Key dates
    release_date = models.DateField(null=True, blank=True, help_text="Ngày phát hành HSMT")
    site_visit_date = models.DateTimeField(null=True, blank=True, help_text="Khảo sát hiện trường")
    pre_bid_meeting_date = models.DateTimeField(null=True, blank=True, help_text="Hội nghị tiền đấu thầu")
    clarification_deadline = models.DateField(null=True, blank=True)
    submission_deadline = models.DateTimeField()
    opening_date = models.DateTimeField(null=True, blank=True, help_text="Mở thầu")
    submission_method = models.CharField(
        max_length=16, choices=SubmissionMethod.choices, default=SubmissionMethod.ONLINE
    )
    bid_validity_days = models.PositiveIntegerField(null=True, blank=True, help_text="Hiệu lực HSDT (ngày)")
    submitted_at = models.DateTimeField(null=True, blank=True)
    # Go / no-go
    decision = models.CharField(max_length=16, choices=Decision.choices, default=Decision.PENDING)
    decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decision_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True, default="")
    # Result
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SCREENING)
    result_date = models.DateField(null=True, blank=True)
    winner_name = models.CharField(max_length=255, blank=True, default="")
    lost_reason = models.CharField(max_length=16, choices=LostReason.choices, blank=True, default="")
    result_note = models.TextField(blank=True, default="")
    capability_documents = models.ManyToManyField(
        CapabilityDocument, blank=True, related_name="tenders", db_table="cx_tender_capabilities"
    )

    class Meta:
        db_table = "cx_tenders"
        ordering = ("submission_deadline",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], condition=Q(deleted_at__isnull=True), name="cx_tender_unique_code"
            )
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    @property
    def is_locked(self):
        # Results are history: a closed tender is no longer edited.
        return self.status in (self.Status.WON, self.Status.LOST, self.Status.DECLINED, self.Status.CANCELLED)


class TenderClarification(WorkspaceScopedModel):
    """Hỏi đáp làm rõ HSMT / văn bản sửa đổi HSMT."""

    class Kind(models.TextChoices):
        QUESTION = "question", "Câu hỏi làm rõ của nhà thầu"
        ADDENDUM = "addendum", "Văn bản sửa đổi / làm rõ của bên mời thầu"

    tender = models.ForeignKey(Tender, on_delete=models.CASCADE, related_name="clarifications")
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.QUESTION)
    reference = models.CharField(max_length=128, blank=True, default="", help_text="Số văn bản")
    question = models.TextField()
    asked_date = models.DateField(null=True, blank=True)
    answer = models.TextField(blank=True, default="")
    answered_date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "cx_tender_clarifications"
        ordering = ("created_at",)

    @property
    def is_answered(self):
        return bool(self.answer.strip())


PRIORITY_CHOICES = (("urgent", "Khẩn cấp"), ("high", "Cao"), ("medium", "Trung bình"), ("low", "Thấp"))


class TenderItem(WorkspaceScopedModel):
    """Một đầu mục hồ sơ cần chuẩn bị cho gói thầu."""

    class Category(models.TextChoices):
        LEGAL = "legal", "Hồ sơ pháp lý / năng lực"
        TECHNICAL = "technical", "Hồ sơ kỹ thuật"
        FINANCIAL = "financial", "Khối lượng / BOQ"
        OTHER = "other", "Khác"

    class Status(models.TextChoices):
        TODO = "todo", "Chưa làm"
        IN_PROGRESS = "in_progress", "Đang làm"
        DONE = "done", "Hoàn thành"

    tender = models.ForeignKey(Tender, on_delete=models.CASCADE, related_name="items")
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=16, choices=Category.choices, default=Category.TECHNICAL)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    description = models.TextField(blank=True, default="")
    priority = models.CharField(max_length=16, choices=PRIORITY_CHOICES, default="medium")
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.TODO)
    completed_at = models.DateTimeField(null=True, blank=True)
    note = models.TextField(blank=True, default="")

    def save(self, *args, **kwargs):
        if self.status == self.Status.DONE:
            self.completed_at = self.completed_at or timezone.now()
        else:
            self.completed_at = None
        super().save(*args, **kwargs)

    class Meta:
        db_table = "cx_tender_items"
        ordering = ("due_date", "created_at")


class TenderItemComment(WorkspaceScopedModel):
    """Trao đổi trên một công việc của gói thầu."""

    item = models.ForeignKey(TenderItem, on_delete=models.CASCADE, related_name="comments")
    text = models.TextField()

    class Meta:
        db_table = "cx_tender_item_comments"
        ordering = ("created_at",)


class Document(WorkspaceScopedModel):
    class Category(models.TextChoices):
        DRAWING = "drawing", "Bản vẽ"
        METHOD_STATEMENT = "method_statement", "Biện pháp thi công"
        ACCEPTANCE = "acceptance", "Hồ sơ nghiệm thu"
        QUALITY = "quality", "QA/QC"
        HSE = "hse", "An toàn - Môi trường"
        CONTRACT = "contract", "Hợp đồng"
        BID = "bid", "Hồ sơ dự thầu"
        LEGAL = "legal", "Pháp lý dự án"
        OTHER = "other", "Khác"

    class Status(models.TextChoices):
        DRAFT = "draft", "Nháp"
        SUBMITTED = "submitted", "Chờ duyệt / nghiệm thu"
        APPROVED = "approved", "Đã duyệt"
        REJECTED = "rejected", "Bị trả lại"

    project = models.ForeignKey(
        "db.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="cx_documents"
    )
    tender = models.ForeignKey(Tender, on_delete=models.CASCADE, null=True, blank=True, related_name="documents")
    category = models.CharField(max_length=32, choices=Category.choices, default=Category.OTHER)
    code = models.CharField(max_length=64, blank=True, default="")
    title = models.CharField(max_length=255)
    version = models.CharField(max_length=16, default="1")
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_comment = models.TextField(blank=True, default="")

    class Meta:
        db_table = "cx_documents"
        ordering = ("-created_at",)

    @property
    def is_locked(self):
        return self.status == self.Status.APPROVED


class Attachment(WorkspaceScopedModel):
    class EntityType(models.TextChoices):
        EMPLOYEE = "employee", "Nhân sự"
        DAILY_REPORT = "daily_report", "Nhật ký công trường"
        DOCUMENT = "document", "Hồ sơ"
        TASK = "task", "Công việc"
        SCHEDULE_ITEM = "schedule_item", "Hạng mục tiến độ"
        APPROVAL_REQUEST = "approval_request", "Yêu cầu phê duyệt"
        TENDER = "tender", "Gói thầu"
        TENDER_ITEM = "tender_item", "Công việc gói thầu"
        CAPABILITY = "capability", "Hồ sơ năng lực"

    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="+")
    entity_type = models.CharField(max_length=32, choices=EntityType.choices)
    entity_id = models.UUIDField()
    file_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField()
    storage_key = models.CharField(max_length=512, unique=True)
    storage_backend = models.CharField(max_length=16, default="s3")

    class Meta:
        db_table = "cx_attachments"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["entity_type", "entity_id"], name="cx_attachment_entity_idx")]


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------


class RequestType(models.TextChoices):
    PURCHASE = "purchase", "Mua vật tư"
    PAYMENT = "payment", "Thanh toán"
    ADVANCE = "advance", "Tạm ứng"
    VARIATION = "variation", "Chi phí phát sinh"
    BUDGET_ADJUSTMENT = "budget_adjustment", "Điều chỉnh ngân sách"
    CONTRACT = "contract", "Hợp đồng"
    LEAVE = "leave", "Nghỉ phép"


FINANCIAL_REQUEST_TYPES = {
    RequestType.PURCHASE,
    RequestType.PAYMENT,
    RequestType.ADVANCE,
    RequestType.VARIATION,
    RequestType.BUDGET_ADJUSTMENT,
    RequestType.CONTRACT,
}


class ApprovalWorkflow(WorkspaceScopedModel):
    request_type = models.CharField(max_length=32, choices=RequestType.choices)
    name = models.CharField(max_length=255)
    is_financial = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "cx_approval_workflows"
        ordering = ("request_type",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "request_type"],
                condition=Q(deleted_at__isnull=True),
                name="cx_workflow_unique_type",
            )
        ]


class ApprovalStep(BaseModel):
    class ApproverKind(models.TextChoices):
        DEPARTMENT_HEAD = "department_head", "Trưởng bộ phận của người đề nghị"
        PROJECT_MANAGER = "project_manager", "Trưởng dự án"
        ROLE = "role", "Theo vai trò"

    workflow = models.ForeignKey(ApprovalWorkflow, on_delete=models.CASCADE, related_name="steps")
    order = models.PositiveIntegerField()
    name = models.CharField(max_length=255)
    approver_kind = models.CharField(max_length=32, choices=ApproverKind.choices)
    approver_role = models.ForeignKey(Role, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    # The step only applies when the request amount is >= min_amount ("phê duyệt theo hạn mức").
    min_amount = models.DecimalField(max_digits=18, decimal_places=0, null=True, blank=True)
    requires_budget_check = models.BooleanField(default=False)

    class Meta:
        db_table = "cx_approval_steps"
        ordering = ("order",)
        constraints = [
            models.UniqueConstraint(
                fields=["workflow", "order"], condition=Q(deleted_at__isnull=True), name="cx_step_unique_order"
            )
        ]


class ApprovalRequest(WorkspaceScopedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Nháp"
        PENDING = "pending", "Đang chờ duyệt"
        APPROVED = "approved", "Đã phê duyệt"
        REJECTED = "rejected", "Từ chối"
        CANCELLED = "cancelled", "Đã hủy"

    code = models.CharField(max_length=32)
    request_type = models.CharField(max_length=32, choices=RequestType.choices)
    workflow = models.ForeignKey(ApprovalWorkflow, on_delete=models.PROTECT, related_name="requests")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="+")
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    amount = models.DecimalField(max_digits=18, decimal_places=0, default=ZERO, validators=[MinValueValidator(0)])
    # Extra structured data (purchase lines, leave dates, contract partner...)
    details = models.JSONField(default=dict, blank=True)
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    current_step = models.ForeignKey(ApprovalStep, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # Ordered list of step ids that apply to this request, frozen at submission time.
    step_plan = models.JSONField(default=list, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "cx_approval_requests"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "code"], condition=Q(deleted_at__isnull=True), name="cx_request_unique_code"
            )
        ]

    @property
    def is_locked(self):
        return self.status in (self.Status.PENDING, self.Status.APPROVED, self.Status.CANCELLED)


class ApprovalHistory(models.Model):
    class Action(models.TextChoices):
        SUBMIT = "submit", "Gửi duyệt"
        APPROVE = "approve", "Phê duyệt"
        REJECT = "reject", "Từ chối"
        CANCEL = "cancel", "Hủy"
        SKIP = "skip", "Bỏ qua bước"
        COMMENT = "comment", "Ý kiến"

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    request = models.ForeignKey(ApprovalRequest, on_delete=models.CASCADE, related_name="history")
    step = models.ForeignKey(ApprovalStep, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    step_name = models.CharField(max_length=255, blank=True, default="")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    action = models.CharField(max_length=16, choices=Action.choices)
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cx_approval_history"
        ordering = ("created_at",)


# ---------------------------------------------------------------------------
# Notifications, audit, sequences
# ---------------------------------------------------------------------------


class Notification(models.Model):
    class Type(models.TextChoices):
        TASK_NEW = "task_new", "Công việc mới"
        TASK_DUE_SOON = "task_due_soon", "Công việc sắp đến hạn"
        TASK_OVERDUE = "task_overdue", "Công việc quá hạn"
        APPROVAL_REQUEST = "approval_request", "Yêu cầu phê duyệt"
        PURCHASE_REQUEST = "purchase_request", "Đề xuất mua hàng"
        BUDGET_OVERRUN = "budget_overrun", "Chi phí vượt ngân sách"
        ACCEPTANCE_REQUIRED = "acceptance_required", "Hồ sơ cần nghiệm thu"
        APPROVAL_RESULT = "approval_result", "Kết quả phê duyệt"
        SCHEDULE_DELAYED = "schedule_delayed", "Dự án chậm tiến độ"
        TENDER_DEADLINE = "tender_deadline", "Hạn đấu thầu"
        DOCUMENT_EXPIRY = "document_expiry", "Hồ sơ năng lực sắp hết hạn"

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="+")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cx_notifications")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="+")
    type = models.CharField(max_length=32, choices=Type.choices)
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True, default="")
    entity_type = models.CharField(max_length=32, blank=True, default="")
    entity_id = models.UUIDField(null=True, blank=True)
    link = models.CharField(max_length=500, blank=True, default="")
    # Prevents the periodic scanners from sending the same reminder twice.
    dedup_key = models.CharField(max_length=255, null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cx_notifications"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["recipient", "workspace", "read_at"], name="cx_notification_inbox_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["recipient", "dedup_key"],
                condition=Q(dedup_key__isnull=False),
                name="cx_notification_dedup",
            )
        ]


class AuditLog(models.Model):
    """Append-only activity history. There is intentionally no API to edit or delete rows."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, null=True, related_name="+")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    action = models.CharField(max_length=32)
    entity_type = models.CharField(max_length=64)
    entity_id = models.CharField(max_length=64, blank=True, default="")
    entity_label = models.CharField(max_length=500, blank=True, default="")
    project = models.ForeignKey("db.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "cx_audit_logs"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["workspace", "entity_type", "entity_id"], name="cx_audit_entity_idx")]


class Sequence(models.Model):
    """Per-workspace counters for human readable codes (PD-2026-0001, ...)."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="+")
    key = models.CharField(max_length=64)
    value = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "cx_sequences"
        constraints = [models.UniqueConstraint(fields=["workspace", "key"], name="cx_sequence_unique_key")]
