import threading
import time
import unittest

import httpx

from openai_gate import GatedTransport, RateBudget, parse_reset
from security import ms_ocr_sanitisation
from specialists.consistency import call_with_fresh_token


def headers(remaining_tokens=400_000, reset_tokens="0s", remaining_requests=4_000, reset_requests="12ms"):
    return {
        "x-ratelimit-limit-tokens": "450000", "x-ratelimit-remaining-tokens": str(remaining_tokens),
        "x-ratelimit-reset-tokens": reset_tokens,
        "x-ratelimit-limit-requests": "5000", "x-ratelimit-remaining-requests": str(remaining_requests),
        "x-ratelimit-reset-requests": reset_requests,
    }


class FakeClock:
    def __init__(self):
        self.now, self.slept = 100.0, []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(round(seconds, 3))
        self.now += seconds


def request():
    return httpx.Request("POST", "https://api.openai.com/v1/chat/completions")


class ParseResetTests(unittest.TestCase):
    def test_openai_duration_formats(self):
        self.assertEqual(parse_reset("12ms"), 0.012)
        self.assertEqual(parse_reset("1.5s"), 1.5)
        self.assertEqual(parse_reset("6m0s"), 360.0)
        self.assertEqual(parse_reset("1h2m3s"), 3723.0)

    def test_unreadable_values(self):
        for value in (None, "", "soon", "5x"):
            self.assertIsNone(parse_reset(value), value)


class RateBudgetTests(unittest.TestCase):
    def test_waits_only_when_the_account_is_nearly_out(self):
        budget = RateBudget(low_share=0.1)
        budget.note(headers(remaining_tokens=400_000, reset_tokens="8s"), now=0.0)
        self.assertEqual(budget.wait_seconds(0.0), 0.0)
        budget.note(headers(remaining_tokens=30_000, reset_tokens="8s"), now=0.0)
        self.assertEqual(budget.wait_seconds(0.0), 8.0)
        self.assertEqual(budget.wait_seconds(8.0), 0.0)

    def test_requests_counter_counts_too_and_waits_are_capped(self):
        budget = RateBudget(low_share=0.1)
        budget.note(headers(remaining_requests=100, reset_requests="1m0s"), now=0.0)
        self.assertEqual(budget.wait_seconds(0.0), 20.0)  # re-checked after each wait

    def test_missing_headers_are_ignored(self):
        budget = RateBudget()
        budget.note({}, now=0.0)
        self.assertEqual(budget.wait_seconds(0.0), 0.0)


class GatedTransportTests(unittest.TestCase):
    def test_caps_requests_in_flight(self):
        in_flight, peak, lock = [0], [0], threading.Lock()

        def handler(_):
            with lock:
                in_flight[0] += 1
                peak[0] = max(peak[0], in_flight[0])
            time.sleep(0.05)
            with lock:
                in_flight[0] -= 1
            return httpx.Response(200, headers=headers())

        gate = GatedTransport(httpx.MockTransport(handler), max_in_flight=3)
        threads = [threading.Thread(target=gate.handle_request, args=(request(),)) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(peak[0], 3)

    def test_paces_after_a_low_budget_response(self):
        clock = FakeClock()
        replies = iter([headers(remaining_tokens=20_000, reset_tokens="6s"), headers()])
        gate = GatedTransport(httpx.MockTransport(lambda _: httpx.Response(200, headers=next(replies))),
                              clock=clock, sleep=clock.sleep)
        gate.handle_request(request())   # reports the account nearly out
        self.assertEqual(clock.slept, [])
        gate.handle_request(request())   # waits for the reset first
        self.assertEqual(clock.slept, [6.0])

    def test_two_processes_both_slow_down_from_the_shared_counters(self):
        # Separate gates (as in separate processes) share nothing in memory,
        # but OpenAI reports the same account-wide counters to both.
        clock = FakeClock()
        gates = [GatedTransport(httpx.MockTransport(lambda _: httpx.Response(200, headers=headers(remaining_tokens=10_000, reset_tokens="3s"))),
                                clock=clock, sleep=clock.sleep) for _ in range(2)]
        for gate in gates:
            gate.handle_request(request())
        for gate in gates:
            self.assertGreater(gate.budget.wait_seconds(clock()), 0)


class FreshTokenRetryTests(unittest.TestCase):
    def test_one_miscopied_token_is_retried_with_a_fresh_token(self):
        tokens = []

        def call(wrapped, token):
            tokens.append(token)
            self.assertIn(token, wrapped)
            if len(tokens) == 1:
                ms_ocr_sanitisation.verify_token(token, token[:-4])  # a dropped-characters copy
            return "result"

        self.assertEqual(call_with_fresh_token("An essay.", call), "result")
        self.assertEqual(len(tokens), 2)
        self.assertNotEqual(tokens[0], tokens[1])

    def test_a_token_still_wrong_after_the_retries_fails_as_before(self):
        attempts = []

        def call(wrapped, token):
            attempts.append(token)
            ms_ocr_sanitisation.verify_token(token, "wrong")

        with self.assertRaises(ms_ocr_sanitisation.TokenMismatchError):
            call_with_fresh_token("An essay.", call)
        self.assertEqual(len(attempts), 3)

    def test_other_errors_are_not_retried(self):
        attempts = []

        def call(wrapped, token):
            attempts.append(token)
            raise ValueError("bad response")

        with self.assertRaises(ValueError):
            call_with_fresh_token("An essay.", call)
        self.assertEqual(len(attempts), 1)


if __name__ == "__main__":
    unittest.main()
