from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wqg_python_tools.case_study_analytics import (  # noqa: E402
    build_report,
    extract_summary_metrics,
    load_bundle,
    write_csv_report,
    write_markdown_report,
)


class CaseStudyAnalyticsTest(unittest.TestCase):
    def test_load_bundle_extracts_summary_and_provenance_fields(self) -> None:
        with tempfile.TemporaryDirectory(prefix="wqg-python-bundle-") as temp_dir:
            bundle_dir = Path(temp_dir) / "fixture"
            bundle_dir.mkdir()
            (bundle_dir / "summary.v2.json").write_text(
                json.dumps(
                    {
                        "overallStatus": "pass",
                        "rollup": {
                            "pageCount": 1,
                            "failedPages": 0,
                            "a11yViolations": 0,
                            "performanceBudgetFailures": 0,
                            "visualFailures": 0,
                        },
                        "pages": [
                            {
                                "details": {
                                    "performance": {
                                        "metrics": {
                                            "performanceScore": 0.98,
                                            "lcpMs": 900,
                                        }
                                    }
                                }
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (bundle_dir / "fixture-provenance.json").write_text(
                json.dumps(
                    {
                        "kind": "fixture-case-study-run",
                        "source": {"repoPath": "tests/fixtures/site"},
                    }
                ),
                encoding="utf-8",
            )

            row = load_bundle(bundle_dir)

            self.assertEqual(row["bundle"], "fixture")
            self.assertEqual(row["provenance_kind"], "fixture-case-study-run")
            self.assertEqual(row["repo_url"], "tests/fixtures/site")
            self.assertEqual(row["average_performance_score"], 0.98)
            self.assertEqual(row["average_lcp_ms"], 900.0)

    def test_extract_summary_metrics_prefers_pages_when_rollup_is_stale(self) -> None:
        metrics = extract_summary_metrics(
            {
                "overallStatus": "fail",
                "rollup": {
                    "pageCount": 0,
                    "failedPages": 4,
                    "a11yViolations": 0,
                    "performanceBudgetFailures": 0,
                    "visualFailures": 0,
                },
                "pages": [
                    {
                        "overallStatus": "pass",
                        "metrics": {"a11yViolations": 1},
                        "details": {
                            "performance": {
                                "metrics": {"performanceScore": 0.95, "lcpMs": 800},
                                "budgetResults": {
                                    "performance": True,
                                    "lcp": False,
                                    "cls": True,
                                    "tbt": True,
                                },
                            },
                            "visual": {"failed": False},
                        },
                    },
                    {
                        "overallStatus": "fail",
                        "metrics": {"a11yViolations": 2},
                        "details": {
                            "performance": {
                                "metrics": {"performanceScore": 0.7, "lcpMs": 1400},
                                "budgetResults": {
                                    "performance": False,
                                    "lcp": False,
                                    "cls": True,
                                    "tbt": True,
                                },
                            },
                            "visual": {"failed": True},
                        },
                    },
                ],
            }
        )

        self.assertEqual(metrics["page_count"], 2)
        self.assertEqual(metrics["failed_pages"], 1)
        self.assertEqual(metrics["a11y_violations"], 3)
        self.assertEqual(metrics["performance_budget_failures"], 3)
        self.assertEqual(metrics["visual_failures"], 1)
        self.assertEqual(metrics["average_performance_score"], 0.825)
        self.assertEqual(metrics["average_lcp_ms"], 1100.0)

    def test_csv_and_markdown_reports_are_written(self) -> None:
        with tempfile.TemporaryDirectory(prefix="wqg-python-report-") as temp_dir:
            output_dir = Path(temp_dir)
            rows = [
                {
                    "bundle": "fixture",
                    "bundle_path": "/tmp/fixture",
                    "summary_path": "/tmp/fixture/summary.v2.json",
                    "provenance_path": "/tmp/fixture/fixture-provenance.json",
                    "roi_path": None,
                    "provenance_kind": "fixture-case-study-run",
                    "repo_url": "tests/fixtures/site",
                    "baseline_sha": None,
                    "improved_sha": None,
                    "overall_status": "pass",
                    "page_count": 1,
                    "failed_pages": 0,
                    "a11y_violations": 0,
                    "performance_budget_failures": 0,
                    "visual_failures": 0,
                    "average_performance_score": 0.98,
                    "average_lcp_ms": 900.0,
                    "roi_failed_pages_delta": None,
                    "roi_performance_score_delta": None,
                    "manifest_roi_path": None,
                }
            ]

            report = build_report(rows)
            self.assertEqual(report["bundle_count"], 1)

            csv_path = output_dir / "report.csv"
            markdown_path = output_dir / "report.md"

            write_csv_report(rows, csv_path)
            write_markdown_report(rows, markdown_path)

            with csv_path.open(encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle)
                parsed_rows = list(reader)

            self.assertEqual(len(parsed_rows), 1)
            self.assertEqual(parsed_rows[0]["bundle"], "fixture")

            markdown = markdown_path.read_text(encoding="utf-8")
            self.assertIn("# WQG Case Study Bundle Analytics", markdown)
            self.assertIn("| fixture | pass | 1 | 0 | 0 | 0.98 | 900.0 |", markdown)

    def test_write_csv_report_escapes_formula_like_cells(self) -> None:
        with tempfile.TemporaryDirectory(prefix="wqg-python-csv-escape-") as temp_dir:
            output_dir = Path(temp_dir)
            rows = [
                {
                    "bundle": "=SUM(1,1)",
                    "bundle_path": "/tmp/fixture",
                    "summary_path": "/tmp/fixture/summary.v2.json",
                    "provenance_path": "/tmp/fixture/fixture-provenance.json",
                    "roi_path": None,
                    "provenance_kind": "\rmeta",
                    "repo_url": "+repo",
                    "baseline_sha": "-baseline",
                    "improved_sha": "@improved",
                    "overall_status": "pass",
                    "page_count": 1,
                    "failed_pages": 0,
                    "a11y_violations": 0,
                    "performance_budget_failures": 0,
                    "visual_failures": 0,
                    "average_performance_score": 0.99,
                    "average_lcp_ms": 800.0,
                    "roi_failed_pages_delta": None,
                    "roi_performance_score_delta": None,
                    "manifest_roi_path": "\tartifact",
                }
            ]

            csv_path = output_dir / "report.csv"
            write_csv_report(rows, csv_path)

            with csv_path.open(encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle)
                parsed_rows = list(reader)

            self.assertEqual(len(parsed_rows), 1)
            parsed = parsed_rows[0]
            self.assertEqual(parsed["bundle"], "'=SUM(1,1)")
            self.assertEqual(parsed["repo_url"], "'+repo")
            self.assertEqual(parsed["baseline_sha"], "'-baseline")
            self.assertEqual(parsed["improved_sha"], "'@improved")
            self.assertEqual(parsed["manifest_roi_path"], "'\tartifact")
            self.assertEqual(parsed["provenance_kind"], "'\rmeta")

    def test_load_bundle_normalizes_rollup_mismatch(self) -> None:
        with tempfile.TemporaryDirectory(prefix="wqg-python-rollup-") as temp_dir:
            bundle_dir = Path(temp_dir) / "fixture"
            bundle_dir.mkdir()
            (bundle_dir / "summary.v2.json").write_text(
                json.dumps(
                    {
                        "overallStatus": "fail",
                        "rollup": {
                            "pageCount": 0,
                            "failedPages": 4,
                            "a11yViolations": 0,
                            "performanceBudgetFailures": 0,
                            "visualFailures": 0,
                        },
                        "pages": [
                            {
                                "overallStatus": "pass",
                                "metrics": {"a11yViolations": 1},
                                "details": {
                                    "performance": {
                                        "metrics": {
                                            "performanceScore": 0.8,
                                            "lcpMs": 1400,
                                        },
                                        "budgetResults": {
                                            "performance": True,
                                            "lcp": False,
                                            "cls": True,
                                            "tbt": True,
                                        },
                                    }
                                },
                            },
                            {
                                "overallStatus": "fail",
                                "metrics": {"a11yViolations": 2},
                                "details": {
                                    "performance": {
                                        "metrics": {
                                            "performanceScore": 0.75,
                                            "lcpMs": 1600,
                                        },
                                        "budgetResults": {
                                            "performance": False,
                                            "lcp": False,
                                            "cls": True,
                                            "tbt": True,
                                        },
                                    },
                                    "visual": {"failed": True},
                                },
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )

            row = load_bundle(bundle_dir)
            self.assertEqual(row["page_count"], 2)
            self.assertEqual(row["failed_pages"], 1)
            self.assertEqual(row["a11y_violations"], 3)
            self.assertEqual(row["performance_budget_failures"], 3)
            self.assertEqual(row["visual_failures"], 1)


if __name__ == "__main__":
    unittest.main()
