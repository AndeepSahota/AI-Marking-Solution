import json

from llm_service import _mark_samples
from conftest import fake_choice


def crit(name, score=5, max_marks=8):
    return {
        "criterion": name, "score_awarded": score, "max_marks": max_marks, "reason": "r",
        "evidence": [{"quote": "q", "comment": "c", "type": "strength", "marks_impact": 1, "how_to_improve": None}],
    }


SCHEME_3AO = json.dumps({
    "question_number": "Q4",
    "marks": 24,
    "assessment_objectives": [
        {"ao": "AO1", "marks_available": 8},
        {"ao": "AO2", "marks_available": 8},
        {"ao": "AO3", "marks_available": 8},
    ],
})


def test_missing_ao_detected_and_forces_review(patch_llm_client):
    patch_llm_client([fake_choice(max_score_detected=24, rubric_breakdown=[crit("AO1"), crit("AO2")])])
    results, _ = _mark_samples("Q", "E", SCHEME_3AO, "tok", 24, None, 0.0, 1)
    assert results[0]["missing_aos"] == ["AO3"]
    assert results[0]["teacher_review_required"] is True


def test_whitespace_and_casing_noise_still_matches_normalize_ao(patch_llm_client):
    breakdown = [crit(" ao1 "), crit("AO2"), crit("ao3")]
    patch_llm_client([fake_choice(max_score_detected=24, rubric_breakdown=breakdown)])
    results, _ = _mark_samples("Q", "E", SCHEME_3AO, "tok", 24, None, 0.0, 1)
    assert results[0]["missing_aos"] == []


def test_general_placeholder_scheme_skips_ao_check(patch_llm_client):
    scheme = json.dumps({
        "question_number": "Q1",
        "marks": 10,
        "assessment_objectives": [{"ao": "General", "marks_available": 10}],
    })
    patch_llm_client([fake_choice(max_score_detected=10, rubric_breakdown=[crit("Content and Organisation", 6, 10)])])
    results, _ = _mark_samples("Q", "E", scheme, "tok", 10, None, 0.0, 1)
    assert results[0]["missing_aos"] == []


def test_notfound_sentinel_marks_value_does_not_crash_ao_check_still_runs(patch_llm_client):
    scheme = json.dumps({
        "question_number": "Q1",
        "marks": "value not found",
        "assessment_objectives": [
            {"ao": "AO1", "marks_available": 8},
            {"ao": "AO2", "marks_available": 8},
        ],
    })
    patch_llm_client([fake_choice(max_score_detected=16, rubric_breakdown=[crit("AO1"), crit("AO2")])])
    results, _ = _mark_samples("Q", "E", scheme, "tok", 16, None, 0.0, 1)
    assert results[0]["missing_aos"] == []
