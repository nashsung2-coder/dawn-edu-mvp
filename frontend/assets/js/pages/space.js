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
  
  // 星球數據（硬編碼，省掉 API 呼叫）
  var PLANETS = [
    {id:"planet_0",name:"知識星-1",type:"knowledge",color:"#4A90D9",x:2324,y:909,radius:115},
    {id:"planet_1",name:"戰鬥星-2",type:"battle",color:"#E74C3C",x:4512,y:4157,radius:97},
    {id:"planet_2",name:"探索星-3",type:"explore",color:"#27AE60",x:2179,y:9435,radius:91},
    {id:"planet_3",name:"神秘星-4",type:"mystery",color:"#9B59B6",x:7412,y:1020,radius:83},
    {id:"planet_4",name:"知識星-5",type:"knowledge",color:"#4A90D9",x:2035,y:4082,radius:109},
    {id:"planet_5",name:"戰鬥星-6",type:"battle",color:"#E74C3C",x:8779,y:934,radius:105},
    {id:"planet_6",name:"探索星-7",type:"explore",color:"#27AE60",x:9428,y:7373,radius:108},
    {id:"planet_7",name:"神秘星-8",type:"mystery",color:"#9B59B6",x:7859,y:5057,radius:80},
    {id:"planet_8",name:"知識星-9",type:"knowledge",color:"#4A90D9",x:3115,y:7424,radius:123},
    {id:"planet_9",name:"戰鬥星-10",type:"battle",color:"#E74C3C",x:5052,y:3047,radius:107},
    {id:"planet_10",name:"探索星-11",type:"explore",color:"#27AE60",x:6014,y:2174,radius:91},
    {id:"planet_11",name:"神秘星-12",type:"mystery",color:"#9B59B6",x:6724,y:2084,radius:125},
    {id:"planet_12",name:"知識星-13",type:"knowledge",color:"#4A90D9",x:6135,y:4833,radius:85},
    {id:"planet_13",name:"戰鬥星-14",type:"battle",color:"#E74C3C",x:8027,y:9285,radius:95},
    {id:"planet_14",name:"探索星-15",type:"explore",color:"#27AE60",x:6701,y:1791,radius:150},
    {id:"planet_15",name:"神秘星-16",type:"mystery",color:"#9B59B6",x:5303,y:6425,radius:104},
    {id:"planet_16",name:"知識星-17",type:"knowledge",color:"#4A90D9",x:1639,y:1250,radius:109},
    {id:"planet_17",name:"戰鬥星-18",type:"battle",color:"#E74C3C",x:5241,y:1807,radius:109},
    {id:"planet_18",name:"探索星-19",type:"explore",color:"#27AE60",x:2154,y:6727,radius:115},
    {id:"planet_19",name:"神秘星-20",type:"mystery",color:"#9B59B6",x:7928,y:6477,radius:100}
  ];
  var SCALE = 0.08; // 宇宙單位轉像素
  
  function toScreen(ux, uy) {
    return [W/2 + (ux - camX) * SCALE, H/2 + (uy - camY) * SCALE];
  }
  
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
    // 畫星球
    for (var p = 0; p < PLANETS.length; p++) {
      var pl = PLANETS[p];
      var pos = toScreen(pl.x, pl.y);
      var sx2 = pos[0], sy2 = pos[1];
      if (sx2 < -200 || sx2 > W+200 || sy2 < -200 || sy2 > H+200) continue;
      var pr = pl.radius * SCALE;
      // 光暈
      var grad = ctx.createRadialGradient(sx2, sy2, 0, sx2, sy2, pr*2);
      grad.addColorStop(0, pl.color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(sx2, sy2, pr*2, 0, Math.PI*2); ctx.fill();
      // 本體
      ctx.fillStyle = pl.color;
      ctx.beginPath(); ctx.arc(sx2, sy2, pr, 0, Math.PI*2); ctx.fill();
      // 名稱
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pl.name, sx2, sy2 + pr + 16);
    }
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
