#!/usr/bin/env python3
"""Convenience launcher for the J.A.R.V.I.S. Python Core.

Usage::

    python run_jarvis_core.py            # start the API on 127.0.0.1:8765
    python run_jarvis_core.py status     # talk to a running core
    python run_jarvis_core.py exec ps    # run a core directive
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jarvis_core.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
