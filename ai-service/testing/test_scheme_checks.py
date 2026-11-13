"""Mark scheme step checks, on made-up scheme fragments shaped like the real
AQA and Edexcel schemes they were found in (private-diagnostics/
markscheme-generalisation-2026-11-13)."""

import unittest

import validation.descriptor_integrity_validation as integrity

integrity.log_descriptor_integrity_comparison = lambda **kwargs: None


def scheme(*objectives, number="Question 1"):
    return {"questions": [{"question_number": number, "assessment_objectives": list(objectives)}]}


def objective(ao, *bands):
    return {"ao": ao, "bands": [{"band": label, "marks": marks, "descriptor": text, "descriptors": points}
                                for label, marks, text, points in bands]}


class ContentCheckSpacingTests(unittest.TestCase):
    def test_spacing_dropped_by_ocr_is_not_a_content_change(self):
        result = scheme(objective("AO5", ("Level 4", "19-24",
                                          "Upper Level 4 22-24 marks.Content• Register is convincing•Matched to purpose",
                                          ["Upper Level 4 22-24 marks.", "Content", "Register is convincing", "Matched to purpose"])))
        self.assertEqual(integrity.validate_descriptor_content_integrity(result), [])

    def test_a_changed_word_still_fails(self):
        result = scheme(objective("AO4", ("Level 2", "4-6", "• Comment on ideas. • References are valid.",
                                          ["Comment on ideas.", "References are relevant."])))
        self.assertEqual(len(integrity.validate_descriptor_content_integrity(result)), 1)

    def test_reordered_points_still_fail(self):
        result = scheme(objective("AO4", ("Level 2", "4-6", "• Comment on ideas. • References are valid.",
                                          ["References are valid.", "Comment on ideas."])))
        self.assertEqual(len(integrity.validate_descriptor_content_integrity(result)), 1)


if __name__ == "__main__":
    unittest.main()
