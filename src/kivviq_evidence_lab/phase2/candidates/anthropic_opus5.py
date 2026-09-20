from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

FIXED_PROVIDER = "anthropic"
FIXED_MODEL_ID = "claude-opus-5"
FIXED_MAX_TOKENS = 4096
FIXED_THINKING_TYPE = "adaptive"
FIXED_EFFORT = "high"
FIXED_ANTHROPIC_VERSION = "2023-06-01"
FIXED_ENDPOINT = "https://api.anthropic.com/v1/messages"
API_KEY_ENV = "ANTHROPIC_API_KEY"


def fixed_inference_settings() -> dict[str, object]:
    return {
        "provider": FIXED_PROVIDER,
        "model_id": FIXED_MODEL_ID,
        "max_tokens": FIXED_MAX_TOKENS,
        "thinking": {"type": FIXED_THINKING_TYPE},
        "output_config": {"effort": FIXED_EFFORT},
        "temperature": "omitted",
        "top_p": "omitted",
        "top_k": "omitted",
        "anthropic_version": FIXED_ANTHROPIC_VERSION,
        "tools": "none",
    }


def _request_body(system_prompt: str, user_prompt: str) -> dict[str, object]:
    return {
        "model": FIXED_MODEL_ID,
        "max_tokens": FIXED_MAX_TOKENS,
        "thinking": {"type": FIXED_THINKING_TYPE},
        "output_config": {"effort": FIXED_EFFORT},
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }


class AnthropicOpus5Backend:
    """Fixed Candidate 1 Anthropic backend.

    Sampling controls are intentionally not configurable. This backend sends no
    evidence facts, governor decisions, tools, or merchant data: only synthetic
    research prompts produced by Candidate 1.
    """

    model_id = FIXED_MODEL_ID

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("Anthropic API key is required")
        self._api_key = api_key

    @classmethod
    def from_env(cls) -> "AnthropicOpus5Backend":
        api_key = os.environ.get(API_KEY_ENV, "")
        if not api_key:
            raise RuntimeError(
                "Candidate 1 requires the research-only ANTHROPIC_API_KEY environment variable"
            )
        return cls(api_key)

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        body = json.dumps(_request_body(system_prompt, user_prompt)).encode("utf-8")
        request = Request(
            FIXED_ENDPOINT,
            data=body,
            headers={
                "content-type": "application/json",
                "x-api-key": self._api_key,
                "anthropic-version": FIXED_ANTHROPIC_VERSION,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=120) as response:  # noqa: S310
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            raise RuntimeError(f"Anthropic Candidate 1 request failed with HTTP {exc.code}") from exc
        except URLError as exc:
            raise RuntimeError("Anthropic Candidate 1 request failed at the network layer") from exc

        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise RuntimeError("Anthropic response must be a JSON object")
        response_model = payload.get("model")
        if not isinstance(response_model, str) or not response_model.startswith(FIXED_MODEL_ID):
            raise RuntimeError(f"Unexpected Anthropic model response: {response_model!r}")
        content = payload.get("content")
        if not isinstance(content, list):
            raise RuntimeError("Anthropic response content must be an array")
        texts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str):
                    texts.append(text)
        if not texts:
            raise RuntimeError("Anthropic response contained no text block")
        return "\n".join(texts)
