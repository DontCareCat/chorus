from datetime import timedelta

import httpx
import pytest

from app.db.models.types import utcnow
from app.services.lyrics.cache import CachedLrclib
from app.services.lyrics.lrclib import LrclibClient, LrclibUnavailable
from tests.conftest import FakeLrclib, lrclib_json


def test_get_found_and_404(lrclib: FakeLrclib):
    c = lrclib.client()
    assert c.get("a", "b", None, 10) is None
    lrclib.get_result = lrclib_json()
    assert c.get("a", "b", "alb", 10)["id"] == 1


def test_retries_5xx_then_gives_up(lrclib: FakeLrclib):
    lrclib.status = 503
    c = lrclib.client()
    with pytest.raises(LrclibUnavailable):
        c.get("a", "b", None, 10)
    assert len(lrclib.calls) == 3


def test_retry_recovers_from_transient_503():
    n = {"i": 0}

    def handler(req):
        n["i"] += 1
        return httpx.Response(503) if n["i"] < 3 else httpx.Response(200, json=[])

    c = LrclibClient(httpx.Client(transport=httpx.MockTransport(handler), base_url="https://x/api"), backoff=0, sleep=lambda _: None)
    assert c.search("q") == [] and n["i"] == 3


def test_network_error_is_unavailable():
    def handler(req):
        raise httpx.ConnectError("down")

    c = LrclibClient(httpx.Client(transport=httpx.MockTransport(handler), base_url="https://x/api"), backoff=0, sleep=lambda _: None)
    with pytest.raises(LrclibUnavailable):
        c.search("q")


def test_cache_hit_avoids_second_request(session, lrclib: FakeLrclib):
    lrclib.search_result = [lrclib_json()]
    cache = CachedLrclib(lrclib.client(), session, ttl_days=30)
    cache.search("Rammstein  Du hast")
    cache.search("rammstein du hast")  # normalised key
    assert len(lrclib.calls) == 1


def test_negative_results_are_cached_too(session, lrclib: FakeLrclib):
    cache = CachedLrclib(lrclib.client(), session, ttl_days=30)
    assert cache.get("a", "b", None, 10) is None
    assert cache.get("a", "b", None, 10) is None
    assert len(lrclib.calls) == 1


def test_ttl_expiry_refetches(session, lrclib: FakeLrclib):
    clock = {"now": utcnow()}
    cache = CachedLrclib(lrclib.client(), session, ttl_days=1, now=lambda: clock["now"])
    cache.search("q")
    clock["now"] += timedelta(hours=23)
    cache.search("q")
    assert len(lrclib.calls) == 1
    clock["now"] += timedelta(hours=2)
    cache.search("q")
    assert len(lrclib.calls) == 2


def test_ttl_zero_means_forever(session, lrclib: FakeLrclib):
    clock = {"now": utcnow()}
    cache = CachedLrclib(lrclib.client(), session, ttl_days=0, now=lambda: clock["now"])
    cache.search("q")
    clock["now"] += timedelta(days=36500)
    cache.search("q")
    assert len(lrclib.calls) == 1


def test_stale_entry_served_when_lrclib_down(session, lrclib: FakeLrclib):
    clock = {"now": utcnow()}
    cache = CachedLrclib(lrclib.client(), session, ttl_days=1, now=lambda: clock["now"])
    lrclib.search_result = [lrclib_json(id=7)]
    cache.search("q")
    clock["now"] += timedelta(days=5)
    lrclib.status = 503
    assert cache.search("q")[0].id == 7


def test_down_without_cache_raises(session, lrclib: FakeLrclib):
    lrclib.status = 503
    with pytest.raises(LrclibUnavailable):
        CachedLrclib(lrclib.client(), session, 30).search("q")


def test_clear(session, lrclib: FakeLrclib):
    cache = CachedLrclib(lrclib.client(), session, 30)
    cache.search("q")
    assert cache.clear() == 1
    cache.search("q")
    assert len(lrclib.calls) == 2
