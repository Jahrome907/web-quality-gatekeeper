#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import TextIO

from wqg_python_tools.compare_runs import (
    ComparisonInputError,
    compare_summaries,
    load_summary,
    write_csv,
    write_json,
    write_markdown,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare two offline WQG SummaryV2 reports.")
    parser.add_argument("--before", required=True, help="Earlier summary.v2.json report.")
    parser.add_argument("--after", required=True, help="Later summary.v2.json report.")
    parser.add_argument("--format", choices=("json", "markdown", "csv"), default="json")
    parser.add_argument("--output", help="Write output to this path instead of standard output.")
    parser.add_argument("--fail-on-regression", action="store_true", help="Exit 1 when comparable reports contain regressions.")
    return parser.parse_args()


def _write(report: dict, output_format: str, handle: TextIO) -> None:
    writers = {"json": write_json, "markdown": write_markdown, "csv": write_csv}
    writers[output_format](report, handle)


def main() -> int:
    args = parse_args()
    try:
        before = load_summary(Path(args.before))
        after = load_summary(Path(args.after))
        report = compare_summaries(before, after)
    except ComparisonInputError as error:
        print(f"Comparison unavailable: {error}", file=sys.stderr)
        return 2

    if args.output:
        try:
            destination = Path(args.output)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("w", encoding="utf-8", newline="" if args.format == "csv" else None) as handle:
                _write(report, args.format, handle)
        except OSError as error:
            print(f"Comparison unavailable: unable to write output: {error}", file=sys.stderr)
            return 2
    else:
        # Reports use Unicode arrows in Markdown. Keep piped output UTF-8 even when a caller sets
        # PYTHONIOENCODING to a legacy Windows code page.
        sys.stdout.reconfigure(encoding="utf-8")
        _write(report, args.format, sys.stdout)

    if report["comparisonStatus"] != "comparable":
        return 2
    if args.fail_on_regression and report["regressions"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
