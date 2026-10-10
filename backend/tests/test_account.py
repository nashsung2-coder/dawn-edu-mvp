"""帳號管理測試：Email／改密碼／忘記密碼／匯出／刪除。"""
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


def _reg(client, name="帳號人", password="pass1234", email=""):
    body = {"name": name, "password": password}
    if email:
        body["email"] = email
    r = client.post("/api/v1/auth/register", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_with_email(client):
    r = _reg(client, email="a@b.cc")
    assert r["user"]["email"] == "a@b.cc"
    # Email 重複
    dup = client.post("/api/v1/auth/register",
                      json={"name": "另一人", "password": "pass1234", "email": "a@b.cc"})
    assert dup.status_code == 400
    assert "Email" in dup.json()["detail"]
    # 格式錯誤
    bad = client.post("/api/v1/auth/register",
                      json={"name": "第三人", "password": "pass1234", "email": "not-an-email"})
    assert bad.status_code == 400


def test_update_email(client):
    token = _reg(client)["token"]
    h = _auth(token)
    r = client.patch("/api/v1/auth/me", json={"email": "new@x.yy"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "new@x.yy"
    me = client.get("/api/v1/auth/me", headers=h).json()
    assert me["user"]["email"] == "new@x.yy"
    # 清空
    r2 = client.patch("/api/v1/auth/me", json={"email": ""}, headers=h)
    assert r2.json()["email"] == ""


def test_change_password(client):
    reg = _reg(client, name="改密碼人")
    h = _auth(reg["token"])
    # 舊密碼錯誤
    bad = client.post("/api/v1/auth/password",
                      json={"old_password": "wrong", "new_password": "newpass1"}, headers=h)
    assert bad.status_code == 400
    # 成功
    ok = client.post("/api/v1/auth/password",
                     json={"old_password": "pass1234", "new_password": "newpass1"}, headers=h)
    assert ok.status_code == 200, ok.text
    # 舊 token 失效
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401
    # 新密碼可登入
    login = client.post("/api/v1/auth/login", json={"name": "改密碼人", "password": "newpass1"})
    assert login.status_code == 200


def test_forgot_password(client):
    _reg(client, name="健忘者", email="forget@x.yy")
    # Email 不符
    bad = client.post("/api/v1/auth/forgot",
                      json={"name": "健忘者", "email": "wrong@x.yy", "new_password": "newpass2"})
    assert bad.status_code == 400
    # 成功重設
    ok = client.post("/api/v1/auth/forgot",
                     json={"name": "健忘者", "email": "forget@x.yy", "new_password": "newpass2"})
    assert ok.status_code == 200, ok.text
    login = client.post("/api/v1/auth/login", json={"name": "健忘者", "password": "newpass2"})
    assert login.status_code == 200
    # 沒填 Email 的帳號不能用忘記密碼
    _reg(client, name="無信者")
    noemail = client.post("/api/v1/auth/forgot",
                          json={"name": "無信者", "email": "", "new_password": "newpass3"})
    assert noemail.status_code == 400


def test_export(client):
    reg = _reg(client, name="匯出者", email="e@x.yy")
    h = _auth(reg["token"])
    uid = reg["user"]["id"]
    client.post(f"/api/v1/islands/{uid}/expand", json={"action": "complete_topic"}, headers=h)
    client.post("/api/v1/favorites", json={"content_id": "c1"}, headers=h)
    r = client.get("/api/v1/export", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["name"] == "匯出者"
    assert d["user"]["email"] == "e@x.yy"
    assert len(d["territory_logs"]) == 1
    assert d["favorites"][0]["content_id"] == "c1"
    assert d["island"]["territory"] > 1


def test_delete_account(client):
    reg = _reg(client, name="刪除者", email="d@x.yy")
    h = _auth(reg["token"])
    uid = reg["user"]["id"]
    client.post(f"/api/v1/islands/{uid}/expand", json={"action": "complete_topic"}, headers=h)
    client.post("/api/v1/favorites", json={"content_id": "c1"}, headers=h)
    # 密碼錯誤刪不掉
    bad = client.request("DELETE", "/api/v1/auth/me",
                         json={"password": "wrong"}, headers=h)
    assert bad.status_code == 400
    # 成功刪除
    ok = client.request("DELETE", "/api/v1/auth/me",
                        json={"password": "pass1234"}, headers=h)
    assert ok.status_code == 200, ok.text
    # token 失效、帳號消失
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401
    login = client.post("/api/v1/auth/login", json={"name": "刪除者", "password": "pass1234"})
    assert login.status_code == 400
