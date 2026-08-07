# Central console logging for ai-service — errors and general events, not
# just exceptions. Console-only for now, on purpose: file/remote destinations
# are a planned expansion, not implemented here yet.
#
# Named per-event functions (mirroring backend/src/logging/'s convention —
# logOcrStart, logOcrDone, etc.) rather than one generic log(message) — keeps
# call sites self-documenting and gives a natural place to add structured
# fields later without changing every call site's signature at once.
#
# Uses the real stdlib logging module — this is exactly why the folder is
# called observability and not logging: a local module named logging would
# have shadowed this same import for everything else in ai-service.

import logging
import sys

logger = logging.getLogger("ai-service")
logger.setLevel(logging.INFO)

if not logger.handlers:
    # Explicit stdout — StreamHandler() defaults to stderr, but the print()
    # calls this replaces all went to stdout. Pinned so behavior matches
    # exactly, not just visually.
    _handler = logging.StreamHandler(stream=sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(_handler)
    logger.propagate = False


# ── OCR events ────────────────────────────────────────────────────────────

def log_ocr_sending(filename: str) -> None:
    logger.info(f"[OCR] Sending {filename} to Datalab API...")


def log_ocr_job_submitted() -> None:
    logger.info("[OCR] Job submitted, polling for results...")


def log_ocr_polling(attempt: int, max_attempts: int) -> None:
    logger.info(f"[OCR] Still processing... attempt {attempt}/{max_attempts}")


def log_ocr_done(char_count: int) -> None:
    logger.info(f"[OCR] Done — extracted {char_count} characters")


# ── Security events ───────────────────────────────────────────────────────

def log_security_stripped(matches: list[str]) -> None:
    logger.warning(
        f"[SECURITY] Stripped delimiter-shaped content before it could reach the LLM: {matches}"
    )
