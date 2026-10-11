/* 全站導覽列自動插入 */
(function() {
  var path = location.pathname;
  var zones = [
    { id: 'lib', href: 'pages/library.html', icon: '◈', label: '知識庫' },
    { id: 'learn', href: 'pages/learn.html', icon: '✎', label: '學習' },
    { id: 'home', href: 'pages/myhome.html', icon: '⌂', label: '我的家' },
    { id: 'game', href: 'pages/game.html', icon: '⚔', label: '遊戲' },
    { id: 'chat', href: 'pages/chat.html', icon: '◐', label: '通訊' },
  ];
  // 首頁不顯示（首頁已有三等份入口）
  if (path.endsWith('desktop.html') || path.endsWith('mobile.html') || path === '/' || path.endsWith('/')) return;
  
  var nav = document.createElement('nav');
  nav.className = 'dawn-nav';
  nav.setAttribute('aria-label', '主導覽');
  
  var html = '';
  zones.forEach(function(z) {
    var href = z.href;
    // 路徑修正：在 pages/ 目錄下，連結用相對路徑（去掉 pages/ 前綴）
    if (path.indexOf('/pages/') !== -1) href = z.href.replace('pages/', '');
    // 不在 pages/ 下（如首頁），保持 pages/ 前綴
    var active = path.indexOf(z.href.split('/').pop().replace('.html','')) !== -1 ? ' active' : '';
    html += '<a href="' + href + '" data-zone="' + z.id + '" class="' + active.trim() + '">'
      + '<span class="ni">' + z.icon + '</span><span>' + z.label + '</span></a>';
  });
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
