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

from llm_service import generate_llm_response, generate_llm_response_consistent, extract_mark_scheme #Self consistency mark where the files gets read 3 times 
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

# Pulls a candidate title/heading off the very start of the essay — either a
# markdown-style '# ...' line, or a short standalone first line followed by
# a blank line before the real paragraph starts. Returns (heading, chars_to_
# strip) or (None, 0) if the essay just starts straight into prose, with no
# structurally separate heading to even consider.
def _extract_heading(raw_text: str):
    # OCR isn't perfectly consistent between runs — sometimes the page comes
    # back with one or two blank lines before the real heading, sometimes
    # none. Skip past any of those first, so "first line" means the first
    # line that actually has something on it, not an accidental blank one.
    leading = len(raw_text) - len(raw_text.lstrip("\n\r \t"))
    text = raw_text[leading:]

    first_line, sep, rest = text.partition("\n")
    candidate = first_line.strip()

    if not candidate:
        return None, 0

    if candidate.startswith("#"):
        return candidate.lstrip("#").strip(), leading + len(first_line) + len(sep)

    if len(candidate) <= 150 and rest.startswith("\n"):
        return candidate, leading + len(first_line) + len(sep)

    return None, 0

# Exam scripts often have the question printed on the page above the
# student's own writing — OCR reads both as one continuous block, so the
# question ends up looking like part of the student's response. Two ways to
# catch it, depending what we actually know the real question is:
#
# 1. The teacher typed the question in — search the WHOLE essay for a
#    near-verbatim match wherever it occurs (handles OCR that runs the
#    question straight into the answer with no clean paragraph break, e.g.
#    a handwritten scan).
# 2. No typed question. Only act on a structurally heading-like first line,
#    and only strip it if it closely matches the mark scheme's OWN OCR'd
#    text (mark schemes typically state the question verbatim) — without
#    that confirmation, a heading-like opening line could just as easily be
#    the student's own title (e.g. an article headline, on a "write an
#    article" task), which is genuine, creditable writing, not noise.
#
# 85+ in both cases catches near-verbatim reproduction (including typical
# OCR typos) while leaving a student's own paraphrase or invented title well
# alone — tested against both scenarios before this went in.
def _strip_question_prefix(raw_text: str, question: str, mark_scheme_text: str) -> str:
    if not raw_text:
        return raw_text

    if question:
        match = fuzz.partial_ratio_alignment(question, raw_text)
        if match.score >= 85:
            return (raw_text[:match.dest_start] + raw_text[match.dest_end:]).strip()

    if mark_scheme_text:
        heading, strip_len = _extract_heading(raw_text)
        if heading and fuzz.partial_ratio(heading, mark_scheme_text) >= 85:
            return raw_text[strip_len:].lstrip("\n").strip()

    return raw_text

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

# Pure arithmetic on what extraction just produced — no extra LLM call, no
# re-reading the original document. Catches the model contradicting its own
# output (e.g. total_marks doesn't match what the per-question breakdown sums
# to), which is a genuine signal something in this one extraction went wrong.
# Does NOT catch the model consistently misreading the original mark scheme
# the same way throughout — only a second, independent read of the source
# document could catch that, which this isn't.
def _check_scheme_consistency(structured_scheme: dict) -> list[str]:
    warnings = []
    questions = structured_scheme.get("questions", [])

    question_sum = sum(q.get("marks", 0) for q in questions)
    total_marks  = structured_scheme.get("total_marks", 0)
    if questions and total_marks != question_sum:
        warnings.append(
            f"total_marks ({total_marks}) doesn't match the sum of each question's marks ({question_sum})"
        )

    for q in questions:
        aos = q.get("assessment_objectives", [])
        ao_sum = sum(ao.get("marks_available", 0) for ao in aos)
        q_marks = q.get("marks", 0)
        if aos and q_marks != ao_sum:
            warnings.append(
                f"{q.get('question_number', 'a question')}: marks ({q_marks}) doesn't match the sum of its AOs ({ao_sum})"
            )

    return warnings

# ── POST /ocr ─────────────────────────────────────────────────────────────────
# Call 1: OCR the mark scheme, then extract its structure with the LLM.
# Runs once per lesson — the structured result is stored so marking calls
# receive clean JSON rather than raw OCR text on every student submission.
@app.post("/ocr")
async def ocr_file(file: UploadFile = File(...)):
    file_bytes = await file.read()
    # low_confidence_words discarded here — this is the printed mark scheme,
    # not student handwriting, and OCR misreads are already caught by
    # _check_scheme_consistency below.
    raw_text   = extract_text_from_file(file_bytes, file.filename)["text"]

    # clean_text (not wrapped_text) is what gets returned/stored — the
    # delimiter markers are a prompt-construction detail for the extraction
    # call only, never part of the mark scheme content itself.
    clean_text, wrapped_text, token = _secure_wrap(raw_text)
    structured_scheme  = extract_mark_scheme(wrapped_text, token)
    extraction_warnings = _check_scheme_consistency(structured_scheme)

    return {"text": clean_text, "structured_scheme": structured_scheme, "extraction_warnings": extraction_warnings}

def _question_number_from_scheme(scheme_text: str):
    try:
        parsed = _json.loads(scheme_text)
        return parsed.get("question_number")
    except Exception:
        return None

# Short human label for the segmentation instruction, e.g. "Q2: Ambition theme"
# — just enough for the model to tell selected questions apart, not the full rubric.
def _question_label_from_scheme(scheme_text: str):
    try:
        parsed = _json.loads(scheme_text)
        number      = parsed.get("question_number", "")
        description = parsed.get("description", "")
        return f"{number}: {description}".strip(": ")
    except Exception:
        return "another question"

# ── POST /mark-with-scheme-text ───────────────────────────────────────────────
# Like /mark but accepts the mark scheme as pre-extracted text rather than a
# file — avoids re-OCRing the scheme on every student submission. Accepts a
# LIST of selected questions (usually just one) and marks the essay against
# each in turn — OCR only happens once, up front, no matter how many
# questions are selected, since it's the same essay every time. Streams one
# NDJSON result line per question, same convention /bulk-mark-with-scheme-text
# already uses for one line per student.
@app.post("/mark-with-scheme-text")
async def mark_with_scheme_text(
    student_work:     UploadFile = File(...),
    questions:        str        = Form(...),   # JSON: [{"index": 0, "scheme_text": "..."}, ...]
    question:         str        = Form(default=''),
    mark_scheme_text: str        = Form(default=''),   # raw OCR'd mark scheme, for question-stripping fallback
):
    student_bytes = await student_work.read()
    ocr_result    = extract_text_from_file(student_bytes, student_work.filename)
    low_confidence_words = ocr_result["low_confidence_words"]
    raw_text      = _strip_question_prefix(ocr_result["text"], question, mark_scheme_text)

    # Post-OCR sanitisation + delimiting for the student's raw OCR text, same
    # as /ocr does for the mark scheme. Only student_work goes through this
    # here — each question's scheme_text has already passed through its own
    # sanitisation earlier in the pipeline (via /ocr) by the time it reaches
    # this endpoint. Done once, reused for every question below.
    student_text, wrapped_student_text, expected_token = _secure_wrap(raw_text)

    questions_list = _json.loads(questions)

    async def generate():
        for entry in questions_list:
            idx         = entry["index"]
            scheme_text = entry["scheme_text"]

            question_number = _question_number_from_scheme(scheme_text)
            exemplars       = get_similar(student_text, question_number, n=3)

            # The segmentation instruction only makes sense when there's
            # something to disambiguate from — every OTHER selected question,
            # not this one. Empty list (the ordinary single-question case)
            # means build_user_prompt adds no segmentation instruction at all.
            other_questions = [
                _question_label_from_scheme(other["scheme_text"])
                for other in questions_list if other["index"] != idx
            ]

            try:
                raw = generate_llm_response_consistent(
                    question=question,
                    essay=wrapped_student_text,
                    rubric=scheme_text,
                    expected_token=expected_token,
                    max_score=100,
                    exemplars=exemplars or None,
                    other_questions=other_questions or None,
                )
                yield _json.dumps({
                    "type":                     "result",
                    "question_index":           idx,
                    "score":                    raw.get("score", 0),
                    "maxScore":                 raw.get("maxScore"),
                    "strengths":                raw.get("strengths", []),
                    "improvements":             raw.get("improvements", []),
                    "actionable_steps":         raw.get("actionable_steps", []),
                    "student_ocr_text":         student_text,
                    "teacher_review_required":  raw.get("teacher_review_required", False) or bool(low_confidence_words),
                    "low_confidence_words":     low_confidence_words,
                    "question_mismatch":        raw.get("question_mismatch", False),
                    "question_mismatch_reason": raw.get("question_mismatch_reason", None),
                    "rubric_breakdown":         raw.get("rubric_breakdown", []),
                    "missing_aos":              raw.get("missing_aos", []),
                    "answer_excerpt":           raw.get("answer_excerpt", None),
                    "confidence":               raw.get("confidence"),
                    "score_spread":             raw.get("score_spread"),
                }) + "\n"
            except Exception as e:
                yield _json.dumps({
                    "type":           "error",
                    "question_index": idx,
                    "message":        str(e),
                }) + "\n"

        yield _json.dumps({"type": "done"}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")

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
    mark_scheme_text:  str        = Form(default=''),   # raw OCR'd mark scheme, for question-stripping fallback
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

        for i, ocr_result_or_err in enumerate(ocr_results):
            if isinstance(ocr_result_or_err, Exception):
                yield _json.dumps({"type": "error", "paper": i + 1, "message": str(ocr_result_or_err)}) + "\n"
                continue

            raw_text              = ocr_result_or_err["text"]
            low_confidence_words  = ocr_result_or_err["low_confidence_words"]
            # Name-matching runs on the untouched OCR text — the name may sit
            # above or below the printed question, so stripping first could
            # only hurt that match, never help it.
            idx, conf = _match_name(raw_text, student_names)
            student = students_list[idx] if idx >= 0 else {"id": None, "name": f"Unmatched paper {i + 1}"}

            try:
                raw_text = _strip_question_prefix(raw_text, question, mark_scheme_text)
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
                    "teacher_review_required":  raw.get("teacher_review_required", False) or bool(low_confidence_words),
                    "low_confidence_words":     low_confidence_words,
                    "question_mismatch":        raw.get("question_mismatch", False),
                    "question_mismatch_reason": raw.get("question_mismatch_reason", None),
                    "rubric_breakdown":         raw.get("rubric_breakdown", []),
                    "missing_aos":              raw.get("missing_aos", []),
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
    # low_confidence_words discarded — this is a teacher-curated reference
    # answer, not live student work being marked.
    essay_text  = extract_text_from_file(file_bytes, file.filename)["text"]
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