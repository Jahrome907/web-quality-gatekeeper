#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from wqg_python_tools.case_study_analytics import (
    build_report,
    load_bundle,
    write_csv_report,
    write_json_report,
    write_markdown_report,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze one or more WQG case-study bundle directories."
    )
    parser.add_argument(
        "--bundle",
        action="append",
        default=[],
        help="Bundle directory containing summary.v2.json and optional provenance/roi files.",
    )
    parser.add_argument("--json-out", help="Write normalized JSON output to this path.")
    parser.add_argument("--csv-out", help="Write CSV output to this path.")
    parser.add_argument("--markdown-out", help="Write Markdown output to this path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.bundle:
        print("At least one --bundle path is required.", file=sys.stderr)
        return 2

    rows = [load_bundle(Path(bundle).resolve()) for bundle in args.bundle]
    report = build_report(rows)

    if args.json_out:
        write_json_report(report, Path(args.json_out).resolve())
    if args.csv_out:
        write_csv_report(rows, Path(args.csv_out).resolve())
    if args.markdown_out:
        write_markdown_report(rows, Path(args.markdown_out).resolve())

    if not args.json_out and not args.csv_out and not args.markdown_out:
        print(json.dumps(report, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
