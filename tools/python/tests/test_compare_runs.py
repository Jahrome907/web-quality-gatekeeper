from __future__ import annotations

import csv
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wqg_python_tools.compare_runs import (  # noqa: E402
    ComparisonInputError,
    compare_summaries,
    load_summary,
    normalize_summary,
    write_csv,
    write_markdown,
)


def detail(
    url: str,
    *,
    status: str = "pass",
    a11y: int | None = 0,
    performance: dict[str, float] | None = None,
    budgets: dict[str, bool] | None = None,
    visual: bool | None = False,
) -> dict:
    return {
        "schemaVersion": "2.3.0",
        "url": url,
        "overallStatus": status,
        "steps": {
            "playwright": "pass",
            "a11y": "pass" if a11y is not None else "skipped",
            "perf": "pass" if performance is not None else "skipped",
            "visual": "pass" if visual is not None else "skipped",
        },
        "a11y": None if a11y is None else {"violations": a11y},
        "performance": None
        if performance is None
        else {
            "metrics": performance,
            "budgetResults": budgets
            or {"performance": True, "lcp": True, "cls": True, "tbt": True},
        },
        "visual": None if visual is None else {"failed": visual},
    }


def aggregate(*pages: tuple[str | None, dict]) -> dict:
    return {
        "schemaVersion": "2.3.0",
        "pages": [
            {"name": name, "url": report["url"], "details": report} if name is not None else {"url": report["url"], "details": report}
            for name, report in pages
        ]
    }


class CompareRunsTest(unittest.TestCase):
    def test_clean_comparison_keeps_diagnostic_metric_deltas(self) -> None:
        before = normalize_summary(
            aggregate(("home", detail("https://example.test", performance={"performanceScore": 0.9, "lcpMs": 900, "cls": 0.01, "tbtMs": 30}))),
            "before",
        )
        after = normalize_summary(
            aggregate(("home", detail("https://example.test", performance={"performanceScore": 0.8, "lcpMs": 1100, "cls": 0.02, "tbtMs": 40}))),
            "after",
        )

        report = compare_summaries(before, after)

        self.assertEqual(report["comparisonStatus"], "comparable")
        self.assertEqual(report["regressions"], [])
        self.assertEqual(report["pages"][0]["metrics"]["lcpMs"]["delta"], 200.0)
        self.assertEqual(report["pages"][0]["metrics"]["performanceScore"]["delta"], -0.1)

    def test_new_budget_failure_and_a11y_increase_are_regressions(self) -> None:
        before = normalize_summary(
            detail("https://example.test", a11y=0, performance={"performanceScore": 1, "lcpMs": 800, "cls": 0, "tbtMs": 0}),
            "before",
        )
        after = normalize_summary(
            detail(
                "https://example.test",
                status="fail",
                a11y=2,
                performance={"performanceScore": 0.8, "lcpMs": 1500, "cls": 0.1, "tbtMs": 100},
                budgets={"performance": False, "lcp": True, "cls": True, "tbt": True},
            ),
            "after",
        )

        report = compare_summaries(before, after)

        kinds = {regression["kind"] for regression in report["regressions"]}
        self.assertEqual(report["comparisonStatus"], "comparable")
        self.assertIn("overall_status_pass_to_fail", kinds)
        self.assertIn("a11y_violations_increased", kinds)
        self.assertIn("new_budget_failure:performance", kinds)

    def test_removed_pages_and_missing_metrics_are_coverage_gaps(self) -> None:
        before = normalize_summary(
            aggregate(
                ("home", detail("https://example.test", performance={"performanceScore": 0.9, "lcpMs": 900, "cls": 0.01, "tbtMs": 30})),
                ("docs", detail("https://example.test/docs", performance={"performanceScore": 0.9, "lcpMs": 900, "cls": 0.01, "tbtMs": 30})),
            ),
            "before",
        )
        after = normalize_summary(
            aggregate(("home", detail("https://example.test", performance={"performanceScore": 0.9, "cls": 0.01, "tbtMs": 30}))),
            "after",
        )

        report = compare_summaries(before, after)

        self.assertEqual(report["comparisonStatus"], "incomparable")
        self.assertIn("removed_page:docs", report["coverageGaps"])
        self.assertIn("home:missing_metric:lcpMs", report["coverageGaps"])

    def test_disabling_previously_measured_checks_is_a_coverage_gap(self) -> None:
        before = normalize_summary(
            detail(
                "https://example.test",
                performance={"performanceScore": 0.9, "lcpMs": 900, "cls": 0.01, "tbtMs": 30},
                budgets={"performance": True, "lcp": True},
                visual=False,
            ),
            "before",
        )
        after = normalize_summary(detail("https://example.test", a11y=None, performance=None, visual=None), "after")

        report = compare_summaries(before, after)

        self.assertEqual(report["comparisonStatus"], "incomparable")
        self.assertIn("https://example.test:missing_visual_result", report["coverageGaps"])
        self.assertIn("https://example.test:missing_budget_results", report["coverageGaps"])

    def test_rejects_wrong_summary_version_and_out_of_range_metrics(self) -> None:
        invalid_version = detail("https://example.test")
        invalid_version["schemaVersion"] = "1.1.0"
        with self.assertRaisesRegex(ComparisonInputError, "SummaryV2"):
            normalize_summary(invalid_version, "before")

        invalid_score = detail(
            "https://example.test",
            performance={"performanceScore": 1.1, "lcpMs": 800, "cls": 0, "tbtMs": 0},
        )
        with self.assertRaisesRegex(ComparisonInputError, "between 0 and 1"):
            normalize_summary(invalid_score, "before")

        with self.assertRaisesRegex(ComparisonInputError, "non-negative whole number"):
            normalize_summary(detail("https://example.test", a11y=-1), "before")

        negative_timing = detail(
            "https://example.test",
            performance={"performanceScore": 0.9, "lcpMs": -1, "cls": 0, "tbtMs": 0},
        )
        with self.assertRaisesRegex(ComparisonInputError, "must not be negative"):
            normalize_summary(negative_timing, "before")

    def test_rejects_truncated_detail_status_or_step_payload(self) -> None:
        missing_status = detail("https://example.test")
        del missing_status["overallStatus"]
        with self.assertRaisesRegex(ComparisonInputError, "overallStatus"):
            normalize_summary(missing_status, "before")

        missing_payload = detail("https://example.test")
        missing_payload["visual"] = None
        with self.assertRaisesRegex(ComparisonInputError, "visual is required"):
            normalize_summary(missing_payload, "before")

    def test_incomplete_checked_sections_are_incomparable(self) -> None:
        before = normalize_summary(detail("https://example.test"), "before")
        incomplete = detail("https://example.test")
        incomplete["steps"]["perf"] = "pass"
        incomplete["a11y"] = {}
        incomplete["performance"] = {"metrics": {}}
        incomplete["visual"] = {}
        after = normalize_summary(incomplete, "after")

        report = compare_summaries(before, after)

        self.assertEqual(report["comparisonStatus"], "incomparable")
        self.assertIn("https://example.test:unavailable:a11yViolations", report["coverageGaps"])
        self.assertIn("https://example.test:unavailable:budgetResults", report["coverageGaps"])
        self.assertIn("https://example.test:unavailable:visualFailed", report["coverageGaps"])

    def test_null_required_performance_metric_is_incomparable(self) -> None:
        before_report = detail(
            "https://example.test",
            performance={"performanceScore": None, "lcpMs": 900, "cls": 0.01, "tbtMs": 30},
        )
        after_report = detail(
            "https://example.test",
            performance={"performanceScore": None, "lcpMs": 900, "cls": 0.01, "tbtMs": 30},
        )
        report = compare_summaries(
            normalize_summary(before_report, "before"), normalize_summary(after_report, "after")
        )

        self.assertEqual(report["comparisonStatus"], "incomparable")
        self.assertIn("https://example.test:unavailable:performanceScore", report["coverageGaps"])

    def test_named_pages_match_across_url_change_and_unnamed_pages_do_not(self) -> None:
        before = normalize_summary(
            aggregate(
                ("home", detail("https://example.test/old")),
                (None, detail("https://example.test/anonymous-old")),
            ),
            "before",
        )
        after = normalize_summary(
            aggregate(
                ("home", detail("https://example.test/new")),
                (None, detail("https://example.test/anonymous-new")),
            ),
            "after",
        )

        report = compare_summaries(before, after)

        self.assertEqual(report["pages"][0]["identity"], "home")
        self.assertTrue(report["pages"][0]["urlChanged"])
        self.assertEqual(report["addedPages"][0]["identity"], "https://example.test/anonymous-new")
        self.assertEqual(report["removedPages"][0]["identity"], "https://example.test/anonymous-old")
        self.assertEqual(report["comparisonStatus"], "incomparable")

    def test_duplicate_identity_and_nonfinite_values_are_rejected(self) -> None:
        with self.assertRaisesRegex(ComparisonInputError, "duplicate page identity"):
            normalize_summary(
                aggregate(("home", detail("https://one.test")), ("home", detail("https://two.test"))),
                "before",
            )
        with self.assertRaisesRegex(ComparisonInputError, "finite number"):
            normalize_summary(detail("https://example.test", a11y=True), "before")

    def test_csv_and_markdown_escape_untrusted_page_text(self) -> None:
        before = normalize_summary(aggregate((r"=SUM(1,1)\|", detail("https://example.test/a|b"))), "before")
        after = normalize_summary(aggregate((r"=SUM(1,1)\|", detail("https://example.test/a|b"))), "after")
        report = compare_summaries(before, after)
        csv_output = io.StringIO()
        markdown_output = io.StringIO()
        write_csv(report, csv_output)
        write_markdown(report, markdown_output)

        parsed = list(csv.DictReader(io.StringIO(csv_output.getvalue())))
        self.assertEqual(parsed[0]["identity"], "'=SUM(1,1)\\|")
        self.assertIn("=SUM(1,1)\\\\\\|", markdown_output.getvalue())
        self.assertIn("a\\|b", markdown_output.getvalue())
        separator = next(line for line in markdown_output.getvalue().splitlines() if line.startswith("|---"))
        self.assertEqual(separator.count("|"), 12)

    def test_cli_exit_codes_and_output(self) -> None:
        repository_root = Path(__file__).resolve().parents[3]
        cli_path = repository_root / "tools" / "python" / "compare_runs.py"
        baseline = aggregate(("home", detail("https://example.test", performance={"performanceScore": 1, "lcpMs": 800, "cls": 0, "tbtMs": 0})))
        regressed = aggregate(("home", detail("https://example.test", status="fail", a11y=1, performance={"performanceScore": 1, "lcpMs": 800, "cls": 0, "tbtMs": 0})))
        incomplete = aggregate(("other", detail("https://example.test/other")))
        with tempfile.TemporaryDirectory(prefix="wqg-compare-runs-") as temp_dir:
            root = Path(temp_dir)
            before_path = root / "before.json"
            after_path = root / "after.json"
            before_path.write_text(json.dumps(baseline), encoding="utf-8")
            after_path.write_text(json.dumps(regressed), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(cli_path), "--before", str(before_path), "--after", str(after_path), "--fail-on-regression"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(json.loads(result.stdout)["comparisonStatus"], "comparable")

            output_path = root / "comparison.csv"
            result = subprocess.run(
                [
                    sys.executable,
                    str(cli_path),
                    "--before",
                    str(before_path),
                    "--after",
                    str(after_path),
                    "--format",
                    "csv",
                    "--output",
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("lcpMs_delta", output_path.read_text(encoding="utf-8"))

            after_path.write_text(json.dumps(incomplete), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(cli_path), "--before", str(before_path), "--after", str(after_path), "--format", "markdown"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("Status: incomparable", result.stdout)

    def test_load_summary_rejects_nonstandard_nan_json(self) -> None:
        with tempfile.TemporaryDirectory(prefix="wqg-compare-nan-") as temp_dir:
            report_path = Path(temp_dir) / "summary.v2.json"
            report_path.write_text('{"schemaVersion":"2.3.0","url":"https://example.test","bad":NaN}', encoding="utf-8")
            with self.assertRaisesRegex(ComparisonInputError, "non-finite JSON constant"):
                load_summary(report_path)


if __name__ == "__main__":
    unittest.main()
