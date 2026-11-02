import threading
import time
import unittest

from observability import cost_tracker
from specialists import parallel
from specialists.parallel import run_calls, run_each


class ParallelTests(unittest.TestCase):
    def test_results_keep_their_order(self):
        def slow(value, delay):
            return lambda: (time.sleep(delay), value)[1]
        self.assertEqual(run_calls([slow("a", 0.05), slow("b", 0.0), slow("c", 0.02)]), ["a", "b", "c"])

    def test_calls_really_run_at_the_same_time(self):
        started = time.monotonic()
        run_calls([lambda: time.sleep(0.2)] * 6)
        self.assertLess(time.monotonic() - started, 0.6)

    def test_cost_tracking_sees_calls_made_on_pool_threads(self):
        cost_tracker.start()
        cost_tracker.set_stage("specialists")
        run_calls([lambda: cost_tracker.record_openai("gpt-4o", 1000, 0, 100)] * 4)
        self.assertEqual(cost_tracker.summary()["by_stage"]["specialists"]["calls"], 4)

    def test_an_error_is_raised_to_the_caller(self):
        def boom():
            raise ValueError("bad sample")
        with self.assertRaises(ValueError):
            run_calls([lambda: 1, boom])

    def test_threads_waiting_on_samples_cannot_deadlock_the_pool(self):
        # More threads than pool workers, each waiting on pool calls.
        workers = parallel._MAX_PARALLEL
        results = run_each([
            (lambda i=i: sum(run_calls([lambda: 1] * 3)) + i)
            for i in range(workers + 2)
        ])
        self.assertEqual(results, [3 + i for i in range(workers + 2)])

    def test_run_each_uses_separate_threads(self):
        names = run_each([lambda: threading.current_thread().name] * 3)
        self.assertTrue(all(name.startswith("specialist-thread") for name in names))
        self.assertEqual(run_each([]), [])


if __name__ == "__main__":
    unittest.main()
