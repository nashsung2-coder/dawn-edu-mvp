/* 我的家：溫馨小屋版（IIFE 零依賴，不卡 import） */
(function() {
  var view = document.getElementById("mh-view");
  if (!view) return;
  
  function toast(msg) {
    try {
      var el = document.getElementById('mh-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'mh-toast';
        el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;z-index:9999';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.style.display = 'block';
      setTimeout(function(){ el.style.display = 'none'; }, 2500);
    } catch(e) {}
  }
  
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  
  function getToken() {
    return localStorage.getItem('dawn:v1:auth-token') || localStorage.getItem('dawn.token');
  }
  
  function getUserId() {
    // 從 localStorage 拿快取的 userId，不解析 JWT
    try {
      var cached = localStorage.getItem('dawn:v1:user-id');
      if (cached) return cached;
    } catch(e) {}
    return null;
  }
  
  function fetchUserId() {
    // 從 API 拿 userId 並快取
    return apiGet('/auth/me').then(function(r) {
      var user = r.data?.user || r.data || r;
      var uid = user?.id || user?.user_id;
      if (uid) {
        try { localStorage.setItem('dawn:v1:user-id', uid); } catch(e) {}
      }
      return uid;
    }).catch(function() { return null; });
  }
  
  function apiGet(path) {
    var token = getToken();
    return fetch('https://dawn-edu-mvp.onrender.com/api/v1' + path, {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  
  function apiPost(path, body) {
    var token = getToken();
    return fetch('https://dawn-edu-mvp.onrender.com/api/v1' + path, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {}),
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  
  function petImg(level) {
    var lv = Number(level) || 1;
    if (window.IMG) {
      if (lv >= 10) return IMG.resolve('pet', 'adult');
      if (lv >= 5) return IMG.resolve('pet', 'baby');
      return IMG.resolve('pet', 'egg');
    }
    if (lv >= 10) return "../assets/img/game/pet-adult.webp?v=3.0.0";
    if (lv >= 5) return "../assets/img/game/pet-baby.webp?v=3.0.0";
    return "../assets/img/game/pet-egg.webp?v=3.0.0";
  }
  
  function petMood(mood) {
    var m = Number(mood) || 50;
    if (m >= 80) return "今天心情超好！";
    if (m >= 60) return "心情不錯喔";
    if (m >= 40) return "有點想你了";
    return "快來陪陪我吧…";
  }
  
  function render() {
    view.innerHTML = '<p class="center" style="color:#A08060">正在點亮壁爐…</p>';
    var timeout = setTimeout(function() {
      if (view.innerHTML.indexOf('正在點亮壁爐') !== -1) {
        view.innerHTML = '<div class="center" style="padding:40px">'
          + '<p style="color:#A08060">載入有點慢，再試一次吧</p>'
          + '<button class="btn-warm" onclick="location.reload()">重新載入</button></div>';
      }
    }, 8000);
    
    // 先檢查有沒有 token
    if (!getToken()) {
      clearTimeout(timeout);
      view.innerHTML = '<div class="center" style="padding:40px">'
        + '<p style="color:#A08060">請先登入再回家</p>'
        + '<a class="btn-warm" href="settings.html">去登入</a></div>';
      return;
    }
    
    // 有 token，先拿 userId
    fetchUserId().then(function(userId) {
      if (!userId) {
        clearTimeout(timeout);
        view.innerHTML = '<div class="center" style="padding:40px">'
          + '<p style="color:#A08060">無法取得用戶資訊，請重新登入</p>'
          + '<a class="btn-warm" href="settings.html">去登入</a></div>';
        return;
      }
      
      Promise.allSettled([
        apiGet('/islands/' + userId),
        apiGet('/world/pet')
      ]).then(function(results) {
      clearTimeout(timeout);
      var statusR = results[0], petR = results[1];
      var st = statusR.status === "fulfilled" ? (statusR.value.island || statusR.value) : null;
      var pet = petR.status === "fulfilled" ? (petR.value.pet || (petR.value.data && petR.value.data.pet)) : null;
      var territory = st ? (Number(st.territory) || 0) : 0;
      var explorePct = Math.min(100, Math.round((territory / 50) * 100));
      
      var petHtml = pet
        ? '<img class="pet-img" src="' + petImg(pet.level) + '" alt="">'
          + '<div class="pet-name">' + escapeHtml(pet.name || "無名") + '</div>'
          + '<div class="pet-status">Lv.' + (pet.level || 1) + '</div>'
          + '<div><span class="speech">' + petMood(pet.mood) + '</span></div>'
          + '<a class="btn-warm" href="pet.html">去陪牠玩</a>'
        : '<img src="../assets/img/game/pet-egg.webp?v=3.0.0" alt="靈獸蛋" style="width:72px;height:72px;object-fit:contain">'
          + '<div class="pet-name">還沒有夥伴</div>'
          + '<div><span class="speech">孵化一顆蛋，開始你們的故事吧</span></div>'
          + '<a class="btn-warm" href="pet.html">去孵化</a>';
      
      view.innerHTML = ''
        + '<div class="cards">'
        + '<div class="card-wood"><h2>靈獸夥伴</h2><div class="pet-wrap">' + petHtml + '</div></div>'
        + '<div class="card-wood"><h2>我的領地</h2><div class="big-num">' + territory + '</div>'
        + '<p class="center" style="color:#A08060;font-size:13px">領土單位</p><div class="deco"><img src="../assets/img/game/island-1.webp?v=3.0.0" alt="島嶼" style="width:48px;height:48px;object-fit:contain"></div>'
        + '<p class="center" style="font-size:13px;color:#A08060">每一塊土地都是你努力的證明</p>'
        + '<div class="center" style="margin-top:12px"><a class="btn-soft" href="island.html">開疆拓土</a></div></div>'
        + '<div class="card-wood"><h2>探索回憶</h2><div class="bar"><div style="width:' + explorePct + '%"></div></div>'
        + '<p class="center" style="font-size:14px"><strong>' + explorePct + '%</strong></p>'
        + '<p class="center" style="font-size:13px;color:#A08060">走過的路，都會變成星光</p>'
        + '<div class="center" style="margin-top:12px"><a class="btn-soft" href="explore.html">繼續冒險</a></div></div>'
        + '<div class="card-wood" style="grid-column:1/-1"><h2>傳送門</h2>'
        + '<p style="font-size:14px;color:#A08060">去拜訪好友的家，看看他們過得怎麼樣（需要 20 星砂）</p>'
        + '<div class="row"><input class="warm" id="mh-portal-name" type="text" placeholder="輸入好友的名字…" aria-label="好友名字">'
        + '<button class="btn-warm" id="mh-portal-go" style="white-space:nowrap">出發</button></div>'
        + '<div id="mh-portal-result" style="margin-top:12px"></div></div>'
        + '<div class="card-wood" style="grid-column:1/-1"><h2>佈置小屋</h2>'
        + '<p style="font-size:14px;color:#A08060">換個壁紙、擺設，讓家更有你的味道。拜訪時好友也會看到喔。</p>'
        + '<div style="margin-top:12px"><a class="btn-soft" href="island.html#skin">去佈置</a></div></div>'
        + '</div>';
      
      var goBtn = document.getElementById("mh-portal-go");
      if (goBtn) {
        goBtn.onclick = function() {
          var nameEl = document.getElementById("mh-portal-name");
          var name = nameEl ? nameEl.value.trim() : "";
          if (!name) { toast("請輸入好友名字"); return; }
          var resultEl = document.getElementById("mh-portal-result");
          goBtn.disabled = true; goBtn.textContent = "出發中…";
          apiPost('/islands/' + userId + '/visit', { friend_name: name }).then(function(r) {
            resultEl.innerHTML = '<div style="background:#FFF8F0;border:2px solid #E8D5B8;border-radius:12px;padding:14px">'
              + '<p style="margin:0 0 6px"><strong>' + escapeHtml(r.friend_name || name) + ' 的家</strong></p>'
              + '<p style="margin:0;font-size:13px;color:#A08060">領土 ' + (r.territory != null ? r.territory : "?") + ' · 夥伴 ' + escapeHtml(r.pet_name || "無") + '</p></div>';
          }).catch(function(e) {
            resultEl.innerHTML = '<p style="color:#c0392b;font-size:13px">' + escapeHtml(e.message) + '</p>';
          }).finally(function() {
            goBtn.disabled = false; goBtn.textContent = "出發";
          });
        };
      }
    }).catch(function(e) {
      clearTimeout(timeout);
      view.innerHTML = '<p class="center">載入失敗：' + escapeHtml(e.message) + '</p>';
    });
    }); // fetchUserId().then 結束
  }
  
  // 未登入也顯示基本版（不卡住）
  render();
})();
