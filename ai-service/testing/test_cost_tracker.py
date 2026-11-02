import os
import unittest

import httpx

from llm_service import _record_usage
from observability import cost_tracker


class CostTrackerTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop("DATALAB_COST_PER_PAGE_USD", None)
        cost_tracker.start()

    def test_prices_gpt4o_with_cached_tokens_at_half_rate(self):
        cost_tracker.set_stage("holistic")
        cost_tracker.record_openai("gpt-4o-2024-08-06", prompt_tokens=1_000_000, cached_tokens=400_000, completion_tokens=100_000)
        stage = cost_tracker.summary()["by_stage"]["holistic"]
        # 600k uncached x $2.50 + 400k cached x $1.25 + 100k output x $10
        self.assertAlmostEqual(stage["cost_usd"], 1.50 + 0.50 + 1.00)

    def test_mini_is_not_priced_as_full_gpt4o(self):
        cost_tracker.record_openai("gpt-4o-mini-2024-07-18", 1_000_000, 0, 0)
        self.assertAlmostEqual(cost_tracker.summary()["openai_usd"], 0.15)

    def test_costs_are_split_by_stage(self):
        cost_tracker.set_stage("holistic")
        cost_tracker.record_openai("gpt-4o", 1000, 0, 100)
        cost_tracker.set_stage("specialists")
        cost_tracker.record_openai("gpt-4o", 1000, 0, 100)
        cost_tracker.record_openai("gpt-4o", 1000, 0, 100)
        result = cost_tracker.summary()
        self.assertEqual(result["by_stage"]["holistic"]["calls"], 1)
        self.assertEqual(result["by_stage"]["specialists"]["calls"], 2)

    def test_unknown_model_is_flagged_not_guessed(self):
        cost_tracker.record_openai("gpt-6-luna", 1000, 0, 100)
        result = cost_tracker.summary()
        self.assertEqual(result["unpriced_models"], ["gpt-6-luna"])
        self.assertFalse(result["total_is_complete"])

    def test_ocr_priced_at_the_list_price_unless_overridden(self):
        cost_tracker.record_datalab(2)
        result = cost_tracker.summary()
        self.assertAlmostEqual(result["datalab_usd"], 0.03)
        self.assertTrue(result["total_is_complete"])
        self.assertIn("$0.0300 (2 page(s))", cost_tracker.log_line(result))
        os.environ["DATALAB_COST_PER_PAGE_USD"] = "0.01"
        self.assertAlmostEqual(cost_tracker.summary()["datalab_usd"], 0.02)
        os.environ["DATALAB_COST_PER_PAGE_USD"] = "not a number"
        self.assertAlmostEqual(cost_tracker.summary()["datalab_usd"], 0.03)
        os.environ.pop("DATALAB_COST_PER_PAGE_USD")

    def test_nothing_recorded_outside_a_marking_request(self):
        cost_tracker._current.set(None)
        cost_tracker.record_openai("gpt-4o", 1000, 0, 100)
        self.assertIsNone(cost_tracker.summary())


class ResponseHookTests(unittest.TestCase):
    def setUp(self):
        cost_tracker.start()

    def test_hook_reads_usage_from_an_openai_response(self):
        response = httpx.Response(200, json={
            "model": "gpt-4o-2024-08-06",
            "usage": {"prompt_tokens": 2000, "completion_tokens": 300, "prompt_tokens_details": {"cached_tokens": 1024}},
        })
        _record_usage(response)
        stage = cost_tracker.summary()["by_stage"]["other"]
        self.assertEqual((stage["prompt_tokens"], stage["cached_tokens"], stage["completion_tokens"]), (2000, 1024, 300))

    def test_hook_never_raises_on_odd_responses(self):
        _record_usage(httpx.Response(200, content=b"not json"))
        _record_usage(httpx.Response(500, json={"error": "x"}))
        self.assertEqual(cost_tracker.summary()["by_stage"], {})


if __name__ == "__main__":
    unittest.main()
