import unittest

import specialists.orchestrate as orchestrate
from specialists.calibration import calibration_for, combine_calibrated, fine_score

BAND_MARKS = [
    {"band": "Level 1", "marks": "1-3"},
    {"band": "Level 2", "marks": "4-6"},
    {"band": "Level 3", "marks": "7-9"},
    {"band": "Level 4", "marks": "10-12"},
    {"band": "Level 5", "marks": "13-15"},
]
CALIBRATION = {"cuts": [2.1667, 2.3889, 2.8333], "near_boundary_margin": 0.1}


def combine(score, thread_levels=(3, 3, 3)):
    return combine_calibrated(list(thread_levels), score, BAND_MARKS, CALIBRATION)


class FineScoreTests(unittest.TestCase):
    def test_averages_every_run_of_every_thread(self):
        threads = [{"sample_levels": [1, 2, 3]}, {"sample_levels": [3, 3, 3]}, {"sample_levels": [2]}]
        self.assertAlmostEqual(fine_score(threads), 17 / 7)


class LevelTests(unittest.TestCase):
    def test_score_is_cut_into_levels_at_the_learned_boundaries(self):
        self.assertEqual(combine(1.5)["overall_level"], 1)
        self.assertEqual(combine(2.3)["overall_level"], 2)
        self.assertEqual(combine(2.5)["overall_level"], 3)
        self.assertEqual(combine(3.0)["overall_level"], 4)

    def test_score_exactly_on_a_boundary_stays_in_the_lower_level(self):
        self.assertEqual(combine(2.1667)["overall_level"], 1)

    def test_level_5_needs_most_threads_at_level_5(self):
        self.assertEqual(combine(4.5, thread_levels=(5, 4, 5))["overall_level"], 5)
        self.assertEqual(combine(4.5, thread_levels=(5, 4, 4))["overall_level"], 4)


class MarkWithinBandTests(unittest.TestCase):
    def test_mark_moves_through_the_band_with_the_score(self):
        self.assertEqual(combine(1.0)["marks"], 1)
        self.assertEqual(combine(2.1)["marks"], 3)
        self.assertEqual(combine(2.4)["marks"], 7)
        self.assertEqual(combine(2.83)["marks"], 9)

    def test_mark_always_stays_inside_its_band(self):
        for score in [x / 100 for x in range(100, 500)]:
            result = combine(score, thread_levels=(5, 5, 5))
            low, high = {1: (1, 3), 2: (4, 6), 3: (7, 9), 4: (10, 12), 5: (13, 15)}[result["overall_level"]]
            self.assertTrue(low <= result["marks"] <= high, (score, result))

    def test_band_label_matches_level(self):
        self.assertEqual(combine(2.5)["band"], "Level 3")


class NearBoundaryTests(unittest.TestCase):
    def test_flags_scores_within_the_margin_of_a_boundary(self):
        self.assertTrue(combine(2.25)["near_boundary"])
        self.assertTrue(combine(2.75)["near_boundary"])

    def test_does_not_flag_scores_well_inside_a_level(self):
        self.assertFalse(combine(1.5)["near_boundary"])
        self.assertFalse(combine(2.6)["near_boundary"])


class CalibrationLookupTests(unittest.TestCase):
    def test_unknown_mark_scheme_has_no_calibration(self):
        ao = {"ao": "AO2", "threads": {"a": {"levels": [{"descriptor_id": "ao2-1a", "text": "Some comment"}]}}}
        self.assertIsNone(calibration_for(ao))


class RunsPerThreadTests(unittest.TestCase):
    AO = {
        "ao": "AO4", "marks_available": 15, "band_marks": BAND_MARKS,
        "threads": {k: {"thread_description": k, "levels": [{"descriptor_id": f"ao4-{n}{k}"} for n in (1, 2, 3)]} for k in "abc"},
    }

    def _run(self, mode, calibration):
        calls = []

        def fake_specialist(**kwargs):
            calls.append(kwargs["n_samples"])
            key = kwargs["thread_description"]
            return {"descriptor_id": f"ao4-3{key}", "evidence": [{"quote": "q", "explanation": "e"}],
                    "sample_levels": [3] * kwargs["n_samples"], "usage": {}}

        saved = (orchestrate._COMBINE_MODE, orchestrate.calibration_for, orchestrate.generate_thread_specialist_response_consistent)
        orchestrate._COMBINE_MODE = mode
        orchestrate.calibration_for = lambda ao: calibration
        orchestrate.generate_thread_specialist_response_consistent = fake_specialist
        try:
            result = orchestrate.mark_ao_with_specialists("q", "essay", self.AO, engine="general")
        finally:
            orchestrate._COMBINE_MODE, orchestrate.calibration_for, orchestrate.generate_thread_specialist_response_consistent = saved
        return calls, result

    def test_calibrated_mode_runs_each_thread_six_times(self):
        calls, result = self._run(orchestrate.COMBINE_CALIBRATED, CALIBRATION)
        self.assertEqual(calls, [6, 6, 6])
        self.assertEqual(result["combine_mode"], "calibrated")

    def test_vote_mode_keeps_three_runs(self):
        calls, result = self._run(orchestrate.COMBINE_VOTE, CALIBRATION)
        self.assertEqual(calls, [3, 3, 3])
        self.assertEqual(result["combine_mode"], "vote")

    def test_calibrated_mode_without_boundaries_falls_back_to_three_runs_and_vote(self):
        calls, result = self._run(orchestrate.COMBINE_CALIBRATED, None)
        self.assertEqual(calls, [3, 3, 3])
        self.assertEqual(result["combine_mode"], "vote")


class SwitchTests(unittest.TestCase):
    def test_default_is_majority_vote(self):
        self.assertEqual(orchestrate.COMBINE_VOTE, "vote")
        if "SPECIALIST_COMBINE" not in __import__("os").environ:
            self.assertEqual(orchestrate._COMBINE_MODE, orchestrate.COMBINE_VOTE)


if __name__ == "__main__":
    unittest.main()
