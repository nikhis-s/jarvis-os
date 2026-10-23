"""J.A.R.V.I.S. Python Core.

A local FastAPI service that powers the J.A.R.V.I.S. HUD with real
system telemetry, a sandboxed virtual filesystem, a command engine,
server-sent events and a CLI client.

The browser frontend is the "view"; this package is the "brain".
"""

from __future__ import annotations

from .config import CORE_VERSION, CoreConfig

__all__ = ["CORE_VERSION", "CoreConfig", "__version__"]

__version__ = CORE_VERSION
