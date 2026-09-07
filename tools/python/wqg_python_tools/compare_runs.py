from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO


_DANGEROUS_CSV_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
_PERFORMANCE_METRICS = ("performanceScore", "lcpMs", "cls", "tbtMs")
_BUDGET_KEYS = ("performance", "lcp", "cls", "tbt")


class ComparisonInputError(ValueError):
    """Raised when a report cannot be compared safely."""


def _reject_nonfinite_json_constant(constant: str) -> None:
    raise ValueError(f"non-finite JSON constant {constant!r}")


@dataclass(frozen=True)
class PageRun:
    identity: str
    name: str | None
    url: str
    overall_status: str | None
    a11y_violations: float | None
    performance: dict[str, float | None]
    budget_results: dict[str, bool] | None
    visual_failed: bool | None
    unavailable: tuple[str, ...]


def _object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ComparisonInputError(f"{context} must be a JSON object.")
    return value


def _string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ComparisonInputError(f"{context} must be a non-empty string.")
    return value


def _finite_number(value: Any, context: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ComparisonInputError(f"{context} must be a finite number.")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ComparisonInputError(f"{context} must be a finite number.")
    return float(value)


def _nonnegative_count(value: Any, context: str) -> float:
    number = _finite_number(value, context)
    if number < 0 or number != int(number):
        raise ComparisonInputError(f"{context} must be a non-negative whole number.")
    return number


def _performance_metric(value: Any, metric: str, context: str) -> float | None:
    number = _optional_metric(value, context)
    if number is None:
        return None
    if number < 0:
        raise ComparisonInputError(f"{context} must not be negative.")
    if metric == "performanceScore" and number > 1:
        raise ComparisonInputError(f"{context} must be between 0 and 1.")
    return number


def _optional_metric(value: Any, context: str) -> float | None:
    if value is None:
        return None
    return _finite_number(value, context)


def _status(value: Any, context: str) -> str | None:
    if value is None:
        return None
    if value not in ("pass", "fail", "skipped"):
        raise ComparisonInputError(f"{context} must be pass, fail, or skipped.")
    return value


def _step(summary: dict[str, Any], name: str, context: str) -> str | None:
    steps = summary.get("steps")
    values = _object(steps, f"{context}.steps")
    status = _status(values.get(name), f"{context}.steps.{name}")
    if status is None:
        raise ComparisonInputError(f"{context}.steps.{name} is required.")
    return status


def _metric_section(summary: dict[str, Any], section: str, step_name: str, context: str) -> dict[str, Any] | None:
    step_status = _step(summary, step_name, context)
    value = summary.get(section)
    if step_status == "skipped":
        if value is not None:
            raise ComparisonInputError(f"{context}.{section} is present although {step_name} is skipped.")
        return None
    if value is None:
        raise ComparisonInputError(f"{context}.{section} is required when {step_name} is {step_status}.")
    return _object(value, f"{context}.{section}")


def _normalize_detail(summary: dict[str, Any], name: str | None, url: str, context: str) -> PageRun:
    schema_version = summary.get("schemaVersion")
    if not isinstance(schema_version, str) or not schema_version.startswith("2."):
        raise ComparisonInputError(f"{context}.schemaVersion must identify a SummaryV2 report.")
    overall_status = summary.get("overallStatus")
    if overall_status not in ("pass", "fail"):
        raise ComparisonInputError(f"{context}.overallStatus must be pass or fail.")
    _object(summary.get("steps"), f"{context}.steps")

    a11y = _metric_section(summary, "a11y", "a11y", context)
    a11y_violations = None
    unavailable: list[str] = []
    if a11y is not None and "violations" in a11y:
        a11y_violations = _nonnegative_count(a11y["violations"], f"{context}.a11y.violations")
    elif a11y is not None:
        unavailable.append("a11yViolations")

    performance_section = _metric_section(summary, "performance", "perf", context)
    performance = {metric: None for metric in _PERFORMANCE_METRICS}
    budget_results: dict[str, bool] | None = None
    if performance_section is not None:
        metrics = performance_section.get("metrics")
        if metrics is not None:
            metric_values = _object(metrics, f"{context}.performance.metrics")
            for metric in _PERFORMANCE_METRICS:
                if metric in metric_values:
                    performance[metric] = _performance_metric(
                        metric_values[metric], metric, f"{context}.performance.metrics.{metric}"
                    )
                    if performance[metric] is None:
                        unavailable.append(metric)
                else:
                    unavailable.append(metric)
        else:
            unavailable.extend(_PERFORMANCE_METRICS)
        raw_budgets = performance_section.get("budgetResults")
        if raw_budgets is not None:
            budget_values = _object(raw_budgets, f"{context}.performance.budgetResults")
            budget_results = {}
            for key, passed in budget_values.items():
                if not isinstance(key, str) or not isinstance(passed, bool):
                    raise ComparisonInputError(
                        f"{context}.performance.budgetResults must map strings to booleans."
                    )
                budget_results[key] = passed
            unavailable.extend(
                f"budgetResult:{key}" for key in _BUDGET_KEYS if key not in budget_results
            )
        else:
            unavailable.append("budgetResults")

    visual = _metric_section(summary, "visual", "visual", context)
    visual_failed = None
    if visual is not None and "failed" in visual:
        failed = visual["failed"]
        if not isinstance(failed, bool):
            raise ComparisonInputError(f"{context}.visual.failed must be a boolean.")
        visual_failed = failed
    elif visual is not None:
        unavailable.append("visualFailed")

    identity = name if name else url
    return PageRun(
        identity=identity,
        name=name,
        url=url,
        overall_status=overall_status,
        a11y_violations=a11y_violations,
        performance=performance,
        budget_results=budget_results,
        visual_failed=visual_failed,
        unavailable=tuple(unavailable),
    )


def normalize_summary(summary: Any, label: str) -> dict[str, PageRun]:
    """Normalize either an aggregate SummaryV2.pages report or a detail SummaryV2 report."""
    value = _object(summary, label)
    schema_version = value.get("schemaVersion")
    if not isinstance(schema_version, str) or not schema_version.startswith("2."):
        raise ComparisonInputError(f"{label}.schemaVersion must identify a SummaryV2 report.")
    raw_pages = value.get("pages")
    page_runs: list[PageRun] = []
    if raw_pages is not None:
        if not isinstance(raw_pages, list):
            raise ComparisonInputError(f"{label}.pages must be an array.")
        for index, raw_page in enumerate(raw_pages):
            page = _object(raw_page, f"{label}.pages[{index}]")
            name = page.get("name")
            if name is not None:
                name = _string(name, f"{label}.pages[{index}].name")
            url = _string(page.get("url"), f"{label}.pages[{index}].url")
            details = _object(page.get("details"), f"{label}.pages[{index}].details")
            page_runs.append(_normalize_detail(details, name, url, f"{label}.pages[{index}].details"))
    else:
        url = _string(value.get("url"), f"{label}.url")
        page_runs.append(_normalize_detail(value, None, url, label))

    if not page_runs:
        raise ComparisonInputError(f"{label} contains no pages.")
    pages: dict[str, PageRun] = {}
    for page in page_runs:
        if page.identity in pages:
            raise ComparisonInputError(
                f"{label} has duplicate page identity: {page.identity!r}. Name pages uniquely or use distinct URLs."
            )
        pages[page.identity] = page
    return pages


def load_summary(path: Path) -> dict[str, PageRun]:
    try:
        with path.open(encoding="utf-8") as handle:
            parsed = json.load(
                handle,
                parse_constant=_reject_nonfinite_json_constant,
            )
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise ComparisonInputError(f"Unable to read {path}: {error}") from None
    return normalize_summary(parsed, str(path))


def _delta(before: float | None, after: float | None) -> dict[str, float | None]:
    delta = None if before is None or after is None else round(after - before, 12)
    return {"before": before, "after": after, "delta": delta}


def _page_comparison(before: PageRun, after: PageRun) -> dict[str, Any]:
    metric_deltas = {
        "a11yViolations": _delta(before.a11y_violations, after.a11y_violations),
        **{metric: _delta(before.performance[metric], after.performance[metric]) for metric in _PERFORMANCE_METRICS},
    }
    new_budget_failures = sorted(
        key
        for key, current in (after.budget_results or {}).items()
        if current is False and (before.budget_results or {}).get(key) is not False
    )
    budget_regressions = [
        key
        for key in new_budget_failures
        if (before.budget_results or {}).get(key) is True
    ]
    regressions: list[str] = []
    if before.overall_status == "pass" and after.overall_status == "fail":
        regressions.append("overall_status_pass_to_fail")
    if before.a11y_violations is not None and after.a11y_violations is not None and after.a11y_violations > before.a11y_violations:
        regressions.append("a11y_violations_increased")
    if before.visual_failed is False and after.visual_failed is True:
        regressions.append("visual_failed_false_to_true")
    regressions.extend(f"new_budget_failure:{key}" for key in budget_regressions)
    missing_metrics = [
        metric for metric, values in metric_deltas.items() if values["before"] is not None and values["after"] is None
    ]
    coverage_gaps = [f"missing_metric:{metric}" for metric in missing_metrics]
    coverage_gaps.extend(f"unavailable:{field}" for field in sorted(set(before.unavailable) | set(after.unavailable)))
    if before.visual_failed is not None and after.visual_failed is None:
        coverage_gaps.append("missing_visual_result")
    if before.budget_results is not None:
        if after.budget_results is None:
            coverage_gaps.append("missing_budget_results")
        else:
            coverage_gaps.extend(
                f"missing_budget_result:{key}"
                for key in sorted(set(before.budget_results) - set(after.budget_results))
            )
    return {
        "identity": before.identity,
        "name": before.name,
        "beforeUrl": before.url,
        "afterUrl": after.url,
        "urlChanged": before.url != after.url,
        "beforeStatus": before.overall_status,
        "afterStatus": after.overall_status,
        "metrics": metric_deltas,
        "newBudgetFailures": new_budget_failures,
        "beforeVisualFailed": before.visual_failed,
        "afterVisualFailed": after.visual_failed,
        "regressions": regressions,
        "coverageGaps": coverage_gaps,
    }


def compare_summaries(before: dict[str, PageRun], after: dict[str, PageRun]) -> dict[str, Any]:
    before_ids = set(before)
    after_ids = set(after)
    shared_ids = sorted(before_ids & after_ids)
    removed = sorted(before_ids - after_ids)
    added = sorted(after_ids - before_ids)
    pages = [_page_comparison(before[identity], after[identity]) for identity in shared_ids]
    coverage_gaps = [f"removed_page:{identity}" for identity in removed]
    for page in pages:
        coverage_gaps.extend(f"{page['identity']}:{gap}" for gap in page["coverageGaps"])
    if not shared_ids:
        coverage_gaps.append("no_comparable_pages")
    regressions = [
        {"identity": page["identity"], "kind": regression}
        for page in pages
        for regression in page["regressions"]
    ]
    return {
        "comparisonStatus": "incomparable" if coverage_gaps else "comparable",
        "beforePageCount": len(before),
        "afterPageCount": len(after),
        "pages": pages,
        "addedPages": [{"identity": identity, "url": after[identity].url} for identity in added],
        "removedPages": [{"identity": identity, "url": before[identity].url} for identity in removed],
        "coverageGaps": coverage_gaps,
        "regressions": regressions,
    }


def _safe_csv(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(_DANGEROUS_CSV_PREFIXES):
        return f"'{value}"
    return value


def _safe_markdown(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _format_delta(values: dict[str, float | None]) -> str:
    if values["before"] is None or values["after"] is None:
        return "unavailable"
    return "{before:.6g} → {after:.6g} ({delta:+.6g})".format(
        before=values["before"], after=values["after"], delta=values["delta"]
    )


def write_json(report: dict[str, Any], handle: TextIO) -> None:
    json.dump(report, handle, indent=2, allow_nan=False)
    handle.write("\n")


def write_csv(report: dict[str, Any], handle: TextIO) -> None:
    fields = [
        "identity",
        "name",
        "before_url",
        "after_url",
        "before_status",
        "after_status",
        *(
            field
            for metric in ("a11yViolations", *_PERFORMANCE_METRICS)
            for field in (f"{metric}_before", f"{metric}_after", f"{metric}_delta")
        ),
        "new_budget_failures",
        "regressions",
        "coverage_gaps",
    ]
    writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for page in report["pages"]:
        row = {
            "identity": _safe_csv(page["identity"]),
            "name": _safe_csv(page["name"] or ""),
            "before_url": _safe_csv(page["beforeUrl"]),
            "after_url": _safe_csv(page["afterUrl"]),
            "before_status": page["beforeStatus"] or "",
            "after_status": page["afterStatus"] or "",
            "new_budget_failures": ";".join(page["newBudgetFailures"]),
            "regressions": ";".join(page["regressions"]),
            "coverage_gaps": ";".join(page["coverageGaps"]),
        }
        for metric, values in page["metrics"].items():
            row[f"{metric}_before"] = values["before"]
            row[f"{metric}_after"] = values["after"]
            row[f"{metric}_delta"] = values["delta"]
        writer.writerow({key: _safe_csv(value) for key, value in row.items()})


def write_markdown(report: dict[str, Any], handle: TextIO) -> None:
    lines = [
        "# WQG audit comparison",
        "",
        f"Status: {_safe_markdown(report['comparisonStatus'])}",
        "",
        "| Page | Before URL | After URL | Status | A11y delta | Perf delta | LCP delta | CLS delta | TBT delta | Regressions | Coverage gaps |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---|---|",
    ]
    for page in report["pages"]:
        status = f"{page['beforeStatus'] or 'unavailable'} → {page['afterStatus'] or 'unavailable'}"
        lines.append(
            "| {identity} | {before_url} | {after_url} | {status} | {a11y} | {performance} | {lcp} | {cls} | {tbt} | {regressions} | {coverage} |".format(
                identity=_safe_markdown(page["identity"]),
                before_url=_safe_markdown(page["beforeUrl"]),
                after_url=_safe_markdown(page["afterUrl"]),
                status=_safe_markdown(status),
                a11y=_safe_markdown(_format_delta(page["metrics"]["a11yViolations"])),
                performance=_safe_markdown(_format_delta(page["metrics"]["performanceScore"])),
                lcp=_safe_markdown(_format_delta(page["metrics"]["lcpMs"])),
                cls=_safe_markdown(_format_delta(page["metrics"]["cls"])),
                tbt=_safe_markdown(_format_delta(page["metrics"]["tbtMs"])),
                regressions=_safe_markdown(", ".join(page["regressions"]) or "none"),
                coverage=_safe_markdown(", ".join(page["coverageGaps"]) or "none"),
            )
        )
    if report["addedPages"]:
        lines.extend(["", "## Added pages", ""])
        lines.extend(f"- {_safe_markdown(page['identity'])}: {_safe_markdown(page['url'])}" for page in report["addedPages"])
    if report["removedPages"]:
        lines.extend(["", "## Coverage gaps", ""])
        lines.extend(f"- Removed page: {_safe_markdown(page['identity'])}" for page in report["removedPages"])
    handle.write("\n".join(lines) + "\n")
