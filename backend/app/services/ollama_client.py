"""Thin wrapper around the local Ollama HTTP API."""
from __future__ import annotations
import json
import requests
from typing import Iterable


class OllamaError(RuntimeError):
    pass


def chat(base_url: str, model: str, messages: list[dict], timeout: int = 120,
         fmt: str | None = None) -> str:
    url = f"{base_url.rstrip('/')}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
    }
    if fmt:
        # Ollama: format="json" constrains the model to emit valid JSON.
        payload["format"] = fmt
    try:
        r = requests.post(url, json=payload, timeout=timeout)
    except requests.RequestException as e:
        raise OllamaError(f"Could not reach Ollama at {url}: {e}") from e
    if r.status_code != 200:
        raise OllamaError(f"Ollama returned {r.status_code}: {r.text[:300]}")
    payload = r.json()
    msg = payload.get("message") or {}
    return msg.get("content", "")


def is_running(base_url: str, timeout: int = 3) -> bool:
    try:
        r = requests.get(f"{base_url.rstrip('/')}/api/tags", timeout=timeout)
        return r.status_code == 200
    except requests.RequestException:
        return False


def list_models(base_url: str, timeout: int = 5) -> list[dict]:
    """Return [{name, size, parameter_size, family}, …] for chat-capable models.
    Filters out embedding-only families like nomic-bert."""
    try:
        r = requests.get(f"{base_url.rstrip('/')}/api/tags", timeout=timeout)
    except requests.RequestException:
        return []
    if r.status_code != 200:
        return []
    out = []
    for m in (r.json() or {}).get("models", []) or []:
        details = m.get("details") or {}
        family = (details.get("family") or "").lower()
        # heuristic: embedding models aren't useful for chat
        if "bert" in family or "embed" in (m.get("name") or "").lower():
            continue
        out.append({
            "name": m.get("name"),
            "size": m.get("size"),
            "parameter_size": details.get("parameter_size"),
            "family": details.get("family"),
        })
    return out
