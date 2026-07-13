import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ocr_service import extract_text_from_file
from llm_service import generate_llm_response


def run_marking(student_bytes: bytes, scheme_bytes: bytes) -> dict:
    student_text = extract_text_from_file(student_bytes, "student.pdf")
    scheme_text  = extract_text_from_file(scheme_bytes,  "scheme.pdf")

    llm_result = generate_llm_response(
        question="GCSE English Essay",
        essay=student_text,
        rubric=scheme_text,
        max_score=25
    )

    return {
        "score":    llm_result.get("score"),
        "maxScore": llm_result.get("maxScore", 25),
        "feedback": llm_result,
    }
