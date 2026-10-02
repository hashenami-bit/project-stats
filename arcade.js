/* Quest Invaders: the Arcade tab of Project Stats.
   Open quests become invaders (red = big, 3 HP; yellow = 2 HP; green and questions = 1 HP).
   Each wave is one project; then its boss arrives with HP from that project's open red quests.
   Shooting a quest here never marks it done. Best score stays in this device's storage. */
(function(){
'use strict';

var C = {bg:'#05060B', panel:'#0B1640', panel2:'#12225E', line:'#2A3A78', text:'#EAF0FF', muted:'#8D9AC8',
  blue:'#2F7BFF', purple:'#9B5CFF', red:'#FF3B5C', yellow:'#FFD23F', green:'#2EE59D'};
var FLAG = {red:{r:17, hp:3, pts:300, c:C.red}, yellow:{r:14, hp:2, pts:150, c:C.yellow},
  green:{r:11, hp:1, pts:50, c:C.green}, q:{r:11, hp:1, pts:80, c:C.purple}};
var ORDER = {red:0, yellow:1, q:2, green:3};
var DISPLAY = '800 italic {s}px "Saira Condensed","Arial Narrow",sans-serif';
var BODY = '700 {s}px "Rajdhani","Segoe UI",sans-serif';
function font(t, s){ return t.replace('{s}', s); }
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
var reduced = false;
try{ reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}

function initials(name){
  var w = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w.map(function(x){ return x[0]; }).join('') : (w[0] || '?').slice(0, 3)).slice(0, 3).toUpperCase();
}

/* Turns the board's projects into waves. Paused projects only send their red quests. */
function buildWaves(projects){
  var waves = [];
  projects.forEach(function(p){
    var qs = p.quests.filter(function(q){ return !p.done[q.id] && (!p.paused || q.flag === 'red'); });
    if(!qs.length) return;
    qs.sort(function(a, b){ return (ORDER[a.flag] || 9) - (ORDER[b.flag] || 9); });
    var reds = qs.filter(function(q){ return q.flag === 'red'; }).length;
    waves.push({name:p.name, tag:initials(p.name), boss:p.boss || 'The main blocker', reds:reds, quests:qs.slice(0, 18)});
  });
  waves.sort(function(a, b){ return b.reds - a.reds; });
  if(!waves.length) waves.push({name:'Practice', tag:'BUG', boss:'Nothing open. Practice round.', reds:0,
    quests:Array.apply(null, Array(12)).map(function(_, i){ return {id:'b'+i, flag:'green', text:'Practice bug'}; })});
  return waves;
}

function mount(root, getProjects){
  root.innerHTML =
    '<canvas class="arc-cv" aria-label="Quest Invaders game. Drag to move, the ship fires by itself. Arrow keys also work."></canvas>' +
    '<button type="button" class="arc-pause" aria-label="Pause">II</button>' +
    '<div class="arc-over"></div>';
  var cv = root.querySelector('canvas'), ctx = cv.getContext('2d');
  var over = root.querySelector('.arc-over'), pauseBtn = root.querySelector('.arc-pause');
  var W = 360, H = 600, dpr = 1, raf = 0, last = 0, alive = true;
  var S = null;                                  // game state, null on the title screen
  var mode = 'title';                            // title | play | paused | over
  var keys = {}, drag = null;
  var best = +(lsGet('ps-arcade-best') || 0);
  var sound = lsGet('ps-arcade-sound') !== '0', actx = null;

  function size(){
    var top = root.getBoundingClientRect().top + window.scrollY;
    var tab = document.querySelector('.tabbar'), tabH = tab ? tab.offsetHeight : 80;
    W = Math.min(root.clientWidth, 640);
    H = Math.max(440, Math.min(860, window.innerHeight - top - tabH - 14));
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if(S){ S.player.y = H - 54; S.player.x = S.player.tx = Math.min(Math.max(S.player.x, 20), W - 20); }
    if(mode !== 'play') draw();
  }

  /* ---------- sound (tiny synth blips, no files) ---------- */
  function beep(f, d, type, vol){
    if(!sound) return;
    try{
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type || 'square'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, f * 0.5), t + d);
      g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d);
    }catch(e){}
  }

  /* ---------- game setup ---------- */
  function newGame(){
    S = {score:0, round:1, wave:0, waves:buildWaves(getProjects()), lives:3,
      player:{x:W/2, tx:W/2, y:H-54, cool:0, inv:0, power:0},
      shots:[], bolts:[], foes:[], drops:[], bits:[], boss:null,
      fx:0, fy:0, dir:1, intro:0, banner:null, toast:null, shake:0, enemyCool:1.5, grid:0, total:0};
    startWave();
  }
  function speed(){ return 1 + (S.round - 1) * 0.25; }
  function startWave(){
    var w = S.waves[S.wave], cell = 46, cols = Math.max(4, Math.min(6, Math.floor((W - 40) / cell)));
    var width = (cols - 1) * cell, x0 = (W - width) / 2;
    S.foes = w.quests.map(function(q, i){
      var f = FLAG[q.flag] || FLAG.green;
      return {bx:x0 + (i % cols) * cell, by:96 + Math.floor(i / cols) * 42, r:f.r, hp:f.hp, max:f.hp, pts:f.pts, c:f.c, q:q, flash:0, ph:Math.random() * 6};
    });
    S.total = S.foes.length; S.fx = 0; S.fy = -260; S.dir = 1; S.intro = 1.4; S.boss = null; S.bolts = [];
    S.banner = {t:2, title:'Wave ' + (S.wave + 1) + ': ' + w.name, sub:S.foes.length + ' open quest' + (S.foes.length === 1 ? '' : 's') + ' incoming'};
  }
  function startBoss(){
    var w = S.waves[S.wave], hp = Math.min(66, 6 + 6 * w.reds) * speed();
    S.boss = {x:W/2, y:-80, ty:118, w:Math.min(W * 0.62, 240), h:58, hp:Math.round(hp), max:Math.round(hp), t:0, cool:1.6, flash:0, name:w.name};
    S.bolts = [];
    S.banner = {t:2.4, title:'Boss: ' + w.name, sub:w.reds ? w.reds + ' red quest' + (w.reds === 1 ? '' : 's') + ' in real life give it ' + S.boss.max + ' HP'
      : 'No red quests left, so this boss is weak'};
    beep(110, 0.6, 'sawtooth', 0.05);
  }
  function nextWave(){
    S.score += 500;
    S.wave++;
    if(S.wave >= S.waves.length){ S.wave = 0; S.round++; S.waves = buildWaves(getProjects()); S.lives = Math.min(5, S.lives + 1); }
    startWave();
    if(S.wave === 0) S.banner = {t:2.4, title:'Round ' + S.round + ': faster', sub:'Every project cleared once. Extra life.'};
  }

  /* ---------- update ---------- */
  function burst(x, y, c, n){ n = reduced ? Math.ceil(n / 3) : n;
    for(var i = 0; i < n; i++){ var a = Math.random() * 6.28, v = 40 + Math.random() * 160;
      S.bits.push({x:x, y:y, vx:Math.cos(a) * v, vy:Math.sin(a) * v, life:0.5 + Math.random() * 0.4, c:c}); } }
  function hitPlayer(){
    var p = S.player; if(p.inv > 0) return;
    S.lives--; p.inv = 2; p.power = 0; S.shake = reduced ? 0 : 0.35;
    burst(p.x, p.y, C.yellow, 26); beep(70, 0.5, 'sawtooth', 0.07);
    if(S.lives <= 0) gameOver();
  }
  function foeX(f){ return f.bx + S.fx; }
  function foeY(f){ return f.by + S.fy + Math.sin(f.ph) * 2; }

  function update(dt){
    var p = S.player, i, j;
    // move: drag target or keys
    var k = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
    if(k){ p.x += k * 330 * dt; p.tx = p.x; }
    else p.x += (p.tx - p.x) * Math.min(1, dt * 18);   // glide to where the finger went, even after a quick swipe
    p.x = Math.max(18, Math.min(W - 18, p.x));
    p.inv = Math.max(0, p.inv - dt); p.power = Math.max(0, p.power - dt); S.shake = Math.max(0, S.shake - dt);
    // auto fire
    p.cool -= dt;
    if(p.cool <= 0 && S.intro <= 0){
      p.cool = p.power > 0 ? 0.16 : 0.24;
      if(p.power > 0){ S.shots.push({x:p.x - 9, y:p.y - 16}, {x:p.x + 9, y:p.y - 16}); } else S.shots.push({x:p.x, y:p.y - 18});
      beep(880, 0.05, 'square', 0.015);
    }
    for(i = S.shots.length - 1; i >= 0; i--){ S.shots[i].y -= 620 * dt; if(S.shots[i].y < -10) S.shots.splice(i, 1); }
    // formation
    if(S.intro > 0){ S.intro -= dt; S.fy += (0 - S.fy) * Math.min(1, dt * 4); if(S.intro <= 0) S.fy = 0; }
    else if(S.foes.length){
      var v = (24 + 70 * (1 - S.foes.length / S.total)) * speed();
      S.fx += S.dir * v * dt;
      var minX = 1e9, maxX = -1e9, maxY = 0;
      S.foes.forEach(function(f){ minX = Math.min(minX, foeX(f) - f.r); maxX = Math.max(maxX, foeX(f) + f.r); maxY = Math.max(maxY, foeY(f) + f.r); });
      if((minX < 8 && S.dir < 0) || (maxX > W - 8 && S.dir > 0)){ S.dir *= -1; S.fy += 14; }
      if(maxY > p.y - 22){ hitPlayer(); S.fy -= 120; }
      S.enemyCool -= dt;
      if(S.enemyCool <= 0){
        var shooter = S.foes[Math.floor(Math.random() * S.foes.length)];
        S.bolts.push({x:foeX(shooter), y:foeY(shooter) + shooter.r, vx:0, vy:(190 + S.wave * 6) * speed(), c:shooter.c});
        S.enemyCool = Math.max(0.35, (1.3 - S.wave * 0.05) / speed()) * (0.6 + Math.random() * 0.8);
      }
    }
    S.foes.forEach(function(f){ f.ph += dt * 3; f.flash = Math.max(0, f.flash - dt); });
    // boss
    var b = S.boss;
    if(b){
      b.t += dt; b.flash = Math.max(0, b.flash - dt);
      b.y += (b.ty - b.y) * Math.min(1, dt * 2.5);
      b.x = W/2 + Math.sin(b.t * 0.9 * speed()) * (W/2 - b.w/2 - 10);
      b.cool -= dt;
      if(b.cool <= 0 && b.y > b.ty - 10){
        var n = b.hp < b.max / 2 ? 5 : 3;
        for(i = 0; i < n; i++){ var a = (i - (n - 1) / 2) * 0.28;
          S.bolts.push({x:b.x, y:b.y + b.h/2, vx:Math.sin(a) * 200, vy:Math.cos(a) * 210 * speed(), c:C.purple}); }
        b.cool = (b.hp < b.max / 2 ? 0.95 : 1.4) / speed();
        beep(220, 0.12, 'triangle', 0.03);
      }
    }
    // enemy bolts
    for(i = S.bolts.length - 1; i >= 0; i--){ var e = S.bolts[i]; e.x += e.vx * dt; e.y += e.vy * dt;
      if(e.y > H + 10 || e.x < -10 || e.x > W + 10){ S.bolts.splice(i, 1); continue; }
      if(Math.abs(e.x - p.x) < 13 && Math.abs(e.y - p.y) < 13){ S.bolts.splice(i, 1); hitPlayer(); if(mode !== 'play') return; } }
    // shots vs foes and boss
    for(i = S.shots.length - 1; i >= 0; i--){
      var s = S.shots[i], hit = false;
      for(j = S.foes.length - 1; j >= 0; j--){
        var f = S.foes[j], dx = s.x - foeX(f), dy = s.y - foeY(f);
        if(dx * dx + dy * dy < (f.r + 3) * (f.r + 3)){
          hit = true; f.hp--; f.flash = 0.08;
          if(f.hp <= 0){ S.score += f.pts * S.round; burst(foeX(f), foeY(f), f.c, 16); beep(300 + f.r * 20, 0.16, 'square', 0.035);
            S.toast = {t:2.6, proj:S.waves[S.wave].name, text:f.q.text, c:f.c};
            if(Math.random() < 0.09) S.drops.push({x:foeX(f), y:foeY(f)});
            S.foes.splice(j, 1);
          } else beep(520, 0.04, 'square', 0.02);
          break;
        }
      }
      if(!hit && b && Math.abs(s.x - b.x) < b.w/2 && Math.abs(s.y - b.y) < b.h/2){
        hit = true; b.hp--; b.flash = 0.06; S.score += 10 * S.round;
        if(b.hp <= 0){ S.score += 1000 * S.round; burst(b.x, b.y, C.red, 60); burst(b.x, b.y, C.yellow, 30); S.shake = reduced ? 0 : 0.5;
          beep(90, 0.9, 'sawtooth', 0.07); S.toast = {t:2.6, proj:b.name, text:'Boss down. Now beat it in real life too.', c:C.green};
          S.boss = null; b = null; nextWave(); }
      }
      if(hit) S.shots.splice(i, 1);
    }
    if(!S.foes.length && !S.boss && S.intro <= 0) startBoss();
    // power-ups ("Commit": double shot)
    for(i = S.drops.length - 1; i >= 0; i--){ var d = S.drops[i]; d.y += 110 * dt;
      if(Math.abs(d.x - p.x) < 20 && Math.abs(d.y - p.y) < 20){ p.power = 8; S.drops.splice(i, 1); beep(660, 0.25, 'triangle', 0.05);
        S.toast = {t:2, proj:'Commit pushed', text:'Double shot for 8 seconds', c:C.green}; }
      else if(d.y > H + 10) S.drops.splice(i, 1); }
    for(i = S.bits.length - 1; i >= 0; i--){ var q = S.bits[i]; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.96; q.vy *= 0.96; q.life -= dt; if(q.life <= 0) S.bits.splice(i, 1); }
    if(S.banner){ S.banner.t -= dt; if(S.banner.t <= 0) S.banner = null; }
    if(S.toast){ S.toast.t -= dt; if(S.toast.t <= 0) S.toast = null; }
    S.grid = (S.grid + dt * 30) % 24;
  }

  /* ---------- drawing ---------- */
  function hex(x, y, r){ ctx.beginPath();
    for(var i = 0; i < 6; i++){ var a = Math.PI / 3 * i; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r * 0.86); } ctx.closePath(); }
  function slant(x, y, w, h, c){ ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.closePath(); }
  function fit(text, max){ if(ctx.measureText(text).width <= max) return text;
    while(text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1); return text + '…'; }

  function drawBg(){
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    var g = ctx.createRadialGradient(W/2, H * 0.3, 10, W/2, H * 0.3, H * 0.8);
    g.addColorStop(0, 'rgba(155,92,255,.16)'); g.addColorStop(1, 'rgba(5,6,11,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(47,123,255,.08)'; ctx.lineWidth = 1; ctx.beginPath();
    var off = S ? S.grid : 0;
    for(var x = -H; x < W + H; x += 24){ ctx.moveTo(x + off, 0); ctx.lineTo(x + off + H * 0.47, H); }
    ctx.stroke();
  }
  function drawPlayer(p){
    if(p.inv > 0 && Math.floor(p.inv * 10) % 2) return;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.shadowColor = p.power > 0 ? C.green : C.blue; ctx.shadowBlur = 14;
    ctx.fillStyle = C.yellow; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(15, 12); ctx.lineTo(5, 7); ctx.lineTo(0, 14); ctx.lineTo(-5, 7); ctx.lineTo(-15, 12); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = C.bg; ctx.fillRect(-2, -6, 4, 8);
    ctx.fillStyle = p.power > 0 ? C.green : C.blue; ctx.fillRect(-4, 14, 8, 3 + Math.random() * 4);
    ctx.restore();
  }
  function drawFoe(f, tag){
    var x = foeX(f), y = foeY(f);
    hex(x, y, f.r); ctx.fillStyle = f.flash > 0 ? '#fff' : C.panel2; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = f.c; ctx.stroke();
    if(f.max > 1){ for(var i = 0; i < f.max; i++){ ctx.fillStyle = i < f.hp ? f.c : C.line; ctx.fillRect(x - f.max * 3 + i * 6 + 1, y + f.r * 0.86 + 3, 4, 3); } }
    ctx.fillStyle = f.c; ctx.font = font(DISPLAY, f.r > 14 ? 12 : 10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tag, x, y + 1);
  }
  function drawBoss(b){
    var x = b.x - b.w/2, y = b.y - b.h/2;
    ctx.save(); ctx.shadowColor = C.red; ctx.shadowBlur = 22;
    slant(x, y, b.w, b.h, 16); ctx.fillStyle = b.flash > 0 ? '#fff' : C.panel2; ctx.fill(); ctx.restore();
    slant(x, y, b.w, b.h, 16); ctx.lineWidth = 3; ctx.strokeStyle = C.red; ctx.stroke();
    ctx.fillStyle = C.red; ctx.fillRect(b.x - 5, y + b.h - 2, 10, 8);
    ctx.fillStyle = C.text; ctx.font = font(DISPLAY, 18); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fit(b.name.toUpperCase(), b.w - 34), b.x, b.y + 1);
    // boss HP bar across the top
    var bw = W - 32, frac = b.hp / b.max;
    slant(16, 50, bw, 10, 6); ctx.fillStyle = C.panel; ctx.fill();
    slant(16, 50, Math.max(8, bw * frac), 10, 6); ctx.fillStyle = frac < 0.35 ? C.yellow : C.red; ctx.fill();
    ctx.fillStyle = C.muted; ctx.font = font(BODY, 12); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('Boss HP ' + b.hp + ' / ' + b.max, 18, 63);
  }
  function drawHud(){
    ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = C.yellow; ctx.font = font(DISPLAY, 24);
    ctx.fillText(String(S.score), 14, 12);
    ctx.fillStyle = C.muted; ctx.font = font(BODY, 12); ctx.fillText('Best ' + Math.max(best, S.score), 14, 36);
    ctx.textAlign = 'center'; ctx.fillStyle = C.text; ctx.font = font(DISPLAY, 15);
    ctx.fillText(fit('Wave ' + (S.wave + 1) + '/' + S.waves.length + (S.round > 1 ? '  R' + S.round : ''), W - 190), W/2, 14);
    for(var i = 0; i < S.lives; i++){ var lx = W - 62 - i * 18, ly = 22;
      ctx.fillStyle = C.yellow; ctx.beginPath(); ctx.moveTo(lx, ly - 7); ctx.lineTo(lx + 6, ly + 5); ctx.lineTo(lx - 6, ly + 5); ctx.closePath(); ctx.fill(); }
    if(S.player.power > 0){ ctx.textAlign = 'left'; ctx.fillStyle = C.green; ctx.font = font(BODY, 12); ctx.fillText('Double shot ' + Math.ceil(S.player.power) + 's', 14, H - 22); }
  }
  function drawToast(t){
    var a = Math.min(1, t.t * 2), y = H - 112;
    ctx.globalAlpha = a; slant(12, y, W - 24, 40, 10); ctx.fillStyle = 'rgba(11,22,64,.92)'; ctx.fill();
    ctx.fillStyle = t.c; ctx.fillRect(12, y, 4, 40);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = font(DISPLAY, 13); ctx.fillStyle = t.c; ctx.fillText(fit(t.proj, W - 60), 24, y + 5);
    ctx.font = font(BODY, 14); ctx.fillStyle = C.text; ctx.fillText(fit(t.text, W - 52), 24, y + 20);
    ctx.globalAlpha = 1;
  }
  function drawBanner(bn){
    var a = Math.min(1, bn.t * 2, (2.6 - bn.t) * 4), y = H * 0.42;
    ctx.globalAlpha = Math.max(0, a);
    slant(-10, y - 34, W + 20, 72, 18); ctx.fillStyle = 'rgba(5,6,11,.82)'; ctx.fill();
    ctx.fillStyle = C.yellow; ctx.fillRect(0, y - 34, W, 3);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(DISPLAY, 28); ctx.fillStyle = C.yellow;
    ctx.fillText(fit(bn.title.toUpperCase(), W - 30), W/2, y - 8);
    ctx.font = font(BODY, 14); ctx.fillStyle = C.text; ctx.fillText(fit(bn.sub, W - 30), W/2, y + 20);
    ctx.globalAlpha = 1;
  }
  function draw(){
    ctx.save();
    if(S && S.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * S.shake, (Math.random() - 0.5) * 10 * S.shake);
    drawBg();
    if(S){
      var tag = S.waves[S.wave] ? S.waves[S.wave].tag : '';
      S.foes.forEach(function(f){ drawFoe(f, tag); });
      if(S.boss) drawBoss(S.boss);
      ctx.fillStyle = C.yellow; S.shots.forEach(function(s){ ctx.fillRect(s.x - 1.5, s.y - 7, 3, 12); });
      S.bolts.forEach(function(e){ ctx.fillStyle = e.c; ctx.beginPath(); ctx.moveTo(e.x, e.y - 6); ctx.lineTo(e.x + 4, e.y); ctx.lineTo(e.x, e.y + 6); ctx.lineTo(e.x - 4, e.y); ctx.fill(); });
      S.drops.forEach(function(d){ ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = C.green; ctx.shadowColor = C.green; ctx.shadowBlur = 12; ctx.fillRect(-7, -7, 14, 14); ctx.restore(); });
      S.bits.forEach(function(q){ ctx.globalAlpha = Math.max(0, q.life * 1.6); ctx.fillStyle = q.c; ctx.fillRect(q.x - 2, q.y - 2, 4, 4); }); ctx.globalAlpha = 1;
      if(mode !== 'over') drawPlayer(S.player);
      drawHud();
      if(S.toast) drawToast(S.toast);
      if(S.banner) drawBanner(S.banner);
    }
    ctx.restore();
  }

  /* ---------- loop and screens ---------- */
  function frame(t){
    if(!alive) return;
    var dt = Math.min(0.033, (t - last) / 1000 || 0); last = t;
    if(mode === 'play'){ update(dt); draw(); }
    raf = requestAnimationFrame(frame);
  }
  function screen(html){ over.innerHTML = html; over.hidden = !html; pauseBtn.hidden = !!html; var b = over.querySelector('button'); if(b) b.focus({preventScroll:true}); }
  function soundBtn(){ return '<button type="button" class="btn ghost arc-sound">Sound: ' + (sound ? 'on' : 'off') + '</button>'; }
  function title(){
    mode = 'title'; S = null; draw();
    var n = 0, reds = 0;
    getProjects().forEach(function(p){ p.quests.forEach(function(q){ if(!p.done[q.id] && (!p.paused || q.flag === 'red')){ n++; if(q.flag === 'red') reds++; } }); });
    screen('<div class="arc-card"><h2 class="arc-title">Quest Invaders</h2>' +
      '<p>' + (n ? 'Your <b>' + n + ' open quests</b> are the invaders, one project per wave. Each project ends with its boss.' : 'No open quests right now, so this is a practice round.') + '</p>' +
      '<p class="arc-hint">Boss HP comes from real red quests (' + reds + ' open). Clear them in real life and the bosses get weaker. Shooting a quest here does not mark it done.</p>' +
      '<div class="arc-btns"><button type="button" class="btn arc-start">Start game</button>' + soundBtn() + '</div>' +
      '<p class="arc-hint">Drag anywhere to move. Your ship fires by itself.' + (best ? ' Best: <b>' + best + '</b>' : '') + '</p></div>');
  }
  function unlockAudio(){   // iPhones only allow sound that starts inside a tap
    if(!sound) return;
    try{ actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if(actx.state === 'suspended') actx.resume(); }catch(e){}
  }
  function play(){ unlockAudio(); if(!S) newGame(); mode = 'play'; screen(''); last = performance.now(); }
  function pause(){ if(mode !== 'play') return; mode = 'paused'; draw();
    screen('<div class="arc-card"><h2 class="arc-title">Paused</h2><div class="arc-btns"><button type="button" class="btn arc-start">Continue</button>' + soundBtn() +
      '<button type="button" class="btn ghost arc-quit">Quit</button></div></div>'); }
  function gameOver(){
    mode = 'over'; var nb = S.score > best; if(nb){ best = S.score; lsSet('ps-arcade-best', String(best)); }
    draw();
    screen('<div class="arc-card"><h2 class="arc-title">Game over</h2><p class="arc-score">' + S.score + '</p>' +
      '<p>' + (nb ? 'New best score!' : 'Best: ' + best) + ' You reached wave ' + (S.wave + 1) + (S.round > 1 ? ' of round ' + S.round : '') + '.</p>' +
      '<div class="arc-btns"><button type="button" class="btn arc-again">Play again</button></div></div>');
  }

  over.addEventListener('click', function(e){
    if(e.target.closest('.arc-start')) play();
    else if(e.target.closest('.arc-again')){ S = null; play(); }
    else if(e.target.closest('.arc-quit')) title();
    else if(e.target.closest('.arc-sound')){ sound = !sound; lsSet('ps-arcade-sound', sound ? '1' : '0'); e.target.closest('.arc-sound').textContent = 'Sound: ' + (sound ? 'on' : 'off'); if(sound){ unlockAudio(); beep(660, 0.1); } }
  });
  pauseBtn.addEventListener('click', pause);
  cv.addEventListener('pointerdown', function(e){ if(mode !== 'play') return; var r = cv.getBoundingClientRect();
    drag = {id:e.pointerId, sx:e.clientX - r.left, px:S.player.x}; try{ cv.setPointerCapture(e.pointerId); }catch(x){} e.preventDefault(); });
  cv.addEventListener('pointermove', function(e){ if(!drag || e.pointerId !== drag.id) return; var r = cv.getBoundingClientRect();
    S.player.tx = Math.max(18, Math.min(W - 18, drag.px + (e.clientX - r.left - drag.sx) * 1.3)); });
  function endDrag(e){ if(drag && e.pointerId === drag.id) drag = null; }
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  function keydown(e){
    if(['ArrowLeft', 'ArrowRight', 'a', 'd'].indexOf(e.key) >= 0){ keys[e.key] = true; if(mode === 'play') e.preventDefault(); }
    if((e.key === 'Escape' || e.key === 'p') && mode === 'play') pause();
    else if((e.key === ' ' || e.key === 'Enter') && mode === 'paused' && document.activeElement === document.body){ play(); e.preventDefault(); }
  }
  function keyup(e){ keys[e.key] = false; }
  function vis(){ if(document.visibilityState !== 'visible') pause(); }
  window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
  window.addEventListener('resize', size); document.addEventListener('visibilitychange', vis);

  size(); title(); raf = requestAnimationFrame(frame);
  function destroy(){
    alive = false; cancelAnimationFrame(raf);
    window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
    window.removeEventListener('resize', size); document.removeEventListener('visibilitychange', vis);
    if(actx) try{ actx.close(); }catch(e){}
  }
  destroy.busy = function(){ return mode === 'play' || mode === 'paused' || mode === 'over'; };   // a game is on screen
  return destroy;
}

window.PSArcade = {mount:mount};
})();
