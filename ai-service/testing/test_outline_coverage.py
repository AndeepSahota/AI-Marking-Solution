import unittest

from validation.outline_coverage import possibly_missing

# Made-up schemes in the layouts seen on real papers.
LANGUAGE = """Contents: Question 1, Question 2, Section B
### Question 1 (1 Mark)
Identify a phrase that shows the setting.
### Question 2 (2 Marks)
Give two examples of how the writer builds tension.
### Section B: Transactional Writing
| Level 1 | 1-4 | Communication is simple |
"""
# AQA prints an objectives summary for both sections before any question.
SUMMARY_FIRST = """## SECTION A: READING - Assessment Objectives
AO1 identify and interpret.
## SECTION B: WRITING - Assessment Objectives
AO5 communicate clearly.
**0 1** Read again the first part of the source.
**0 5** A magazine has asked for contributions.
"""


def item(number, start, description="d"):
    return {"question_number": number, "printed_number": number, "description": description, "section_start": start}


Q1 = item("Question 1", "Identify a phrase that shows the setting")
Q2 = item("Question 2", "Give two examples of how the writer builds tension")


class OutlineCoverageTests(unittest.TestCase):
    def test_a_section_with_no_listed_question_is_flagged(self):
        missing = possibly_missing(LANGUAGE, [Q1, Q2])
        self.assertEqual([m["name"] for m in missing], ["Section B"])

    def test_a_question_named_after_the_section_covers_it(self):
        writing = item("Section B: Transactional Writing", "Level 1 | 1-4 | Communication is simple")
        self.assertEqual(possibly_missing(LANGUAGE, [Q1, Q2, writing]), [])

    def test_a_summary_of_both_sections_before_the_questions_is_not_a_gap(self):
        items = [item("01", "Read again the first part of the source"), item("05", "A magazine has asked for contributions")]
        self.assertEqual(possibly_missing(SUMMARY_FIRST, items), [])

    def test_no_section_warning_when_a_start_cannot_be_placed(self):
        lost = item("Question 2", "words that are not in the scheme at all")
        self.assertEqual(possibly_missing(LANGUAGE, [Q1, lost]), [])

    def test_a_printed_question_number_not_in_the_outline_is_flagged(self):
        missing = possibly_missing(LANGUAGE, [Q1, item("Section B", "Level 1 | 1-4 | Communication is simple")])
        self.assertEqual([m["name"] for m in missing], ["Question 2"])

    def test_a_missing_sub_question_is_flagged_but_a_parent_heading_is_covered(self):
        text = "#### Question 27\n#### Question 27.1\nIn Scaffolding...\n#### Question 27.2\nIn both poems...\n"
        items = [item("27.1", "In Scaffolding x"), item("27.2", "In both poems x")]
        self.assertEqual(possibly_missing(text, items[:1] + [item("26", "zzzzzzzzzz")]), [
            {"name": "Question 27.2", "reason": "Question 27.2 is printed in the mark scheme but was not found"}])
        self.assertEqual(possibly_missing(text, items), [])

    def test_questions_in_the_marks_table_count_including_ranges(self):
        text = "| Question 1 | 2 | 2 |\n| Question 7-9 | 16 | 40 |\n| Question 10 or 11 | 40 |\n"
        listed = [item(n, "zzzzzzzzzz") for n in ("1", "7", "8", "9", "10")]
        self.assertEqual([m["name"] for m in possibly_missing(text, listed)], ["Question 11"])

    def test_a_contents_list_is_not_a_heading(self):
        text = "Contents: Question 1, Question 9\n### Question 1\nIdentify a phrase that shows the setting.\n"
        self.assertEqual(possibly_missing(text, [Q1]), [])


if __name__ == "__main__":
    unittest.main()
