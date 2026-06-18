from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from go_issue_agent.core.json_utils import parse_json_from_text


class GeminiProvider:
    def __init__(self, api_key: str | None = None, model: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.model = model or os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        self.base_url = base_url or "https://generativelanguage.googleapis.com/v1beta"

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def generate(self, system: str | None, prompt: str, json_mode: bool = False, temperature: float = 0.2, google_search: bool = False) -> str:
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is required unless offline mode is enabled")

        url = f"{self.base_url}/models/{self.model}:generateContent?key={urllib.parse.quote(self.api_key)}"
        body = {
            "systemInstruction": {"parts": [{"text": system}]} if system else None,
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature},
        }
        if json_mode and not google_search:
            body["generationConfig"]["responseMimeType"] = "application/json"
        if google_search:
            body["tools"] = [{"googleSearch": {}}]

        request = urllib.request.Request(
            url,
            data=json.dumps({key: value for key, value in body.items() if value is not None}).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Gemini {self.model} request failed ({error.code}): {detail}") from error

        parts = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        text = "".join(part.get("text", "") for part in parts).strip()
        if not text:
            raise RuntimeError(f"Gemini {self.model} returned no text")
        return text

    def generate_json(self, **kwargs):
        return parse_json_from_text(self.generate(json_mode=True, **kwargs))


def create_model(offline: bool = False, logger=None):
    provider = GeminiProvider()
    if offline or not provider.available:
        if not provider.available and logger:
            logger.warn("GEMINI_API_KEY not set; using deterministic offline agents.")
        return None
    return provider
