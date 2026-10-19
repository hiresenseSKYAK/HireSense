"""Small, environment-backed settings surface for AI interview providers."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


@dataclass(frozen=True)
class InterviewAISettings:
    api_key: str
    model: str
    timeout_seconds: float
    max_output_tokens: int
    max_retries: int

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)


def get_interview_ai_settings() -> InterviewAISettings:
    return InterviewAISettings(
        api_key=(os.getenv("OPENAI_API_KEY") or "").strip(),
        model=(os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip() or "gpt-4o-mini",
        timeout_seconds=_bounded_float("OPENAI_TIMEOUT_SECONDS", 20.0, 5.0, 60.0),
        max_output_tokens=_bounded_int("OPENAI_MAX_OUTPUT_TOKENS", 1800, 256, 4000),
        max_retries=_bounded_int("OPENAI_MAX_RETRIES", 1, 0, 2),
    )
