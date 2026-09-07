from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any


_DANGEROUS_CSV_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=lambda constant: (_raise_nonfinite_json_constant(constant)),
        )
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to read JSON at {path}: {error}") from None
    if not isinstance(value, dict):
        raise ValueError(f"JSON object required at {path}.")
    return value


def _raise_nonfinite_json_constant(constant: str) -> None:
    raise ValueError(f"non-finite JSON constant {constant!r}")


def _mapping(value: Any, field: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object.")
    return value


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
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("count must be a finite non-negative whole number.")
    integer = int(value)
    if integer < 0 or integer != value:
        raise ValueError("count must be a finite non-negative whole number.")
    return integer


def _safe_finite_number(value: Any, field: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number.")
    return float(value)


def _page_details(page: dict[str, Any], field: str) -> dict[str, Any]:
    details = page.get("details")
    if details is None:
        # Detail SummaryV2 has these fields at the top level; aggregate entries put it in details.
        return page
    return _mapping(details, f"{field}.details")


def _page_a11y_violations(page: dict[str, Any]) -> int:
    metrics = _mapping(page.get("metrics"), "page.metrics")
    metric_value = _safe_nonnegative_int(metrics.get("a11yViolations"))
    if metric_value is not None:
        return metric_value

    details = _page_details(page, "page")
    a11y = _mapping(details.get("a11y"), "page.details.a11y")
    return _safe_nonnegative_int(a11y.get("violations")) or 0


def _page_performance_budget_failures(page: dict[str, Any]) -> int:
    details = _page_details(page, "page")
    performance = _mapping(details.get("performance"), "page.details.performance")
    budget_results = performance.get("budgetResults")
    if budget_results is None:
        return 0
    budget_results = _mapping(budget_results, "page.details.performance.budgetResults")
    if any(not isinstance(passed, bool) for passed in budget_results.values()):
        raise ValueError("page.details.performance.budgetResults must map keys to booleans.")
    return sum(1 for passed in budget_results.values() if passed is False)


def _page_visual_failed(page: dict[str, Any]) -> bool:
    details = _page_details(page, "page")
    visual = _mapping(details.get("visual"), "page.details.visual")
    failed = visual.get("failed")
    if failed is not None and not isinstance(failed, bool):
        raise ValueError("page.details.visual.failed must be a boolean.")
    return failed is True


def _rollup_counts(rollup: Any) -> dict[str, int]:
    values = _mapping(rollup, "rollup")
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
    if not isinstance(summary, dict):
        raise ValueError("summary must be an object.")
    raw_pages = summary.get("pages")
    if raw_pages is not None and not isinstance(raw_pages, list):
        raise ValueError("summary.pages must be an array.")
    pages = [page for page in raw_pages if isinstance(page, dict)] if isinstance(raw_pages, list) else []
    if isinstance(raw_pages, list) and len(pages) != len(raw_pages):
        raise ValueError("summary.pages entries must be objects.")
    # A detail SummaryV2 has a URL and measurements directly on the summary instead of pages.
    if not pages and isinstance(summary.get("url"), str):
        pages = [summary]
    performance_scores: list[float] = []
    lcp_values: list[float] = []

    for page in pages:
        details = _page_details(page, "summary.pages")
        performance = _mapping(details.get("performance"), "summary.pages.details.performance")
        metrics = _mapping(performance.get("metrics"), "summary.pages.details.performance.metrics")
        performance_score = _safe_finite_number(
            metrics.get("performanceScore"), "summary.pages.details.performance.metrics.performanceScore"
        )
        lcp_ms = _safe_finite_number(metrics.get("lcpMs"), "summary.pages.details.performance.metrics.lcpMs")
        if performance_score is not None:
            performance_scores.append(performance_score)
        if lcp_ms is not None:
            lcp_values.append(lcp_ms)

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

    baseline = _mapping((provenance or {}).get("baseline"), "provenance.baseline")
    improved = _mapping((provenance or {}).get("improved"), "provenance.improved")
    source = _mapping((provenance or {}).get("source"), "provenance.source")
    roi_output = _mapping((provenance or {}).get("roiOutput"), "provenance.roiOutput")
    roi_values = _mapping((roi or {}).get("roi"), "roi.roi")

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
        "roi_failed_pages_delta": _safe_finite_number(roi_values.get("failedPagesDelta"), "roi.roi.failedPagesDelta"),
        "roi_performance_score_delta": _safe_finite_number(roi_values.get("performanceScoreDelta"), "roi.roi.performanceScoreDelta"),
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
        safe_row = {key: _sanitize_markdown_value(value) for key, value in row.items()}
        lines.append(
            "| {bundle} | {overall_status} | {page_count} | {a11y_violations} | {performance_budget_failures} | {average_performance_score} | {average_lcp_ms} |".format(
                **safe_row
            )
        )

    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _sanitize_markdown_value(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")
