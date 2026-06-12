"""Versión del backend LocalTv.

Fuente única de verdad para la versión que reporta la API (/api/health,
/api/updater/capabilities). Se sobreescribe en build vía la env LOCALTV_VERSION
(la misma que usa el frontend), con fallback al valor versionado acá.
"""
import os

APP_VERSION = os.getenv("LOCALTV_VERSION") or "1.2.13"
