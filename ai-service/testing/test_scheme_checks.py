"""Mark scheme step checks, on made-up scheme fragments shaped like the real
AQA and Edexcel schemes they were found in (private-diagnostics/
markscheme-generalisation-2026-11-13)."""

import unittest

import validation.descriptor_integrity_validation as integrity
import validation.descriptor_validation as shapes
from llm_service import DescriptorValidationError
from specialists.orchestrate import general_engine_ao
from transformations.segment_transormation import transform_segment_mark_scheme
from validation.band_levels import is_level_scale, is_points_objective, level_number, level_numbers
from validation.scheme_checks import check_questions

integrity.log_descriptor_integrity_comparison = lambda **kwargs: None
shapes.log_descriptor_validation_comparison = lambda **kwargs: None


def scheme(*objectives, number="Question 1"):
    return {"questions": [{"question_number": number, "assessment_objectives": list(objectives)}]}


def objective(ao, *bands):
    return {"ao": ao, "bands": [{"band": label, "marks": marks, "descriptor": text, "descriptors": points}
                                for label, marks, text, points in bands]}


# A matching Level 1 band, so each objective below is a level scale
# (one band alone counts as a points section).
LEVEL_1 = ("Level 1", "1-3", "• Description of ideas.", ["Description of ideas."])


class ContentCheckSpacingTests(unittest.TestCase):
    def test_spacing_dropped_by_ocr_is_not_a_content_change(self):
        result = scheme(objective("AO5", LEVEL_1,
                                  ("Level 4", "19-24",
                                   "Upper Level 4 22-24 marks.Content• Register is convincing•Matched to purpose",
                                   ["Upper Level 4 22-24 marks.", "Content", "Register is convincing", "Matched to purpose"])))
        self.assertEqual(integrity.validate_descriptor_content_integrity(result), [])

    def test_a_changed_word_still_fails(self):
        result = scheme(objective("AO4", LEVEL_1, ("Level 2", "4-6", "• Comment on ideas. • References are valid.",
                                                   ["Comment on ideas.", "References are relevant."])))
        self.assertEqual(len(integrity.validate_descriptor_content_integrity(result)), 1)

    def test_reordered_points_still_fail(self):
        result = scheme(objective("AO4", LEVEL_1, ("Level 2", "4-6", "• Comment on ideas. • References are valid.",
                                                   ["References are valid.", "Comment on ideas."])))
        self.assertEqual(len(integrity.validate_descriptor_content_integrity(result)), 1)


# A levelled AO4-style objective that passes every check.
GOOD = objective("AO4",
                 ("Level 1", "1-3", "• Description of ideas. • References are limited.", ["Description of ideas.", "References are limited."]),
                 ("Level 2", "4-6", "• Comment on ideas. • References are valid.", ["Comment on ideas.", "References are valid."]))
# The same, but the model dropped a point -- fails the content check.
BAD = objective("AO4",
                ("Level 1", "1-3", "• Description of ideas. • References are limited.", ["Description of ideas."]),
                ("Level 2", "4-6", "• Comment on ideas. • References are valid.", ["Comment on ideas.", "References are valid."]))
# A points question the model gave a real AO and a made-up band.
POINTS = objective("AO1", ("General", "2", "Accept one of the following:• several• three (3)", ["Accept one of the following:• several• three (3)"]))


class LevelRuleTests(unittest.TestCase):
    def test_level_labels(self):
        self.assertEqual([level_number(x) for x in ("Level 3", "band 2", "0", " Level 10 ")], [3, 2, 0, 10])
        for label in ("1 mark", "2 marks", "General", "Indicative content", "High performance", "13-16 marks", None):
            self.assertIsNone(level_number(label), label)

    def test_level_scale_needs_two_level_bands(self):
        self.assertTrue(is_level_scale([{"band": "Level 1"}, {"band": "Level 2"}]))
        self.assertFalse(is_level_scale([{"band": "Level 1"}]))
        self.assertFalse(is_level_scale([{"band": "1 mark"}, {"band": "2 marks"}]))

    def test_points_sections_are_recognised_whatever_the_ao(self):
        self.assertTrue(is_points_objective(POINTS))
        self.assertTrue(is_points_objective({"ao": "General", "bands": GOOD["bands"]}))
        self.assertFalse(is_points_objective(GOOD))


# AQA Literature's spelling, punctuation and grammar scale.
SPAG = objective("AO4",
                 ("High performance", "4 marks", "• Spells and punctuates with consistent accuracy.", ["Spells and punctuates with consistent accuracy."]),
                 ("Intermediate performance", "2–3 marks", "• Spells and punctuates with considerable accuracy.", ["Spells and punctuates with considerable accuracy."]),
                 ("Threshold performance", "1 mark", "• Spells and punctuates with reasonable accuracy.", ["Spells and punctuates with reasonable accuracy."]),
                 ("0 marks", "0 marks", "• Nothing to reward.", ["Nothing to reward."]))


class NamedBandTests(unittest.TestCase):
    def test_named_bands_are_numbered_by_marks(self):
        self.assertEqual(level_numbers(SPAG["bands"]), [3, 2, 1, 0])

    def test_level_labels_keep_their_own_numbers(self):
        self.assertEqual(level_numbers([{"band": "Level 2", "marks": "4-6"}, {"band": "Level 1", "marks": "1-3"}]), [2, 1])

    def test_points_rows_are_never_named_levels(self):
        true_false = [{"band": letter, "marks": mark} for letter, mark in (("A", "[T]"), ("B", "[F]"), ("C", "[F]"))]
        self.assertIsNone(level_numbers(true_false))
        self.assertIsNone(level_numbers([{"band": "One mark", "marks": "1"}, {"band": "Two marks", "marks": "2"}]))
        self.assertIsNone(level_numbers([{"band": "Indicative content", "marks": "4"}, {"band": "General", "marks": "1"}]))

    def test_overlapping_mark_ranges_are_not_a_scale(self):
        self.assertIsNone(level_numbers([{"band": "Upper", "marks": "4-8"}, {"band": "Lower", "marks": "1-5"}]))

    def test_named_bands_get_descriptor_ids_and_no_credit_band_gets_no_thread(self):
        result = check_questions(scheme(SPAG))
        bands = result["questions"][0]["assessment_objectives"][0]["bands"]
        self.assertEqual([b["descriptors"][0]["id"] for b in bands], ["ao4-3a", "ao4-2a", "ao4-1a", "ao4-0a"])
        threads = transform_segment_mark_scheme(result)["questions"]["Question 1"]["assessment_objectives"]["AO4"]["threads"]
        self.assertEqual([lv["descriptor_id"] for lv in threads["a"]["levels"]], ["ao4-3a", "ao4-2a", "ao4-1a"])

    def test_level_labelled_ids_are_unchanged(self):
        result = check_questions(scheme(GOOD))
        ids = [d["id"] for b in result["questions"][0]["assessment_objectives"][0]["bands"] for d in b["descriptors"]]
        self.assertEqual(ids, ["ao4-1a", "ao4-1b", "ao4-2a", "ao4-2b"])


class PerQuestionCheckTests(unittest.TestCase):
    def test_points_section_with_a_real_ao_skips_the_descriptor_checks(self):
        result = check_questions(scheme(POINTS))
        self.assertEqual(result["skipped_questions"], [])
        self.assertEqual(len(result["questions"]), 1)

    def test_one_bad_question_is_skipped_and_the_rest_kept(self):
        paper = {"questions": [scheme(GOOD, number="Q4")["questions"][0], scheme(BAD, number="Q5")["questions"][0]]}
        result = check_questions(paper)
        self.assertEqual([q["question_number"] for q in result["questions"]], ["Q4"])
        self.assertEqual(result["skipped_questions"][0]["question_number"], "Q5")
        # The kept question still gets its deterministic descriptor IDs.
        first = result["questions"][0]["assessment_objectives"][0]["bands"][0]["descriptors"][0]
        self.assertEqual(first["id"], "ao4-1a")

    def test_a_different_split_of_the_same_words_is_kept(self):
        # The model attached the heading "Content" to the first point; the
        # parser makes it its own point. Same words, so the question is kept.
        heading = objective("AO5",
                            ("Level 1", "1-6", "Content• Simple register• Limited vocabulary", ["Content Simple register", "Limited vocabulary"]),
                            ("Level 2", "7-12", "Content• Some register• Varied vocabulary", ["Content Some register", "Varied vocabulary"]))
        result = check_questions(scheme(heading))
        self.assertEqual(result["skipped_questions"], [])
        self.assertEqual(len(result["questions"]), 1)

    def test_a_paper_with_no_good_question_is_still_rejected(self):
        with self.assertRaises(Exception):
            check_questions(scheme(BAD))


class RouterLevelRuleTests(unittest.TestCase):
    @staticmethod
    def extraction(bands):
        levels = [{"descriptor_id": f"ao1-{i}a", "band": b, "text": "x"} for i, b in enumerate(bands, 1)]
        return {"assessment_objectives": {"AO1": {"band_marks": [{"band": b, "marks": "1"} for b in bands],
                                                  "threads": {"a": {"levels": levels}}}}}

    def test_mark_rows_never_reach_the_general_engine(self):
        self.assertIsNone(general_engine_ao(self.extraction(["1 mark", "2 marks"])))

    def test_a_level_scale_still_does(self):
        self.assertIsNotNone(general_engine_ao(self.extraction(["Level 1", "Level 2", "Level 3"])))


if __name__ == "__main__":
    unittest.main()
