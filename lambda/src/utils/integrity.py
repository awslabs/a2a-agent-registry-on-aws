"""Content-addressed AgentCard integrity.

A ``card_ref`` is a portable, deterministic identifier for an AgentCard:

    card_ref = "sha256:" + SHA-256( RFC 8785 JCS( agent_card ) )

Because the preimage is the RFC 8785 (JSON Canonicalization Scheme) encoding of
the card, the reference is independent of key order and insignificant
whitespace, so any party that holds the same AgentCard recomputes the same
``card_ref`` byte-for-byte. That lets a consumer verify that the card served by
this registry is the card the agent actually published (fetch the agent's own
AgentCard, recompute, compare), and gives every card a stable content-addressed
identity for correlation and de-duplication across registries.

RFC 8785 is used deliberately rather than ``json.dumps(sort_keys=True)``: the
latter diverges from other implementations on non-ASCII escaping, supplementary
plane (non-BMP) key ordering, and integer-valued floats, which would make the
reference non-reproducible across languages. See RFC 8785.

This module intentionally does not sign the card; ``card_ref`` is an integrity
and identity primitive, not an authenticity one. Signing/anchoring can be
layered on top by referencing the ``card_ref``.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any, Dict

import rfc8785

CARD_REF_PREFIX = "sha256:"


def compute_card_ref(agent_card: Dict[str, Any]) -> str:
    """Return the content-addressed ``card_ref`` for an AgentCard.

    Args:
        agent_card: The AgentCard as a JSON-compatible dict.

    Returns:
        ``"sha256:<hex>"`` over the RFC 8785 JCS encoding of ``agent_card``.
    """
    canonical = rfc8785.dumps(agent_card)
    return CARD_REF_PREFIX + hashlib.sha256(canonical).hexdigest()


def verify_card_ref(agent_card: Dict[str, Any], expected_ref: str) -> bool:
    """Return True iff ``agent_card`` recomputes to ``expected_ref``.

    Uses a constant-time comparison so a caller can verify a card against an
    advertised reference without leaking timing information.
    """
    computed = compute_card_ref(agent_card)
    return hmac.compare_digest(computed, expected_ref)
