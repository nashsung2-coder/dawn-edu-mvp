"""引路儀式測試：儲存人格／me 回傳／守衛。"""
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


def _register(client, name="引路人", password="pass1234"):
    r = client.post("/api/v1/auth/register", json={"name": name, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


PERSONA = {
    "role": "weaver",
    "role_name": "星圖織者",
    "axes": {"x": 0, "y": 4},
    "choices": [{"q": 1, "option": "星圖"}],
    "at": "2026-10-09",
}


def test_save_and_me_returns_persona(client):
    reg = _register(client)
    h = _auth(reg["token"])
    r = client.post("/api/v1/auth/persona", json={"persona": PERSONA}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] and body["persona"]["role"] == "weaver"
    assert body["persona"]["choices"][0]["option"] == "星圖"

    me = client.get("/api/v1/auth/me", headers=h)
    assert me.status_code == 200
    assert me.json()["user"]["persona"]["role_name"] == "星圖織者"


def test_persona_requires_login(client):
    assert client.post("/api/v1/auth/persona", json={"persona": PERSONA}).status_code == 401


def test_persona_validation(client):
    reg = _register(client, name="驗證者")
    h = _auth(reg["token"])
    # 缺少 role
    bad = client.post("/api/v1/auth/persona", json={"persona": {"axes": {}}}, headers=h)
    assert bad.status_code == 400
    # 非物件
    bad2 = client.post("/api/v1/auth/persona", json={"persona": [1, 2]}, headers=h)
    assert bad2.status_code in (400, 422)
