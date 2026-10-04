"""Match imported transactions to bills using a simple scoring heuristic."""
from __future__ import annotations
from typing import Optional


def match_bill(description: str, amount: float, bills: list) -> Optional[int]:
    if not description:
        return None
    desc = description.lower()
    best_id, best_score = None, 0
    for b in bills:
        score = 0
        n = (b.name or "").lower()
        if n and n in desc:
            score += 4
        else:
            tokens = [t for t in n.split() if len(t) > 3]
            for t in tokens:
                if t in desc:
                    score += 2
        ba = float(b.amount or 0)
        if ba and abs(abs(amount) - ba) / max(ba, 1) < 0.05:
            score += 3
        if score > best_score:
            best_id, best_score = b.id, score
    return best_id if best_score >= 4 else None
