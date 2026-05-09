from model.ocr import run_ocr


def run_marking(student_bytes: bytes, _scheme_bytes: bytes) -> dict:
    student_result = run_ocr(student_bytes)

    return {
        "score": 18,
        "maxScore": 25,
        "percentage": 72,
        "breakdown": [
            {"section": "Question 1", "marks": 8, "maxMarks": 10},
            {"section": "Question 2", "marks": 10, "maxMarks": 15},
        ],
        "feedback": student_result["text"],
        "_ocr_stages": {
            "studentWork": student_result["stages"],
        },
        "_ocr_meta": {
            "studentWork": student_result["meta"],
        },
    }
