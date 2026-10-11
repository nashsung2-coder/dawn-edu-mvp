/* 未知之境：極簡版 - 先確保畫面能出來 */
(function() {
  var canvas = document.getElementById('sp-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var W, H, stars = [];
  
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    stars = [];
    for (var i = 0; i < 200; i++) {
      stars.push({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*1.5+0.5 });
    }
  }
  window.addEventListener('resize', resize);
  resize();
  
  var camX = 5000, camY = 5000;
  var coordsEl = document.getElementById('sp-coords');
  
  function draw() {
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, W, H);
    var t = Date.now() / 1000;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(t + i));
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 畫飛船（簡單三角形）
    var sx = W/2, sy = H/2;
    ctx.fillStyle = '#00E5FF';
    ctx.beginPath();
    ctx.moveTo(sx, sy-15); ctx.lineTo(sx-10, sy+10); ctx.lineTo(sx+10, sy+10);
    ctx.closePath(); ctx.fill();
    // 座標
    if (coordsEl) coordsEl.textContent = 'x: ' + Math.round(camX) + ', y: ' + Math.round(camY);
    requestAnimationFrame(draw);
  }
  
  // 點擊移動
  canvas.addEventListener('click', function(e) {
    // 簡單：點擊哪就顯示提示
    var toast = document.getElementById('sp-toast');
    if (toast) {
      toast.textContent = '點擊位置：' + e.clientX + ', ' + e.clientY;
      toast.hidden = false;
      setTimeout(function(){ toast.hidden = true; }, 2000);
    }
  });
  
  draw();
})();
