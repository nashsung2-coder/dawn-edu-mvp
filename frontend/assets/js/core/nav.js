/* 全站導覽列自動插入 v2.1
 * 新增：HTTP→HTTPS 強制跳轉（修 localStorage 登入狀態分裂問題）
 * 新增：登入狀態顯示、星砂餘額（Gemini UX 建議）
 */
(function() {
  // P0 修復：強制 HTTPS，避免 http/https 的 localStorage 登入狀態分裂
  if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    location.replace('https://' + location.host + location.pathname + location.search + location.hash);
    return;
  }

  var path = location.pathname;
  var zones = [
    { id: 'lib', href: '/pages/library', icon: '◈', label: '知識庫' },
    { id: 'learn', href: '/pages/learn', icon: '✎', label: '學習' },
    { id: 'home', href: '/pages/myhome', icon: '⌂', label: '我的家' },
    { id: 'game', href: '/pages/game', icon: '⚔', label: '遊戲' },
    { id: 'chat', href: '/pages/chat', icon: '◐', label: '通訊' },
  ];
  // 首頁不顯示（首頁已有三等份入口）
  if (path.endsWith('desktop.html') || path.endsWith('mobile.html') || path === '/' || path.endsWith('/')) return;
  
  var nav = document.createElement('nav');
  nav.className = 'dawn-nav';
  nav.setAttribute('aria-label', '主導覽');
  
  var html = '';
  zones.forEach(function(z) {
    var href = z.href; // 絕對路徑，直接用
    var active = path.indexOf(z.href.split('/').pop()) !== -1 ? ' active' : '';
    html += '<a href="' + href + '" data-zone="' + z.id + '" class="' + active.trim() + '">'
      + '<span class="ni">' + z.icon + '</span><span>' + z.label + '</span></a>';
  });
  
  // 登入狀態 / 星砂餘額（右側）
  var token = null;
  try { token = localStorage.getItem('dawn:v1:auth-token'); } catch(e) {}
  if (token) {
    // 已登入：顯示星砂餘額（點擊去看明細）
    html += '<a href="/pages/game" data-zone="sand" id="dawn-sand">'
      + '<span class="ni">✨</span><span id="dawn-sand-num">…</span></a>';
    // 異步載入餘額
    setTimeout(function() {
      fetch('https://dawn-edu-mvp.onrender.com/api/v1/game/currency', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function(r) { return r.json(); }).then(function(d) {
        var num = d.starsand ?? d.data?.starsand ?? d.balance ?? '?';
        var el = document.getElementById('dawn-sand-num');
        if (el) el.textContent = num;
      }).catch(function() {
        var el = document.getElementById('dawn-sand-num');
        if (el) el.textContent = '✨';
      });
    }, 500);
  } else {
    // 未登入：明確的登入按鈕（Gemini P0 建議）
    html += '<a href="/pages/settings" data-zone="login" style="background:#1a1a1a;color:#fff;border-radius:8px;margin:4px;">'
      + '<span class="ni">→</span><span>登入</span></a>';
  }
  
  nav.innerHTML = html;
  document.body.appendChild(nav);
  document.body.classList.add('has-nav');
  
  // 載入 CSS（導覽列 + 全站響應式）
  var base = path.indexOf('/pages/') !== -1 ? '../assets/css/' : 'assets/css/';
  [['nav.css'], ['responsive.css']].forEach(function(f) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = base + f[0];
    document.head.appendChild(link);
  });
})();
