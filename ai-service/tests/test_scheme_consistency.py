from main import _check_scheme_consistency


def test_consistent_scheme_returns_no_warnings():
    scheme = {
        "total_marks": 40,
        "questions": [
            {
                "question_number": "Q1",
                "marks": 20,
                "assessment_objectives": [
                    {"ao": "AO1", "marks_available": 10},
                    {"ao": "AO2", "marks_available": 10},
                ],
            },
            {
                "question_number": "Q2",
                "marks": 20,
                "assessment_objectives": [
                    {"ao": "AO1", "marks_available": 20},
                ],
            },
        ],
    }
    assert _check_scheme_consistency(scheme) == []


def test_bad_total_marks_returns_warning_with_both_numbers():
    scheme = {
        "total_marks": 40,
        "questions": [
            {
                "question_number": "Q1",
                "marks": 24,
                "assessment_objectives": [{"ao": "AO1", "marks_available": 24}],
            },
        ],
    }
    warnings = _check_scheme_consistency(scheme)
    assert len(warnings) == 1
    assert "40" in warnings[0] and "24" in warnings[0]


def test_bad_question_ao_sum_returns_warning_naming_question():
    scheme = {
        "total_marks": 24,
        "questions": [
            {
                "question_number": "Q4",
                "marks": 24,
                "assessment_objectives": [
                    {"ao": "AO1", "marks_available": 8},
                    {"ao": "AO2", "marks_available": 8},
                    {"ao": "AO3", "marks_available": 4},
                ],
            },
        ],
    }
    warnings = _check_scheme_consistency(scheme)
    assert len(warnings) == 1
    assert "Q4" in warnings[0] and "24" in warnings[0] and "20" in warnings[0]


def test_single_question_consistent_scheme_returns_no_warnings():
    scheme = {
        "total_marks": 10,
        "questions": [
            {
                "question_number": "Q1",
                "marks": 10,
                "assessment_objectives": [{"ao": "General", "marks_available": 10}],
            },
        ],
    }
    assert _check_scheme_consistency(scheme) == []
