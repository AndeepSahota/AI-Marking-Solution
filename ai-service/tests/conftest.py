import os
from types import SimpleNamespace

import pytest

# Import-time safety net: llm_service.py constructs OpenAI(api_key=...) and
# ocr_service.py reads DATALAB_API_KEY at call time — neither validates the
# key eagerly, but setting dummies removes any doubt in a clean CI env.
os.environ.setdefault("OPENAI_API_KEY", "test-dummy-key")
os.environ.setdefault("DATALAB_API_KEY", "test-dummy-key")

import llm_service  # noqa: E402


def fake_marking_result(**overrides):
    """A SimpleNamespace shaped like message.parsed — every field
    MarkingResult requires, plus a working model_dump(exclude=...) so
    _mark_samples' result.model_dump(exclude={"delimiter_token"}) call works
    exactly like it does against a real Structured Outputs response."""
    fields = {
        "max_score_detected": 24,
        "delimiter_token": "tok",
        "strengths": [],
        "improvements": [],
        "actionable_steps": [],
        "rubric_breakdown": [],
        "teacher_review_required": False,
        "question_mismatch": False,
        "question_mismatch_reason": None,
        "answer_excerpt": None,
    }
    fields.update(overrides)

    def model_dump(exclude=None):
        exclude = exclude or set()
        return {k: v for k, v in fields.items() if k not in exclude}

    return SimpleNamespace(**fields, model_dump=model_dump)


def fake_choice(**overrides):
    """One entry of response.choices — a non-refusing message wrapping a
    fake_marking_result."""
    return SimpleNamespace(message=SimpleNamespace(refusal=None, parsed=fake_marking_result(**overrides)))


def fake_openai_response(choices):
    return SimpleNamespace(choices=choices)


@pytest.fixture
def patch_llm_client(monkeypatch):
    """Patches the two things _mark_samples talks to over the network:
    the OpenAI client's .parse() call, and the delimiter-token check. Returns
    a setter the test calls with the choices it wants returned."""
    monkeypatch.setattr(llm_service, "verify_token", lambda expected, actual: None)

    def set_choices(choices):
        monkeypatch.setattr(
            llm_service.client.chat.completions,
            "parse",
            lambda *a, **kw: fake_openai_response(choices),
        )

    return set_choices
