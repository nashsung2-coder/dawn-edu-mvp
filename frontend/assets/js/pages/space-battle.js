/* 太空對戰：坦克大戰式單人遊戲
 * 玩家是人（藍色），敵人是外星人（紅/紫/綠）
 * WASD/方向鍵移動，空白鍵/點擊射擊
 * 多人連機顯示「開發中」
 */
(function() {
  var canvas = document.getElementById('bt-canvas');
  var ctx = canvas.getContext('2d');
  var W, H;
  
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();
  
  // 遊戲狀態
  var player = { x: 0, y: 0, dir: 0, hp: 100, speed: 4, cooldown: 0 };
  var bullets = []; // {x, y, dx, dy, friendly}
  var aliens = []; // {x, y, dir, hp, speed, cooldown, color}
  var particles = [];
  var score = 0;
  var wave = 1;
  var gameOver = false;
  var victory = false;
  
  var keys = {};
  window.addEventListener('keydown', function(e) {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { e.preventDefault(); shoot(); }
  });
  window.addEventListener('keyup', function(e) {
    keys[e.key.toLowerCase()] = false;
  });
  
  // 觸控：點擊射擊
  canvas.addEventListener('click', function() { shoot(); });
  
  // 從 URL 拿星球和戰力
  var params = new URLSearchParams(location.search);
  var planetId = params.get('planet');
  var power = parseInt(params.get('power') || '10');
  
  // 戰力影響：傷害 = 20 + 戰力（每點戰力 +1 傷害）
  var baseDamage = 20 + power;
  
  function init() {
    player.x = W / 2;
    player.y = H - 100;
    player.hp = 100;
    player.dir = 0;
    player.damage = baseDamage; // 星砂轉換的傷害
    bullets = [];
    aliens = [];
    particles = [];
    score = 0;
    wave = 1;
    gameOver = false;
    victory = false;
    spawnWave();
    updateHUD();
    if (planetId) {
      log('征服戰：' + planetId + '（戰力 ' + power + '）');
    }
  }
  
  function spawnWave() {
    var count = 3 + wave;
    var colors = ['#ff6b6b', '#9B59B6', '#27AE60'];
    for (var i = 0; i < count; i++) {
      aliens.push({
        x: 50 + Math.random() * (W - 100),
        y: 50 + Math.random() * 150,
        dir: Math.PI / 2, // 朝下
        hp: 30 + wave * 10,
        maxHp: 30 + wave * 10,
        speed: 1 + wave * 0.3,
        cooldown: Math.random() * 60,
        color: colors[i % 3],
        wobble: Math.random() * Math.PI * 2
      });
    }
  }
  
  function shoot() {
    if (player.cooldown > 0 || gameOver) return;
    player.cooldown = 15;
    var dx = Math.sin(player.dir), dy = -Math.cos(player.dir);
    bullets.push({
      x: player.x + dx * 20, y: player.y + dy * 20,
      dx: dx * 8, dy: dy * 8, friendly: true
    });
  }
  
  function alienShoot(a) {
    var dx = Math.sin(a.dir), dy = -Math.cos(a.dir);
    bullets.push({
      x: a.x + dx * 18, y: a.y + dy * 18,
      dx: dx * 5, dy: dy * 5, friendly: false
    });
  }
  
  function explode(x, y, color) {
    for (var i = 0; i < 20; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = 2 + Math.random() * 4;
      particles.push({
        x: x, y: y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 1, color: color, size: 2 + Math.random() * 3
      });
    }
  }
  
  function update() {
    if (gameOver || victory) return;
    
    // 玩家移動
    var mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) { my = -1; player.dir = 0; }
    if (keys['s'] || keys['arrowdown']) { my = 1; player.dir = Math.PI; }
    if (keys['a'] || keys['arrowleft']) { mx = -1; player.dir = -Math.PI/2; }
    if (keys['d'] || keys['arrowright']) { mx = 1; player.dir = Math.PI/2; }
    
    if (mx !== 0 && my !== 0) {
      // 斜向：取主要方向
      player.dir = Math.atan2(mx, -my);
    }
    
    player.x = Math.max(20, Math.min(W - 20, player.x + mx * player.speed));
    player.y = Math.max(20, Math.min(H - 20, player.y + my * player.speed));
    
    if (player.cooldown > 0) player.cooldown--;
    
    // 外星人 AI
    for (var i = aliens.length - 1; i >= 0; i--) {
      var a = aliens[i];
      a.wobble += 0.05;
      // 朝玩家移動（帶抖動）
      var dx = player.x - a.x, dy = player.y - a.y;
      var dist = Math.hypot(dx, dy);
      if (dist > 150) {
        a.dir = Math.atan2(dx, -dy) + Math.sin(a.wobble) * 0.5;
        a.x += Math.sin(a.dir) * a.speed;
        a.y += -Math.cos(a.dir) * a.speed;
      }
      // 射擊
      a.cooldown--;
      if (a.cooldown <= 0 && dist < 400) {
        a.dir = Math.atan2(dx, -dy);
        alienShoot(a);
        a.cooldown = 60 + Math.random() * 60;
      }
      a.x = Math.max(20, Math.min(W - 20, a.x));
      a.y = Math.max(20, Math.min(H - 20, a.y));
    }
    
    // 子彈
    for (var j = bullets.length - 1; j >= 0; j--) {
      var b = bullets[j];
      b.x += b.dx; b.y += b.dy;
      
      // 出界
      if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) {
        bullets.splice(j, 1); continue;
      }
      
      if (b.friendly) {
        // 打外星人（傷害受星砂戰力加成）
        for (var k = aliens.length - 1; k >= 0; k--) {
          var al = aliens[k];
          if (Math.hypot(b.x - al.x, b.y - al.y) < 18) {
            al.hp -= player.damage || 25;
            explode(b.x, b.y, '#ffaa00');
            bullets.splice(j, 1);
            if (al.hp <= 0) {
              explode(al.x, al.y, al.color);
              aliens.splice(k, 1);
              score += 100 * wave;
              updateHUD();
            }
            break;
          }
        }
      } else {
        // 打玩家
        if (Math.hypot(b.x - player.x, b.y - player.y) < 16) {
          player.hp -= 10;
          explode(b.x, b.y, '#ff6b6b');
          bullets.splice(j, 1);
          updateHUD();
          if (player.hp <= 0) {
            gameOver = true;
            explode(player.x, player.y, '#00E5FF');
            showEnd(false);
          }
        }
      }
    }
    
    // 粒子
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.x += pt.vx; pt.y += pt.vy;
      pt.vx *= 0.98; pt.vy *= 0.98;
      pt.life -= 0.03;
      if (pt.life <= 0) particles.splice(p, 1);
    }
    
    // 下一波
    if (aliens.length === 0 && !gameOver) {
      wave++;
      if (wave > 5) {
        victory = true;
        showEnd(true);
      } else {
        spawnWave();
        log('第 ' + wave + ' 波外星人來襲！');
      }
    }
  }
  
  function drawPerson(x, y, dir) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dir);
    // 人（頂視圖：圓頭 + 身體）
    ctx.fillStyle = '#00E5FF';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI*2); ctx.fill(); // 頭
    ctx.fillStyle = '#0088AA';
    ctx.fillRect(-8, -4, 16, 20); // 身體
    // 槍口方向
    ctx.fillStyle = '#00E5FF';
    ctx.fillRect(-2, -20, 4, 12);
    ctx.restore();
  }
  
  function drawAlien(a) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.dir);
    // 外星人（橢圓身體 + 觸手）
    ctx.fillStyle = a.color;
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI*2); ctx.fill();
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-5, -12, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -12, 3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(-5, -12, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -12, 1.5, 0, Math.PI*2); ctx.fill();
    // 血條
    ctx.fillStyle = '#333';
    ctx.fillRect(-15, -22, 30, 4);
    ctx.fillStyle = a.color;
    ctx.fillRect(-15, -22, 30 * (a.hp / a.maxHp), 4);
    ctx.restore();
  }
  
  function draw() {
    // 背景
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, W, H);
    // 星空
    ctx.fillStyle = '#ffffff22';
    for (var i = 0; i < 100; i++) {
      var sx = (i * 137) % W, sy = (i * 89) % H;
      ctx.fillRect(sx, sy, 2, 2);
    }
    
    if (!gameOver && !victory) {
      drawPerson(player.x, player.y, player.dir);
    }
    
    for (var i = 0; i < aliens.length; i++) {
      drawAlien(aliens[i]);
    }
    
    // 子彈
    for (var j = 0; j < bullets.length; j++) {
      var b = bullets[j];
      ctx.fillStyle = b.friendly ? '#00E5FF' : '#ff6b6b';
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
      // 尾跡
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(b.x - b.dx, b.y - b.dy, 2, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    
    // 粒子
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * pt.life, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    
    // 玩家血條（頭頂）
    if (!gameOver) {
      ctx.fillStyle = '#333';
      ctx.fillRect(player.x - 20, player.y - 28, 40, 5);
      ctx.fillStyle = player.hp > 30 ? '#00E5FF' : '#ff6b6b';
      ctx.fillRect(player.x - 20, player.y - 28, 40 * (player.hp / 100), 5);
    }
  }
  
  function updateHUD() {
    var el = document.getElementById('bt-score');
    if (el) el.textContent = '分數 ' + score + ' · 第 ' + wave + '/5 波';
    var hp = document.getElementById('bt-p1-hp');
    if (hp) hp.style.width = Math.max(0, player.hp) + '%';
  }
  
  function log(msg) {
    var el = document.getElementById('bt-log');
    if (!el) return;
    var d = document.createElement('div');
    d.textContent = msg;
    el.prepend(d);
    while (el.children.length > 8) el.lastChild.remove();
  }
  
  function showEnd(won) {
    // 勝利且是征服戰：標記星球已征服
    if (won && planetId) {
      try {
        var conquered = JSON.parse(localStorage.getItem('dawn:conquered') || '[]');
        if (conquered.indexOf(planetId) === -1) {
          conquered.push(planetId);
          localStorage.setItem('dawn:conquered', JSON.stringify(conquered));
        }
      } catch(e) {}
    }
    var el = document.getElementById('bt-actions');
    el.innerHTML = '<div style="text-align:center">'
      + '<div style="font-size:24px;font-weight:800;color:' + (won ? '#00E5FF' : '#ff6b6b') + ';margin-bottom:12px">'
      + (won ? (planetId ? '🏳️ 星球征服成功！' : '勝利！外星人被擊退了！') : '被外星人擊敗了…') + '</div>'
      + '<div style="color:#8B93C9;margin-bottom:16px">最終分數：' + score + '</div>'
      + '<button class="btn btn-primary" onclick="location.reload()" style="padding:12px 32px;margin-right:8px">再來一局</button>'
      + '<a class="btn btn-ghost" href="space.html" style="padding:12px 24px;text-decoration:none">返回太空</a>'
      + '</div>';
    log(won ? '勝利！' : '遊戲結束');
  }
  
  // 主循環
  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }
  
  // 多人連機按鈕 → 顯示開發中
  var mpBtn = document.getElementById('bt-multiplayer');
  if (mpBtn) {
    mpBtn.onclick = function() {
      log('多人連機開發中，敬請期待！');
      var toast = document.getElementById('sp-toast');
      if (toast) {
        toast.textContent = '多人連機開發中';
        toast.hidden = false;
        setTimeout(function(){ toast.hidden = true; }, 2000);
      }
    };
  }
  
  init();
  loop();
  log('WASD 或方向鍵移動，空白鍵射擊！');
})();
