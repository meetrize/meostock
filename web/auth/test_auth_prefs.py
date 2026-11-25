"""鉴权 + 用户配置 API 基础测试。"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_path = tmp.name
    monkeypatch.setenv("QUOTE_CACHE_PATH", db_path)
    monkeypatch.setenv("AUTH_OPEN_REGISTER", "1")
    monkeypatch.setenv("AUTH_ADMIN_USER", "admin")
    monkeypatch.setenv("AUTH_ADMIN_PASSWORD", "admin-pass-99")

    # 强制新连接
    import cache.db as db_mod

    db_mod.close_db()
    db_mod.init_db()

    from auth.api import bootstrap_on_startup, router as auth_router
    from user_prefs.api import router as prefs_router

    bootstrap_on_startup()

    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(prefs_router)
    with TestClient(app) as c:
        yield c

    db_mod.close_db()
    Path(db_path).unlink(missing_ok=True)
    for suffix in ("-wal", "-shm"):
        Path(db_path + suffix).unlink(missing_ok=True)


def test_me_guest(client: TestClient):
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["user"] is None


def test_register_login_logout(client: TestClient):
    r = client.post(
        "/api/auth/register",
        json={"username": "alice", "password": "secret12"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["user"]["username"] == "alice"
    assert "meo_session" in r.cookies

    me = client.get("/api/auth/me")
    assert me.json()["user"]["username"] == "alice"

    client.post("/api/auth/logout")
    me2 = client.get("/api/auth/me")
    assert me2.json()["user"] is None

    bad = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "wrong"},
    )
    assert bad.status_code == 401

    ok = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "secret12"},
    )
    assert ok.status_code == 200
    assert ok.json()["user"]["username"] == "alice"


def test_prefs_requires_auth(client: TestClient):
    r = client.get("/api/user/prefs?namespace=dashboard")
    assert r.status_code == 401


def test_prefs_put_get_import(client: TestClient):
    client.post(
        "/api/auth/register",
        json={"username": "bob", "password": "secret12"},
    )
    put = client.put(
        "/api/user/prefs",
        json={
            "namespace": "dashboard",
            "items": [{"key": "watchlist.groups", "value": [{"id": "default", "codes": ["600036"]}]}],
        },
    )
    assert put.status_code == 200
    assert put.json()["ok"] is True
    items = put.json()["items"]
    assert len(items) == 1
    assert items[0]["rev"] == 1

    got = client.get("/api/user/prefs?namespace=dashboard")
    assert got.status_code == 200
    keys = {i["key"] for i in got.json()["items"]}
    assert "watchlist.groups" in keys

    # merge：已有 key 跳过
    imp = client.post(
        "/api/user/prefs/import",
        json={
            "namespace": "dashboard",
            "mode": "merge",
            "items": [
                {"key": "watchlist.groups", "value": [{"id": "default", "codes": []}]},
                {"key": "app.theme", "value": "dark"},
            ],
        },
    )
    assert imp.status_code == 200
    body = imp.json()
    assert body["written"] == 1
    assert body["skipped"] == 1

    got2 = client.get("/api/user/prefs?namespace=dashboard")
    by_key = {i["key"]: i["value"] for i in got2.json()["items"]}
    assert by_key["app.theme"] == "dark"
    assert by_key["watchlist.groups"][0]["codes"] == ["600036"]

    # overwrite
    imp2 = client.post(
        "/api/user/prefs/import",
        json={
            "namespace": "dashboard",
            "mode": "overwrite",
            "items": [
                {"key": "watchlist.groups", "value": [{"id": "default", "codes": ["000001"]}]},
            ],
        },
    )
    assert imp2.json()["written"] == 1
    got3 = client.get("/api/user/prefs?namespace=dashboard")
    by_key3 = {i["key"]: i["value"] for i in got3.json()["items"]}
    assert by_key3["watchlist.groups"][0]["codes"] == ["000001"]


def test_change_password(client: TestClient):
    client.post(
        "/api/auth/register",
        json={"username": "carol", "password": "oldpass1"},
    )
    bad = client.post(
        "/api/auth/change-password",
        json={"old_password": "nope", "new_password": "newpass1"},
    )
    assert bad.status_code == 400

    ok = client.post(
        "/api/auth/change-password",
        json={"old_password": "oldpass1", "new_password": "newpass1"},
    )
    assert ok.status_code == 200
    assert ok.json()["ok"] is True

    client.post("/api/auth/logout")
    login = client.post(
        "/api/auth/login",
        json={"username": "carol", "password": "newpass1"},
    )
    assert login.status_code == 200


def test_register_closed(monkeypatch: pytest.MonkeyPatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    db_path = tmp.name
    monkeypatch.setenv("QUOTE_CACHE_PATH", db_path)
    monkeypatch.setenv("AUTH_OPEN_REGISTER", "0")
    monkeypatch.setenv("AUTH_ADMIN_PASSWORD", "admin-pass-99")

    import cache.db as db_mod

    db_mod.close_db()
    db_mod.init_db()

    from auth.api import bootstrap_on_startup, router as auth_router
    from auth.store import open_register_enabled

    assert open_register_enabled() is False
    bootstrap_on_startup()

    app = FastAPI()
    app.include_router(auth_router)
    with TestClient(app) as c:
        cfg = c.get("/api/auth/config")
        assert cfg.json()["open_register"] is False
        r = c.post(
            "/api/auth/register",
            json={"username": "denied", "password": "secret12"},
        )
        assert r.status_code == 403

    db_mod.close_db()
    Path(db_path).unlink(missing_ok=True)


def test_admin_bootstrap_login(client: TestClient):
    r = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin-pass-99"},
    )
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "admin"


def test_password_hash_roundtrip():
    from auth.passwords import hash_password, verify_password

    h = hash_password("abc12345")
    assert verify_password("abc12345", h)
    assert not verify_password("wrong", h)
