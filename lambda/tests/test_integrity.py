"""Unit tests for content-addressed AgentCard integrity (card_ref)."""

import hashlib
import json
import re

import pytest
import rfc8785

from src.utils.integrity import CARD_REF_PREFIX, compute_card_ref, verify_card_ref

CARD = {
    "protocolVersion": "0.3.0",
    "name": "Weather Agent",
    "description": "Forecasts",
    "url": "https://a.example/agent",
    "version": "1.0.0",
    "capabilities": {"streaming": True},
    "skills": [{"id": "forecast", "name": "Forecast", "tags": ["weather"]}],
}


class TestComputeCardRef:
    def test_format_is_sha256_prefixed_hex(self):
        ref = compute_card_ref(CARD)
        assert re.fullmatch(r"sha256:[0-9a-f]{64}", ref)

    def test_matches_rfc8785_jcs_over_sha256(self):
        # The reference must be SHA-256 of the RFC 8785 JCS encoding, so any
        # independent implementation recomputes the same value.
        expected = CARD_REF_PREFIX + hashlib.sha256(rfc8785.dumps(CARD)).hexdigest()
        assert compute_card_ref(CARD) == expected

    def test_deterministic(self):
        assert compute_card_ref(CARD) == compute_card_ref(dict(CARD))

    def test_key_order_invariant(self):
        # JCS sorts keys, so an input with a different insertion order (and
        # reordered nested keys) yields the same reference.
        reordered = {
            "skills": [{"tags": ["weather"], "name": "Forecast", "id": "forecast"}],
            "capabilities": {"streaming": True},
            "version": "1.0.0",
            "url": "https://a.example/agent",
            "description": "Forecasts",
            "name": "Weather Agent",
            "protocolVersion": "0.3.0",
        }
        assert compute_card_ref(reordered) == compute_card_ref(CARD)

    def test_jcs_edge_cases_are_stable(self):
        # Non-BMP (supplementary plane) key, combining char, integer-valued
        # float, and integer-string keys: json.dumps(sort_keys=True) would
        # diverge from other languages here; RFC 8785 does not.
        edge = {"z": "\u00e9", "a": "\U0001f600", "2": 2.0, "1": 1}
        expected = CARD_REF_PREFIX + hashlib.sha256(rfc8785.dumps(edge)).hexdigest()
        assert compute_card_ref(edge) == expected

    def test_supplementary_plane_key_uses_utf16_order_not_code_point(self):
        # The sharp edge of canonicalization: a supplementary-plane (non-BMP)
        # key alongside a BMP key. json.dumps(sort_keys=True) orders keys by
        # code point, which puts U+FFFF before the emoji; RFC 8785 orders by
        # UTF-16 code unit, which puts the emoji (first code unit 0xD83D) first.
        # card_ref must follow RFC 8785, so it differs from a naive sort_keys
        # hash of the same card. This is why "keys sorted ASC" is not enough.
        card = {"\U0001f621": 2, "\uffff": 1}  # emoji U+1F621 key, U+FFFF key
        assert compute_card_ref(card) == (
            CARD_REF_PREFIX + hashlib.sha256(rfc8785.dumps(card)).hexdigest()
        )
        naive = json.dumps(card, sort_keys=True, ensure_ascii=False).encode("utf-8")
        naive_ref = CARD_REF_PREFIX + hashlib.sha256(naive).hexdigest()
        assert compute_card_ref(card) != naive_ref

    def test_any_change_changes_the_ref(self):
        tampered = dict(CARD)
        tampered["url"] = "https://evil.example/agent"
        assert compute_card_ref(tampered) != compute_card_ref(CARD)


class TestVerifyCardRef:
    def test_verify_true_for_matching_card(self):
        assert verify_card_ref(CARD, compute_card_ref(CARD)) is True

    def test_verify_false_for_tampered_card(self):
        ref = compute_card_ref(CARD)
        tampered = dict(CARD)
        tampered["name"] = "Impostor Agent"
        assert verify_card_ref(tampered, ref) is False

    def test_verify_false_for_wrong_ref(self):
        assert verify_card_ref(CARD, "sha256:" + "0" * 64) is False
