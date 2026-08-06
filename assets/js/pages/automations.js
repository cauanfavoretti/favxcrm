// ======================================
// FAVX CRM — Automações (workflow builder estilo n8n)
// ======================================

const AUTO_TRIGGER_DEFS = {
  contact_replied:           { label: 'Cliente respondeu',           icon: 'message-circle', desc: 'Quando o contato envia uma mensagem no WhatsApp' },
  webhook:                   { label: 'Webhook',                     icon: 'webhook',         desc: 'Quando uma URL externa é chamada (POST)' },
  user_replied:               { label: 'Usuário respondeu',           icon: 'send',            desc: 'Quando um usuário do CRM responde no chat' },
  opportunity_created:        { label: 'Oportunidade criada',         icon: 'plus-circle',     desc: 'Quando uma nova oportunidade é criada' },
  opportunity_stage_changed:  { label: 'Oportunidade mudou de etapa', icon: 'move-right',      desc: 'Quando a oportunidade muda de etapa no funil' },
  opportunity_status_changed: { label: 'Status da oportunidade mudou',icon: 'flag',            desc: 'Quando é marcada como aberta, ganha ou perdida' },
  contact_assigned:           { label: 'Usuário atribuído ao contato',icon: 'user-check',      desc: 'Quando um usuário passa a ser responsável pelo contato' },
};
// Paleta do workflow: azul, laranja, vermelho, roxo — cada cor com um
// tom de glow correspondente, usado nos badges de ícone e nas bordas
// dos nós selecionados/gatilho no canvas escuro.
const AUTO_COLORS = {
  blue:   { color: '#3b82f6', glow: 'rgba(59,130,246,.45)'  },
  orange: { color: '#f97316', glow: 'rgba(249,115,22,.45)'  },
  red:    { color: '#ef4444', glow: 'rgba(239,68,68,.45)'   },
  purple: { color: '#a855f7', glow: 'rgba(168,85,247,.45)'  },
};
const AUTO_TRIGGER_COLOR = AUTO_COLORS.purple.color;
const AUTO_TRIGGER_GLOW  = AUTO_COLORS.purple.glow;

const AUTO_NODE_DEFS = {
  whatsapp_send_message: { label: 'Enviar WhatsApp',        icon: 'message-square', ...AUTO_COLORS.blue },
  pipeline_create:       { label: 'Criar Pipeline',         icon: 'columns-3',      ...AUTO_COLORS.blue },
  opportunity_search:    { label: 'Procurar Oportunidade',  icon: 'search',         ...AUTO_COLORS.blue },
  opportunity_update:    { label: 'Atualizar Oportunidade', icon: 'pencil',         ...AUTO_COLORS.blue },
  timer:                 { label: 'Timer',                  icon: 'clock',          ...AUTO_COLORS.orange },
  contact_tag_add:       { label: 'Aplicar tag',           icon: 'tag',            ...AUTO_COLORS.blue },
  contact_tag_remove:    { label: 'Remover tag',           icon: 'tag',            ...AUTO_COLORS.orange },
  if_else:                { label: 'If / Else',              icon: 'git-branch',     ...AUTO_COLORS.red },
  contact_has_tag:        { label: 'Tem a tag?',             icon: 'tags',           ...AUTO_COLORS.red },
  split:                  { label: 'Split',                  icon: 'split',          ...AUTO_COLORS.purple },
};

// Nodes que se ramificam em duas saídas (SIM/NÃO). Precisam da forma de
// losango e de duas portas, e não só o If/Else.
function _autoIsBranch(node) {
  return !node.isTrigger && (node.type === 'if_else' || node.type === 'contact_has_tag');
}

const AUTO_STAGE_COLORS = ['#3b82f6','#f97316','#a855f7','#ef4444','#3b82f6','#f97316','#a855f7'];

let automationsState = { list: [] };
let _autoCurrent      = null;  // { id, name, description, graph:{nodes,edges} }
let _autoSelectedNode = null;
let _autoNodeEls      = {};
let _autoDrag         = null;
let _autoConnect      = null;
let _autoIdSeq        = 0;
let _autoPipelines    = [];
let _autoUsers        = [];
let _autoTags         = [];

// Câmera do canvas. A rolagem nativa foi trocada por translate+scale: com
// scrollLeft não dá para aplicar zoom, porque transform não altera a área
// rolável e o conteúdo ampliado ficaria inalcançável.
const AUTO_ZOOM_MIN  = 0.3;
const AUTO_ZOOM_MAX  = 2;
const AUTO_ZOOM_STEP = 0.15;
const AUTO_CANVAS_W  = 2600;
const AUTO_CANVAS_H  = 1700;
let _autoView = { x: 0, y: 0, zoom: 1 };
let _autoPan  = null;

// Uma tag pode ter sido apagada depois de configurada no fluxo; nesse caso
// mostra o id abreviado em vez de sumir com a referência silenciosamente.
function _autoTagNames(ids) {
  return (Array.isArray(ids) ? ids : []).map(id => {
    const t = _autoTags.find(x => x.id === id);
    return t ? t.name : `(tag removida ${String(id).slice(0, 6)})`;
  });
}

function _autoNewId(prefix) { return `${prefix}_${Date.now().toString(36)}${(_autoIdSeq++).toString(36)}`; }
function _autoEsc(s) { return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── API ──────────────────────────────────────────────────────

window.loadAutomations = async function() {
  return await apiFetch('/api/automations');
};

// ── PAGE (lista) — o construtor abre em camada própria de tela cheia,
// fora de #pageContent (ver _autoMountBuilder). ──────────────────

window.pageAutomations = function(data) {
  if (Array.isArray(data)) automationsState.list = data;
  return _autoListHtml(automationsState.list);
};

window.initAutomations = function() {
  _autoInitList();
};

// ── LIST VIEW ─────────────────────────────────────────────────

function _autoFmtWhen(iso) {
  if (!iso) return 'Nunca executada';
  const d = new Date(iso);
  return 'Última execução: ' + d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function _autoListHtml(automations) {
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Automações</h1>
      <p class="page-subtitle">${automations.length} automação${automations.length !== 1 ? 'ões' : ''} cadastrada${automations.length !== 1 ? 's' : ''}</p>
    </div>
    <button class="btn btn-primary btn-sm" id="btnNewAutomation"><i data-lucide="plus" style="width:14px;height:14px"></i> Nova Automação</button>
  </div>

  ${automations.length === 0 ? `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:320px;gap:14px;color:var(--color-text-3)">
      <i data-lucide="workflow" style="width:42px;height:42px;opacity:0.3"></i>
      <p style="font-size:13px">Nenhuma automação cadastrada ainda.</p>
      <button class="btn btn-primary btn-sm" id="btnNewAutomationEmpty"><i data-lucide="plus" style="width:14px;height:14px"></i> Criar primeira automação</button>
    </div>
  ` : `
  <div class="auto-grid">
    ${automations.map(a => {
      const t = AUTO_TRIGGER_DEFS[a.trigger_type] || { label: a.trigger_type, icon: 'zap' };
      return `
      <div class="auto-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div class="auto-card-title" data-open="${a.id}" style="cursor:pointer">${_autoEsc(a.name)}</div>
          <label class="toggle" style="flex-shrink:0" title="${a.is_active ? 'Ativa' : 'Pausada'}">
            <input type="checkbox" ${a.is_active ? 'checked' : ''} class="automation-toggle" data-id="${a.id}">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="auto-trigger-badge"><i data-lucide="${t.icon}" style="width:11px;height:11px"></i> ${_autoEsc(t.label)}</div>
        ${a.description ? `<div style="font-size:12px;color:var(--color-text-3);line-height:1.4">${_autoEsc(a.description)}</div>` : ''}
        <div class="auto-card-meta">
          <span>${(a.run_count || 0).toLocaleString('pt-BR')} execuç${a.run_count === 1 ? 'ão' : 'ões'}</span>
          <span>${_autoFmtWhen(a.last_run_at)}</span>
        </div>
        <div class="auto-card-actions">
          <button class="btn btn-ghost btn-sm auto-edit-btn" data-id="${a.id}" style="flex:1"><i data-lucide="pencil" style="width:13px;height:13px"></i> Editar</button>
          <button class="btn btn-ghost btn-sm auto-test-btn" data-id="${a.id}" data-name="${_autoEsc(a.name)}" title="Testar"><i data-lucide="play" style="width:13px;height:13px"></i></button>
          <button class="btn btn-ghost btn-sm auto-delete-btn" data-id="${a.id}" data-name="${_autoEsc(a.name)}" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px;color:var(--color-red)"></i></button>
        </div>
      </div>`;
    }).join('')}
  </div>
  `}
  `;
}

function _autoInitList() {
  document.getElementById('btnNewAutomation')?.addEventListener('click', _autoOpenNew);
  document.getElementById('btnNewAutomationEmpty')?.addEventListener('click', _autoOpenNew);

  document.querySelectorAll('.auto-card-title[data-open]').forEach(el => {
    el.addEventListener('click', () => _autoOpenEdit(el.dataset.open));
  });
  document.querySelectorAll('.auto-edit-btn').forEach(el => {
    el.addEventListener('click', () => _autoOpenEdit(el.dataset.id));
  });

  document.querySelectorAll('.automation-toggle').forEach(input => {
    input.addEventListener('change', async function() {
      try { await apiFetch(`/api/automations/${this.dataset.id}/toggle`, { method: 'PUT' }); }
      catch (err) { this.checked = !this.checked; console.error('[automation toggle]', err.message); }
    });
  });

  document.querySelectorAll('.auto-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showConfirmModal({
        title: 'Excluir automação',
        message: `Excluir "${btn.dataset.name}"? Essa ação não pode ser desfeita.`,
        confirmLabel: 'Excluir',
        onConfirm: async () => {
          await apiFetch(`/api/automations/${btn.dataset.id}`, { method: 'DELETE' });
          await _autoReloadList();
        },
      });
    });
  });

  document.querySelectorAll('.auto-test-btn').forEach(btn => {
    btn.addEventListener('click', () => _autoOpenTestModal(btn.dataset.id, btn.dataset.name));
  });
}

async function _autoReloadList() {
  const data = await window.loadAutomations();
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = window.pageAutomations(data);
  lucide.createIcons();
  window.initAutomations();
}

function _autoOpenNew() {
  _autoCurrent = { id: null, name: 'Nova automação', description: '', graph: { nodes: [], edges: [] } };
  _autoSelectedNode = null;
  _autoView = { x: 0, y: 0, zoom: 1 };
  _autoMountBuilder();
}

async function _autoOpenEdit(id) {
  if (!id) return;
  let automation;
  try { automation = await apiFetch(`/api/automations/${id}`); } catch (err) { alert(err.message); return; }
  _autoCurrent = {
    id: automation.id, name: automation.name, description: automation.description || '',
    graph: automation.graph && automation.graph.nodes ? automation.graph : { nodes: [], edges: [] },
  };
  _autoSelectedNode = null;
  _autoView = { x: 0, y: 0, zoom: 1 };
  _autoMountBuilder();
}

// Monta o construtor como uma camada de tela cheia, fora do layout normal
// do CRM (sem sidebar/topbar) — "abre em outra página".
function _autoMountBuilder() {
  document.getElementById('autoBuilderOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'autoBuilderOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:4000';
  overlay.innerHTML = _autoBuilderHtml();
  document.body.appendChild(overlay);
  lucide.createIcons();
  _autoInitBuilder();
}

// Substitui o conteúdo do construtor já montado (usado após salvar, para
// refletir ex. o token de webhook gerado no servidor sem fechar a tela).
function _autoRefreshBuilder() {
  const overlay = document.getElementById('autoBuilderOverlay');
  if (!overlay) return;
  overlay.innerHTML = _autoBuilderHtml();
  lucide.createIcons();
  _autoInitBuilder();
}

async function _autoCloseBuilder() {
  document.removeEventListener('keydown', _autoOnKeyView);
  _autoOnPanEnd();
  document.getElementById('autoBuilderOverlay')?.remove();
  await _autoReloadList();
}

// ── TEST MODAL ────────────────────────────────────────────────

function _autoOpenTestModal(automationId, automationName) {
  document.getElementById('autoTestModal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'autoTestModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:14px;width:420px;max-width:100%;box-shadow:0 32px 64px rgba(0,0,0,.25)">
      <div style="padding:16px 20px;border-bottom:1px solid var(--color-border)">
        <div style="font-size:15px;font-weight:700">Testar "${_autoEsc(automationName)}"</div>
        <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">Escolha um contato (opcional) e execute o fluxo agora</div>
      </div>
      <div style="padding:18px 20px">
        <div class="search-wrapper" style="min-width:unset;margin-bottom:8px">
          <i data-lucide="search"></i>
          <input type="text" id="autoTestSearch" placeholder="Buscar contato..." />
        </div>
        <div id="autoTestResults" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
        <input type="hidden" id="autoTestContactId" />
        <div id="autoTestSelected" style="font-size:12px;color:var(--color-text-3);margin-top:8px"></div>
        <div id="autoTestOutcome" style="font-size:12px;margin-top:10px"></div>
      </div>
      <div style="padding:14px 20px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-secondary btn-sm" id="autoTestCancel">Fechar</button>
        <button class="btn btn-primary btn-sm" id="autoTestRun"><i data-lucide="play" style="width:13px;height:13px"></i> Executar teste</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  lucide.createIcons();

  overlay.querySelector('#autoTestCancel').addEventListener('click', () => overlay.remove());

  const search = overlay.querySelector('#autoTestSearch');
  const results = overlay.querySelector('#autoTestResults');
  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = search.value.trim();
      if (!q) { results.innerHTML = ''; return; }
      try {
        const res = await apiFetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=6`);
        const list = res?.data || [];
        results.innerHTML = list.length ? list.map(c => `
          <button type="button" class="auto-test-pick" data-id="${c.id}" data-name="${_autoEsc(c.name)}"
            style="display:flex;align-items:center;gap:8px;padding:7px 8px;border:none;background:none;cursor:pointer;border-radius:6px;text-align:left;font-size:12px"
            onmouseover="this.style.background='var(--color-bg-2)'" onmouseout="this.style.background='none'">
            <div class="assign-mini-avatar">${(c.name||'?')[0].toUpperCase()}</div>${_autoEsc(c.name)}
          </button>`).join('') : `<div style="font-size:12px;color:var(--color-text-3);padding:6px">Nenhum contato encontrado.</div>`;
        results.querySelectorAll('.auto-test-pick').forEach(btn => {
          btn.addEventListener('click', () => {
            overlay.querySelector('#autoTestContactId').value = btn.dataset.id;
            overlay.querySelector('#autoTestSelected').textContent = `Contato selecionado: ${btn.dataset.name}`;
            results.innerHTML = '';
            search.value = '';
          });
        });
      } catch {}
    }, 250);
  });

  overlay.querySelector('#autoTestRun').addEventListener('click', async () => {
    const btn = overlay.querySelector('#autoTestRun');
    const outcome = overlay.querySelector('#autoTestOutcome');
    const contact_id = overlay.querySelector('#autoTestContactId').value || undefined;
    btn.disabled = true; btn.textContent = 'Executando...';
    try {
      const run = await apiFetch(`/api/automations/${automationId}/test`, { method: 'POST', body: JSON.stringify({ contact_id }) });
      const ok = run.status === 'completed';
      outcome.innerHTML = ok
        ? `<span style="color:var(--color-green)">✓ Concluído com sucesso.</span>`
        : run.status === 'waiting'
          ? `<span style="color:var(--color-yellow)">⏳ Pausado num Timer — vai continuar automaticamente.</span>`
          : `<span style="color:var(--color-red)">✕ Falhou: ${_autoEsc(run.error || 'erro desconhecido')}</span>`;
    } catch (err) {
      outcome.innerHTML = `<span style="color:var(--color-red)">✕ ${_autoEsc(err.message)}</span>`;
    } finally {
      btn.disabled = false; btn.innerHTML = '<i data-lucide="play" style="width:13px;height:13px"></i> Executar teste';
      lucide.createIcons();
    }
  });
}

// ── BUILDER: shell ───────────────────────────────────────────

function _autoBuilderHtml() {
  const hasNodes = _autoCurrent.graph.nodes.length > 0;
  return `
  <div class="auto-builder">
    <div class="auto-builder-header">
      <button class="btn btn-ghost btn-sm" id="btnAutoBack"><i data-lucide="arrow-left" style="width:14px;height:14px"></i></button>
      <input type="text" id="autoNameInput" class="auto-name-input" value="${_autoEsc(_autoCurrent.name)}" placeholder="Nome da automação" />
      <button class="btn btn-secondary btn-sm" id="btnAutoAddMenu"><i data-lucide="plus" style="width:13px;height:13px"></i> Adicionar</button>
      <span id="autoSaveError" style="font-size:12px;color:var(--color-red)"></span>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
        ${_autoCurrent.id ? `<button class="btn btn-ghost btn-sm" id="btnAutoTest"><i data-lucide="play" style="width:13px;height:13px"></i> Testar</button>` : ''}
        <button class="btn btn-primary btn-sm" id="btnAutoSave"><i data-lucide="check" style="width:13px;height:13px"></i> Salvar</button>
      </div>
    </div>
    <div class="auto-builder-body" id="autoBuilderBody">
      <div class="auto-canvas-wrap" id="autoCanvasWrap">
        <div class="auto-canvas" id="autoCanvas">
          <svg class="auto-edges" id="autoEdgesSvg"></svg>
          ${!hasNodes ? `<div class="auto-canvas-empty-hint"><i data-lucide="mouse-pointer-click" style="width:16px;height:16px;flex-shrink:0"></i> Clique em "+ Adicionar" para escolher um gatilho e começar o fluxo.</div>` : ''}
        </div>
        <div class="auto-zoom-bar">
          <button class="auto-zoom-btn" id="btnAutoZoomOut" title="Diminuir (tecla −)"><i data-lucide="minus"></i></button>
          <button class="auto-zoom-level" id="autoZoomLabel" title="Voltar a 100% (tecla 0)">100%</button>
          <button class="auto-zoom-btn" id="btnAutoZoomIn" title="Ampliar (tecla +)"><i data-lucide="plus"></i></button>
          <span class="auto-zoom-sep"></span>
          <button class="auto-zoom-btn" id="btnAutoFit" title="Enquadrar o fluxo (tecla 1)"><i data-lucide="maximize"></i></button>
        </div>
        <div class="auto-canvas-tip">Arraste o fundo para mover · roda para deslocar · Ctrl+roda para ampliar</div>
      </div>
    </div>
  </div>`;
}

function _autoInitBuilder() {
  _autoNodeEls = {};
  document.getElementById('btnAutoBack')?.addEventListener('click', () => {
    if (_autoDirty()) {
      showConfirmModal({
        title: 'Sair sem salvar?',
        message: 'Há alterações não salvas neste fluxo. Deseja sair mesmo assim?',
        confirmLabel: 'Sair sem salvar',
        onConfirm: async () => { await _autoCloseBuilder(); },
      });
    } else {
      _autoCloseBuilder();
    }
  });

  document.getElementById('autoNameInput')?.addEventListener('input', e => { _autoCurrent.name = e.target.value; });
  document.getElementById('btnAutoSave')?.addEventListener('click', _autoSave);
  document.getElementById('btnAutoTest')?.addEventListener('click', () => _autoOpenTestModal(_autoCurrent.id, _autoCurrent.name));
  document.getElementById('btnAutoAddMenu')?.addEventListener('click', e => { e.stopPropagation(); _autoOpenAddMenu(e.currentTarget); });

  Promise.all([
    apiFetch('/api/pipelines').catch(() => []),
    apiFetch('/api/conversations/members').catch(() => []),
    apiFetch('/api/contact-tags').catch(() => []),
  ]).then(([pipelines, users, tags]) => {
    _autoPipelines = Array.isArray(pipelines) ? pipelines : [];
    _autoUsers = Array.isArray(users) ? users : [];
    _autoTags = Array.isArray(tags) ? tags : [];
  });

  const wrap = document.getElementById('autoCanvasWrap');
  wrap?.addEventListener('mousedown', _autoStartPan);
  // passive:false porque o handler chama preventDefault para impedir o zoom
  // da página no Ctrl+roda.
  wrap?.addEventListener('wheel', _autoOnWheel, { passive: false });
  // Botão do meio cola o texto no Linux e abre o autoscroll no Windows.
  wrap?.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });

  document.getElementById('btnAutoZoomIn') ?.addEventListener('click', () => _autoZoomBy(AUTO_ZOOM_STEP));
  document.getElementById('btnAutoZoomOut')?.addEventListener('click', () => _autoZoomBy(-AUTO_ZOOM_STEP));
  document.getElementById('autoZoomLabel') ?.addEventListener('click', _autoResetView);
  document.getElementById('btnAutoFit')    ?.addEventListener('click', _autoFitView);

  // Um só listener global, trocado a cada montagem em vez de acumulado.
  document.removeEventListener('keydown', _autoOnKeyView);
  document.addEventListener('keydown', _autoOnKeyView);

  _autoRenderNodes();
  _autoRedrawEdges();
  _autoApplyView();
}

function _autoDirty() { return _autoCurrent.graph.nodes.length > 0; }

// ── BUILDER: pan e zoom ───────────────────────────────────────

function _autoApplyView() {
  const canvas = document.getElementById('autoCanvas');
  if (!canvas) return;
  const { x, y, zoom } = _autoView;
  canvas.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  const label = document.getElementById('autoZoomLabel');
  if (label) label.textContent = Math.round(zoom * 100) + '%';
}

// Impede que o fluxo seja arrastado inteiramente para fora da tela.
function _autoClampView() {
  const wrap = document.getElementById('autoCanvasWrap');
  if (!wrap) return;
  const margin = 160;
  const w = AUTO_CANVAS_W * _autoView.zoom;
  const h = AUTO_CANVAS_H * _autoView.zoom;
  _autoView.x = Math.min(wrap.clientWidth  - margin, Math.max(margin - w, _autoView.x));
  _autoView.y = Math.min(wrap.clientHeight - margin, Math.max(margin - h, _autoView.y));
}

// Converte um ponto da tela para as coordenadas do canvas, que é o sistema
// em que as posições dos nodes e as arestas são guardadas.
function _autoToCanvas(clientX, clientY) {
  const wrap = document.getElementById('autoCanvasWrap');
  const r = wrap.getBoundingClientRect();
  return {
    x: (clientX - r.left - _autoView.x) / _autoView.zoom,
    y: (clientY - r.top  - _autoView.y) / _autoView.zoom,
  };
}

// Amplia mantendo fixo o ponto indicado (centro da tela nos botões, cursor na
// roda) — sem isso o conteúdo escapa da vista a cada passo de zoom.
function _autoZoomAt(nextZoom, clientX, clientY) {
  const wrap = document.getElementById('autoCanvasWrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  const z = Math.min(AUTO_ZOOM_MAX, Math.max(AUTO_ZOOM_MIN, nextZoom));
  if (z === _autoView.zoom) return;

  const px = (clientX ?? r.left + r.width / 2) - r.left;
  const py = (clientY ?? r.top + r.height / 2) - r.top;
  const cx = (px - _autoView.x) / _autoView.zoom;
  const cy = (py - _autoView.y) / _autoView.zoom;

  _autoView.zoom = z;
  _autoView.x = px - cx * z;
  _autoView.y = py - cy * z;
  _autoClampView();
  _autoApplyView();
}

function _autoZoomBy(delta) { _autoZoomAt(_autoView.zoom + delta); }

function _autoResetView() {
  _autoView = { x: 0, y: 0, zoom: 1 };
  _autoApplyView();
}

// Enquadra todos os nodes na área visível.
function _autoFitView() {
  const wrap  = document.getElementById('autoCanvasWrap');
  const nodes = _autoCurrent?.graph?.nodes || [];
  if (!wrap || !nodes.length) return _autoResetView();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const el = _autoNodeEls[n.id];
    const w = el?.offsetWidth || 220;
    const h = el?.offsetHeight || 60;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  });

  const pad = 60;
  const zoom = Math.min(
    AUTO_ZOOM_MAX,
    Math.max(AUTO_ZOOM_MIN,
      Math.min((wrap.clientWidth - pad * 2) / (maxX - minX), (wrap.clientHeight - pad * 2) / (maxY - minY))));

  _autoView.zoom = zoom;
  _autoView.x = (wrap.clientWidth  - (maxX - minX) * zoom) / 2 - minX * zoom;
  _autoView.y = (wrap.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom;
  _autoApplyView();
}

function _autoStartPan(e) {
  // Botão do meio arrasta de qualquer lugar; o esquerdo só no vazio, para não
  // atrapalhar arrastar node, criar conexão ou apagar aresta.
  // A barra de zoom fica dentro da área do canvas; sem excluí-la, clicar em
  // "+" também iniciaria o arraste da vista.
  const onBlank = !e.target.closest('.auto-node') && !e.target.closest('.auto-port')
               && !e.target.closest('[data-edge-del]') && !e.target.closest('.auto-edge-hit')
               && !e.target.closest('.auto-zoom-bar');
  if (e.button !== 1 && !(e.button === 0 && onBlank)) return;
  e.preventDefault();
  _autoPan = { startX: e.clientX, startY: e.clientY, origX: _autoView.x, origY: _autoView.y, moved: false };
  document.getElementById('autoCanvasWrap')?.classList.add('auto-panning');
  document.addEventListener('mousemove', _autoOnPanMove);
  document.addEventListener('mouseup', _autoOnPanEnd);
}
function _autoOnPanMove(e) {
  if (!_autoPan) return;
  const dx = e.clientX - _autoPan.startX;
  const dy = e.clientY - _autoPan.startY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) _autoPan.moved = true;
  _autoView.x = _autoPan.origX + dx;
  _autoView.y = _autoPan.origY + dy;
  _autoClampView();
  _autoApplyView();
}
function _autoOnPanEnd() {
  _autoPan = null;
  document.getElementById('autoCanvasWrap')?.classList.remove('auto-panning');
  document.removeEventListener('mousemove', _autoOnPanMove);
  document.removeEventListener('mouseup', _autoOnPanEnd);
}

function _autoOnWheel(e) {
  // Ctrl/⌘ + roda amplia; roda sozinha desloca a vista, que é o papel que a
  // rolagem nativa cumpria antes.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    _autoZoomAt(_autoView.zoom - Math.sign(e.deltaY) * AUTO_ZOOM_STEP, e.clientX, e.clientY);
    return;
  }
  e.preventDefault();
  _autoView.x -= e.deltaX;
  _autoView.y -= e.deltaY;
  _autoClampView();
  _autoApplyView();
}

function _autoOnKeyView(e) {
  if (!document.getElementById('autoBuilderOverlay')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); _autoZoomBy(AUTO_ZOOM_STEP); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); _autoZoomBy(-AUTO_ZOOM_STEP); }
  else if (e.key === '0') { e.preventDefault(); _autoResetView(); }
  else if (e.key === '1') { e.preventDefault(); _autoFitView(); }
}

// ── BUILDER: node CRUD ───────────────────────────────────────

function _autoNextPosition() {
  // Canto superior esquerdo do que está visível agora, em coordenadas do
  // canvas — o node novo nasce à vista mesmo com a tela deslocada ou ampliada.
  const origin = document.getElementById('autoCanvasWrap')
    ? _autoToCanvas(
        document.getElementById('autoCanvasWrap').getBoundingClientRect().left,
        document.getElementById('autoCanvasWrap').getBoundingClientRect().top)
    : { x: 0, y: 0 };
  const baseX = Math.max(0, origin.x) + 80;
  const baseY = Math.max(0, origin.y) + 60;
  const n = _autoCurrent.graph.nodes.length;
  return { x: baseX + (n % 4) * 30, y: baseY + Math.floor(n / 4) * 30 + (n * 18) % 160 };
}

function _autoAddTrigger(type) {
  const existing = _autoCurrent.graph.nodes.find(n => n.isTrigger);
  const doAdd = () => {
    if (existing) {
      existing.triggerType = type;
      existing.config = {};
    } else {
      _autoCurrent.graph.nodes.push({
        id: _autoNewId('trigger'), isTrigger: true, triggerType: type, config: {}, position: _autoNextPosition(),
      });
    }
    _autoRenderNodes();
    _autoRedrawEdges();
    const el = document.querySelector('.auto-canvas-empty-hint'); if (el) el.remove();
    const t = _autoCurrent.graph.nodes.find(n => n.isTrigger);
    _autoSelectNode(t.id);
  };
  if (existing && existing.triggerType !== type) {
    showConfirmModal({
      title: 'Trocar gatilho?',
      message: 'Este fluxo já tem um gatilho. Trocar vai limpar a configuração atual dele.',
      confirmLabel: 'Trocar',
      onConfirm: async () => doAdd(),
    });
  } else if (!existing) {
    doAdd();
  } else {
    _autoSelectNode(existing.id);
  }
}

function _autoAddNode(type) {
  const node = { id: _autoNewId('node'), type, config: {}, position: _autoNextPosition() };
  _autoCurrent.graph.nodes.push(node);
  _autoRenderNodes();
  _autoRedrawEdges();
  const el = document.querySelector('.auto-canvas-empty-hint'); if (el) el.remove();
  _autoSelectNode(node.id);
}

function _autoDeleteNode(nodeId) {
  _autoCurrent.graph.nodes = _autoCurrent.graph.nodes.filter(n => n.id !== nodeId);
  _autoCurrent.graph.edges = _autoCurrent.graph.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
  if (_autoSelectedNode === nodeId) { _autoSelectedNode = null; document.getElementById('autoConfigPanel')?.remove(); }
  _autoRenderNodes();
  _autoRedrawEdges();
}

// ── BUILDER: menu "+ Adicionar" (Acionador ou Nó) ─────────────
// Substitui a paleta fixa: clicar em "+ Adicionar" abre um menu de duas
// etapas — primeiro escolhe a categoria (Acionador / Nó), depois o tipo
// específico dentro dela.

function _autoCloseAddMenuOnOutside(e) {
  const menu = document.getElementById('autoAddMenu');
  if (!menu) return;
  // Usa composedPath() (capturado no momento do clique, antes de qualquer
  // handler mexer no DOM) em vez de e.target: clicar num item do menu troca
  // o innerHTML (nível 1 → nível 2) e desanexa o elemento clicado, então
  // menu.contains(e.target) ficaria false mesmo para cliques dentro do menu.
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
  const btn = document.getElementById('btnAutoAddMenu');
  if (path.includes(menu) || (btn && path.includes(btn))) return;
  _autoCloseAddMenu();
}
function _autoCloseAddMenu() {
  document.getElementById('autoAddMenu')?.remove();
  document.removeEventListener('click', _autoCloseAddMenuOnOutside);
}

function _autoOpenAddMenu(anchorEl) {
  _autoCloseAddMenu();
  const menu = document.createElement('div');
  menu.id = 'autoAddMenu';
  menu.className = 'auto-add-menu';
  document.body.appendChild(menu);
  const r = anchorEl.getBoundingClientRect();
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.left = r.left + 'px';
  _autoRenderAddMenuLevel1(menu);
  setTimeout(() => document.addEventListener('click', _autoCloseAddMenuOnOutside), 0);
}

function _autoRenderAddMenuLevel1(menu) {
  const hasTrigger = _autoCurrent.graph.nodes.some(n => n.isTrigger);
  menu.innerHTML = `
    <button class="auto-add-menu-item" data-cat="trigger">
      <div class="auto-node-icon" style="background:${AUTO_TRIGGER_COLOR};box-shadow:0 0 10px ${AUTO_TRIGGER_GLOW}"><i data-lucide="zap" style="width:14px;height:14px"></i></div>
      <div class="auto-add-menu-text">
        <div class="auto-add-menu-title">Acionador</div>
        <div class="auto-add-menu-desc">${hasTrigger ? 'Trocar o gatilho do fluxo' : 'Evento que inicia o fluxo'}</div>
      </div>
      <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--ab-text-3)"></i>
    </button>
    <button class="auto-add-menu-item" data-cat="node">
      <div class="auto-node-icon" style="background:${AUTO_COLORS.blue.color};box-shadow:0 0 10px ${AUTO_COLORS.blue.glow}"><i data-lucide="box" style="width:14px;height:14px"></i></div>
      <div class="auto-add-menu-text">
        <div class="auto-add-menu-title">Nó</div>
        <div class="auto-add-menu-desc">Ação ou lógica do fluxo</div>
      </div>
      <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--ab-text-3)"></i>
    </button>`;
  lucide.createIcons();
  menu.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => _autoRenderAddMenuLevel2(menu, btn.dataset.cat));
  });
}

function _autoRenderAddMenuLevel2(menu, cat) {
  const isTrigger = cat === 'trigger';
  const defs = isTrigger ? AUTO_TRIGGER_DEFS : AUTO_NODE_DEFS;
  menu.innerHTML = `
    <button class="auto-add-menu-item auto-add-menu-back" data-back="1">
      <i data-lucide="chevron-left" style="width:14px;height:14px"></i>
      <div class="auto-add-menu-text"><div class="auto-add-menu-title">${isTrigger ? 'Acionador' : 'Nó'}</div></div>
    </button>
    ${Object.entries(defs).map(([type, def]) => `
      <button class="auto-add-menu-item" data-type="${type}">
        <div class="auto-node-icon" style="background:${isTrigger ? AUTO_TRIGGER_COLOR : def.color};box-shadow:0 0 10px ${isTrigger ? AUTO_TRIGGER_GLOW : def.glow}"><i data-lucide="${def.icon}" style="width:13px;height:13px"></i></div>
        <div class="auto-add-menu-text"><div class="auto-add-menu-title">${def.label}</div></div>
      </button>`).join('')}`;
  lucide.createIcons();
  menu.querySelector('[data-back]')?.addEventListener('click', () => _autoRenderAddMenuLevel1(menu));
  menu.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      _autoCloseAddMenu();
      if (isTrigger) _autoAddTrigger(btn.dataset.type);
      else _autoAddNode(btn.dataset.type);
    });
  });
}

// ── BUILDER: node summary text (canvas preview) ──────────────

function _autoNodeSummary(node) {
  if (node.isTrigger) {
    const d = AUTO_TRIGGER_DEFS[node.triggerType];
    const parts = [];
    if (node.triggerType === 'opportunity_stage_changed') {
      const p = _autoPipelines.find(p => p.id === node.config?.pipeline_id);
      const s = p?.stages?.find(s => s.id === node.config?.to_stage_id);
      if (s) parts.push(`→ ${s.name}`);
    }
    if (node.triggerType === 'opportunity_status_changed' && node.config?.to_status) {
      parts.push(`→ ${({won:'Ganho',lost:'Perdido',open:'Aberto'})[node.config.to_status] || node.config.to_status}`);
    }
    if (node.triggerType === 'webhook' && node.config?.token) parts.push('URL gerada ✓');
    return (d?.desc || '') + (parts.length ? '\n' + parts.join(' · ') : '');
  }
  const c = node.config || {};
  switch (node.type) {
    case 'whatsapp_send_message': return c.message ? `"${c.message.slice(0, 70)}${c.message.length > 70 ? '…' : ''}"` : 'Configure a mensagem…';
    case 'pipeline_create': return c.name ? `Pipeline: ${c.name} (${(c.stages||[]).length} etapas)` : 'Configure o pipeline…';
    case 'opportunity_search': return { trigger_opportunity: 'Oportunidade do gatilho', by_contact: 'Por contato', by_pipeline_stage: 'Por funil/etapa' }[c.scope || 'trigger_opportunity'];
    case 'opportunity_update': {
      const f = c.fields || {};
      const bits = [];
      if (f.stage_id) bits.push('etapa');
      if (f.status) bits.push('status');
      if (f.value != null && f.value !== '') bits.push('valor');
      return bits.length ? `Atualiza: ${bits.join(', ')}` : 'Configure os campos…';
    }
    case 'timer': return c.amount ? `Aguardar ${c.amount} ${({minutes:'min',hours:'h',days:'dias'})[c.unit || 'minutes']}` : 'Configure o tempo…';
    case 'if_else': return c.field ? `SE ${c.field} ${c.operator || 'eq'} "${c.value ?? ''}"` : 'Configure a condição…';
    case 'contact_tag_add':
    case 'contact_tag_remove': {
      const names = _autoTagNames(c.tag_ids);
      return names.length ? names.join(', ') : 'Selecione as tags…';
    }
    case 'contact_has_tag': {
      const names = _autoTagNames(c.tag_ids);
      if (!names.length) return 'Selecione as tags…';
      return `${c.match === 'all' ? 'Tem todas' : 'Tem alguma'}: ${names.join(', ')}`;
    }
    case 'split': return 'Executa todos os caminhos conectados em paralelo';
    default: return '';
  }
}

// ── BUILDER: render nodes (DOM) ───────────────────────────────

function _autoRenderNodes() {
  const canvas = document.getElementById('autoCanvas');
  if (!canvas) return;
  canvas.querySelectorAll('.auto-node').forEach(el => el.remove());
  _autoNodeEls = {};

  _autoCurrent.graph.nodes.forEach(node => {
    const def = node.isTrigger ? AUTO_TRIGGER_DEFS[node.triggerType] : AUTO_NODE_DEFS[node.type];
    const color = node.isTrigger ? AUTO_TRIGGER_COLOR : def.color;
    const glow  = node.isTrigger ? AUTO_TRIGGER_GLOW  : def.glow;
    // Formas: padrão (quadrado), If/Else (losango) e Timer (círculo) —
    // só ações têm forma especial; gatilhos são sempre quadrados.
    const shape = _autoIsBranch(node) ? 'if'
                : !node.isTrigger && node.type === 'timer' ? 'timer'
                : null;
    const el = document.createElement('div');
    el.className = 'auto-node' + (node.isTrigger ? ' auto-node-trigger' : '') + (shape ? ` auto-node-${shape}` : '') + (_autoSelectedNode === node.id ? ' auto-node-selected' : '');
    el.style.left = node.position.x + 'px';
    el.style.top = node.position.y + 'px';
    el.dataset.nodeId = node.id;

    const title = node.label?.trim() || (node.isTrigger ? (def?.label || node.triggerType) : def.label);
    el.title = _autoNodeSummary(node);
    el.innerHTML = `
      ${node.isTrigger ? '' : `<button class="auto-node-del" data-del="${node.id}" title="Remover"><i data-lucide="x" style="width:11px;height:11px"></i></button>`}
      <div class="auto-node-badge" style="background:${color};box-shadow:0 0 12px ${glow}"><i data-lucide="${def?.icon || 'circle'}" style="width:18px;height:18px"></i></div>
      <div class="auto-node-name">${_autoEsc(title)}</div>
      ${!node.isTrigger ? `<div class="auto-port auto-port-in" data-port-in="${node.id}"></div>` : ''}
      ${_autoIsBranch(node) ? `
        <div class="auto-port auto-port-out auto-port-true" data-port-out="${node.id}" data-handle="true" title="SIM"></div>
        <div class="auto-port auto-port-out auto-port-false" data-port-out="${node.id}" data-handle="false" title="NÃO"></div>
      ` : `<div class="auto-port auto-port-out" data-port-out="${node.id}" data-handle="default"></div>`}
    `;
    canvas.appendChild(el);
    _autoNodeEls[node.id] = el;

    el.addEventListener('mousedown', e => {
      if (e.target.closest('.auto-node-del') || e.target.closest('.auto-port')) return;
      _autoStartNodeDrag(e, node.id);
    });
    el.addEventListener('click', e => {
      if (e.target.closest('.auto-port') || e.target.closest('.auto-node-del')) return;
      _autoSelectNode(node.id);
    });
    el.querySelector('.auto-node-del')?.addEventListener('click', e => { e.stopPropagation(); _autoDeleteNode(node.id); });

    el.querySelectorAll('[data-port-out]').forEach(portEl => {
      portEl.addEventListener('mousedown', e => { e.stopPropagation(); _autoStartConnect(e, node.id, portEl.dataset.handle); });
    });
    const portIn = el.querySelector('[data-port-in]');
    if (portIn) {
      portIn.addEventListener('mouseup', e => { e.stopPropagation(); _autoFinishConnect(node.id); });
      portIn.addEventListener('mousedown', e => e.stopPropagation());
    }
  });

  lucide.createIcons();
}

function _autoSelectNode(nodeId) {
  _autoSelectedNode = nodeId;
  document.querySelectorAll('.auto-node').forEach(el => el.classList.toggle('auto-node-selected', el.dataset.nodeId === nodeId));
  _autoRenderConfigPanel();
}

// ── BUILDER: dragging nodes ───────────────────────────────────

function _autoStartNodeDrag(e, nodeId) {
  e.preventDefault();
  const node = _autoCurrent.graph.nodes.find(n => n.id === nodeId);
  _autoSelectNode(nodeId);
  _autoDrag = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.position.x, origY: node.position.y };
  document.addEventListener('mousemove', _autoOnNodeDragMove);
  document.addEventListener('mouseup', _autoOnNodeDragEnd);
}
function _autoOnNodeDragMove(e) {
  if (!_autoDrag) return;
  const node = _autoCurrent.graph.nodes.find(n => n.id === _autoDrag.nodeId);
  if (!node) return;
  // O deslocamento do mouse é em pixels de tela; as posições são do canvas.
  // Sem dividir pelo zoom, o node desliza mais rápido que o cursor quando
  // ampliado e mais devagar quando reduzido.
  node.position.x = Math.max(0, _autoDrag.origX + (e.clientX - _autoDrag.startX) / _autoView.zoom);
  node.position.y = Math.max(0, _autoDrag.origY + (e.clientY - _autoDrag.startY) / _autoView.zoom);
  const el = _autoNodeEls[node.id];
  if (el) { el.style.left = node.position.x + 'px'; el.style.top = node.position.y + 'px'; }
  _autoRedrawEdges();
}
function _autoOnNodeDragEnd() {
  _autoDrag = null;
  document.removeEventListener('mousemove', _autoOnNodeDragMove);
  document.removeEventListener('mouseup', _autoOnNodeDragEnd);
}

// ── BUILDER: connecting edges ─────────────────────────────────

function _autoStartConnect(e, nodeId, handle) {
  e.preventDefault();
  const p = _autoToCanvas(e.clientX, e.clientY);
  _autoConnect = { sourceId: nodeId, handle: handle || 'default', x: p.x, y: p.y };
  document.addEventListener('mousemove', _autoOnConnectMove);
  document.addEventListener('mouseup', _autoOnConnectCancel);
}
function _autoOnConnectMove(e) {
  if (!_autoConnect) return;
  const p = _autoToCanvas(e.clientX, e.clientY);
  _autoConnect.x = p.x;
  _autoConnect.y = p.y;
  _autoRedrawEdges();
}
function _autoOnConnectCancel() {
  _autoConnect = null;
  document.removeEventListener('mousemove', _autoOnConnectMove);
  document.removeEventListener('mouseup', _autoOnConnectCancel);
  _autoRedrawEdges();
}
function _autoFinishConnect(targetNodeId) {
  if (!_autoConnect) return;
  const { sourceId, handle } = _autoConnect;
  if (sourceId !== targetNodeId) {
    const exists = _autoCurrent.graph.edges.some(ed => ed.source === sourceId && ed.sourceHandle === handle && ed.target === targetNodeId);
    if (!exists) {
      _autoCurrent.graph.edges.push({ id: _autoNewId('edge'), source: sourceId, sourceHandle: handle, target: targetNodeId });
    }
  }
  _autoConnect = null;
  document.removeEventListener('mousemove', _autoOnConnectMove);
  document.removeEventListener('mouseup', _autoOnConnectCancel);
  _autoRenderNodes();
  _autoRedrawEdges();
}
function _autoDeleteEdge(edgeId) {
  _autoCurrent.graph.edges = _autoCurrent.graph.edges.filter(e => e.id !== edgeId);
  _autoRedrawEdges();
}

// ── BUILDER: edge geometry + SVG ──────────────────────────────

function _autoPortWorldPos(nodeId, kind, handle) {
  const node = _autoCurrent.graph.nodes.find(n => n.id === nodeId);
  const el = _autoNodeEls[nodeId];
  if (!node || !el) return { x: 0, y: 0 };
  const w = el.offsetWidth || 220;
  const h = el.offsetHeight || 60;
  if (kind === 'in') return { x: node.position.x, y: node.position.y + h / 2 };
  if (handle === 'true')  return { x: node.position.x + w, y: node.position.y + h * 0.38 };
  if (handle === 'false') return { x: node.position.x + w, y: node.position.y + h * 0.78 };
  return { x: node.position.x + w, y: node.position.y + h / 2 };
}

function _autoBezier(p1, p2) {
  const dx = Math.max(60, Math.abs(p2.x - p1.x) * 0.5);
  return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
}

// Cor de origem de uma aresta — herda a cor do node de onde ela sai
// (gatilho = roxo, ação = a cor do seu tipo), dando o efeito de "fluxo
// colorido" visto no diagrama de referência.
function _autoEdgeSourceColor(nodeId) {
  const node = _autoCurrent.graph.nodes.find(n => n.id === nodeId);
  if (!node) return AUTO_COLORS.blue.color;
  return node.isTrigger ? AUTO_TRIGGER_COLOR : (AUTO_NODE_DEFS[node.type]?.color || AUTO_COLORS.blue.color);
}

function _autoRedrawEdges() {
  const svg = document.getElementById('autoEdgesSvg');
  if (!svg) return;
  let html = `
    <defs>
      <marker id="autoArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f5680"></path>
      </marker>
    </defs>`;

  _autoCurrent.graph.edges.forEach(edge => {
    const p1 = _autoPortWorldPos(edge.source, 'out', edge.sourceHandle);
    const p2 = _autoPortWorldPos(edge.target, 'in');
    const d = _autoBezier(p1, p2);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const gradId = `autoGrad_${edge.id}`;
    const srcColor = _autoEdgeSourceColor(edge.source);
    html += `
      <linearGradient id="${gradId}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="${srcColor}"></stop>
        <stop offset="100%" stop-color="#4f5680"></stop>
      </linearGradient>`;
    html += `<path class="auto-edge-line" d="${d}" style="stroke:url(#${gradId})" marker-end="url(#autoArrow)"></path>`;
    html += `<path class="auto-edge-hit" d="${d}" data-edge-id="${edge.id}"></path>`;
    html += `<g class="auto-edge-del" data-edge-del="${edge.id}"><circle cx="${mx}" cy="${my}" r="9"></circle><text x="${mx}" y="${my}">×</text></g>`;
  });

  if (_autoConnect) {
    const p1 = _autoPortWorldPos(_autoConnect.sourceId, 'out', _autoConnect.handle);
    const d = _autoBezier(p1, { x: _autoConnect.x, y: _autoConnect.y });
    html += `<path class="auto-edge-preview" d="${d}"></path>`;
  }

  svg.innerHTML = html;
  svg.querySelectorAll('[data-edge-del]').forEach(g => {
    g.addEventListener('click', e => { e.stopPropagation(); _autoDeleteEdge(g.dataset.edgeDel); });
  });
}

// ── BUILDER: config panel ─────────────────────────────────────

function _sel2(id, options, val, placeholder) {
  return `<select id="${id}" class="settings-input" style="width:100%">
    ${placeholder ? `<option value="">${placeholder}</option>` : ''}
    ${options.map(o => { const [v,l] = Array.isArray(o) ? o : [o,o]; return `<option value="${v}" ${String(v)===String(val)?'selected':''}>${l}</option>`; }).join('')}
  </select>`;
}

function _autoRenderConfigPanel() {
  document.getElementById('autoConfigPanel')?.remove();
  if (!_autoSelectedNode) return;
  const node = _autoCurrent.graph.nodes.find(n => n.id === _autoSelectedNode);
  if (!node) return;

  const body = document.getElementById('autoBuilderBody');
  const panel = document.createElement('div');
  panel.id = 'autoConfigPanel';
  panel.className = 'auto-config-panel';
  panel.innerHTML = node.isTrigger ? _autoTriggerConfigHtml(node) : _autoNodeConfigHtml(node);
  body.appendChild(panel);
  lucide.createIcons();

  panel.querySelector('#autoConfigClose')?.addEventListener('click', () => { _autoSelectedNode = null; panel.remove(); _autoRenderNodes(); });
  _autoBindConfigInputs(node, panel);
}

function _autoConfigHeader(node, defLabel, icon, color, glow) {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <div class="auto-node-icon" style="background:${color};box-shadow:0 0 12px ${glow || 'transparent'}"><i data-lucide="${icon}" style="width:14px;height:14px"></i></div>
      <div style="font-size:11px;font-weight:700;flex:1;color:var(--ab-text-3);text-transform:uppercase;letter-spacing:.05em">${_autoEsc(defLabel)}</div>
      <button id="autoConfigClose" style="background:none;border:none;cursor:pointer;color:var(--ab-text-3)"><i data-lucide="x" style="width:16px;height:16px"></i></button>
    </div>
    <div class="settings-field">
      <label class="settings-label">NOME DO NODE</label>
      <input type="text" id="cfgNodeLabel" class="settings-input" value="${_autoEsc(node.label || '')}" placeholder="${_autoEsc(defLabel)}" />
    </div>`;
}

function _autoTriggerConfigHtml(node) {
  const def = AUTO_TRIGGER_DEFS[node.triggerType];
  let fields = `<p style="font-size:12px;color:var(--ab-text-3);line-height:1.5;margin-bottom:14px">${def.desc}</p>`;

  if (node.triggerType === 'opportunity_stage_changed') {
    const pid = node.config?.pipeline_id || '';
    const pipeline = _autoPipelines.find(p => p.id === pid);
    fields += `
      <div class="settings-field">
        <label class="settings-label">FUNIL (opcional)</label>
        ${_sel2('cfgPipeline', _autoPipelines.map(p => [p.id, p.name]), pid, 'Qualquer funil')}
      </div>
      <div class="settings-field">
        <label class="settings-label">ETAPA DE DESTINO (opcional)</label>
        <select id="cfgStage" class="settings-input" style="width:100%" ${!pipeline ? 'disabled' : ''}>
          <option value="">Qualquer etapa</option>
          ${(pipeline?.stages || []).map(s => `<option value="${s.id}" ${s.id === node.config?.to_stage_id ? 'selected' : ''}>${_autoEsc(s.name)}</option>`).join('')}
        </select>
      </div>`;
  } else if (node.triggerType === 'opportunity_status_changed') {
    fields += `
      <div class="settings-field">
        <label class="settings-label">NOVO STATUS (opcional)</label>
        ${_sel2('cfgToStatus', [['won','Ganho'],['lost','Perdido'],['open','Reaberto']], node.config?.to_status || '', 'Qualquer status')}
      </div>`;
  } else if (node.triggerType === 'opportunity_created') {
    fields += `
      <div class="settings-field">
        <label class="settings-label">FUNIL (opcional)</label>
        ${_sel2('cfgPipeline', _autoPipelines.map(p => [p.id, p.name]), node.config?.pipeline_id || '', 'Qualquer funil')}
      </div>`;
  } else if (node.triggerType === 'contact_assigned') {
    fields += `
      <div class="settings-field">
        <label class="settings-label">USUÁRIO (opcional)</label>
        ${_sel2('cfgUserId', _autoUsers.map(u => [u.id, u.name]), node.config?.user_id || '', 'Qualquer usuário')}
      </div>`;
  } else if (node.triggerType === 'webhook') {
    const token = node.config?.token;
    const url = token ? `${window.location.origin}/api/automations/webhook/${token}` : null;
    fields += url ? `
      <div class="settings-field">
        <label class="settings-label">URL DO WEBHOOK</label>
        <div style="display:flex;gap:6px">
          <input type="text" readonly value="${url}" style="flex:1;font-size:11px;padding:8px;border:1px solid var(--ab-border-2);border-radius:var(--radius-sm);background:var(--ab-surface)" />
          <button class="btn btn-secondary btn-sm" id="cfgCopyWebhook" title="Copiar"><i data-lucide="copy" style="width:13px;height:13px"></i></button>
        </div>
        <p style="font-size:11px;color:var(--ab-text-3);margin-top:6px">Envie um POST para esta URL para disparar o fluxo.</p>
      </div>` : `<p style="font-size:12px;color:var(--ab-text-3)">A URL será gerada quando você salvar a automação.</p>`;
  }

  return _autoConfigHeader(node, def.label, def.icon, AUTO_TRIGGER_COLOR, AUTO_TRIGGER_GLOW) + fields;
}

function _autoNodeConfigHtml(node) {
  const def = AUTO_NODE_DEFS[node.type];
  const c = node.config || {};
  let fields = '';

  if (node.type === 'whatsapp_send_message') {
    fields = `
      <div class="settings-field">
        <label class="settings-label">MENSAGEM *</label>
        <textarea id="cfgMessage" class="settings-input" rows="6" style="resize:vertical">${_autoEsc(c.message || '')}</textarea>
        <p style="font-size:11px;color:var(--ab-text-3);margin-top:6px">Use <code>{{trigger.contact.name}}</code>, <code>{{trigger.message}}</code>, etc. para inserir dados do gatilho.</p>
      </div>`;
  } else if (node.type === 'pipeline_create') {
    const stages = c.stages && c.stages.length ? c.stages : [{ name: '', color: AUTO_STAGE_COLORS[0] }];
    fields = `
      <div class="settings-field">
        <label class="settings-label">NOME DO PIPELINE *</label>
        <input type="text" id="cfgPName" class="settings-input" value="${_autoEsc(c.name || '')}" placeholder="Ex: Funil de Reativação" />
      </div>
      <div class="settings-field">
        <label class="settings-label">ETAPAS *</label>
        <div id="cfgStagesList">
          ${stages.map((s, i) => `
            <div class="auto-stage-row" data-stage-row="${i}">
              <input type="text" class="settings-input cfg-stage-name" value="${_autoEsc(s.name)}" placeholder="Nome da etapa" style="flex:1" />
              <button type="button" class="btn btn-ghost btn-sm cfg-stage-del" style="padding:5px"><i data-lucide="x" style="width:12px;height:12px"></i></button>
            </div>`).join('')}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="cfgAddStage" style="margin-top:4px"><i data-lucide="plus" style="width:12px;height:12px"></i> Etapa</button>
      </div>`;
  } else if (node.type === 'opportunity_search') {
    fields = `
      <div class="settings-field">
        <label class="settings-label">BUSCAR</label>
        ${_sel2('cfgScope', [
          ['trigger_opportunity','Oportunidade do gatilho'],
          ['by_contact','Oportunidades do contato'],
          ['by_pipeline_stage','Por funil / etapa / status'],
        ], c.scope || 'trigger_opportunity')}
      </div>`;
  } else if (node.type === 'opportunity_update') {
    const upstreamSearches = _autoCurrent.graph.nodes.filter(n => n.type === 'opportunity_search');
    fields = `
      <div class="settings-field">
        <label class="settings-label">ORIGEM DA OPORTUNIDADE</label>
        ${_sel2('cfgSource', [['trigger','Oportunidade do gatilho'], ...upstreamSearches.map(n => [n.id, 'Resultado de: ' + (n.config?.scope || 'busca')])], c.source || 'trigger')}
      </div>
      <div class="settings-field">
        <label class="settings-label">FUNIL (para escolher a etapa)</label>
        ${_sel2('cfgPipeline2', _autoPipelines.map(p => [p.id, p.name]), '', 'Selecione um funil...')}
      </div>
      <div class="settings-field">
        <label class="settings-label">NOVA ETAPA (opcional)</label>
        <select id="cfgFieldStage" class="settings-input" style="width:100%"><option value="">— sem alteração —</option></select>
      </div>
      <div class="settings-field">
        <label class="settings-label">NOVO STATUS (opcional)</label>
        ${_sel2('cfgFieldStatus', [['open','Aberto'],['won','Ganho'],['lost','Perdido']], (c.fields||{}).status || '', 'sem alteração')}
      </div>
      <div class="settings-field">
        <label class="settings-label">NOVO VALOR (opcional)</label>
        <input type="number" id="cfgFieldValue" class="settings-input" value="${(c.fields||{}).value ?? ''}" min="0" step="0.01" />
      </div>
      <div class="settings-field">
        <label class="settings-label">MOTIVO DE PERDA (opcional)</label>
        <input type="text" id="cfgFieldLostReason" class="settings-input" value="${_autoEsc((c.fields||{}).lost_reason || '')}" />
      </div>`;
  } else if (node.type === 'timer') {
    fields = `
      <div class="settings-field">
        <label class="settings-label">AGUARDAR</label>
        <div style="display:flex;gap:8px">
          <input type="number" id="cfgAmount" class="settings-input" value="${c.amount || 1}" min="1" style="width:90px" />
          ${_sel2('cfgUnit', [['minutes','Minutos'],['hours','Horas'],['days','Dias']], c.unit || 'minutes')}
        </div>
        <p style="font-size:11px;color:var(--ab-text-3);margin-top:6px">A retomada depende de uma tarefa agendada (cron) — pode levar alguns minutos além do tempo configurado.</p>
      </div>`;
  } else if (node.type === 'contact_tag_add' || node.type === 'contact_tag_remove' || node.type === 'contact_has_tag') {
    const chosen = new Set(Array.isArray(c.tag_ids) ? c.tag_ids : []);
    const verb = node.type === 'contact_tag_add' ? 'aplicadas ao'
               : node.type === 'contact_tag_remove' ? 'removidas do' : 'checadas no';
    fields = `
      <p style="font-size:12px;color:var(--ab-text-3);line-height:1.5;margin-bottom:12px">
        Tags ${verb} contato do fluxo. O gatilho precisa envolver um contato.
      </p>
      <div class="settings-field">
        <label class="settings-label">TAGS *</label>
        ${_autoTags.length ? `
        <div class="auto-tag-picker">
          ${_autoTags.map(t => `
            <label class="auto-tag-opt">
              <input type="checkbox" class="cfgTagBox" value="${_autoEsc(t.id)}" ${chosen.has(t.id) ? 'checked' : ''} />
              <span class="tag-chip" style="--tag:${/^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#6B7280'}">${_autoEsc(t.name)}</span>
            </label>`).join('')}
        </div>` : `
        <p style="font-size:12px;color:var(--ab-text-3)">
          Nenhuma tag criada ainda. Crie em Contatos → ícone de tags.
        </p>`}
      </div>
      ${node.type === 'contact_has_tag' ? `
      <div class="settings-field">
        <label class="settings-label">CRITÉRIO</label>
        ${_sel2('cfgMatch', [['any','Tem ao menos uma das tags'],['all','Tem todas as tags']], c.match || 'any')}
        <p style="font-size:11px;color:var(--ab-text-3);margin-top:6px">Saída SIM quando o critério bate; NÃO caso contrário.</p>
      </div>` : ''}`;
  } else if (node.type === 'if_else') {
    fields = `
      <div class="settings-field">
        <label class="settings-label">CAMPO (caminho no contexto) *</label>
        <input type="text" id="cfgField" class="settings-input" value="${_autoEsc(c.field || '')}" placeholder="Ex: trigger.opportunity.value" />
      </div>
      <div class="settings-field">
        <label class="settings-label">OPERADOR</label>
        ${_sel2('cfgOperator', [['eq','Igual a'],['neq','Diferente de'],['gt','Maior que'],['gte','Maior ou igual'],['lt','Menor que'],['lte','Menor ou igual'],['contains','Contém'],['is_empty','Está vazio'],['is_not_empty','Não está vazio']], c.operator || 'eq')}
      </div>
      <div class="settings-field">
        <label class="settings-label">VALOR</label>
        <input type="text" id="cfgValue" class="settings-input" value="${_autoEsc(c.value ?? '')}" />
      </div>`;
  } else if (node.type === 'split') {
    fields = `<p style="font-size:12px;color:var(--ab-text-3);line-height:1.5">Conecte a saída deste node a vários outros — todos serão executados em paralelo.</p>`;
  }

  return _autoConfigHeader(node, def.label, def.icon, def.color, def.glow) + fields;
}

function _autoBindConfigInputs(node, panel) {
  // Nome customizado — comum a triggers e nodes.
  panel.querySelector('#cfgNodeLabel')?.addEventListener('input', e => {
    node.label = e.target.value;
    _autoRenderNodes();
  });

  const set = (path, val) => {
    const keys = path.split('.');
    let obj = node.config || (node.config = {});
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]] || (obj[keys[i]] = {});
    obj[keys[keys.length - 1]] = val;
    _autoRenderNodes();
  };

  if (node.isTrigger) {
    panel.querySelector('#cfgPipeline')?.addEventListener('change', e => { set('pipeline_id', e.target.value || null); _autoRenderConfigPanel(); });
    panel.querySelector('#cfgStage')?.addEventListener('change', e => set('to_stage_id', e.target.value || null));
    panel.querySelector('#cfgToStatus')?.addEventListener('change', e => set('to_status', e.target.value || null));
    panel.querySelector('#cfgUserId')?.addEventListener('change', e => set('user_id', e.target.value || null));
    panel.querySelector('#cfgCopyWebhook')?.addEventListener('click', () => {
      const input = panel.querySelector('input[readonly]');
      input?.select(); document.execCommand('copy');
    });
    return;
  }

  if (node.type === 'whatsapp_send_message') {
    panel.querySelector('#cfgMessage')?.addEventListener('input', e => set('message', e.target.value));
  } else if (node.type === 'pipeline_create') {
    panel.querySelector('#cfgPName')?.addEventListener('input', e => set('name', e.target.value));
    const syncStages = () => {
      const rows = [...panel.querySelectorAll('[data-stage-row]')];
      node.config.stages = rows.map(r => ({ name: r.querySelector('.cfg-stage-name').value, color: AUTO_STAGE_COLORS[0] }));
      _autoRenderNodes();
    };
    panel.querySelectorAll('.cfg-stage-name').forEach(inp => inp.addEventListener('input', syncStages));
    panel.querySelectorAll('.cfg-stage-del').forEach(btn => btn.addEventListener('click', () => { btn.closest('[data-stage-row]').remove(); syncStages(); }));
    panel.querySelector('#cfgAddStage')?.addEventListener('click', () => {
      const list = panel.querySelector('#cfgStagesList');
      const row = document.createElement('div');
      row.className = 'auto-stage-row'; row.dataset.stageRow = '1';
      row.innerHTML = `<input type="text" class="settings-input cfg-stage-name" placeholder="Nome da etapa" style="flex:1" /><button type="button" class="btn btn-ghost btn-sm cfg-stage-del" style="padding:5px"><i data-lucide="x" style="width:12px;height:12px"></i></button>`;
      list.appendChild(row);
      lucide.createIcons();
      row.querySelector('.cfg-stage-name').addEventListener('input', syncStages);
      row.querySelector('.cfg-stage-del').addEventListener('click', () => { row.remove(); syncStages(); });
    });
  } else if (node.type === 'opportunity_search') {
    panel.querySelector('#cfgScope')?.addEventListener('change', e => set('scope', e.target.value));
  } else if (node.type === 'opportunity_update') {
    panel.querySelector('#cfgSource')?.addEventListener('change', e => set('source', e.target.value));
    const pipelineSel = panel.querySelector('#cfgPipeline2');
    const stageSel = panel.querySelector('#cfgFieldStage');
    pipelineSel?.addEventListener('change', () => {
      const p = _autoPipelines.find(p => p.id === pipelineSel.value);
      stageSel.innerHTML = '<option value="">— sem alteração —</option>' + (p?.stages || []).map(s => `<option value="${s.id}">${_autoEsc(s.name)}</option>`).join('');
    });
    stageSel?.addEventListener('change', () => set('fields.stage_id', stageSel.value || null));
    panel.querySelector('#cfgFieldStatus')?.addEventListener('change', e => set('fields.status', e.target.value || null));
    panel.querySelector('#cfgFieldValue')?.addEventListener('input', e => set('fields.value', e.target.value));
    panel.querySelector('#cfgFieldLostReason')?.addEventListener('input', e => set('fields.lost_reason', e.target.value));
  } else if (node.type === 'timer') {
    panel.querySelector('#cfgAmount')?.addEventListener('input', e => set('amount', parseInt(e.target.value) || 1));
    panel.querySelector('#cfgUnit')?.addEventListener('change', e => set('unit', e.target.value));
  } else if (node.type === 'contact_tag_add' || node.type === 'contact_tag_remove' || node.type === 'contact_has_tag') {
    const boxes = panel.querySelectorAll('.cfgTagBox');
    boxes.forEach(b => b.addEventListener('change', () => {
      set('tag_ids', [...boxes].filter(x => x.checked).map(x => x.value));
    }));
    panel.querySelector('#cfgMatch')?.addEventListener('change', e => set('match', e.target.value));
  } else if (node.type === 'if_else') {
    panel.querySelector('#cfgField')?.addEventListener('input', e => set('field', e.target.value));
    panel.querySelector('#cfgOperator')?.addEventListener('change', e => set('operator', e.target.value));
    panel.querySelector('#cfgValue')?.addEventListener('input', e => set('value', e.target.value));
  }
}

// ── BUILDER: save ─────────────────────────────────────────────

function _autoValidate() {
  const triggerNode = _autoCurrent.graph.nodes.find(n => n.isTrigger);
  if (!triggerNode) return 'Adicione um gatilho antes de salvar.';
  const hasNext = _autoCurrent.graph.edges.some(e => e.source === triggerNode.id);
  if (!hasNext) return 'Conecte o gatilho a pelo menos uma ação.';
  return null;
}

async function _autoSave() {
  const errEl = document.getElementById('autoSaveError');
  errEl.textContent = '';
  if (!_autoCurrent.name.trim()) { errEl.textContent = 'Dê um nome para a automação.'; return; }
  const err = _autoValidate();
  if (err) { errEl.textContent = err; return; }

  const btn = document.getElementById('btnAutoSave');
  btn.disabled = true; btn.innerHTML = 'Salvando...';
  try {
    const payload = { name: _autoCurrent.name.trim(), description: _autoCurrent.description || null, graph: _autoCurrent.graph };
    let saved;
    if (_autoCurrent.id) saved = await apiFetch(`/api/automations/${_autoCurrent.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else saved = await apiFetch('/api/automations', { method: 'POST', body: JSON.stringify(payload) });

    _autoCurrent.id = saved.id;
    _autoCurrent.graph = saved.graph;
    // Re-render para refletir o token de webhook gerado no servidor, se houver.
    const selectedBefore = _autoSelectedNode;
    _autoRefreshBuilder();
    if (selectedBefore) _autoSelectNode(selectedBefore);
  } catch (e) {
    errEl.textContent = e.message;
    btn.disabled = false; btn.innerHTML = '<i data-lucide="check" style="width:13px;height:13px"></i> Salvar';
    lucide.createIcons();
  }
}
