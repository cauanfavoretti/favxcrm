// ======================================================
// FAVX CRM — Virtual Office (2D Gather-style)
// Cada webhook ativo é um NPC no escritório.
// ======================================================

// ── Constantes de mapa ────────────────────────────────
const TILE  = 40;      // px por tile
const COLS  = 24;
const ROWS  = 16;
const W     = COLS * TILE;
const H     = ROWS * TILE;
const SPEED = 3;
const INTERACT_DIST = TILE * 1.6;

// Paleta de cores para os agentes
const AGENT_COLORS = [
  '#6366f1','#f59e0b','#10b981','#ef4444',
  '#8b5cf6','#06b6d4','#f97316','#ec4899',
];

// ── Layout do mapa ────────────────────────────────────
// 0=chão  1=parede  2=mesa  3=planta  4=sofá  5=porta
const MAP_RAW = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,2,0,0,2,0,0,2,0,0,0,1,0,0,2,0,0,2,0,0,0,0,1],
  [1,0,2,0,0,2,0,0,2,0,0,0,1,0,0,2,0,0,2,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,2,0,0,2,0,0,2,0,0,0,0,0,0,2,0,0,2,0,0,0,0,1],
  [1,0,2,0,0,2,0,0,2,0,0,0,0,0,0,2,0,0,2,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,3,0,0,3,0,0,0,0,0,0,0,0,0,1],
  [1,0,2,0,0,2,0,0,2,0,0,0,0,0,0,2,0,0,2,0,0,0,0,1],
  [1,0,2,0,0,2,0,0,2,0,0,0,0,0,0,2,0,0,2,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,5,1,1,1,1,1,1,1,1,1,1,1,1],
];

// Posições onde os agentes ficam sentados (tile col, row)
const DESK_SEATS = [
  {col:2,row:2},{col:5,row:2},{col:8,row:2},
  {col:15,row:2},{col:18,row:2},
  {col:2,row:6},{col:5,row:6},{col:8,row:6},
  {col:15,row:6},{col:18,row:6},
  {col:2,row:10},{col:5,row:10},{col:8,row:10},
  {col:15,row:10},{col:18,row:10},
];

// ── Estado ────────────────────────────────────────────
let _canvas, _ctx, _raf;
let _player  = { x: 11 * TILE + TILE/2, y: 14 * TILE + TILE/2, dir: 0 };
let _keys    = {};
let _agents  = [];   // { x, y, color, name, webhook }
let _nearby  = null; // agente mais próximo se < INTERACT_DIST
let _panel   = null; // webhook exibido no painel lateral
let _userInitials = 'EU';

// Tamanho lógico vs display
let _scale   = 1;

// ── Sprites ───────────────────────────────────────────
function drawCharacter(ctx, x, y, color, label, talking) {
  const r = 14;
  // Sombra
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y + r + 2, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Corpo
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Borda
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.stroke();

  // Inicial
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${r * 0.85}px system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.slice(0, 2).toUpperCase(), x, y);

  // Balão de fala pulsando
  if (talking) {
    ctx.save();
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(Date.now() / 250);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - 20, y - r - 26, 40, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '10px system-ui,sans-serif';
    ctx.fillText('Press E', x, y - r - 17);
    ctx.restore();
  }

  // Nome abaixo
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.font = '10px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lw = ctx.measureText(label).width + 10;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(x - lw / 2, y + r + 5, lw, 14, 3);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#111';
  ctx.fillText(label, x, y + r + 7);
}

function drawTile(ctx, tx, ty, type) {
  const x = tx * TILE, y = ty * TILE;
  switch (type) {
    case 0: // chão
      ctx.fillStyle = '#f0eee8';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = '#e0ddd5';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, TILE, TILE);
      break;
    case 1: // parede
      ctx.fillStyle = '#3b3b3b';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      break;
    case 2: { // mesa
      ctx.fillStyle = '#f0eee8';
      ctx.fillRect(x, y, TILE, TILE);
      const pw = TILE - 8, ph = TILE - 10;
      ctx.fillStyle = '#c8a96e';
      ctx.beginPath();
      ctx.roundRect(x + 4, y + 5, pw, ph, 3);
      ctx.fill();
      ctx.fillStyle = '#b8955a';
      ctx.fillRect(x + 4, y + 5, pw, 3);
      // Monitor
      ctx.fillStyle = '#2d3748';
      ctx.beginPath();
      ctx.roundRect(x + 10, y + 7, pw - 12, ph - 10, 2);
      ctx.fill();
      ctx.fillStyle = '#4299e1';
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x + 12, y + 9, pw - 16, ph - 14);
      ctx.globalAlpha = 1;
      break;
    }
    case 3: // planta
      ctx.fillStyle = '#f0eee8';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7d5a3c';
      ctx.fillRect(x + 15, y + 26, 10, 8);
      ctx.fillStyle = '#2f855a';
      ctx.beginPath();
      ctx.arc(x + 20, y + 18, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#276749';
      ctx.beginPath();
      ctx.arc(x + 13, y + 22, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 27, y + 22, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 4: // sofá
      ctx.fillStyle = '#f0eee8';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#6b7280';
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 8, TILE - 4, TILE - 14, 4);
      ctx.fill();
      ctx.fillStyle = '#9ca3af';
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 8, TILE - 4, 10, [4, 4, 0, 0]);
      ctx.fill();
      break;
    case 5: // porta
      ctx.fillStyle = '#f0eee8';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#a07850';
      ctx.beginPath();
      ctx.roundRect(x + 8, y + 2, TILE - 16, TILE - 4, [4, 4, 0, 0]);
      ctx.fill();
      ctx.fillStyle = '#d4a96a';
      ctx.fillRect(x + 10, y + 4, TILE - 20, TILE - 8);
      ctx.fillStyle = '#b8895a';
      ctx.beginPath();
      ctx.arc(x + TILE / 2, y + TILE / 2 + 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

// ── Colisão ───────────────────────────────────────────
function isSolid(px, py) {
  const col = Math.floor(px / TILE);
  const row = Math.floor(py / TILE);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
  const t = MAP_RAW[row]?.[col];
  return t === 1 || t === 2 || t === 3 || t === 4;
}

function tryMove(x, y, dx, dy) {
  const r = 10;
  const nx = x + dx, ny = y + dy;
  const canX = !isSolid(nx - r, y) && !isSolid(nx + r, y) && !isSolid(nx, y - r) && !isSolid(nx, y + r);
  const canY = !isSolid(x, ny - r) && !isSolid(x + r, ny) && !isSolid(x - r, ny) && !isSolid(x, ny + r);
  return { x: canX ? nx : x, y: canY ? ny : y };
}

// ── Câmera ────────────────────────────────────────────
function getCameraOffset(px, py, viewW, viewH) {
  let cx = px - viewW / 2;
  let cy = py - viewH / 2;
  cx = Math.max(0, Math.min(W - viewW, cx));
  cy = Math.max(0, Math.min(H - viewH, cy));
  return { cx, cy };
}

// ── Loop de jogo ──────────────────────────────────────
function gameLoop() {
  if (!_canvas || !_ctx) return;
  _raf = requestAnimationFrame(gameLoop);

  // Movimento
  let dx = 0, dy = 0;
  if (_keys['ArrowLeft']  || _keys['a'] || _keys['A']) dx -= SPEED;
  if (_keys['ArrowRight'] || _keys['d'] || _keys['D']) dx += SPEED;
  if (_keys['ArrowUp']    || _keys['w'] || _keys['W']) dy -= SPEED;
  if (_keys['ArrowDown']  || _keys['s'] || _keys['S']) dy += SPEED;

  if (dx && dy) { dx *= 0.707; dy *= 0.707; }
  if (dx || dy) {
    const np = tryMove(_player.x, _player.y, dx, dy);
    _player.x = np.x;
    _player.y = np.y;
  }

  // Agente próximo
  _nearby = null;
  let minDist = Infinity;
  for (const ag of _agents) {
    const d = Math.hypot(ag.x - _player.x, ag.y - _player.y);
    if (d < INTERACT_DIST && d < minDist) { minDist = d; _nearby = ag; }
  }

  // Render
  const vw = _canvas.width / _scale;
  const vh = _canvas.height / _scale;
  _ctx.save();
  _ctx.scale(_scale, _scale);

  const { cx, cy } = getCameraOffset(_player.x, _player.y, vw, vh);
  _ctx.translate(-cx, -cy);

  // Mapa
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++)
      drawTile(_ctx, col, row, MAP_RAW[row][col]);

  // Agentes
  for (const ag of _agents) {
    const talking = _nearby === ag;
    drawCharacter(_ctx, ag.x, ag.y, ag.color, ag.label, talking);
  }

  // Player
  drawCharacter(_ctx, _player.x, _player.y, '#1d4ed8', _userInitials, false);

  _ctx.restore();
}

// ── Painel lateral ───────────────────────────────────
function showPanel(webhook) {
  _panel = webhook;
  const el = document.getElementById('officePanel');
  if (!el) return;
  const events = (webhook.events || []).join(', ') || '—';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:44px;height:44px;border-radius:12px;background:${webhook._color};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="color:#fff;font-weight:800;font-size:15px">${webhook.name.slice(0,2).toUpperCase()}</span>
      </div>
      <div>
        <div style="font-size:16px;font-weight:700;color:var(--color-text-1)">${webhook.name}</div>
        <div style="display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 8px;border-radius:20px;
          background:${webhook.is_active ? 'var(--color-green-lite)' : 'var(--color-border-2)'};
          color:${webhook.is_active ? 'var(--color-green)' : 'var(--color-text-3)'}">
          <span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>
          ${webhook.is_active ? 'Ativo' : 'Inativo'}
        </div>
      </div>
    </div>
    <div style="font-size:12px;color:var(--color-text-3);margin-bottom:4px">Endpoint</div>
    <div style="font-size:12px;word-break:break-all;color:var(--color-text-1);background:var(--color-surface-2);padding:8px;border-radius:6px;margin-bottom:12px;font-family:monospace">${webhook.url}</div>
    <div style="font-size:12px;color:var(--color-text-3);margin-bottom:4px">Eventos</div>
    <div style="font-size:12px;color:var(--color-text-1);margin-bottom:16px">${events}</div>
    <div style="font-size:12px;color:var(--color-text-3);margin-bottom:6px">Último disparo</div>
    <div style="font-size:12px;color:var(--color-text-1);margin-bottom:20px">${webhook.last_triggered_at ? new Date(webhook.last_triggered_at).toLocaleString('pt-BR') : '—'}</div>
    <button class="btn btn-ghost btn-sm" id="officePanelClose" style="width:100%">Fechar</button>
  `;
  el.style.display = 'block';
  document.getElementById('officePanelClose')?.addEventListener('click', () => {
    el.style.display = 'none';
    _panel = null;
    _canvas?.focus();
  });
}

// ── Inicialização ─────────────────────────────────────
window.initOffice = function({ webhooks = [], userInitials = 'EU' } = {}) {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }

  _userInitials = userInitials.slice(0, 2).toUpperCase() || 'EU';

  // Posiciona agentes nas mesas
  const active = webhooks.filter(w => w.is_active);
  const all    = [...active, ...webhooks.filter(w => !w.is_active)];
  _agents = all.slice(0, DESK_SEATS.length).map((wh, i) => ({
    x:      DESK_SEATS[i].col * TILE + TILE / 2,
    y:      DESK_SEATS[i].row * TILE + TILE / 2 + TILE,
    color:  AGENT_COLORS[i % AGENT_COLORS.length],
    label:  wh.name.slice(0, 8),
    webhook: wh,
    _color: AGENT_COLORS[i % AGENT_COLORS.length],
  }));
  // Injeta cor no webhook para uso no painel
  _agents.forEach(ag => { ag.webhook._color = ag.color; });

  _player = { x: 11.5 * TILE, y: 13.5 * TILE };
  _keys   = {};
  _nearby = null;
  _panel  = null;

  _canvas = document.getElementById('officeCanvas');
  if (!_canvas) return;
  _ctx    = _canvas.getContext('2d');

  // Dimensiona canvas ao container
  function resize() {
    const container = _canvas.parentElement;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight || Math.round(cw * (H / W));
    _scale   = Math.min(cw / W, ch / H, 1);
    _canvas.width  = Math.round(W * _scale);
    _canvas.height = Math.round(H * _scale);
  }
  resize();

  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(_canvas.parentElement);

  // Teclado
  _canvas.setAttribute('tabindex', '0');
  _canvas.style.outline = 'none';
  _canvas.focus();

  const onKey = (e, val) => {
    _keys[e.key] = val;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
    if (val && (e.key === 'e' || e.key === 'E') && _nearby) showPanel(_nearby.webhook);
  };
  _canvas.addEventListener('keydown', e => onKey(e, true));
  _canvas.addEventListener('keyup',   e => onKey(e, false));

  // Clique no agente (touch / mouse)
  _canvas.addEventListener('click', e => {
    if (!_nearby) return;
    showPanel(_nearby.webhook);
  });

  gameLoop();
};

window.unloadOffice = function() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  _canvas = null;
  _ctx    = null;
};
