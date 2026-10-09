"""收藏測試：需登入／加入／重複加入冪等／取消／隔離。"""
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


def _reg(client, name="藏書人", password="pass1234"):
    r = client.post("/api/v1/auth/register", json={"name": name, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_requires_login(client):
    assert client.get("/api/v1/favorites").status_code == 401
    assert client.post("/api/v1/favorites", json={"content_id": "c1"}).status_code == 401
    assert client.delete("/api/v1/favorites/c1").status_code == 401


def test_add_list_remove(client):
    token = _reg(client)["token"]
    h = _auth(token)
    assert client.get("/api/v1/favorites", headers=h).json()["favorites"] == []

    r = client.post("/api/v1/favorites", json={"content_id": "c1"}, headers=h)
    assert r.status_code == 201, r.text
    # 重複加入冪等
    r2 = client.post("/api/v1/favorites", json={"content_id": "c1"}, headers=h)
    assert r2.status_code == 201
    client.post("/api/v1/favorites", json={"content_id": "c2"}, headers=h)

    favs = client.get("/api/v1/favorites", headers=h).json()["favorites"]
    assert sorted(favs) == ["c1", "c2"]

    d = client.delete("/api/v1/favorites/c1", headers=h)
    assert d.status_code == 200
    favs = client.get("/api/v1/favorites", headers=h).json()["favorites"]
    assert favs == ["c2"]


def test_isolated_between_users(client):
    t1 = _reg(client, name="甲")["token"]
    t2 = _reg(client, name="乙")["token"]
    client.post("/api/v1/favorites", json={"content_id": "cx"}, headers=_auth(t1))
    assert client.get("/api/v1/favorites", headers=_auth(t2)).json()["favorites"] == []
    # 乙不能刪甲的
    client.delete("/api/v1/favorites/cx", headers=_auth(t2))
    assert client.get("/api/v1/favorites", headers=_auth(t1)).json()["favorites"] == ["cx"]


def test_empty_content_id_rejected(client):
    token = _reg(client, name="丙")["token"]
    r = client.post("/api/v1/favorites", json={"content_id": "  "}, headers=_auth(token))
    assert r.status_code == 400
