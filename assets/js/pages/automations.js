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
const AUTO_TRIGGER_COLOR = '#a855f7';

const AUTO_NODE_DEFS = {
  whatsapp_send_message: { label: 'Enviar WhatsApp',        icon: 'message-square', color: '#22c55e' },
  pipeline_create:       { label: 'Criar Pipeline',         icon: 'columns-3',      color: '#3b82f6' },
  opportunity_search:    { label: 'Procurar Oportunidade',  icon: 'search',         color: '#3b82f6' },
  opportunity_update:    { label: 'Atualizar Oportunidade', icon: 'pencil',         color: '#3b82f6' },
  timer:                 { label: 'Timer',                  icon: 'clock',          color: '#f59e0b' },
  if_else:                { label: 'If / Else',              icon: 'git-branch',     color: '#ec4899' },
  split:                  { label: 'Split',                  icon: 'split',          color: '#6366f1' },
};

const AUTO_STAGE_COLORS = ['#3b82f6','#f59e0b','#8b5cf6','#ec4899','#10b981','#ef4444','#6b7280'];

let automationsState = { mode: 'list', list: [] };
let _autoCurrent      = null;  // { id, name, description, graph:{nodes,edges} }
let _autoSelectedNode = null;
let _autoNodeEls      = {};
let _autoDrag         = null;
let _autoConnect      = null;
let _autoIdSeq        = 0;
let _autoPipelines    = [];
let _autoUsers        = [];

function _autoNewId(prefix) { return `${prefix}_${Date.now().toString(36)}${(_autoIdSeq++).toString(36)}`; }
function _autoEsc(s) { return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── API ──────────────────────────────────────────────────────

window.loadAutomations = async function() {
  return await apiFetch('/api/automations');
};

// ── PAGE (list ↔ builder) ────────────────────────────────────

window.pageAutomations = function(data) {
  if (Array.isArray(data)) automationsState.list = data;
  if (automationsState.mode === 'builder') return _autoBuilderHtml();
  return _autoListHtml(automationsState.list);
};

window.initAutomations = function() {
  if (automationsState.mode === 'builder') _autoInitBuilder();
  else _autoInitList();
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
  automationsState.mode = 'list';
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
  automationsState.mode = 'builder';
  const content = document.getElementById('pageContent');
  content.innerHTML = window.pageAutomations();
  lucide.createIcons();
  window.initAutomations();
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
  automationsState.mode = 'builder';
  const content = document.getElementById('pageContent');
  content.innerHTML = window.pageAutomations();
  lucide.createIcons();
  window.initAutomations();
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
      <span id="autoSaveError" style="font-size:12px;color:var(--color-red)"></span>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
        ${_autoCurrent.id ? `<button class="btn btn-ghost btn-sm" id="btnAutoTest"><i data-lucide="play" style="width:13px;height:13px"></i> Testar</button>` : ''}
        <button class="btn btn-primary btn-sm" id="btnAutoSave"><i data-lucide="check" style="width:13px;height:13px"></i> Salvar</button>
      </div>
    </div>
    <div class="auto-builder-body" id="autoBuilderBody">
      <div class="auto-palette">
        <div class="auto-palette-title">Gatilho (escolha 1)</div>
        ${Object.entries(AUTO_TRIGGER_DEFS).map(([type, def]) => `
          <div class="auto-palette-item" data-add-trigger="${type}">
            <div class="auto-node-icon" style="background:${AUTO_TRIGGER_COLOR}"><i data-lucide="${def.icon}" style="width:13px;height:13px"></i></div>
            ${def.label}
          </div>`).join('')}
        <div class="auto-palette-title">Ações &amp; Lógica</div>
        ${Object.entries(AUTO_NODE_DEFS).map(([type, def]) => `
          <div class="auto-palette-item" data-add-node="${type}">
            <div class="auto-node-icon" style="background:${def.color}"><i data-lucide="${def.icon}" style="width:13px;height:13px"></i></div>
            ${def.label}
          </div>`).join('')}
      </div>
      <div class="auto-canvas-wrap" id="autoCanvasWrap">
        <div class="auto-canvas" id="autoCanvas">
          <svg class="auto-edges" id="autoEdgesSvg"></svg>
          ${!hasNodes ? `<div class="auto-canvas-empty-hint"><i data-lucide="mouse-pointer-click" style="width:16px;height:16px;flex-shrink:0"></i> Comece escolhendo um gatilho na barra lateral. Depois adicione ações e conecte as portas arrastando.</div>` : ''}
        </div>
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
        onConfirm: async () => { await _autoReloadList(); },
      });
    } else {
      _autoReloadList();
    }
  });

  document.getElementById('autoNameInput')?.addEventListener('input', e => { _autoCurrent.name = e.target.value; });
  document.getElementById('btnAutoSave')?.addEventListener('click', _autoSave);
  document.getElementById('btnAutoTest')?.addEventListener('click', () => _autoOpenTestModal(_autoCurrent.id, _autoCurrent.name));

  document.querySelectorAll('.auto-palette-item[data-add-trigger]').forEach(el => {
    el.addEventListener('click', () => _autoAddTrigger(el.dataset.addTrigger));
  });
  document.querySelectorAll('.auto-palette-item[data-add-node]').forEach(el => {
    el.addEventListener('click', () => _autoAddNode(el.dataset.addNode));
  });

  Promise.all([
    apiFetch('/api/pipelines').catch(() => []),
    apiFetch('/api/conversations/members').catch(() => []),
  ]).then(([pipelines, users]) => {
    _autoPipelines = Array.isArray(pipelines) ? pipelines : [];
    _autoUsers = Array.isArray(users) ? users : [];
  });

  _autoRenderNodes();
  _autoRedrawEdges();
}

function _autoDirty() { return _autoCurrent.graph.nodes.length > 0; }

// ── BUILDER: node CRUD ───────────────────────────────────────

function _autoNextPosition() {
  const wrap = document.getElementById('autoCanvasWrap');
  const baseX = (wrap?.scrollLeft || 0) + 80;
  const baseY = (wrap?.scrollTop || 0) + 60;
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
    const el = document.createElement('div');
    el.className = 'auto-node' + (node.isTrigger ? ' auto-node-trigger' : '') + (node.type === 'if_else' ? ' auto-node-if' : '') + (_autoSelectedNode === node.id ? ' auto-node-selected' : '');
    el.style.left = node.position.x + 'px';
    el.style.top = node.position.y + 'px';
    el.dataset.nodeId = node.id;

    const title = node.isTrigger ? (def?.label || node.triggerType) : def.label;
    el.innerHTML = `
      <div class="auto-node-head">
        <div class="auto-node-icon" style="background:${color}"><i data-lucide="${def?.icon || 'circle'}" style="width:13px;height:13px"></i></div>
        <div class="auto-node-title">${_autoEsc(title)}</div>
        ${node.isTrigger ? '' : `<button class="auto-node-del" data-del="${node.id}" title="Remover"><i data-lucide="x" style="width:13px;height:13px"></i></button>`}
      </div>
      <div class="auto-node-body">${_autoEsc(_autoNodeSummary(node))}</div>
      ${!node.isTrigger ? `<div class="auto-port auto-port-in" data-port-in="${node.id}"></div>` : ''}
      ${node.type === 'if_else' ? `
        <div class="auto-port auto-port-out auto-port-true" data-port-out="${node.id}" data-handle="true"></div>
        <div class="auto-port-label auto-port-label-true">SIM</div>
        <div class="auto-port auto-port-out auto-port-false" data-port-out="${node.id}" data-handle="false"></div>
        <div class="auto-port-label auto-port-label-false">NÃO</div>
      ` : `<div class="auto-port auto-port-out" data-port-out="${node.id}" data-handle="default"></div>`}
    `;
    canvas.appendChild(el);
    _autoNodeEls[node.id] = el;

    el.querySelector('.auto-node-head').addEventListener('mousedown', e => {
      if (e.target.closest('.auto-node-del')) return;
      _autoStartNodeDrag(e, node.id);
    });
    el.querySelector('.auto-node-body').addEventListener('mousedown', e => e.stopPropagation());
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
  node.position.x = Math.max(0, _autoDrag.origX + (e.clientX - _autoDrag.startX));
  node.position.y = Math.max(0, _autoDrag.origY + (e.clientY - _autoDrag.startY));
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
  const wrap = document.getElementById('autoCanvasWrap');
  const wrapRect = wrap.getBoundingClientRect();
  _autoConnect = {
    sourceId: nodeId, handle: handle || 'default',
    x: e.clientX - wrapRect.left + wrap.scrollLeft, y: e.clientY - wrapRect.top + wrap.scrollTop,
  };
  document.addEventListener('mousemove', _autoOnConnectMove);
  document.addEventListener('mouseup', _autoOnConnectCancel);
}
function _autoOnConnectMove(e) {
  if (!_autoConnect) return;
  const wrap = document.getElementById('autoCanvasWrap');
  const wrapRect = wrap.getBoundingClientRect();
  _autoConnect.x = e.clientX - wrapRect.left + wrap.scrollLeft;
  _autoConnect.y = e.clientY - wrapRect.top + wrap.scrollTop;
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

function _autoRedrawEdges() {
  const svg = document.getElementById('autoEdgesSvg');
  if (!svg) return;
  let html = '';

  _autoCurrent.graph.edges.forEach(edge => {
    const p1 = _autoPortWorldPos(edge.source, 'out', edge.sourceHandle);
    const p2 = _autoPortWorldPos(edge.target, 'in');
    const d = _autoBezier(p1, p2);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    html += `<path class="auto-edge-line" d="${d}"></path>`;
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

function _autoConfigHeader(title, icon, color) {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <div class="auto-node-icon" style="background:${color}"><i data-lucide="${icon}" style="width:14px;height:14px"></i></div>
      <div style="font-size:13px;font-weight:700;flex:1">${_autoEsc(title)}</div>
      <button id="autoConfigClose" style="background:none;border:none;cursor:pointer;color:var(--color-text-3)"><i data-lucide="x" style="width:16px;height:16px"></i></button>
    </div>`;
}

function _autoTriggerConfigHtml(node) {
  const def = AUTO_TRIGGER_DEFS[node.triggerType];
  let fields = `<p style="font-size:12px;color:var(--color-text-3);line-height:1.5;margin-bottom:14px">${def.desc}</p>`;

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
          <input type="text" readonly value="${url}" style="flex:1;font-size:11px;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg)" />
          <button class="btn btn-secondary btn-sm" id="cfgCopyWebhook" title="Copiar"><i data-lucide="copy" style="width:13px;height:13px"></i></button>
        </div>
        <p style="font-size:11px;color:var(--color-text-3);margin-top:6px">Envie um POST para esta URL para disparar o fluxo.</p>
      </div>` : `<p style="font-size:12px;color:var(--color-text-3)">A URL será gerada quando você salvar a automação.</p>`;
  }

  return _autoConfigHeader(def.label, def.icon, AUTO_TRIGGER_COLOR) + fields;
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
        <p style="font-size:11px;color:var(--color-text-3);margin-top:6px">Use <code>{{trigger.contact.name}}</code>, <code>{{trigger.message}}</code>, etc. para inserir dados do gatilho.</p>
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
        <p style="font-size:11px;color:var(--color-text-3);margin-top:6px">A retomada depende de uma tarefa agendada (cron) — pode levar alguns minutos além do tempo configurado.</p>
      </div>`;
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
    fields = `<p style="font-size:12px;color:var(--color-text-3);line-height:1.5">Conecte a saída deste node a vários outros — todos serão executados em paralelo.</p>`;
  }

  return _autoConfigHeader(def.label, def.icon, def.color) + fields;
}

function _autoBindConfigInputs(node, panel) {
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
    automationsState.mode = 'builder';
    const content = document.getElementById('pageContent');
    content.innerHTML = window.pageAutomations();
    lucide.createIcons();
    window.initAutomations();
    if (selectedBefore) _autoSelectNode(selectedBefore);
  } catch (e) {
    errEl.textContent = e.message;
    btn.disabled = false; btn.innerHTML = '<i data-lucide="check" style="width:13px;height:13px"></i> Salvar';
    lucide.createIcons();
  }
}
