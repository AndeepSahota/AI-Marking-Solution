import os
import time

import filetype as ft
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from azure.identity import DefaultAzureCredential

# ── Azure AI Document Intelligence client — created lazily and reused ──────────
_client = None


def _get_client() -> DocumentIntelligenceClient:
    global _client
    if _client is None:
        endpoint = os.getenv("AZURE_DOCINTEL_ENDPOINT") or ""
        key = os.getenv("AZURE_DOCINTEL_KEY")
        if key:
            # Local dev: authenticate with the resource key from local.env.
            credential = AzureKeyCredential(key)
        else:
            # Production: no key — authenticate via managed identity (Entra ID).
            # DefaultAzureCredential also works locally via `az login` / VS Code sign-in.
            credential = DefaultAzureCredential()
        _client = DocumentIntelligenceClient(endpoint=endpoint, credential=credential)
    return _client


def run_ocr(file_bytes: bytes) -> dict:
    """
    Run OCR on file bytes using Document Intelligence's "prebuilt-read" model.
    Returns the exact shape the backend already consumes:
      text   — full text (pages joined)
      stages — timing entries for the flow panel
      meta   — file type, page count, per-page dims and char counts

    Document Intelligence takes the raw PDF/image and handles multi-page itself, so
    there is no rasterising, flattening, or downscaling — we send the bytes once and
    map the returned pages into our contract.
    """
    stages = []
    page_metas = []
    pages = []

    kind = ft.guess(file_bytes)
    is_pdf = kind and kind.extension == "pdf"
    file_type = "pdf" if is_pdf else "image"
    print(f"[OCR] File type: {file_type} ({len(file_bytes)} bytes)")

    # One call analyses the whole document (PDF or image).
    t = time.time()
    poller = _get_client().begin_analyze_document(
        "prebuilt-read",
        body=file_bytes,
        content_type="application/octet-stream",
    )
    result = poller.result()
    analyze_ms = _ms(t)

    doc_pages = result.pages or []
    page_count = len(doc_pages)
    # One network call covers all pages, so split its duration evenly across the
    # per-page stages the flow panel expects.
    per_page_ms = analyze_ms // max(page_count, 1)
    print(f"[OCR] Analysed {page_count} page(s) in {analyze_ms} ms")

    for page in doc_pages:
        lines = page.lines or []
        page_text = "\n".join(line.content for line in lines)
        char_count = len(page_text)
        print(f"[OCR] Page {page.page_number} → {char_count} chars")

        pages.append(page_text)
        stages.append({"label": f"OCR page {page.page_number} of {page_count}", "ms": per_page_ms})
        page_metas.append({
            "index":           page.page_number,
            "original_width":  page.width,
            "original_height": page.height,
            "model_width":     page.width,
            "model_height":    page.height,
            "downscaled":      False,
            "char_count":      char_count,
            "ms":              per_page_ms,
        })

    t2 = time.time()
    text = "\n\n---\n\n".join(pages)
    stages.append({"label": "Assembled text output", "ms": _ms(t2)})

    total_chars = sum(p["char_count"] for p in page_metas)
    print(f"[OCR] Done — {page_count} page(s), {total_chars} total chars")

    return {
        "text":   text,
        "stages": stages,
        "meta": {
            "file_type":   file_type,
            "page_count":  page_count,
            "total_chars": total_chars,
            "pages":       page_metas,
        },
    }


def _ms(start: float) -> int:
    return int((time.time() - start) * 1000)
