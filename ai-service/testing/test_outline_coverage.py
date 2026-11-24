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

    def test_a_contents_list_is_not_a_heading(self):
        text = "Contents: Question 1, Question 9\n### Question 1\nIdentify a phrase that shows the setting.\n"
        self.assertEqual(possibly_missing(text, [Q1]), [])


if __name__ == "__main__":
    unittest.main()
