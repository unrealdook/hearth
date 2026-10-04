"""
Fernet encryption for stored bill credentials.

The Fernet key is derived from the user's 4-digit passcode at unlock time
(see auth.derive_fernet_key) and lives only in the in-memory session.
"""
from __future__ import annotations
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken


def _f(key_b64: str) -> Fernet:
    return Fernet(key_b64.encode("ascii"))


def encrypt(value: Optional[str], key_b64: str) -> Optional[bytes]:
    if value is None or value == "":
        return None
    return _f(key_b64).encrypt(value.encode("utf-8"))


def decrypt(blob: Optional[bytes], key_b64: str) -> Optional[str]:
    if blob is None:
        return None
    try:
        return _f(key_b64).decrypt(blob).decode("utf-8")
    except InvalidToken:
        return None
