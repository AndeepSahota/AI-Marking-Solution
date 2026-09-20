import unittest

from pydantic import ValidationError

from aggregation.aggregation_prompt import (
    SYSTEM_PROMPT,
    _select_extracted_result,
    build_aggregation_user_prompt,
)
from schemas.aggregation_schema import AggregationResult


class AggregationPromptTests(unittest.TestCase):
    def test_system_prompt_classifies_the_complete_response_by_span(self):
        self.assertIn("COMPLETE-RESPONSE EVIDENCE CLASSIFICATION", SYSTEM_PROMPT)
        self.assertIn("EVIDENCE CLASSIFICATION FRAMEWORK", SYSTEM_PROMPT)
        self.assertIn(
            "Before classifying any evidence, read every supplied thread_description",
            SYSTEM_PROMPT,
        )
        self.assertLess(
            SYSTEM_PROMPT.index("Before classifying any evidence"),
            SYSTEM_PROMPT.index("CLASSIFICATION RULES"),
        )
        self.assertIn("A span qualifies as evidence when:", SYSTEM_PROMPT)
        self.assertIn("Use the ASSESSMENT FOCUS descriptions", SYSTEM_PROMPT)
        self.assertNotIn("Use the QUESTION", SYSTEM_PROMPT)
        self.assertIn(
            "This does not mean that every thread must receive evidence",
            SYSTEM_PROMPT,
        )
        self.assertIn("Evaluate every paragraph,\n   sentence and distinct statement", SYSTEM_PROMPT)
        self.assertIn("A new paragraph is\n   always a boundary", SYSTEM_PROMPT)
        self.assertIn("a visual line wrap alone is not necessarily a boundary", SYSTEM_PROMPT)
        self.assertIn("different parts of one sentence demonstrate different capabilities", SYSTEM_PROMPT)
        self.assertIn("same source words genuinely demonstrate multiple descriptors", SYSTEM_PROMPT)
        self.assertIn("Never join evidence across sentence or paragraph boundaries", SYSTEM_PROMPT)
        self.assertIn("7. Return every genuine match in source order", SYSTEM_PROMPT)
        self.assertIn("Do not rank, cap, or replace matches", SYSTEM_PROMPT)
        self.assertIn("Leave any writing unclassified", SYSTEM_PROMPT)
        self.assertNotIn("no more than ten", SYSTEM_PROMPT.lower())
        self.assertIn(
            "the characters immediately after\n"
            "MARK_SCHEME_OCR_ (or END_MARK_SCHEME_OCR_)",
            SYSTEM_PROMPT,
        )
        self.assertIn("return `descriptor_ids` as a non-empty list", SYSTEM_PROMPT)
        self.assertIn("A single quotation may demonstrate\nmultiple descriptors", SYSTEM_PROMPT)
        self.assertIn("a level below, within,\n   or above the holistic awarded band", SYSTEM_PROMPT)
        self.assertIn("You may choose descriptor\nIDs from any level", SYSTEM_PROMPT)
        self.assertIn(
            "does not recalculate\n"
            "   or replace the whole-response band",
            SYSTEM_PROMPT,
        )
        self.assertIn("EVIDENCE QUOTE FIDELITY", SYSTEM_PROMPT)
        self.assertIn("spelling and grammatical mistakes", SYSTEM_PROMPT)
        self.assertIn("`~~` markers", SYSTEM_PROMPT)
        self.assertIn("exact substring of the delimited STUDENT RESPONSE", SYSTEM_PROMPT)
        self.assertIn("may begin or end anywhere within a sentence", SYSTEM_PROMPT)
        self.assertIn("Never return `was met with nothing.`", SYSTEM_PROMPT)
        self.assertIn("CLASSIFICATION COMPLETENESS CHECK", SYSTEM_PROMPT)
        self.assertIn("add any missed\nmatch", SYSTEM_PROMPT)
        self.assertIn("Never invent a descriptor match", SYSTEM_PROMPT)
        self.assertNotIn("WHOLE-RESPONSE COVERAGE PASS", SYSTEM_PROMPT)
        self.assertNotIn("JUSTIFICATION", SYSTEM_PROMPT)
        self.assertNotIn("`explanation`", SYSTEM_PROMPT)
        self.assertNotIn("SEGMENTED RESULT", SYSTEM_PROMPT)

    def test_user_prompt_requests_all_qualifying_spans_without_segmentation(self):
        prompt = build_aggregation_user_prompt(
            assessment_focus=[
                "Evaluate texts critically and support this with appropriate references."
            ],
            student_response="<<<MARK_SCHEME_OCR_test>>>Student text<<<END_MARK_SCHEME_OCR_test>>>",
            extracted_result={"score": 5, "maxScore": 15, "rubric_breakdown": []},
            mark_scheme_extraction={"next_band": "Level 3"},
        )

        self.assertIn("STUDENT RESPONSE", prompt)
        self.assertIn("Student text", prompt)
        self.assertIn("ASSESSMENT FOCUS", prompt)
        self.assertIn(
            "Evaluate texts critically and support this with appropriate references.",
            prompt,
        )
        self.assertNotIn("QUESTION:", prompt)
        self.assertIn("crossed-out notation preserved", prompt)
        self.assertIn("within one sentence or distinct statement", prompt)
        self.assertIn("no boundary punctuation added", prompt)
        self.assertIn("Classify the complete student response in source order", prompt)
        self.assertIn("Do not limit the\nnumber of evidence items", prompt)
        self.assertIn("classification completeness check", prompt)
        self.assertIn('"descriptor_ids"', prompt)
        self.assertNotIn('"explanation"', prompt)
        self.assertIn("any level", prompt)
        self.assertIn("Do not limit the\nnumber of evidence items or alter the fixed holistic score or band", prompt)
        self.assertNotIn("up to ten", prompt.lower())
        self.assertNotIn("SEGMENTED RESULT", prompt)

    def test_aggregation_schema_accepts_more_than_ten_items_without_explanations(self):
        evidence = [
            {
                "quote": f"Quote {index}",
                "descriptor_ids": ["ao4-3a"],
            }
            for index in range(12)
        ]

        result = AggregationResult.model_validate({
            "delimiter_token": "test",
            "evidence": evidence,
        })

        self.assertEqual(len(result.evidence), 12)
        self.assertNotIn("explanation", result.evidence[0].model_dump())

    def test_aggregation_schema_rejects_obsolete_explanations(self):
        with self.assertRaises(ValidationError):
            AggregationResult.model_validate({
                "delimiter_token": "test",
                "evidence": [{
                    "quote": "Student quotation",
                    "descriptor_ids": ["ao4-3a"],
                    "explanation": "Obsolete field",
                }],
            })

    def test_aggregation_schema_requires_descriptor_ids_for_each_quote(self):
        with self.assertRaises(ValidationError):
            AggregationResult.model_validate({
                "delimiter_token": "test",
                "evidence": [{
                    "quote": "Student quotation",
                }],
            })

    def test_aggregation_schema_allows_multiple_descriptors_for_one_quote(self):
        result = AggregationResult.model_validate({
            "delimiter_token": "test",
            "evidence": [{
                "quote": "The quotation and the student's opinion.",
                "descriptor_ids": ["ao4-2b", "ao4-2c"],
            }],
        })

        self.assertEqual(
            result.evidence[0].descriptor_ids,
            ["ao4-2b", "ao4-2c"],
        )

    def test_aggregation_schema_does_not_cap_descriptors_per_quote(self):
        descriptor_ids = [f"ao4-{level}a" for level in range(25)]
        result = AggregationResult.model_validate({
            "delimiter_token": "test",
            "evidence": [{
                "quote": "Student quotation",
                "descriptor_ids": descriptor_ids,
            }],
        })

        self.assertEqual(result.evidence[0].descriptor_ids, descriptor_ids)

    def test_extracted_result_is_reduced_to_mark_summary(self):
        extracted_result = {
            "score": 8,
            "maxScore": 15,
            "rubric_breakdown": [
                {
                    "criterion": "AO4",
                    "awarded_band": "Level 3",
                    "score_awarded": 8,
                    "max_marks": 15,
                    "reason": "This must not be included.",
                    "evidence_supporting_awarded_band": [],
                }
            ],
            "actionable_steps": ["This must not be included."],
        }

        selected = _select_extracted_result(extracted_result)

        self.assertEqual(selected, {
            "score": 8,
            "maxScore": 15,
            "percentage": 53,
            "breakdown": [
                {
                    "section": "AO4",
                    "awardedBand": "Level 3",
                    "marks": 8,
                    "maxMarks": 15,
                }
            ],
        })


if __name__ == "__main__":
    unittest.main()
