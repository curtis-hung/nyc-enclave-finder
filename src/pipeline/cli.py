"""Command-line entry point: `uv run pipeline <command>`."""

from __future__ import annotations

import argparse
import sys


def _cmd_fetch(args: argparse.Namespace) -> int:
    from pipeline.fetch.registry import run_fetch

    return run_fetch(refresh=args.refresh, only=args.only)


def _cmd_build(args: argparse.Namespace) -> int:
    from pipeline.build.run import run_build

    return run_build()


def _cmd_report(args: argparse.Namespace) -> int:
    from pipeline.report import run_report

    return run_report()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline", description="NYC Enclave Finder data pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="Download source snapshots into data/raw/")
    p_fetch.add_argument("--refresh", action="store_true", help="Re-download even if a snapshot exists")
    p_fetch.add_argument("--only", nargs="*", default=None, help="Restrict to these source ids")
    p_fetch.set_defaults(func=_cmd_fetch)

    p_build = sub.add_parser("build", help="Build frontend assets from local snapshots")
    p_build.set_defaults(func=_cmd_build)

    p_report = sub.add_parser("report", help="Write docs/TAXONOMY.md and review figures")
    p_report.set_defaults(func=_cmd_report)

    args = parser.parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
