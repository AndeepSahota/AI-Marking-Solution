from model.ocr import run_ocr
from llm_service import generate_llm_response

def run_marking(student_bytes: bytes, scheme_bytes: bytes) -> dict:
    # Step 1 — OCR extracts text from both uploaded files
    student_result = run_ocr(student_bytes)
    scheme_result = run_ocr(scheme_bytes)

    student_text = student_result["text"]
    scheme_text = scheme_result["text"]

    # Step 2 — LLM marks the extracted text against the scheme
    llm_result = generate_llm_response(
        question="GCSE English Essay",
        essay=student_text,
        rubric=scheme_text,
        max_score=25
    )

    # Step 3 — return structured result to the frontend
    return {
        "score":    llm_result.get("score"),
        "maxScore": 25,
        "feedback": llm_result,
        "_ocr_stages": {
            "studentWork": student_result["stages"],
            "markScheme":  scheme_result["stages"],
        },
        "_ocr_meta": {
            "studentWork": student_result["meta"],
            "markScheme":  scheme_result["meta"],
        }
    }