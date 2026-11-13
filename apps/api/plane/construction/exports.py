# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Excel (.xlsx) export helpers."""

import datetime
import decimal
import io
import re

from django.http import HttpResponse
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

NAVY = "1E3A5F"
_THIN = Side(style="thin", color="CBD5E1")


def _cell_value(value):
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, datetime.datetime):
        return timezone.localtime(value).replace(tzinfo=None) if timezone.is_aware(value) else value
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value)
    if isinstance(value, dict):
        return value.get("display_name") or value.get("name") or str(value)
    # Neutralise spreadsheet formula injection from user-entered text.
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


def _resolve(row, accessor):
    if callable(accessor):
        return accessor(row)
    value = row
    for part in accessor.split("."):
        if value is None:
            return None
        value = value.get(part) if isinstance(value, dict) else getattr(value, part, None)
    return value


def build_xlsx(title, columns, rows, subtitle=""):
    """columns: [(header, accessor)]; accessor is a dotted key/attr path or a callable."""
    wb = Workbook()
    ws = wb.active
    ws.title = re.sub(r"[\[\]\*\?/\\:]", "", title)[:31] or "Data"
    ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=14, color=NAVY)
    ws.cell(row=2, column=1, value=subtitle or f"Xuất lúc {timezone.localtime().strftime('%d/%m/%Y %H:%M')}")
    header_row = 4
    for idx, (header, _) in enumerate(columns, start=1):
        cell = ws.cell(row=header_row, column=idx, value=header)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(top=_THIN, bottom=_THIN, left=_THIN, right=_THIN)
    widths = [len(h) + 2 for h, _ in columns]
    for r, row in enumerate(rows, start=header_row + 1):
        for c, (_, accessor) in enumerate(columns, start=1):
            value = _cell_value(_resolve(row, accessor))
            cell = ws.cell(row=r, column=c, value=value)
            cell.border = Border(top=_THIN, bottom=_THIN, left=_THIN, right=_THIN)
            if isinstance(value, (datetime.date, datetime.datetime)):
                cell.number_format = "DD/MM/YYYY"
            elif isinstance(value, float):
                cell.number_format = "#,##0.##"
            widths[c - 1] = min(60, max(widths[c - 1], len(str(value or "")) + 2))
    for idx, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = width
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def xlsx_response(filename, title, columns, rows, subtitle=""):
    content = build_xlsx(title, columns, rows, subtitle)
    response = HttpResponse(content, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    stamp = timezone.localtime().strftime("%Y%m%d-%H%M")
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", filename)
    response["Content-Disposition"] = f'attachment; filename="{safe}-{stamp}.xlsx"'
    return response
