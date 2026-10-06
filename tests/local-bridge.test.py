import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).parents[1] / "integrations/local-jev/semif-server.py"
spec = importlib.util.spec_from_file_location("semif_bridge", path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CandidateCoverage(unittest.TestCase):
    def test_full_distribution_including_final_singleton(self):
        for size in (1, 16, 17, 120, 255, 256):
            with self.subTest(size=size):
                criteria = {f"target-{i}": f"已观测候选 {i}" for i in range(size)}
                rows, plans = bridge.prepare({"state": "现场证据", "questions": {
                    "target": {"type": "choice", "criteria": criteria}}})
                self.assertTrue(all(2 <= len(r["options"]) <= 16 for r in rows))
                results = [{"id": r["id"], "option_ids": [o["id"] for o in r["options"]],
                            "probabilities": [1 / len(r["options"])] * len(r["options"])} for r in rows]
                answer = bridge.combine(plans, results)["target"]
                self.assertEqual(set(answer["probabilities"]), set(criteria))
                self.assertAlmostEqual(sum(answer["probabilities"].values()), 1)
                self.assertIn(answer["choice"], criteria)

    def test_missing_candidate_cannot_pass(self):
        rows, plans = bridge.prepare({"state": "现场证据", "questions": {
            "target": {"type": "choice", "criteria": {"a": "一", "b": "二"}}}})
        with self.assertRaises(ValueError):
            bridge.combine(plans, [{"id": rows[0]["id"], "option_ids": ["a"], "probabilities": [1]}])

    def test_oversized_candidate_set_is_refused(self):
        with self.assertRaises(ValueError):
            bridge.prepare({"state": "现场证据", "questions": {"target": {
                "type": "choice", "criteria": {str(i): str(i) for i in range(257)}}}})


if __name__ == "__main__": unittest.main()
