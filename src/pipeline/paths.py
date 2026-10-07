"""Canonical repository paths. Everything is resolved relative to the repo root."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
MANIFEST_PATH = DATA_DIR / "manifest.json"
WEB_DATA_DIR = REPO_ROOT / "web" / "public" / "data"
LOG_DIR = DATA_DIR / "logs"
