/* =========================================================
   柴犬丟平底鍋  (Shiba Pan Toss)
   玩法：按住 空白鍵 / 滑鼠左鍵 蓄力，指針落在綠色區域放開
         = 完美命中 20 傷害，邊緣 7 傷害，其他 MISS。
   ========================================================= */
(() => {
  'use strict';

  /* ---------------- 基本設定 ---------------- */
  const CW = 1280,
    CH = 720;
  const GROUND = 588; // 腳底基準線
  const SCALE = 1.55; // 角色放大倍率
  const CELL_H = 128; // 精靈圖每格高度

  const SWEET_MIN = 0.66,
    SWEET_MAX = 0.9; // 完美命中區
  const EDGE_MIN = 0.58,
    EDGE_MAX = 0.98; // 擦邊區
  const DMG_SWEET = 20,
    DMG_EDGE = 7,
    MAX_HP = 100;

  const CHARGE_PERIOD = 1.5; // 蓄力指針來回一趟（秒）
  const AI_CHARGE_DUR = 1.1;
  const CAST_DELAY = 0.45; // 舉鍋到出手的延遲
  const PAN_DUR = 0.6; // 平底鍋飛行時間

  const SHEETS = {
    idle: { url: 'assets/dog-sprite-idle.png', cw: 92, frames: 24, fps: 10 },
    walk: { url: 'assets/dog-sprite-walk.png', cw: 88, frames: 24, fps: 12 },
    run: { url: 'assets/dog-sprite-run.png', cw: 148, frames: 24, fps: 14 },
    cast: { url: 'assets/dog-sprite-cast.png', cw: 128, frames: 24, fps: 18, once: true },
    hit: { url: 'assets/dog-sprite-hit.png', cw: 104, frames: 16, fps: 12, once: true },
  };
  const BG_URL = 'assets/bg-market.png';

  /* ---------------- 畫布 ---------------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  /* ---------------- 資源載入 ---------------- */
  const IMAGES = {};
  const BG = new Image();
  let loadTotal = Object.keys(SHEETS).length + 1;
  let loadDone = 0;

  function onLoaded() {
    loadDone++;
  }

  for (const key in SHEETS) {
    const img = new Image();
    img.onload = onLoaded;
    img.onerror = onLoaded;
    img.src = SHEETS[key].url;
    IMAGES[key] = img;
  }
  BG.onload = onLoaded;
  BG.onerror = onLoaded;
  BG.src = BG_URL;

  /* ---------------- 音效（WebAudio，無需外部檔案） ---------------- */
  let actx = null;

  function initAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
    } catch (e) {
      actx = null;
    }
  }

  function beep(type) {
    if (!actx) return;
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.connect(g);
    g.connect(actx.destination);

    if (type === 'hit') {
      o.type = 'square';
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      o.start(t);
      o.stop(t + 0.25);
    } else if (type === 'miss') {
      o.type = 'sine';
      o.frequency.setValueAtTime(340, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.2);
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.start(t);
      o.stop(t + 0.27);
    } else {
      o.type = 'triangle';
      o.frequency.setValueAtTime(620, t);
      o.frequency.exponentialRampToValueAtTime(200, t + 0.25);
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t);
      o.stop(t + 0.31);
    }
  }

  /* ---------------- 小工具 ---------------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  /* ---------------- 角色 ---------------- */
  class Fighter {
    constructor(x, flip, name) {
      this.x = x;
      this.flip = flip; // true = 水平翻轉（面向右）
      this.name = name;
      this.hp = MAX_HP;
      this.anim = 'idle';
      this.animT = 0;
      this.shake = 0;
    }

    play(name, restart) {
      if (!SHEETS[name]) name = 'idle';
      if (this.anim === name && !restart) return;
      this.anim = name;
      this.animT = 0;
    }

    update(dt) {
      this.animT += dt;
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3.2);

      const s = SHEETS[this.anim];
      if (s.once) {
        const total = s.frames / s.fps;
        if (this.animT > total) this.animT = total - 1e-3;
      }
    }

    draw(c) {
      const s = SHEETS[this.anim];
      const img = IMAGES[this.anim];
      if (!img || !img.complete || img.naturalWidth === 0) return;

      let idx = Math.floor(this.animT * s.fps);
      if (idx >= s.frames) idx = s.frames - 1;
      if (idx < 0) idx = 0;
      const col = idx % 8;
      const row = Math.floor(idx / 8);
      const sx = col * s.cw;
      const sy = row * CELL_H;

      const w = s.cw * SCALE;
      const h = CELL_H * SCALE;
      const dy = GROUND - h;

      // 影子
      c.save();
      c.globalAlpha = 0.3;
      c.fillStyle = '#000';
      c.beginPath();
      c.ellipse(this.x, GROUND - 6, w * 0.3, 13, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();

      const off = this.shake > 0 ? Math.sin(this.animT * 45) * 8 * this.shake : 0;

      c.save();
      c.translate(this.x + off, 0);
      if (this.flip) c.scale(-1, 1);
      if (this.shake > 0.15) c.filter = 'brightness(1.9) saturate(0.6)';
      c.drawImage(img, sx, sy, s.cw, CELL_H, -w / 2, dy, w, h);
      c.restore();
    }
  }

  const player = new Fighter(330, true, '你');
  const cpu = new Fighter(950, false, '電腦');

  /* ---------------- 遊戲狀態 ---------------- */
  const S = {
    phase: 'loading', // loading/title/playerReady/playerCharging/castDelay/flying/resolve/aiWait/aiCharging/over
    timer: 0,
    power: 0,
    chargeT: 0,
    aiTarget: 0,
    aiChargeT: 0,
    thrower: 'player',
    pan: null,
    pendingJudge: null,
    particles: [],
    popups: [],
    resultText: '',
    resultColor: '#fff',
    resultT: 0,
    shakeScreen: 0,
    winner: null,
    round: 1,
  };

  /* ---------------- 判定 ---------------- */
  function judge(v) {
    if (v >= SWEET_MIN && v <= SWEET_MAX)
      return { dmg: DMG_SWEET, text: '完美命中！', color: '#8dff9c' };
    if (v >= EDGE_MIN && v <= EDGE_MAX)
      return { dmg: DMG_EDGE, text: '擦邊命中', color: '#ffd166' };
    return { dmg: 0, text: 'MISS', color: '#ff8a8a' };
  }

  function pickAIValue() {
    const r = Math.random();
    if (r < 0.55) return SWEET_MIN + Math.random() * (SWEET_MAX - SWEET_MIN);
    if (r < 0.8)
      return Math.random() < 0.5
        ? EDGE_MIN + Math.random() * (SWEET_MIN - EDGE_MIN)
        : SWEET_MAX + Math.random() * (EDGE_MAX - SWEET_MAX);
    return Math.random() * 0.5;
  }

  /* ---------------- 效果 ---------------- */
  function spawnParticles(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 320;
      S.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 160,
        life: 0.5 + Math.random() * 0.45,
        age: 0,
        r: 3 + Math.random() * 4,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  function popup(x, y, text, color) {
    S.popups.push({ x, y, text, color, age: 0, life: 1.1 });
  }

  /* ---------------- 回合流程 ---------------- */
  function newGame() {
    player.hp = MAX_HP;
    cpu.hp = MAX_HP;
    player.play('idle', true);
    cpu.play('idle', true);
    S.pan = null;
    S.particles.length = 0;
    S.popups.length = 0;
    S.resultText = '';
    S.resultT = 0;
    S.winner = null;
    S.round = 1;
    S.power = 0;
    S.phase = 'playerReady';
  }

  function releasePlayer() {
    beginThrow('player', judge(S.power));
  }

  function beginThrow(who, j) {
    S.thrower = who;
    S.pendingJudge = j;
    (who === 'player' ? player : cpu).play('cast', true);
    S.phase = 'castDelay';
    S.timer = CAST_DELAY;
    beep('throw');
  }

  function launchPan() {
    const from = S.thrower === 'player' ? player : cpu;
    const to = S.thrower === 'player' ? cpu : player;
    const dir = S.thrower === 'player' ? 1 : -1;
    const hx = from.x + dir * 78;
    const hy = GROUND - 165;
    S.pan = {
      sx: hx,
      sy: hy,
      x: hx,
      y: hy,
      tx: to.x,
      ty: GROUND - 120,
      t: 0,
      rot: Math.random() * Math.PI,
      spin: dir * (14 + Math.random() * 6),
      judge: S.pendingJudge,
      target: to,
    };
    S.phase = 'flying';
  }

  function impact() {
    const pan = S.pan;
    const j = pan.judge;
    const tgt = pan.target;
    S.pan = null;

    if (j.dmg > 0) {
      tgt.hp = Math.max(0, tgt.hp - j.dmg);
      tgt.play('hit', true);
      tgt.shake = 1;
      S.shakeScreen = 14;
      popup(tgt.x, GROUND - 210, '-' + j.dmg, '#ff6b6b');
      spawnParticles(tgt.x, GROUND - 120, 22, ['#ffd166', '#ff8a3d', '#fff3c4', '#8dff9c']);
      beep('hit');
    } else {
      popup(tgt.x, GROUND - 210, 'MISS', '#ffb3b3');
      spawnParticles(tgt.x + (S.thrower === 'player' ? -60 : 60), GROUND - 90, 8, ['#d9d0c0', '#a99a86']);
      beep('miss');
    }

    S.resultText = j.text;
    S.resultColor = j.color;
    S.resultT = 1.4;
    S.phase = 'resolve';
    S.timer = 1.35;
  }

  function nextTurn() {
    if (cpu.hp <= 0) {
      S.winner = 'player';
      S.phase = 'over';
      return;
    }
    if (player.hp <= 0) {
      S.winner = 'cpu';
      S.phase = 'over';
      return;
    }
    if (S.thrower === 'player') {
      player.play('idle', true);
      S.phase = 'aiWait';
      S.timer = 0.7;
    } else {
      S.round++;
      S.power = 0;
      cpu.play('idle', true);
      player.play('idle', true);
      S.phase = 'playerReady';
    }
  }

  /* ---------------- 更新 ---------------- */
  function update(dt) {
    player.update(dt);
    cpu.update(dt);

    if (S.resultT > 0) S.resultT -= dt;
    if (S.shakeScreen > 0) S.shakeScreen = Math.max(0, S.shakeScreen - dt * 50);

    // 粒子
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        S.particles.splice(i, 1);
        continue;
      }
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y > GROUND - 4) {
        p.y = GROUND - 4;
        p.vy *= -0.35;
        p.vx *= 0.7;
      }
    }

    // 飄字
    for (let i = S.popups.length - 1; i >= 0; i--) {
      const p = S.popups[i];
      p.age += dt;
      p.y -= 52 * dt;
      if (p.age >= p.life) S.popups.splice(i, 1);
    }

    switch (S.phase) {
      case 'playerCharging': {
        S.chargeT += dt;
        const ph = (S.chargeT % CHARGE_PERIOD) / CHARGE_PERIOD;
        S.power = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
        break;
      }
      case 'castDelay': {
        S.timer -= dt;
        if (S.timer <= 0) launchPan();
        break;
      }
      case 'flying': {
        const pan = S.pan;
        if (!pan) break;
        pan.t += dt / PAN_DUR;
        const t = clamp(pan.t, 0, 1);
        pan.x = lerp(pan.sx, pan.tx, t);
        pan.y = lerp(pan.sy, pan.ty, t) - Math.sin(t * Math.PI) * 170;
        pan.rot += pan.spin * dt;
        if (pan.t >= 1) impact();
        break;
      }
      case 'resolve': {
        S.timer -= dt;
        if (S.timer <= 0) nextTurn();
        break;
      }
      case 'aiWait': {
        S.timer -= dt;
        if (S.timer <= 0) {
          S.aiTarget = pickAIValue();
          S.aiChargeT = 0;
          S.power = 0;
          cpu.play('walk', true);
          S.phase = 'aiCharging';
        }
        break;
      }
      case 'aiCharging': {
        S.aiChargeT += dt;
        const t = clamp(S.aiChargeT / AI_CHARGE_DUR, 0, 1);
        S.power = S.aiTarget * (t * t * (3 - 2 * t));
        if (S.aiChargeT >= AI_CHARGE_DUR) {
          S.power = S.aiTarget;
          beginThrow('cpu', judge(S.aiTarget));
        }
        break;
      }
      default:
        break;
    }
  }

  /* ---------------- 繪圖 ---------------- */
  function drawBackground() {
    if (BG.complete && BG.naturalWidth > 0) {
      ctx.drawImage(BG, 0, 0, CW, CH);
    } else {
      ctx.fillStyle = '#3a2a18';
      ctx.fillRect(0, 0, CW, CH);
    }
    // 暖色調光暈
    const g = ctx.createRadialGradient(CW * 0.5, CH * 0.35, 80, CW * 0.5, CH * 0.35, CW * 0.62);
    g.addColorStop(0, 'rgba(255,214,140,0.18)');
    g.addColorStop(1, 'rgba(20,10,0,0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CW, CH);
  }

  function drawPan() {
    const p = S.pan;
    if (!p) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    // 陰影
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 6, 24, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 手柄
    ctx.fillStyle = '#5a3b25';
    roundRect(ctx, 16, -6, 40, 12, 5);
    ctx.fill();
    // 鍋身
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#454550';
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9aa0ad';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of S.particles) {
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of S.popups) {
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.6));
      ctx.font = 'bold 44px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawHpBar(x, y, w, h, ratio, flip) {
    // 外框
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 8);
    ctx.fill();
    ctx.fillStyle = '#2a1c10';
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();

    const bw = Math.max(0, w * ratio);
    const bx = flip ? x + w - bw : x;
    const col = ratio > 0.55 ? ['#57d95c', '#2f9e3a'] : ratio > 0.25 ? ['#f2c14e', '#c8892a'] : ['#e85c5c', '#a52f2f'];
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, col[0]);
    g.addColorStop(1, col[1]);
    ctx.fillStyle = g;
    roundRect(ctx, bx, y, bw, h, 6);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,238,200,0.75)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 6);
    ctx.stroke();
  }

  function drawHud() {
    const barW = 400,
      barH = 24,
      barY = 36;

    // 左：玩家
    drawHpBar(48, barY, barW, barH, player.hp / MAX_HP, false);
    ctx.font = 'bold 26px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = '#ffe9c4';
    ctx.textAlign = 'left';
    ctx.fillText('你', 48, barY - 12);
    ctx.textAlign = 'right';
    ctx.fillText(player.hp + ' / ' + MAX_HP, 48 + barW, barY - 12);

    // 右：電腦
    drawHpBar(CW - 48 - barW, barY, barW, barH, cpu.hp / MAX_HP, true);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe9c4';
    ctx.fillText('電腦', CW - 48, barY - 12);
    ctx.textAlign = 'left';
    ctx.fillText(cpu.hp + ' / ' + MAX_HP, CW - 48 - barW, barY - 12);

    // 回合數
    ctx.textAlign = 'center';
    ctx.font = 'bold 24px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = 'rgba(255,233,196,0.85)';
    ctx.fillText('第 ' + S.round + ' 回合', CW / 2, 46);

    // 中央結果文字
    if (S.resultT > 0 && S.resultText) {
      const a = clamp(S.resultT / 0.5, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = 'bold 74px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(S.resultText, CW / 2, 210);
      ctx.fillStyle = S.resultColor;
      ctx.fillText(S.resultText, CW / 2, 210);
      ctx.globalAlpha = 1;
    }

    // 蓄力條
    const showMeter = S.phase === 'playerReady' || S.phase === 'playerCharging' || S.phase === 'aiCharging' || S.phase === 'aiWait';
    if (showMeter) {
      const mw = 560,
        mh = 28,
        mx = (CW - mw) / 2,
        my = CH - 96;

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRect(ctx, mx - 6, my - 6, mw + 12, mh + 12, 10);
      ctx.fill();

      // 底色
      ctx.fillStyle = '#3a2b1c';
      roundRect(ctx, mx, my, mw, mh, 6);
      ctx.fill();

      // 擦邊區
      ctx.fillStyle = 'rgba(242,193,78,0.35)';
      ctx.fillRect(mx + mw * EDGE_MIN, my, mw * (EDGE_MAX - EDGE_MIN), mh);
      ctx.fillStyle = 'rgba(242,193,78,0.55)';
      ctx.fillRect(mx + mw * EDGE_MIN, my, mw * (SWEET_MIN - EDGE_MIN), mh);
      ctx.fillRect(mx + mw * SWEET_MAX, my, mw * (EDGE_MAX - SWEET_MAX), mh);

      // 完美區
      const sg = ctx.createLinearGradient(0, my, 0, my + mh);
      sg.addColorStop(0, '#a8ff9e');
      sg.addColorStop(1, '#2f9e3a');
      ctx.fillStyle = sg;
      ctx.fillRect(mx + mw * SWEET_MIN, my, mw * (SWEET_MAX - SWEET_MIN), mh);

      ctx.strokeStyle = 'rgba(255,238,200,0.8)';
      ctx.lineWidth = 2;
      roundRect(ctx, mx, my, mw, mh, 6);
      ctx.stroke();

      // 指針
      const px = mx + mw * clamp(S.power, 0, 1);
      ctx.fillStyle = '#fff8e1';
      ctx.fillRect(px - 3, my - 10, 6, mh + 20);
      ctx.beginPath();
      ctx.moveTo(px - 9, my - 10);
      ctx.lineTo(px + 9, my - 10);
      ctx.lineTo(px, my + 2);
      ctx.closePath();
      ctx.fill();

      ctx.textAlign = 'center';
      ctx.font = 'bold 20px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.fillStyle = 'rgba(255,233,196,0.9)';
      ctx.fillText('完美區', mx + mw * (SWEET_MIN + SWEET_MAX) / 2, my - 22);
    }

    // 操作提示
    ctx.textAlign = 'center';
    ctx.font = '22px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = 'rgba(255,233,196,0.9)';
    let hint = '';
    if (S.phase === 'playerReady') hint = '按住 空白鍵 / 滑鼠左鍵 蓄力，放開投擲平底鍋';
    else if (S.phase === 'playerCharging') hint = '放開！讓指針停在綠色區域';
    else if (S.phase === 'aiWait' || S.phase === 'aiCharging') hint = '電腦正在瞄準…';
    ctx.fillText(hint, CW / 2, CH - 26);
    ctx.textAlign = 'left';
  }

  function drawOverlay() {
    if (S.phase === 'loading') {
      const ready = loadDone >= loadTotal;
      ctx.fillStyle = 'rgba(10,6,2,0.92)';
      ctx.fillRect(0, 0, CW, CH);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9c4';
      ctx.font = 'bold 46px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.fillText(ready ? '素材載入完成' : '載入中… ' + loadDone + '/' + loadTotal, CW / 2, CH / 2);
      if (ready) {
        S.phase = 'title';
      }
      return;
    }

    if (S.phase === 'title') {
      ctx.fillStyle = 'rgba(10,6,2,0.55)';
      ctx.fillRect(0, 0, CW, CH);

      ctx.textAlign = 'center';
      ctx.font = 'bold 96px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText('柴犬丟平底鍋', CW / 2, 250);
      const tg = ctx.createLinearGradient(0, 180, 0, 270);
      tg.addColorStop(0, '#ffe9a8');
      tg.addColorStop(1, '#f0a03c');
      ctx.fillStyle = tg;
      ctx.fillText('柴犬丟平底鍋', CW / 2, 250);

      ctx.font = '28px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.fillStyle = '#ffe9c4';
      ctx.fillText('按住 空白鍵 / 滑鼠左鍵 蓄力，放開把平底鍋丟出去！', CW / 2, 340);
      ctx.fillStyle = '#8dff9c';
      ctx.fillText('指針停在綠色區域 → 完美命中 (20 傷害)', CW / 2, 388);
      ctx.fillStyle = '#ffd166';
      ctx.fillText('邊緣黃色區域 → 擦邊命中 (7 傷害)', CW / 2, 430);

      ctx.font = 'bold 34px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() / 300);
      ctx.fillStyle = '#fff3c4';
      ctx.fillText('點一下畫面 / 按空白鍵 開始', CW / 2, 530);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      return;
    }

    if (S.phase === 'over') {
      ctx.fillStyle = 'rgba(10,6,2,0.7)';
      ctx.fillRect(0, 0, CW, CH);
      ctx.textAlign = 'center';

      const win = S.winner === 'player';
      ctx.font = 'bold 92px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const txt = win ? '你贏了！' : '你輸了…';
      ctx.strokeText(txt, CW / 2, 300);
      ctx.fillStyle = win ? '#8dff9c' : '#ff8a8a';
      ctx.fillText(txt, CW / 2, 300);

      ctx.font = '30px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.fillStyle = '#ffe9c4';
      ctx.fillText('共打了 ' + S.round + ' 回合', CW / 2, 366);

      ctx.font = 'bold 34px system-ui, "Microsoft JhengHei", sans-serif';
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() / 300);
      ctx.fillStyle = '#fff3c4';
      ctx.fillText('點一下畫面 / 按空白鍵 再玩一次', CW / 2, 470);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CW, CH);

    drawBackground();

    ctx.save();
    if (S.shakeScreen > 0) {
      ctx.translate(
        (Math.random() - 0.5) * S.shakeScreen,
        (Math.random() - 0.5) * S.shakeScreen
      );
    }

    cpu.draw(ctx);
    player.draw(ctx);
    drawPan();
    drawParticles();
    drawPopups();

    ctx.restore();

    if (S.phase !== 'loading' && S.phase !== 'title') drawHud();
    drawOverlay();
  }

  /* ---------------- 主迴圈 ---------------- */
  let last = performance.now();

  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // 避免切換分頁後跳太大

    if (S.phase !== 'loading') update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  /* ---------------- 輸入 ---------------- */
  function onDown() {
    initAudio();
    if (S.phase === 'title' || S.phase === 'over') {
      newGame();
      return;
    }
    if (S.phase === 'playerReady') {
      S.chargeT = 0;
      S.power = 0;
      S.phase = 'playerCharging';
    }
  }

  function onUp() {
    if (S.phase === 'playerCharging') releasePlayer();
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onDown();
  });
  window.addEventListener('pointerup', (e) => {
    e.preventDefault();
    onUp();
  });
  window.addEventListener('pointercancel', onUp);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) onDown();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      onUp();
    }
  });

  /* ---------------- 啟動 ---------------- */
  requestAnimationFrame(loop);
})();
