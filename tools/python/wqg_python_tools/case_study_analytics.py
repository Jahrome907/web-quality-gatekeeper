from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


_DANGEROUS_CSV_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _find_existing(bundle_dir: Path, candidates: list[str]) -> Path | None:
    for candidate in candidates:
        path = bundle_dir / candidate
        if path.exists():
            return path
    return None


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def _safe_nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    integer = int(value)
    if integer < 0 or integer != value:
        return None
    return integer


def _page_a11y_violations(page: dict[str, Any]) -> int:
    metrics = page.get("metrics") or {}
    metric_value = _safe_nonnegative_int(metrics.get("a11yViolations"))
    if metric_value is not None:
        return metric_value

    details = page.get("details") or {}
    a11y = details.get("a11y") or {}
    return _safe_nonnegative_int(a11y.get("violations")) or 0


def _page_performance_budget_failures(page: dict[str, Any]) -> int:
    details = page.get("details") or {}
    performance = details.get("performance") or {}
    budget_results = performance.get("budgetResults")
    if not isinstance(budget_results, dict):
        return 0
    return sum(1 for passed in budget_results.values() if passed is False)


def _page_visual_failed(page: dict[str, Any]) -> bool:
    details = page.get("details") or {}
    visual = details.get("visual") or {}
    return visual.get("failed") is True


def _rollup_counts(rollup: Any) -> dict[str, int]:
    values = rollup if isinstance(rollup, dict) else {}
    return {
        "page_count": _safe_nonnegative_int(values.get("pageCount")) or 0,
        "failed_pages": _safe_nonnegative_int(values.get("failedPages")) or 0,
        "a11y_violations": _safe_nonnegative_int(values.get("a11yViolations")) or 0,
        "performance_budget_failures": _safe_nonnegative_int(values.get("performanceBudgetFailures")) or 0,
        "visual_failures": _safe_nonnegative_int(values.get("visualFailures")) or 0,
    }


def _sanitize_csv_value(value: Any) -> Any:
    if not isinstance(value, str) or not value.startswith(_DANGEROUS_CSV_PREFIXES):
        return value
    return f"'{value}"


def extract_summary_metrics(summary: dict[str, Any]) -> dict[str, Any]:
    raw_pages = summary.get("pages")
    pages = [page for page in raw_pages if isinstance(page, dict)] if isinstance(raw_pages, list) else []
    performance_scores: list[float] = []
    lcp_values: list[float] = []

    for page in pages:
        metrics = (((page or {}).get("details") or {}).get("performance") or {}).get("metrics") or {}
        performance_score = metrics.get("performanceScore")
        lcp_ms = metrics.get("lcpMs")
        if isinstance(performance_score, (int, float)):
            performance_scores.append(float(performance_score))
        if isinstance(lcp_ms, (int, float)):
            lcp_values.append(float(lcp_ms))

    if pages:
        counts = {
            "page_count": len(pages),
            "failed_pages": sum(1 for page in pages if page.get("overallStatus") == "fail"),
            "a11y_violations": sum(_page_a11y_violations(page) for page in pages),
            "performance_budget_failures": sum(
                _page_performance_budget_failures(page) for page in pages
            ),
            "visual_failures": sum(1 for page in pages if _page_visual_failed(page)),
        }
    else:
        counts = _rollup_counts(summary.get("rollup"))

    return {
        "overall_status": str(summary.get("overallStatus", "unknown")),
        **counts,
        "average_performance_score": _average(performance_scores),
        "average_lcp_ms": _average(lcp_values),
    }


def load_bundle(bundle_dir: Path) -> dict[str, Any]:
    summary_path = _find_existing(
        bundle_dir,
        ["summary.v2.json", "fixture-summary.v2.json", "artifacts/summary.v2.json"],
    )
    if summary_path is None:
        raise FileNotFoundError(f"Missing summary.v2.json in bundle: {bundle_dir}")

    provenance_path = _find_existing(bundle_dir, ["provenance.json", "fixture-provenance.json"])
    roi_path = _find_existing(bundle_dir, ["roi.json"])

    summary = _read_json(summary_path)
    provenance = _read_json(provenance_path) if provenance_path else None
    roi = _read_json(roi_path) if roi_path else None
    metrics = extract_summary_metrics(summary)

    baseline = (provenance or {}).get("baseline") or {}
    improved = (provenance or {}).get("improved") or {}
    source = (provenance or {}).get("source") or {}
    roi_output = (provenance or {}).get("roiOutput") or {}

    return {
        "bundle": bundle_dir.name,
        "bundle_path": str(bundle_dir),
        "summary_path": str(summary_path),
        "provenance_path": str(provenance_path) if provenance_path else None,
        "roi_path": str(roi_path) if roi_path else None,
        "provenance_kind": (provenance or {}).get("kind"),
        "repo_url": (provenance or {}).get("repoUrl") or source.get("repoPath"),
        "baseline_sha": baseline.get("sha"),
        "improved_sha": improved.get("sha"),
        "roi_failed_pages_delta": ((roi or {}).get("roi") or {}).get("failedPagesDelta"),
        "roi_performance_score_delta": ((roi or {}).get("roi") or {}).get("performanceScoreDelta"),
        "manifest_roi_path": roi_output.get("path"),
        **metrics,
    }


def build_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "bundle_count": len(rows),
        "pass_count": sum(1 for row in rows if row["overall_status"] == "pass"),
        "fail_count": sum(1 for row in rows if row["overall_status"] == "fail"),
        "rows": rows,
    }


def write_json_report(report: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(report, indent=2)}\n", encoding="utf-8")


def write_csv_report(rows: list[dict[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "bundle",
        "bundle_path",
        "summary_path",
        "provenance_path",
        "roi_path",
        "provenance_kind",
        "repo_url",
        "baseline_sha",
        "improved_sha",
        "overall_status",
        "page_count",
        "failed_pages",
        "a11y_violations",
        "performance_budget_failures",
        "visual_failures",
        "average_performance_score",
        "average_lcp_ms",
        "roi_failed_pages_delta",
        "roi_performance_score_delta",
        "manifest_roi_path",
    ]

    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(
            {field: _sanitize_csv_value(row.get(field)) for field in fieldnames}
            for row in rows
        )


def write_markdown_report(rows: list[dict[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# WQG Case Study Bundle Analytics",
        "",
        "| Bundle | Status | Pages | A11y Violations | Perf Budget Failures | Avg Perf Score | Avg LCP (ms) |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]

    for row in rows:
        lines.append(
            "| {bundle} | {overall_status} | {page_count} | {a11y_violations} | {performance_budget_failures} | {average_performance_score} | {average_lcp_ms} |".format(
                **row
            )
        )

    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
