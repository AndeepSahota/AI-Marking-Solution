import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile

from model.marker import run_marking
from model.ocr import run_ocr

# Load the Document Intelligence connection values from the gitignored local.env.
load_dotenv(Path(__file__).parent / "local.env")

app = FastAPI()


def _configured() -> bool:
    # Only the endpoint is always required. Auth is either a key (local dev) or
    # managed identity (prod), so a missing key does not mean "unconfigured".
    return bool(os.getenv("AZURE_DOCINTEL_ENDPOINT"))


# ── GET /health ───────────────────────────────────────────────────────────────
# No local model to warm up, so readiness is just "is the endpoint set". `auth`
# reports which credential path will be used, without leaking any values.
@app.get("/health")
def health():
    return {
        "status": "ok",
        "configured": _configured(),
        "auth": "key" if os.getenv("AZURE_DOCINTEL_KEY") else "managed_identity",
    }


# ── POST /ocr ─────────────────────────────────────────────────────────────────
# Single-file OCR. Signature unchanged — the backend still POSTs one file and gets
# back { text, stages, meta }.
@app.post("/ocr")
async def ocr_file(file: UploadFile = File(...)):
    file_bytes = await file.read()
    result = run_ocr(file_bytes)
    return result


# ── POST /mark ────────────────────────────────────────────────────────────────
# Two-file marking. Signature unchanged.
@app.post("/mark")
async def mark_submission(
    student_work: UploadFile = File(...),
    mark_scheme: UploadFile = File(...),
):
    student_bytes = await student_work.read()
    scheme_bytes = await mark_scheme.read()
    result = run_marking(student_bytes, scheme_bytes)
    return result
