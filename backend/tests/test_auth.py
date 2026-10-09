"""帳號系統測試：註冊／登入／登出／權杖守衛／島嶼上雲。"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DAWN_DB", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def _register(client, name="小月", password="pass1234"):
    return client.post("/api/v1/auth/register", json={"name": name, "password": password})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_and_me(client):
    r = _register(client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["ok"] and body["token"]
    assert body["user"]["name"] == "小月"

    me = client.get("/api/v1/auth/me", headers=_auth(body["token"]))
    assert me.status_code == 200
    assert me.json()["user"]["name"] == "小月"


def test_register_duplicate_name(client):
    assert _register(client, name="阿星").status_code == 201
    r2 = _register(client, name="阿星")
    assert r2.status_code == 400
    assert "已經被使用" in r2.json()["detail"]


def test_register_validation(client):
    assert _register(client, name="  ").status_code == 400
    assert _register(client, name="x" * 21).status_code == 400
    assert _register(client, name="短密碼", password="123").status_code == 400


def test_login_ok_and_wrong_password(client):
    _register(client, name="登入者", password="secret99")
    ok = client.post("/api/v1/auth/login", json={"name": "登入者", "password": "secret99"})
    assert ok.status_code == 200
    assert ok.json()["user"]["name"] == "登入者"

    bad = client.post("/api/v1/auth/login", json={"name": "登入者", "password": "wrongpw"})
    assert bad.status_code == 401

    missing = client.post("/api/v1/auth/login", json={"name": "不存在的人", "password": "secret99"})
    assert missing.status_code == 401


def test_login_rotates_token(client):
    r1 = _register(client, name="輪換", password="pass1234")
    t1 = r1.json()["token"]
    r2 = client.post("/api/v1/auth/login", json={"name": "輪換", "password": "pass1234"})
    t2 = r2.json()["token"]
    assert t1 != t2
    # 舊權杖失效
    assert client.get("/api/v1/auth/me", headers=_auth(t1)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=_auth(t2)).status_code == 200


def test_logout(client):
    r = _register(client, name="登出者", password="pass1234")
    token = r.json()["token"]
    out = client.post("/api/v1/auth/logout", headers=_auth(token))
    assert out.status_code == 200
    assert client.get("/api/v1/auth/me", headers=_auth(token)).status_code == 401


def test_island_requires_login(client):
    r = _register(client, name="島主", password="pass1234")
    uid = r.json()["user"]["id"]
    # 無權杖 → 401
    assert client.get(f"/api/v1/islands/{uid}").status_code == 401
    assert client.post(f"/api/v1/islands/{uid}/expand",
                       json={"action": "complete_topic"}).status_code == 401
    # 錯誤權杖 → 401
    assert client.get(f"/api/v1/islands/{uid}",
                      headers=_auth("bogus")).status_code == 401


def test_island_forbidden_for_other_user(client):
    a = _register(client, name="甲", password="pass1234").json()
    b = _register(client, name="乙", password="pass1234").json()
    # 乙拿甲的 user_id → 403
    r = client.get(f"/api/v1/islands/{a['user']['id']}", headers=_auth(b["token"]))
    assert r.status_code == 403


def test_island_expand_persists(client):
    r = _register(client, name="拓荒者", password="pass1234").json()
    uid, headers = r["user"]["id"], _auth(r["token"])

    s0 = client.get(f"/api/v1/islands/{uid}", headers=headers).json()
    assert s0["territory"] == 1.0

    exp = client.post(f"/api/v1/islands/{uid}/expand",
                      json={"action": "complete_topic"}, headers=headers)
    assert exp.status_code == 200
    assert exp.json()["ok"] is True

    s1 = client.get(f"/api/v1/islands/{uid}", headers=headers).json()
    assert s1["territory"] > s0["territory"]

    logs = client.get(f"/api/v1/islands/{uid}/logs", headers=headers).json()["logs"]
    assert len(logs) >= 1
    assert logs[0]["action"] == "complete_topic"


def test_old_user_without_password_cannot_login(client):
    # 模擬舊版 users 表殘留的無密碼帳號（ensure_user 產生）：登入應被拒絕
    from app import db
    with db.get_conn() as conn:
        conn.execute("INSERT INTO users (id, name) VALUES (?, ?)", ("legacy1", "老人"))
    r = client.post("/api/v1/auth/login", json={"name": "老人", "password": "whatever"})
    assert r.status_code == 401
