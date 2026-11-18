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
            levelled = {"assessment_objectives": {"AO4": {"threads": {"a": {"levels": []}}}}}
            merged = scheme_extraction.describe_threads_by_question(
                {"questions": {"Q1": levelled, "Q2": levelled, "Q3": levelled}})
        self.assertEqual(sorted(merged["questions"]), ["Q1", "Q3"])


def graded(top_by_ao):
    return {"question_number": "x", "marks": 20, "description": "d", "question_text": "value not found", "band_constraints": [],
            "assessment_objectives": [{"ao": ao, "marks_available": top, "bands": [
                {"band": "Level 1", "marks": f"1-{top // 2}", "descriptor": "• Basic.", "descriptors": ["Basic."]},
                {"band": "Level 2", "marks": f"{top // 2 + 1}-{top}", "descriptor": "• Clear.", "descriptors": ["Clear."]}]}
                for ao, top in top_by_ao]}


class WrongQuestionGuardTests(unittest.TestCase):
    def run_with(self, attempts):
        calls = []

        def outline(text, token):
            return {"total_marks": 20, "questions": [{"question_number": "04", "marks": 20, "description": "evaluate"}]}

        def one(text, token, number, marks, description, all_numbers):
            calls.append(number)
            return attempts[len(calls) - 1]

        with mock.patch.object(scheme_extraction, "extract_question_outline", outline), \
             mock.patch.object(scheme_extraction, "extract_mark_scheme_question", one):
            return scheme_extraction.extract_mark_scheme_by_question("A mark scheme."), calls

    def test_another_questions_grid_is_retried_then_skipped(self):
        writing = graded([("AO5", 24), ("AO6", 16)])  # 40 marks for a 20-mark question
        with self.assertRaises(ExtractionIncompleteError):
            self.run_with([writing, writing])

    def test_a_right_second_attempt_is_kept(self):
        result, calls = self.run_with([graded([("AO5", 24), ("AO6", 16)]), graded([("AO4", 20)])])
        self.assertEqual(len(calls), 2)
        self.assertEqual(result["questions"][0]["assessment_objectives"][0]["ao"], "AO4")

    def test_a_shared_grid_repeated_under_two_aos_is_not_a_mismatch(self):
        result, calls = self.run_with([graded([("AO1", 20), ("AO3", 20)])])
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(result["questions"]), 1)

    def test_the_skip_reason_says_why(self):
        writing = graded([("AO5", 24), ("AO6", 16)])
        ok = graded([("AO4", 20)])
        def outline(text, token):
            return {"total_marks": 40, "questions": [{"question_number": n, "marks": 20, "description": "d"} for n in ("03", "04")]}
        answers = {"03": [ok], "04": [writing, writing]}
        def one(text, token, number, marks, description, all_numbers):
            return answers[number].pop(0)
        with mock.patch.object(scheme_extraction, "extract_question_outline", outline), \
             mock.patch.object(scheme_extraction, "extract_mark_scheme_question", one):
            result = scheme_extraction.extract_mark_scheme_by_question("A mark scheme.")
        self.assertEqual(result["skipped_questions"][0]["question_number"], "04")
        self.assertIn("may belong to another question", result["skipped_questions"][0]["reason"])


# A made-up long paper: contents list, three questions, one shared grid.
CONTENTS = "Contents: Question 1a Macbeth, Question 1b Macbeth, Question 2a Othello.\n"
Q1A = "**Question 1a** Macbeth indicative content. " + "Ambition and guilt are explored. " * 20
Q1B = "**Question 1b** Macbeth wider play. " + "Kingship across the play. " * 20
Q2A = "**Question 2a** Othello indicative content. " + "Jealousy and trust are explored. " * 20
GRID = "| Levels grid for all part (a) questions | Level 1 | 1-4 | simple comments |" + " Level detail." * 20
PAPER = CONTENTS + Q1A + Q1B + Q2A + GRID
ITEMS = [{"question_number": "1a", "section_start": "Question 1a Macbeth indicative content"},
         {"question_number": "1b", "section_start": "Question 1b Macbeth wider play"},
         {"question_number": "2a", "section_start": "Question 2a Othello indicative content"}]
SHARED = [{"title": "Levels grid", "section_start": "Levels grid for all part (a) questions"}]


class SectionTests(unittest.TestCase):
    def long_paper(self, *args):
        with mock.patch.object(scheme_extraction, "_LONG_PAPER", 100):
            return scheme_extraction.question_texts(*args)

    def test_each_question_sees_its_own_section_plus_the_shared_grid(self):
        texts = self.long_paper(PAPER, ITEMS, SHARED)
        self.assertIn("Ambition and guilt", texts["1a"])
        self.assertNotIn("Kingship across", texts["1a"])
        self.assertNotIn("Jealousy", texts["1a"])
        self.assertIn("Levels grid for all part (a) questions", texts["1a"])
        self.assertIn("Jealousy", texts["2a"])
        self.assertTrue(all(len(t) < len(PAPER) for t in texts.values()))

    def test_the_contents_list_is_passed_over(self):
        texts = self.long_paper(PAPER, ITEMS, SHARED)
        self.assertFalse(texts["1a"].startswith("Contents"))
        self.assertNotIn("Contents:", texts["1b"])

    def test_a_start_that_cannot_be_found_falls_back_to_the_whole_text(self):
        items = ITEMS[:2] + [{"question_number": "2a", "section_start": "Question 2a Hamlet madness"}]
        texts = self.long_paper(PAPER, items, SHARED)
        self.assertEqual(texts["2a"], PAPER)
        self.assertNotEqual(texts["1a"], PAPER)

    def test_a_short_paper_keeps_the_whole_text(self):
        texts = scheme_extraction.question_texts(PAPER, ITEMS, SHARED)
        self.assertTrue(all(t == PAPER for t in texts.values()))


class NoThreadsTests(unittest.TestCase):
    def test_points_questions_skip_the_thread_split_call(self):
        calls = []

        def describe(text, token):
            calls.append(text)
            return {"questions": {"Q2": {"marks_available": 8, "assessment_objectives": {"AO2": {"threads": {"a": {"thread_description": "x"}}}}}}}

        points = {"marks_available": 2, "assessment_objectives": {"AO1": {"marks_available": 2, "band_marks": [{"band": "General", "marks": "2"}], "threads": {}}}}
        levelled = {"marks_available": 8, "assessment_objectives": {"AO2": {"threads": {"a": {"levels": []}}}}}
        with mock.patch.object(scheme_extraction, "generate_thread_description_response", describe):
            merged = scheme_extraction.describe_threads_by_question({"questions": {"Q1": points, "Q2": levelled}})
        self.assertEqual(len(calls), 1)
        self.assertNotIn('"Q1"', calls[0])
        self.assertEqual(list(merged["questions"]), ["Q1", "Q2"])
        self.assertEqual(merged["questions"]["Q1"], points)


if __name__ == "__main__":
    unittest.main()
