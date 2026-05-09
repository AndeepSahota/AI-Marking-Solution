import os
from pathlib import Path

# Load local.env before any model imports.
# Chandra reads TORCH_DEVICE from the environment at import time via its
# settings module, so env vars must be set here, before the model imports below.
_env_file = Path(__file__).parent / "local.env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile
from model.marker import run_marking
from model.ocr import _get_model

@asynccontextmanager
async def lifespan(_: FastAPI):
    _get_model()  # load 5.3 GB model before accepting requests
    yield

app = FastAPI(lifespan=lifespan)

@app.post("/mark")
async def mark_submission(
    student_work: UploadFile = File(...),
    mark_scheme: UploadFile = File(...)
):
    student_bytes = await student_work.read()
    scheme_bytes = await mark_scheme.read()
    result = run_marking(student_bytes, scheme_bytes)
    return result
