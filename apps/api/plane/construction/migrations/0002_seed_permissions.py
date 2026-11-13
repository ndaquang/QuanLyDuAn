# Seeds the static permission catalogue (module.action) used by the role matrix.

from django.db import migrations


def seed(apps, schema_editor):
    from plane.construction.permissions import permission_catalogue

    Permission = apps.get_model("construction", "Permission")
    for code, module, action, name, order in permission_catalogue():
        Permission.objects.update_or_create(
            code=code, defaults={"module": module, "action": action, "name": name, "sort_order": order}
        )


class Migration(migrations.Migration):
    dependencies = [("construction", "0001_initial")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
