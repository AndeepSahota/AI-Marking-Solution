import os
import sys
from pathlib import Path

# Load local.env before any model imports.
_env_file = Path(__file__).parent / "local.env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile

# Add parent directory to path so we can find llm_service and ocr_service
sys.path.append(str(Path(__file__).parent))

from llm_service import generate_llm_response
from ocr_service import extract_text_from_file

# When Umar's Chandra OCR is available, swap these two lines back in:
# from model.marker import run_marking
# from model.ocr import _get_model, run_ocr

@asynccontextmanager
async def lifespan(_: FastAPI):
    # _get_model()  # uncomment when Chandra is available
    yield

app = FastAPI(lifespan=lifespan)

# ── POST /ocr ─────────────────────────────────────────────────────────────────
@app.post("/ocr")
async def ocr_file(file: UploadFile = File(...)):
    file_bytes = await file.read()
    text = extract_text_from_file(file_bytes, file.filename)
    return {"text": text}

# ── POST /mark ────────────────────────────────────────────────────────────────
@app.post("/mark")
async def mark_submission(
    student_work: UploadFile = File(...),
    mark_scheme: UploadFile = File(...)
):
    student_bytes = await student_work.read()
    scheme_bytes = await mark_scheme.read()

    # Extract text from both files
    student_text = extract_text_from_file(student_bytes, student_work.filename)
    scheme_text = extract_text_from_file(scheme_bytes, mark_scheme.filename)

    # Run LLM marking
    result = generate_llm_response(
        question="GCSE English Essay",
        essay=student_text,
        rubric=scheme_text,
        max_score=25
    )

    return {
        "score":    result.get("score"),
        "maxScore": 25,
        "feedback": result
    }