import unittest

from specialists.combine import vote_levels
from specialists.quote_match import closest_text, find_quote
from specialists.steps import resolve_level_from_steps

ESSAY = (
    "The quotation \"without any warning\" is especially effective. Furthermore, "
    "the quotation “struck the port side” is especially effective in creating "
    "fear using a violent verb. Yusuf’s arm feels  \"numb\".\nThe sea poured in."
)


class FindQuoteTests(unittest.TestCase):
    def test_exact_quote_passes(self):
        self.assertEqual(find_quote("using a violent verb", ESSAY), "using a violent verb")

    def test_capital_letter_slip_passes_and_returns_essay_text(self):
        quote = 'The quotation "struck the port side" is especially effective'
        self.assertEqual(
            find_quote(quote, ESSAY),
            "the quotation “struck the port side” is especially effective",
        )

    def test_extra_or_different_spaces_pass(self):
        self.assertIsNotNone(find_quote('arm feels "numb". The   sea', ESSAY))

    def test_curly_and_straight_apostrophes_pass(self):
        self.assertIsNotNone(find_quote("Yusuf's arm feels", ESSAY))

    def test_punctuation_at_start_and_end_is_ignored(self):
        self.assertIsNotNone(find_quote('"struck the port side."', ESSAY))
        self.assertIsNotNone(find_quote("...without any warning", ESSAY))

    def test_changed_word_fails(self):
        self.assertIsNone(find_quote("struck the left side", ESSAY))

    def test_added_word_fails(self):
        self.assertIsNone(find_quote("struck the port side of the boat", ESSAY))

    def test_missing_word_fails(self):
        self.assertIsNone(find_quote("using a verb", ESSAY))

    def test_empty_or_punctuation_only_quote_fails(self):
        self.assertIsNone(find_quote(None, ESSAY))
        self.assertIsNone(find_quote("", ESSAY))
        self.assertIsNone(find_quote('".', ESSAY))


class ClosestTextTests(unittest.TestCase):
    def test_reports_the_real_sentence_for_a_near_miss(self):
        text, similarity = closest_text("struck the left side", ESSAY)
        self.assertIn("struck the port side", text)
        self.assertGreater(similarity, 0.7)


class ResolveWithForgivingQuotesTests(unittest.TestCase):
    LEVELS = [{"descriptor_id": "ao4-1c"}, {"descriptor_id": "ao4-2c"}]

    def _steps(self, second_quote):
        return [
            {"from_descriptor_id": None, "to_descriptor_id": "ao4-1c", "quote": "without any warning", "explanation": "e"},
            {"from_descriptor_id": "ao4-1c", "to_descriptor_id": "ao4-2c", "quote": second_quote, "explanation": "e"},
        ]

    def test_capital_letter_slip_no_longer_stops_the_climb(self):
        result = resolve_level_from_steps(
            self._steps('The quotation "struck the port side"'), self.LEVELS, ESSAY
        )
        self.assertEqual(result["descriptor_id"], "ao4-2c")
        evidence = result["evidence"][1]["quote"]
        self.assertIn(evidence, ESSAY)  # the student's own text, verbatim
        self.assertIn("struck the port side", evidence)

    def test_invented_quote_still_stops_the_climb_and_logs_closest_text(self):
        result = resolve_level_from_steps(self._steps("struck the left side"), self.LEVELS, ESSAY)
        self.assertEqual(result["descriptor_id"], "ao4-1c")
        self.assertIn("closest essay text", result["reasoning"])


class VoteLevelsTests(unittest.TestCase):
    def test_three_way_split_without_holistic_takes_the_middle(self):
        self.assertEqual(vote_levels([5, 3, 1]), (3, "middle"))

    def test_two_way_tie_without_holistic_takes_the_lower(self):
        self.assertEqual(vote_levels([1, 3]), (1, "lower"))

    def test_holistic_still_breaks_ties_when_present(self):
        self.assertEqual(vote_levels([5, 3, 1], holistic_level=5), (5, "holistic"))

    def test_majority_is_unchanged(self):
        self.assertEqual(vote_levels([2, 2, 4]), (2, None))


if __name__ == "__main__":
    unittest.main()
