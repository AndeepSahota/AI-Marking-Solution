import json

from llm_service import _mark_samples
from conftest import fake_choice

SCHEME = json.dumps({
    "question_number": "Q4",
    "marks": 24,
    "assessment_objectives": [{"ao": "AO1", "marks_available": 24}],
})

BREAKDOWN = [{
    "criterion": "AO1", "score_awarded": 18, "max_marks": 24, "reason": "r",
    "evidence": [{"quote": "q", "comment": "c", "type": "strength", "marks_impact": 1, "how_to_improve": None}],
}]


def test_extracted_marks_mismatch_forces_teacher_review(patch_llm_client):
    patch_llm_client([fake_choice(max_score_detected=40, rubric_breakdown=BREAKDOWN)])
    results, _ = _mark_samples("Q", "E", SCHEME, "tok", 24, None, 0.0, 1)
    assert results[0]["teacher_review_required"] is True


def test_extracted_marks_match_does_not_force_review(patch_llm_client):
    patch_llm_client([fake_choice(max_score_detected=24, rubric_breakdown=BREAKDOWN)])
    results, _ = _mark_samples("Q", "E", SCHEME, "tok", 24, None, 0.0, 1)
    assert results[0]["teacher_review_required"] is False


def test_invalid_json_rubric_does_not_crash_no_false_positive(patch_llm_client):
    patch_llm_client([fake_choice(max_score_detected=24, rubric_breakdown=BREAKDOWN)])
    results, _ = _mark_samples("Q", "E", "not valid json", "tok", 24, None, 0.0, 1)
    assert results[0]["teacher_review_required"] is False
