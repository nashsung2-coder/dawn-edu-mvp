"""星砂經濟測試：state／earn／buy／擴張發放／守衛。"""
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


def _register(client, name="星砂客", password="pass1234"):
    return client.post("/api/v1/auth/register", json={"name": name, "password": password})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _token(client):
    r = _register(client)
    assert r.status_code == 201, r.text
    return r.json()["token"], r.json()["user"]["id"]


def test_state_initial_zero(client):
    token, _ = _token(client)
    r = client.get("/api/v1/game/state", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] and body["points"] == 0 and body["inventory"] == {}


def test_state_requires_login(client):
    assert client.get("/api/v1/game/state").status_code == 401
    assert client.get("/api/v1/game/state", headers=_auth("nope")).status_code == 401


def test_earn_and_cap(client):
    token, _ = _token(client)
    h = _auth(token)
    r = client.post("/api/v1/game/earn", json={"amount": 20, "reason": "對決勝利"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["points"] == 20
    # 單次上限 50：要求 999 只給 50
    r2 = client.post("/api/v1/game/earn", json={"amount": 999, "reason": "刷"}, headers=h)
    assert r2.status_code == 200
    assert r2.json()["earned"] == 50
    assert r2.json()["points"] == 70
    # 非正數拒絕
    assert client.post("/api/v1/game/earn", json={"amount": 0}, headers=h).status_code == 400


def test_buy_ok_and_poor(client):
    token, _ = _token(client)
    h = _auth(token)
    # 身無分文買不起
    poor = client.post("/api/v1/game/shop/buy", json={"item_id": "dart"}, headers=h)
    assert poor.status_code == 400
    assert "星砂不足" in poor.json()["detail"]
    # 賺錢再買
    client.post("/api/v1/game/earn", json={"amount": 50}, headers=h)
    ok = client.post("/api/v1/game/shop/buy", json={"item_id": "dart"}, headers=h)
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["points"] == 30
    assert body["inventory"] == {"dart": 1}
    # 不存在的武器
    bad = client.post("/api/v1/game/shop/buy", json={"item_id": "nuke"}, headers=h)
    assert bad.status_code == 400


def test_expand_awards_points(client):
    token, uid = _token(client)
    h = _auth(token)
    r = client.post(f"/api/v1/islands/{uid}/expand",
                    json={"action": "complete_topic"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["points"] == 10
    assert "星砂" in body["reason"]
    st = client.get("/api/v1/game/state", headers=h).json()
    assert st["points"] == 10
