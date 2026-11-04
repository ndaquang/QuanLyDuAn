# Adds the new permissions (tender.approve, capability.*) and grants them to the default
# system roles exactly as a fresh setup would. Custom roles are left untouched.
# Tenders already past screening are recorded as a "go" decision.

from django.db import migrations

# New permissions, plus tender rights that became defaults of other system roles in this release
# (engineers / MEP / project managers can now see and assign tender work).
NEW_CODES = {
    "tender.approve",
    "tender.view",
    "tender.update",
    "capability.view",
    "capability.create",
    "capability.update",
    "capability.delete",
}


def forwards(apps, schema_editor):
    from plane.construction.permissions import DEFAULT_ROLES, permission_catalogue

    Permission = apps.get_model("construction", "Permission")
    Role = apps.get_model("construction", "Role")
    RolePermission = apps.get_model("construction", "RolePermission")
    Tender = apps.get_model("construction", "Tender")

    for code, module, action, name, order in permission_catalogue():
        Permission.objects.update_or_create(
            code=code, defaults={"module": module, "action": action, "name": name, "sort_order": order}
        )
    perms = {p.code: p for p in Permission.objects.filter(code__in=NEW_CODES)}
    defaults = {spec["code"]: set(spec["permissions"]) & NEW_CODES for spec in DEFAULT_ROLES}
    for role in Role.objects.filter(is_system=True, deleted_at__isnull=True):
        for code in defaults.get(role.code, ()):
            RolePermission.objects.get_or_create(role=role, permission=perms[code])

    Tender.objects.exclude(status="screening").filter(decision="pending").update(decision="go")


class Migration(migrations.Migration):
    dependencies = [("construction", "0003_tender_management")]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
