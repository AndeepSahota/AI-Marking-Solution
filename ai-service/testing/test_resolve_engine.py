import unittest

from specialists.resolve import _teacher_reason, resolve_specialist_final_result

THREADS = {
    "a": {"thread_description": "Ideas, events, themes or settings."},
    "b": {"thread_description": "Judgement about the text."},
}


def specialist_result(**overrides):
    result = {
        "ao": "AO4", "awarded_band": "Level 3", "marks": 8, "max_marks": 15,
        "missing_threads": [], "combine_mode": "calibrated", "runs_per_thread": 6,
        "fine_score": 2.61, "scheme_key": "9e3703bc1e37b448",
        "review_flag": True, "borderline_levels": [3, 4],
        "per_thread": [
            {"thread_key": "a", "descriptor_id": "ao4-3a", "evidence": [
                {"quote": "q1", "explanation": "First step."},
                {"quote": "q2", "explanation": "The student explains how the dark hides the threat. More detail."},
            ]},
            {"thread_key": "b", "descriptor_id": "ao4-1b", "evidence": []},
        ],
    }
    result.update(overrides)
    return result


class EngineBlockTests(unittest.TestCase):
    def test_engine_block_carries_review_and_calibration_fields(self):
        engine = resolve_specialist_final_result(specialist_result(), THREADS)["result"]["engine"]
        self.assertEqual(engine["level"], 3)
        self.assertEqual((engine["mark"], engine["max_mark"]), (8, 15))
        self.assertEqual(engine["borderline_levels"], [3, 4])
        self.assertTrue(engine["borderline"])
        self.assertEqual(engine["fine_score"], 2.61)
        self.assertEqual(engine["scheme_key"], "9e3703bc1e37b448")
        self.assertEqual(engine["runs_per_thread"], 6)

    def test_thread_lines_have_plain_labels_and_no_levels_or_letters(self):
        engine = resolve_specialist_final_result(specialist_result(), THREADS)["result"]["engine"]
        self.assertEqual(engine["threads"][0], {
            "label": "Ideas, events, themes or settings",
            "reason": "The student explains how the dark hides the threat.",
        })
        self.assertEqual(engine["threads"][1]["reason"], "No clear evidence found for this skill.")
        for line in engine["threads"]:
            self.assertEqual(set(line), {"label", "reason"})

    def test_not_borderline_has_no_levels(self):
        engine = resolve_specialist_final_result(
            specialist_result(review_flag=False, borderline_levels=None), THREADS
        )["result"]["engine"]
        self.assertFalse(engine["borderline"])
        self.assertIsNone(engine["borderline_levels"])


class TeacherReasonTests(unittest.TestCase):
    def reason(self, explanation):
        return _teacher_reason({"evidence": [{"quote": "q", "explanation": explanation}]})

    def test_skips_sentences_that_mention_a_level_or_descriptor_id(self):
        self.assertEqual(
            self.reason("This reaches Level 3. ao4-3a is met here. It links the storm to panic."),
            "It links the storm to panic.",
        )

    def test_drops_the_matched_descriptor_phrase(self):
        self.assertEqual(
            self.reason("The quote names the wave (matches: appropriate and relevant)."),
            "The quote names the wave.",
        )

    def test_long_reasons_are_cut_short(self):
        reason = self.reason(" ".join(["word"] * 50) + ".")
        self.assertEqual(len(reason.split()), 30)
        self.assertTrue(reason.endswith("…"))

    def test_falls_back_when_every_sentence_is_internal(self):
        self.assertEqual(self.reason("Meets Level 2."), "Evidence found for this skill.")


if __name__ == "__main__":
    unittest.main()
