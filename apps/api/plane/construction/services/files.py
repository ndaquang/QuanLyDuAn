# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Centralised file storage for construction attachments.

Backend is chosen with ``CONSTRUCTION_FILE_STORAGE``:

* ``s3`` (default) - the same S3/MinIO bucket Plane uses, through ``S3Storage``;
* ``local`` - a directory on the API server (``CONSTRUCTION_MEDIA_ROOT``), handy for
  small single-server installs and development. Back it up together with the database.

Files are always served through the API (authorisation checked first): local files
are streamed, S3 files are redirected to a short-lived presigned URL.
"""

import mimetypes
import os
import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.http import FileResponse, HttpResponseRedirect
from rest_framework.exceptions import ValidationError

ALLOWED_EXTENSIONS = {
    # images (photos from phones included)
    "jpg", "jpeg", "png", "webp", "gif", "heic", "heif",
    # documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv",
    # drawings & archives
    "dwg", "dxf", "zip", "rar", "7z",
}  # fmt: skip


def backend():
    return os.environ.get("CONSTRUCTION_FILE_STORAGE", getattr(settings, "CONSTRUCTION_FILE_STORAGE", "s3")).lower()


def max_size():
    return int(os.environ.get("CONSTRUCTION_FILE_SIZE_LIMIT", settings.FILE_SIZE_LIMIT))


def _local_storage():
    root = os.environ.get("CONSTRUCTION_MEDIA_ROOT") or os.path.join(settings.BASE_DIR, "construction-media")
    return FileSystemStorage(location=root)


def validate_upload(uploaded):
    if uploaded is None:
        raise ValidationError({"file": "Vui lòng chọn tệp cần tải lên."})
    name = os.path.basename(uploaded.name or "")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ValidationError({"file": f"Định dạng .{ext or '?'} không được hỗ trợ."})
    if uploaded.size > max_size():
        raise ValidationError({"file": f"Tệp vượt quá dung lượng cho phép ({max_size() // (1024 * 1024)} MB)."})
    return name, ext


def store(workspace, uploaded):
    """Persist the upload and return (storage_key, backend, content_type).

    The content type is derived from the validated extension, never trusted from the client.
    """
    name, ext = validate_upload(uploaded)
    key = f"{workspace.id}/construction/{uuid.uuid4().hex}.{ext}"
    kind = backend()
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    if kind == "local":
        _local_storage().save(key, uploaded)
    else:
        from plane.settings.storage import S3Storage

        uploaded.seek(0)
        if not S3Storage().upload_file(uploaded, key, content_type):
            raise ValidationError({"file": "Không lưu được tệp lên kho lưu trữ. Vui lòng thử lại."})
    return key, kind, content_type


def serve(request, attachment, inline=True):
    if attachment.storage_backend == "local":
        storage = _local_storage()
        if not storage.exists(attachment.storage_key):
            from rest_framework.exceptions import NotFound

            raise NotFound("Tệp không còn tồn tại trên máy chủ.")
        safe_inline = inline and attachment.content_type in getattr(settings, "INLINE_SAFE_MIME_TYPES", ())
        response = FileResponse(
            storage.open(attachment.storage_key, "rb"),
            as_attachment=not safe_inline,
            filename=attachment.file_name,
            content_type=attachment.content_type if safe_inline else "application/octet-stream",
        )
        response["X-Content-Type-Options"] = "nosniff"
        return response
    from plane.settings.storage import S3Storage

    url = S3Storage(request=request).generate_presigned_url(
        attachment.storage_key,
        disposition="inline" if inline else "attachment",
        filename=attachment.file_name,
        content_type=attachment.content_type,
    )
    if not url:
        from rest_framework.exceptions import NotFound

        raise NotFound("Không tạo được đường dẫn tải tệp.")
    return HttpResponseRedirect(url)


def remove(attachment):
    if attachment.storage_backend == "local":
        _local_storage().delete(attachment.storage_key)
    else:
        from plane.settings.storage import S3Storage

        S3Storage().delete_files([attachment.storage_key])
