import unittest
from unittest import mock

import scheme_extraction
from llm_service import ExtractionIncompleteError, ExtractionTruncatedError
from security import ms_ocr_sanitisation


def question(number):
    return {"question_number": "model's own label", "marks": 8, "description": "d", "question_text": "value not found",
            "assessment_objectives": [], "band_constraints": []}


class ExtractByQuestionTests(unittest.TestCase):
    def run_with(self, outline_items, fail_on=()):
        tokens = []

        def outline(text, token):
            tokens.append(token)
            return {"total_marks": 80, "questions": outline_items}

        def one(text, token, number, marks, description, all_numbers):
            tokens.append(token)
            self.assertIn(token, text)
            if number in fail_on:
                raise ExtractionTruncatedError("too long")
            return question(number)

        with mock.patch.object(scheme_extraction, "extract_question_outline", outline), \
             mock.patch.object(scheme_extraction, "extract_mark_scheme_question", one):
            return scheme_extraction.extract_mark_scheme_by_question("A mark scheme."), tokens

    def test_every_outline_question_is_extracted_with_its_outline_number(self):
        items = [{"question_number": n, "marks": 8, "description": "d"} for n in ("01", "02", "05")]
        result, tokens = self.run_with(items)
        self.assertEqual([q["question_number"] for q in result["questions"]], ["01", "02", "05"])
        self.assertEqual(result["paper_type"], "multi")
        self.assertEqual(result["skipped_questions"], [])
        self.assertEqual(len(set(tokens)), 4, "a fresh token for the outline and every question")

    def test_repeated_numbers_are_made_unique(self):
        items = [{"question_number": "Section A", "marks": m, "description": "d"} for m in (4, 8, 12)]
        result, _ = self.run_with(items)
        self.assertEqual([q["question_number"] for q in result["questions"]],
                         ["Section A", "Section A (2)", "Section A (3)"])

    def test_a_question_that_fails_is_skipped_not_the_paper(self):
        items = [{"question_number": n, "marks": 8, "description": "d"} for n in ("1a", "1b")]
        result, _ = self.run_with(items, fail_on=("1b",))
        self.assertEqual([q["question_number"] for q in result["questions"]], ["1a"])
        self.assertEqual(result["skipped_questions"][0]["question_number"], "1b")

    def test_no_questions_is_an_error(self):
        with self.assertRaises(ExtractionIncompleteError):
            self.run_with([])
        with self.assertRaises(ExtractionIncompleteError):
            self.run_with([{"question_number": "1", "marks": 8, "description": "d"}], fail_on=("1",))


def levelled(points_level_1):
    return {"question_number": "x", "marks": 6, "description": "d", "question_text": "value not found", "band_constraints": [],
            "assessment_objectives": [{"ao": "AO4", "bands": [
                {"band": "Level 1", "marks": "1-3", "descriptor": "• Description of ideas.", "descriptors": points_level_1},
                {"band": "Level 2", "marks": "4-6", "descriptor": "• Comment on ideas.", "descriptors": ["Comment on ideas."]}]}]}


class RetryTests(unittest.TestCase):
    def run_with(self, attempts_by_number):
        calls = {}

        def outline(text, token):
            return {"total_marks": 30, "questions": [{"question_number": n, "marks": 6, "description": "d"} for n in attempts_by_number]}

        def one(text, token, number, marks, description, all_numbers):
            calls[number] = calls.get(number, 0) + 1
            good = attempts_by_number[number][calls[number] - 1]
            return levelled(["Description of ideas."] if good else ["Something else entirely."])

        with mock.patch.object(scheme_extraction, "extract_question_outline", outline), \
             mock.patch.object(scheme_extraction, "extract_mark_scheme_question", one):
            return scheme_extraction.extract_checked_scheme("A mark scheme."), calls

    def test_a_question_that_fails_the_content_check_is_extracted_once_more(self):
        result, calls = self.run_with({"Q1": [True], "Q2": [False, True], "Q3": [False, False]})
        self.assertEqual([q["question_number"] for q in result["questions"]], ["Q1", "Q2"])
        self.assertEqual([s["question_number"] for s in result["skipped_questions"]], ["Q3"])
        self.assertEqual(calls, {"Q1": 1, "Q2": 2, "Q3": 2})
        self.assertNotIn("outline_questions", result)

    def test_nothing_passing_even_after_the_retry_is_still_an_error(self):
        with self.assertRaises(Exception):
            self.run_with({"Q1": [False, False]})


class ThreadsByQuestionTests(unittest.TestCase):
    def test_results_are_merged_and_a_failed_question_is_left_out(self):
        def describe(text, token):
            if '"Q2"' in text:
                raise ms_ocr_sanitisation.TokenMismatchError("bad copy")
            key = "Q1" if '"Q1"' in text else "Q3"
            return {"questions": {key: {"assessment_objectives": {}}}}

        with mock.patch.object(scheme_extraction, "generate_thread_description_response", describe):
            merged = scheme_extraction.describe_threads_by_question(
                {"questions": {"Q1": {}, "Q2": {}, "Q3": {}}})
        self.assertEqual(sorted(merged["questions"]), ["Q1", "Q3"])


if __name__ == "__main__":
    unittest.main()
