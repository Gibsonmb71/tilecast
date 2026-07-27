import base64
import io
import tarfile
from pathlib import Path

paths = [
    "apps/dashboard/src/components/StudioTopbar.tsx",
    "apps/dashboard/src/components/StudioTopbar.test.tsx",
    "apps/dashboard/src/styles/topbar.css",
    "apps/dashboard/src/App.tsx",
]

buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
    for path in paths:
        archive.add(Path(path), arcname=path)

encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
print("CMDK_ARCHIVE_BEGIN")
for index in range(0, len(encoded), 120):
    print(encoded[index : index + 120])
print("CMDK_ARCHIVE_END")
