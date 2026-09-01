import requests
import os
import time
from html.parser import HTMLParser
from observability.event_log import log_ocr_sending, log_ocr_job_submitted, log_ocr_polling, log_ocr_done

# Starting point only — the only real data point so far is clean typed text
# scoring 0.99-1.0 per word (confirmed via a live Datalab call). No noisy
# handwriting sample has been tested against this yet, so treat it as a
# tunable guess, not a calibrated cutoff.
OCR_LOW_CONFIDENCE_THRESHOLD = 0.75


class _WordConfidenceParser(HTMLParser):
    """Pulls (word, confidence) pairs out of Datalab's word_bboxes HTML, e.g.
    <span data-bbox="88 4 148 26" data-confidence="0.993">GCSE</span>.
    The output is flat — one word per span, no nesting — so tracking just the
    most recently opened span's confidence and pairing it with the next
    data() call is enough; no tag stack needed."""

    def __init__(self):
        super().__init__()
        self.words = []
        self._pending_confidence = None

    def handle_starttag(self, tag, attrs):
        self._pending_confidence = None
        if tag != "span":
            return
        attrs = dict(attrs)
        if "data-confidence" not in attrs:
            return
        try:
            self._pending_confidence = float(attrs["data-confidence"])
        except (TypeError, ValueError):
            self._pending_confidence = None

    def handle_data(self, data):
        if self._pending_confidence is None:
            return
        word = data.strip()
        if word:
            self.words.append((word, self._pending_confidence))
        self._pending_confidence = None


def _extract_low_confidence_words(html: str, threshold: float = OCR_LOW_CONFIDENCE_THRESHOLD) -> list[dict]:
    if not html:
        return []
    parser = _WordConfidenceParser()
    parser.feed(html)
    return [
        {"word": word, "confidence": round(confidence, 3)}
        for word, confidence in parser.words
        if confidence < threshold
    ]


def extract_text_from_file(file_bytes: bytes, filename: str) -> dict:
    """
    Takes raw file bytes and returns extracted text plus any words the OCR
    model wasn't confident it read correctly.
    Uses Datalab Chandra OCR API.

    Returns {"text": <markdown>, "low_confidence_words": [{"word", "confidence"}, ...]}.
    """

    api_key = os.getenv("DATALAB_API_KEY")

    if not api_key:
        raise ValueError("DATALAB_API_KEY not found in environment variables")

    log_ocr_sending(filename)

    # Send the file to Datalab's OCR endpoint
    response = requests.post(
        "https://www.datalab.to/api/v1/marker",
        files={
            "file": (filename, file_bytes, _get_mime_type(filename)),
        },
        data={
            "output_format": "markdown,html",
            "use_llm":       False,
            "word_bboxes":   True,
        },
        headers={"X-Api-Key": api_key},
    )
    
    # Check it worked
    if response.status_code != 200:
        raise Exception(f"Datalab API error: {response.status_code} {response.text}")
    
    data = response.json()
    
    # Datalab returns a request_check_url to poll for results
    # OCR is async — we need to wait for it to finish
    check_url = data.get("request_check_url")
    
    if not check_url:
        raise Exception("No check URL returned from Datalab API")
    
    log_ocr_job_submitted()
    
    # Poll until done
    max_attempts = 20
    for attempt in range(max_attempts):
        time.sleep(2)  # wait 2 seconds between checks
        
        result = requests.get(
            check_url,
            headers={"X-Api-Key": api_key}
        )
        
        result_data = result.json()
        
        if result_data.get("status") == "complete":
            text = result_data.get("markdown", "")
            low_confidence_words = _extract_low_confidence_words(result_data.get("html", ""))
            log_ocr_done(len(text))
            return {"text": text, "low_confidence_words": low_confidence_words}

        log_ocr_polling(attempt + 1, max_attempts)
    
    raise Exception("Datalab OCR timed out after 40 seconds")


def _get_mime_type(filename: str) -> str:
    """Work out the MIME type from the filename."""
    filename_lower = filename.lower()
    if filename_lower.endswith(".pdf"):
        return "application/pdf"
    elif filename_lower.endswith(".png"):
        return "image/png"
    elif filename_lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    else:
        return "application/octet-stream"