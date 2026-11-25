import unittest
from unittest import mock

import scheme_extraction
from specialists import orchestrate
from specialists.combine import mark_for_level
from specialists.parts import holistic_level_for, question_parts
from specialists.resolve import resolve_parts_final_result
from specialists.thread_tidy import is_heading_thread, merge_threads, repair_groups, strip_glued_heading, tidy_threads
from validation.ao_names import fix_ao_names
from validation.band_levels import level_number


def thread(ao, letter, texts, description="Skill"):
    return {"thread_description": description, "levels": [
        {"descriptor_id": f"{ao.lower()}-{n}{letter}", "band": f"Level {n}", "text": text}
        for n, text in enumerate(texts, 1)]}


def objective(ao, grid, letters="ab"):
    bands = [{"band": f"Level {n}", "marks": f"{low}-{high}"} for n, (low, high) in enumerate(grid, 1)]
    return {"marks_available": grid[-1][1], "band_marks": bands,
            "threads": {l: thread(ao, l, [f"{ao} {l} level {n}" for n in range(1, len(grid) + 1)]) for l in letters}}


WRITING = {"marks_available": 40, "assessment_objectives": {
    "AO5": objective("AO5", [(1, 6), (7, 12), (13, 18), (19, 24)]),
    "AO6": objective("AO6", [(1, 4), (5, 8), (9, 12), (13, 16)])}}
LIT_GRID = [(1, 5), (6, 10), (11, 15), (16, 20), (21, 25), (26, 30)]
AQA_LIT = {"marks_available": 30, "assessment_objectives": {
    "AO1": objective("AO1", LIT_GRID), "AO2": objective("AO2", LIT_GRID), "AO3": objective("AO3", LIT_GRID, "a")}}


class AoNameTests(unittest.TestCase):
    def names(self, *aos):
        question = {"assessment_objectives": [{"ao": ao, "bands": []} for ao in aos]}
        return [o["ao"] for o in fix_ao_names(question)["assessment_objectives"]]

    def test_a_zero_for_the_letter_o_is_repaired(self):
        self.assertEqual(self.names("A05", "A06"), ["AO5", "AO6"])

    def test_a_combined_label_takes_the_objective_not_already_used(self):
        self.assertEqual(self.names("AO5/AO6", "AO6"), ["AO5", "AO6"])

    def test_an_ambiguous_combined_label_is_left_alone(self):
        self.assertEqual(self.names("AO5/AO6"), ["AO5/AO6"])
        self.assertEqual(self.names("AO4"), ["AO4"])


class LevelLabelTests(unittest.TestCase):
    def test_labels(self):
        cases = {"Level 3": 3, "Band 2": 2, "0": 0, "Level 6Convincing, critical analysis26–30 marks": 6,
                 "Level 4 (16-20 marks)": 4, "1 mark": None, "Level 1-2": None, "High performance": None}
        for label, expected in cases.items():
            self.assertEqual(level_number(label), expected, label)

    def test_named_bands_get_their_mark_by_level(self):
        bands = [{"band": "Threshold performance", "marks": "1"}, {"band": "Intermediate performance", "marks": "2-3"},
                 {"band": "High performance", "marks": "4"}]
        self.assertEqual(mark_for_level(2, bands), {"band": "Intermediate performance", "marks": 2})


class ThreadTidyTests(unittest.TestCase):
    def test_a_heading_only_thread_is_recognised(self):
        self.assertTrue(is_heading_thread(thread("AO5", "a", ["Content"] * 4)))
        self.assertFalse(is_heading_thread(thread("AO5", "b", ["Communicates simply", "Communication is clear"])))

    def test_a_heading_glued_onto_every_level_is_stripped(self):
        glued = thread("AO5", "d", ["Simple vocabulary; simple linguistic devicesOrganisation",
                                     "Conscious use of vocabulary with some linguistic devicesOrganisation"])
        self.assertEqual([l["text"] for l in strip_glued_heading(glued)["levels"]],
                         ["Simple vocabulary; simple linguistic devices", "Conscious use of vocabulary with some linguistic devices"])
        one_only = thread("AO5", "d", ["Uses devicesOrganisation", "Uses devices well"])
        self.assertIs(strip_glued_heading(one_only), one_only)

    def test_merged_threads_keep_each_members_wording_level_by_level(self):
        threads = {"a": thread("AO6", "a", ["Occasional demarcation", "Mostly secure demarcation"], "Demarcation."),
                   "b": thread("AO6", "b", ["Some punctuation", "Range of punctuation"], "Punctuation.")}
        key, merged = merge_threads(threads, ["a", "b"])
        self.assertEqual(key, "a+b")
        self.assertEqual(merged["thread_description"], "Demarcation; Punctuation")
        self.assertEqual([(l["descriptor_id"], l["text"]) for l in merged["levels"]],
                         [("ao6-1a", "Occasional demarcation; Some punctuation"), ("ao6-2a", "Mostly secure demarcation; Range of punctuation")])

    def test_groups_are_repaired_without_inventing_anything(self):
        keys = list("bcdefg")
        self.assertEqual(repair_groups([["b", "c"], ["d", "e"], ["f", "g"], ["e"]], keys, 4), [["b", "c"], ["d", "e"], ["f", "g"]])
        self.assertEqual(repair_groups([["b", "c"], ["d"]], keys, 4), None, "e, f, g alone would make 5 groups")

    def test_tidy_uses_valid_groups_and_ignores_broken_ones(self):
        ao = objective("AO6", [(1, 4), (5, 8)], "abc")
        self.assertEqual(sorted(tidy_threads({**ao, "thread_groups": [["a", "b"], ["c"]]})), ["a+b", "c"])
        self.assertEqual(sorted(tidy_threads({**ao, "thread_groups": [["a", "b"]]})), ["a", "b", "c"])


class PartsTests(unittest.TestCase):
    def test_writing_is_two_parts_one_per_objective(self):
        parts = question_parts(WRITING)
        self.assertEqual([(p["ao"], p["marks_available"]) for p in parts], [("AO5", 24), ("AO6", 16)])
        self.assertEqual(sorted(parts[0]["threads"]), ["AO5:a", "AO5:b"])

    def test_a_grid_shared_by_three_objectives_is_one_part(self):
        parts = question_parts(AQA_LIT)
        self.assertEqual([(p["ao"], p["marks_available"]) for p in parts], [("AO1+AO2+AO3", 30)])
        self.assertEqual(len(parts[0]["threads"]), 5)

    def test_identical_grids_marked_separately_when_the_marks_say_so(self):
        grid = [(1, 4), (5, 8), (9, 12), (13, 16), (17, 20)]
        question = {"marks_available": 40, "assessment_objectives": {"AO1": objective("AO1", grid), "AO2": objective("AO2", grid)}}
        self.assertEqual([p["ao"] for p in question_parts(question)], ["AO1", "AO2"])

    def test_a_spelling_grid_left_out_of_the_marks_is_still_a_part(self):
        grid = [(1, 6), (7, 12), (13, 18), (19, 24), (25, 32)]
        question = {"marks_available": 32, "assessment_objectives": {
            "AO1": objective("AO1", grid), "AO3": objective("AO3", grid), "AO4": objective("AO4", [(1, 2), (3, 5), (6, 8)])}}
        self.assertEqual([(p["ao"], p["marks_available"]) for p in question_parts(question)], [("AO1+AO3", 32), ("AO4", 8)])

    def test_unclear_questions_stay_on_the_old_pipeline(self):
        self.assertIsNone(question_parts({**WRITING, "marks_available": 37}))
        self.assertIsNone(question_parts({**WRITING, "marks_available": "value not found"}))
        self.assertIsNone(question_parts({"marks_available": 15, "assessment_objectives": {"AO4": objective("AO4", [(1, 5), (6, 10)])}}))
        broken = {**WRITING, "assessment_objectives": {**WRITING["assessment_objectives"], "AO6": {**objective("AO6", [(1, 4), (5, 8)]), "threads": {}}}}
        self.assertIsNone(question_parts(broken))

    def test_holistic_level_is_read_per_part(self):
        parts = question_parts(WRITING)
        rows = [{"criterion": "AO5 Content and organisation", "awarded_band": "Level 3"}, {"criterion": "AO6", "awarded_band": "Level 2"}]
        self.assertEqual([holistic_level_for(p, rows) for p in parts], [3, 2])
        self.assertIsNone(holistic_level_for(parts[0], []))


def engine_result(part, level, marks, review=False):
    key = next(iter(part["threads"]))
    return {"ao": part["ao"], "level": level, "awarded_band": f"Level {level}", "marks": marks, "max_marks": part["marks_available"],
            "missing_threads": [], "review_flag": review, "runs_per_thread": 3,
            "per_thread": [{"thread_key": key, "descriptor_id": part["threads"][key]["levels"][level - 1]["descriptor_id"],
                            "evidence": [{"quote": "a quote", "explanation": "why"}]}]}


class PartsResultTests(unittest.TestCase):
    def test_marks_add_up_and_each_part_has_a_row(self):
        parts = question_parts(WRITING)
        final = resolve_parts_final_result([engine_result(parts[0], 3, 15), engine_result(parts[1], 2, 6, review=True)], parts)
        result = final["result"]
        self.assertEqual((result["score"], result["max_score"]), (21, 40))
        self.assertEqual([(r["section"], r["marks"], r["max_marks"]) for r in result["breakdown"]], [("AO5", 15, 24), ("AO6", 6, 16)])
        self.assertTrue(result["teacher_review_required"])
        self.assertTrue(result["engine"]["borderline"])
        self.assertIsNone(result["engine"]["level"])
        self.assertEqual(len({e["evidence_id"] for e in result["evidence"]}), 2)

    def test_parts_are_marked_together_with_their_own_tie_breaker(self):
        parts = question_parts(WRITING)
        calls = []
        def fake(question, essay, part, level, examples):
            calls.append((part["ao"], level, examples))
            return {"ao": part["ao"]}
        with mock.patch.object(orchestrate, "_mark_ao_general", fake):
            results = orchestrate.mark_question_parts("Q", "essay", parts, [3, None])
        self.assertEqual([r["ao"] for r in results], ["AO5", "AO6"])
        self.assertEqual(sorted(calls), [("AO5", 3, None), ("AO6", None, None)])


class ThreadGroupStepTests(unittest.TestCase):
    def test_only_multi_objective_questions_with_many_threads_are_grouped(self):
        many = objective("AO5", [(1, 6), (7, 12)], "abcdef")
        few = objective("AO6", [(1, 4), (5, 8)], "ab")
        questions = {"05": {"assessment_objectives": {"AO5": many, "AO6": few}},
                     "04": {"assessment_objectives": {"AO4": objective("AO4", [(1, 5), (6, 10)], "abcdef")}}}
        asked = []
        def group(text, token):
            asked.append(text)
            return [["a", "b"], ["c", "d"], ["e"], ["f"], ["a"]]
        with mock.patch.object(scheme_extraction, "generate_thread_grouping_response", group):
            scheme_extraction._add_thread_groups(questions)
        self.assertEqual(len(asked), 1, "one call: AO5 of the two-objective question")
        self.assertEqual(questions["05"]["assessment_objectives"]["AO5"]["thread_groups"], [["a", "b"], ["c", "d"], ["e"], ["f"]])
        self.assertNotIn("thread_groups", questions["05"]["assessment_objectives"]["AO6"])
        self.assertNotIn("thread_groups", questions["04"]["assessment_objectives"]["AO4"])


if __name__ == "__main__":
    unittest.main()
