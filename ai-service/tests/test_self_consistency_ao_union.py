import json

from llm_service import generate_llm_response_consistent
from conftest import fake_choice


def crit(name, score, max_marks=8):
    return {
        "criterion": name, "score_awarded": score, "max_marks": max_marks, "reason": "r",
        "evidence": [{"quote": "q", "comment": "c", "type": "strength", "marks_impact": 1, "how_to_improve": None}],
    }


SCHEME_2AO = json.dumps({
    "question_number": "Q1",
    "marks": 16,
    "assessment_objectives": [
        {"ao": "AO1", "marks_available": 8},
        {"ao": "AO2", "marks_available": 8},
    ],
})


def test_missing_ao_from_non_representative_sample_still_surfaces_in_final_result(patch_llm_client):
    # Sample 1 (score 3): missing AO2. Sample 2 (score 10, the median -> the
    # representative): complete. Sample 3 (score 14): complete. If the union
    # logic weren't there, the representative's own missing_aos ([]) would
    # win and sample 1's real drop would be silently lost.
    choices = [
        fake_choice(max_score_detected=16, rubric_breakdown=[crit("AO1", 3)]),
        fake_choice(max_score_detected=16, rubric_breakdown=[crit("AO1", 5), crit("AO2", 5)]),
        fake_choice(max_score_detected=16, rubric_breakdown=[crit("AO1", 7), crit("AO2", 7)]),
    ]
    patch_llm_client(choices)
    rep = generate_llm_response_consistent("Q", "E", SCHEME_2AO, "tok", max_score=16, n_samples=3)
    assert rep["missing_aos"] == ["AO2"]
    assert rep["teacher_review_required"] is True
