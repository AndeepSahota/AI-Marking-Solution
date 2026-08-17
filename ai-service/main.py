import os
import sys
import json as _json
import asyncio
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
import fitz
from rapidfuzz import process, fuzz
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import StreamingResponse

# Add parent directory to path so we can find llm_service and ocr_service
sys.path.append(str(Path(__file__).parent))

from llm_service import generate_llm_response, extract_mark_scheme
from ocr_service import extract_text_from_file
from rag_service import add_exemplar, get_similar, list_exemplars, delete_exemplar
from security import ms_ocr_sanitisation
from observability.event_log import log_security_stripped

# When Umar's Chandra OCR is available, swap these two lines back in:
# from model.marker import run_marking
# from model.ocr import _get_model, run_ocr

@asynccontextmanager
async def lifespan(_: FastAPI):
    # _get_model()  # uncomment when Chandra is available
    yield

app = FastAPI(lifespan=lifespan)

# Runs the same strip -> sanitize -> wrap sequence /ocr and /mark-with-scheme-text
# already used on a piece of raw OCR text, so bulk-mark's per-student text gets
# the identical prompt-injection defense rather than a quieter, unprotected path.
def _secure_wrap(raw_text: str):
    stripped, lookalikes = ms_ocr_sanitisation.strip_delimiter_like_patterns(raw_text)
    if lookalikes:
        log_security_stripped(lookalikes)
    clean_text = ms_ocr_sanitisation.sanitize(stripped)
    wrapped_text, token = ms_ocr_sanitisation.wrap_for_prompt(clean_text)
    return clean_text, wrapped_text, token

# ── POST /ocr ─────────────────────────────────────────────────────────────────
# Call 1: OCR the mark scheme, then extract its structure with the LLM.
# Runs once per lesson — the structured result is stored so marking calls
# receive clean JSON rather than raw OCR text on every student submission.
@app.post("/ocr")
async def ocr_file(file: UploadFile = File(...)):
    file_bytes = await file.read()
    raw_text   = extract_text_from_file(file_bytes, file.filename)

    # clean_text (not wrapped_text) is what gets returned/stored — the
    # delimiter markers are a prompt-construction detail for the extraction
    # call only, never part of the mark scheme content itself.
    clean_text, wrapped_text, token = _secure_wrap(raw_text)
    structured_scheme = extract_mark_scheme(wrapped_text, token)

    return {"text": clean_text, "structured_scheme": structured_scheme}

def _question_number_from_scheme(scheme_text: str):
    try:
        parsed = _json.loads(scheme_text)
        return parsed.get("question_number")
    except Exception:
        return None

# ── POST /mark-with-scheme-text ───────────────────────────────────────────────
# Like /mark but accepts the mark scheme as pre-extracted text rather than a
# file — avoids re-OCRing the scheme on every student submission.
@app.post("/mark-with-scheme-text")
async def mark_with_scheme_text(
    student_work: UploadFile = File(...),
    scheme_text:  str        = Form(...),
    question:     str        = Form(default='')
):
    student_bytes = await student_work.read()
    raw_text      = extract_text_from_file(student_bytes, student_work.filename)

    # Post-OCR sanitisation + delimiting for the student's raw OCR text, same
    # as /ocr does for the mark scheme. Only student_work goes through this
    # here — scheme_text and question have already passed through their own
    # sanitisation earlier in the pipeline (scheme_text via /ocr) by the time
    # they reach this endpoint.
    student_text, wrapped_student_text, expected_token = _secure_wrap(raw_text)

    question_number = _question_number_from_scheme(scheme_text)
    exemplars       = get_similar(student_text, question_number, n=3)

    raw = generate_llm_response(
        question=question,
        essay=wrapped_student_text,
        rubric=scheme_text,
        expected_token=expected_token,
        max_score=100,
        exemplars=exemplars or None,
    )

    return {
        "score":                    raw.get("score", 0),
        "maxScore":                 raw.get("maxScore"),
        "strengths":                raw.get("strengths", []),
        "improvements":             raw.get("improvements", []),
        "actionable_steps":         raw.get("actionable_steps", []),
        "student_ocr_text":         student_text,
        "teacher_review_required":  raw.get("teacher_review_required", False),
        "question_mismatch":        raw.get("question_mismatch", False),
        "question_mismatch_reason": raw.get("question_mismatch_reason", None),
        "rubric_breakdown":         raw.get("rubric_breakdown", []),
    }

# ── Bulk helpers ──────────────────────────────────────────────────────────────

def _split_pdf(pdf_bytes: bytes, pages_per_student: int):
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    sections = []
    for start in range(0, len(doc), pages_per_student):
        end = min(start + pages_per_student, len(doc)) - 1
        out = fitz.open()
        out.insert_pdf(doc, from_page=start, to_page=end)
        sections.append(out.tobytes())
        out.close()
    doc.close()
    return sections

def _match_name(text: str, student_names):
    result = process.extractOne(
        text[:400],
        student_names,
        scorer=fuzz.partial_ratio,
        score_cutoff=65,
    )
    if result:
        _, score, idx = result
        return idx, score
    return -1, 0.0

# ── POST /bulk-mark-with-scheme-text ──────────────────────────────────────────
@app.post("/bulk-mark-with-scheme-text")
async def bulk_mark_with_scheme_text(
    pdf_file:          UploadFile = File(...),
    scheme_text:       str        = Form(...),
    question:          str        = Form(default=''),
    pages_per_student: int        = Form(...),
    students:          str        = Form(...),
):
    pdf_bytes     = await pdf_file.read()
    students_list = _json.loads(students)
    student_names = [s['name'] for s in students_list]

    async def generate():
        sections = _split_pdf(pdf_bytes, pages_per_student)
        yield _json.dumps({"type": "split", "total": len(sections)}) + "\n"

        # OCR all sections concurrently
        ocr_results = await asyncio.gather(
            *[asyncio.to_thread(extract_text_from_file, sec, f"student_{i}.pdf")
              for i, sec in enumerate(sections)],
            return_exceptions=True,
        )
        yield _json.dumps({"type": "ocr_complete"}) + "\n"

        for i, text_or_err in enumerate(ocr_results):
            if isinstance(text_or_err, Exception):
                yield _json.dumps({"type": "error", "paper": i + 1, "message": str(text_or_err)}) + "\n"
                continue

            raw_text = text_or_err
            idx, conf = _match_name(raw_text, student_names)
            student = students_list[idx] if idx >= 0 else {"id": None, "name": f"Unmatched paper {i + 1}"}

            try:
                # Same strip -> sanitize -> wrap treatment as the single-student
                # path — every piece of OCR'd text that reaches the LLM goes
                # through the same prompt-injection defense, not just the ones
                # on the more-used endpoint.
                text, wrapped_text, expected_token = _secure_wrap(raw_text)

                question_number = _question_number_from_scheme(scheme_text)
                exemplars       = get_similar(text, question_number, n=3)
                raw = generate_llm_response(
                    question=question, essay=wrapped_text, rubric=scheme_text,
                    expected_token=expected_token,
                    max_score=100, exemplars=exemplars or None,
                )

                yield _json.dumps({
                    "type":                     "result",
                    "student_id":               student["id"],
                    "student_name":             student["name"],
                    "match_confidence":         conf,
                    "score":                    raw.get("score", 0),
                    "maxScore":                 raw.get("maxScore"),
                    "strengths":                raw.get("strengths", []),
                    "improvements":             raw.get("improvements", []),
                    "actionable_steps":         raw.get("actionable_steps", []),
                    "student_ocr_text":         text,
                    "teacher_review_required":  raw.get("teacher_review_required", False),
                    "question_mismatch":        raw.get("question_mismatch", False),
                    "question_mismatch_reason": raw.get("question_mismatch_reason", None),
                    "rubric_breakdown":         raw.get("rubric_breakdown", []),
                }) + "\n"

            except Exception as e:
                yield _json.dumps({
                    "type":         "error",
                    "student_name": student["name"],
                    "message":      str(e),
                }) + "\n"

        yield _json.dumps({"type": "done"}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")

# ── Exemplar management ───────────────────────────────────────────────────────

@app.post("/exemplars")
async def create_exemplar(
    file:            UploadFile = File(...),
    question_number: str        = Form(...),
    score:           int        = Form(...),
    max_marks:       int        = Form(...),
    band:            int        = Form(default=None),
    source:          str        = Form(default=""),
):
    file_bytes  = await file.read()
    essay_text  = extract_text_from_file(file_bytes, file.filename)
    exemplar_id = add_exemplar(
        essay_text=essay_text,
        question_number=question_number,
        score=score,
        max_marks=max_marks,
        band=band,
        source=source,
    )
    return {"id": exemplar_id, "question_number": question_number, "score": score, "max_marks": max_marks}

@app.get("/exemplars")
async def get_exemplars():
    return {"exemplars": list_exemplars()}

@app.delete("/exemplars/{exemplar_id}")
async def remove_exemplar(exemplar_id: int):
    deleted = delete_exemplar(exemplar_id)
    if not deleted:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Exemplar not found")
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)