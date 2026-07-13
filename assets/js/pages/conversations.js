let activeConvId     = null;
let _pollMsgInterval = null;
let _pollListInterval = null;
let _lastMsgSentAt   = null;
let _convUsers       = [];
let _isInternalMode  = false;
let _pendingMentions = new Set();

function _convStopPolling() {
  clearInterval(_pollMsgInterval);
  clearInterval(_pollListInterval);
  _pollMsgInterval  = null;
  _pollListInterval = null;
}

window.loadConversations = async function() {
  return await apiFetch('/api/conversations');
};

window.pageConversations = function(data) {
  const convs = Array.isArray(data) ? data : [];
  if (convs.length > 0 && !activeConvId) activeConvId = convs[0].id;

  return `
  <div class="page-header" style="margin-bottom:16px">
    <div>
      <h1 class="page-title">Conversas</h1>
      <p class="page-subtitle">${convs.length} conversa${convs.length !== 1 ? 's' : ''}</p>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-primary btn-sm"><i data-lucide="edit" style="width:14px;height:14px"></i> Nova Conversa</button>
    </div>
  </div>

  <div class="conversations-layout">
    <!-- SIDEBAR -->
    <div class="conv-sidebar">
      <div class="conv-sidebar-header">
        <div class="search-wrapper">
          <i data-lucide="search"></i>
          <input type="text" placeholder="Buscar conversa..." />
        </div>
      </div>
      <div class="conv-tabs">
        <button class="conv-tab active">Todas</button>
        <button class="conv-tab">Abertas</button>
      </div>
      <div class="conv-list" id="convList">
        ${convs.length === 0 ? `
          <div style="padding:24px;text-align:center;color:var(--color-text-3);font-size:13px">
            Nenhuma conversa ainda.
          </div>
        ` : convs.map(c => `
        <div class="conv-item ${c.id === activeConvId ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}" data-conv-id="${c.id}">
          <div class="conv-avatar" style="position:relative">
            ${(c.contact_name || '?')[0].toUpperCase()}
            ${c.channel === 'whatsapp' ? `<div style="position:absolute;bottom:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:#25D366;border:2px solid var(--color-surface);display:flex;align-items:center;justify-content:center"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="8" height="8" fill="#fff"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg></div>` : ''}
          </div>
          <div class="conv-info">
            <div class="conv-name">${c.contact_name || 'Desconhecido'}</div>
            <div class="conv-preview">${c.contact_phone || c.channel || '—'}</div>
          </div>
          <div class="conv-meta">
            <div class="conv-time">${c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'}</div>
            ${c.unread_count > 0 ? `<div class="conv-unread-count">${c.unread_count}</div>` : ''}
          </div>
        </div>
        `).join('')}
      </div>
    </div>

    <!-- CHAT AREA -->
    <div class="chat-area" id="chatArea">
      ${activeConvId ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-3);font-size:13px">Selecione uma conversa</div>' : renderEmptyChat()}
    </div>

    <!-- INFO PANEL -->
    <div class="conv-info-panel" id="convInfoPanel">
      <div style="padding:24px 16px;text-align:center;color:var(--color-text-3);font-size:12px">
        Selecione uma conversa
      </div>
    </div>
  </div>
  `;
};

function renderEmptyChat() {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--color-text-3)">
      <i data-lucide="message-circle" style="width:40px;height:40px;opacity:0.3"></i>
      <p style="font-size:13px">Selecione uma conversa para começar</p>
    </div>
  `;
}

// ── PAINEL LATERAL DIREITO (abas por ícone) ──────────────────

let _convInfoTab = 'contato';

const _CONV_INFO_TABS = [
  { id: 'contato', icon: 'user',           title: 'Informações do contato' },
  { id: 'leads',   icon: 'filter',         title: 'Leads' },
  { id: 'notas',   icon: 'pencil',         title: 'Anotações' },
  { id: 'tarefas', icon: 'calendar-check', title: 'Tarefas' },
];

const _CONV_OPP_STATUS = {
  open: { label: 'Aberto',  cls: 'badge-blue'  },
  won:  { label: 'Ganho',   cls: 'badge-black' },
  lost: { label: 'Perdido', cls: 'badge-gray'  },
};
const _convFmtBRL = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function _convInfoSpinner() {
  return `<div style="padding:24px;display:flex;align-items:center;justify-content:center"><div style="width:20px;height:20px;border:2px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin 0.7s linear infinite"></div></div>`;
}

async function renderInfoPanel(convId, conv) {
  const panel = document.getElementById('convInfoPanel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="conv-info-content" id="convInfoContent">${_convInfoSpinner()}</div>
    <div class="conv-info-rail">
      ${_CONV_INFO_TABS.map(t => `
        <button class="conv-info-tab ${t.id === _convInfoTab ? 'active' : ''}" data-info-tab="${t.id}" title="${t.title}">
          <i data-lucide="${t.icon}" style="width:18px;height:18px"></i>
          ${t.id === 'tarefas' ? '<span class="conv-info-soon-dot"></span>' : ''}
        </button>
      `).join('')}
    </div>
  `;
  lucide.createIcons();

  panel.querySelectorAll('.conv-info-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _convInfoTab = btn.dataset.infoTab;
      panel.querySelectorAll('.conv-info-tab').forEach(b => b.classList.toggle('active', b.dataset.infoTab === _convInfoTab));
      _renderConvInfoContent(convId, conv);
    });
  });

  await _renderConvInfoContent(convId, conv);
}

async function _renderConvInfoContent(convId, conv) {
  const box = document.getElementById('convInfoContent');
  if (!box) return;
  box.innerHTML = _convInfoSpinner();
  if (_convInfoTab === 'leads')   return _renderConvLeadsTab(box, conv);
  if (_convInfoTab === 'notas')   return _renderConvNotesTab(box, conv);
  if (_convInfoTab === 'tarefas') return _renderConvTasksTab(box);
  return _renderConvContactTab(box, convId, conv);
}

// ── Aba: Informações do contato ──────────────────────────────

async function _renderConvContactTab(box, convId, conv) {
  const [assignment, freshUsers] = await Promise.all([
    apiFetch(`/api/conversations/${convId}/assignment`).catch(() => ({ owner: null, followers: [] })),
    _convUsers.length ? Promise.resolve(_convUsers) : apiFetch('/api/conversations/members').catch(() => []),
  ]);
  if (!_convUsers.length && Array.isArray(freshUsers)) _convUsers = freshUsers;
  const allUsers = _convUsers;

  const owner = assignment.owner || null;
  const followers = Array.isArray(assignment.followers) ? assignment.followers : [];
  const followerIds = new Set(followers.map(f => f.id));
  const nonFollowers = allUsers.filter(u => !followerIds.has(u.id) && u.id !== owner?.id);
  const name  = conv?.contact_name  || 'Desconhecido';
  const phone = conv?.contact_phone || '—';

  box.innerHTML = `
    <div class="conv-info-section" style="text-align:center">
      <div class="conv-avatar" style="width:56px;height:56px;font-size:20px;margin:0 auto 10px">${name[0].toUpperCase()}</div>
      <div style="font-size:15px;font-weight:700;color:var(--color-text-1)">${name}</div>
      <div style="font-size:12px;color:var(--color-text-3);margin-top:3px;display:flex;align-items:center;justify-content:center;gap:5px">
        <i data-lucide="phone" style="width:12px;height:12px"></i> ${phone}
      </div>
    </div>

    <div class="conv-info-section">
      <div class="conv-info-section-title">Proprietário</div>
      <div style="position:relative">
        <button id="ownerToggle" style="width:100%;border:none;background:none;cursor:pointer;display:flex;align-items:center;gap:8px;border-radius:var(--radius-sm);padding:6px 8px;text-align:left">
          <div class="assign-mini-avatar">${owner ? owner.name[0].toUpperCase() : '?'}</div>
          <span style="flex:1;font-size:13px;color:var(--color-text-${owner ? '1' : '3'})">${owner ? owner.name : 'Sem proprietário'}</span>
          <i data-lucide="chevron-down" style="width:12px;height:12px;color:var(--color-text-3);flex-shrink:0"></i>
        </button>
        <div id="ownerDropdown" style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:300;padding:4px;max-height:220px;overflow-y:auto">
          <button class="owner-opt" data-id="" style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:none;cursor:pointer;border-radius:6px;font-size:13px;color:var(--color-text-3);text-align:left">
            <div class="assign-mini-avatar" style="opacity:0.4">?</div>
            Sem proprietário
          </button>
          ${allUsers.map(u => `
            <button class="owner-opt" data-id="${u.id}" style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:none;cursor:pointer;border-radius:6px;font-size:13px;color:var(--color-text-1);text-align:left;${owner?.id === u.id ? 'background:var(--color-accent-lite);' : ''}">
              <div class="assign-mini-avatar">${u.name[0].toUpperCase()}</div>
              ${u.name}
            </button>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="conv-info-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="conv-info-section-title" style="margin-bottom:0">Seguidores${followers.length > 0 ? ` (${followers.length})` : ''}</div>
        <button id="addFollowerBtn" class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;height:auto;line-height:1.6">+ Adicionar</button>
      </div>
      <div style="position:relative">
        <div id="followersList">
          ${followers.length === 0
            ? `<div style="font-size:12px;color:var(--color-text-3);padding:4px 8px">Nenhum seguidor ainda.</div>`
            : followers.map(f => `
              <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--radius-sm)">
                <div class="assign-mini-avatar">${f.name[0].toUpperCase()}</div>
                <span style="flex:1;font-size:13px;color:var(--color-text-1)">${f.name}</span>
                <button class="remove-follower-btn" data-id="${f.id}" style="border:none;background:none;cursor:pointer;color:var(--color-text-3);padding:2px 4px;border-radius:4px;font-size:15px;line-height:1" title="Remover">×</button>
              </div>
            `).join('')}
        </div>
        <div id="addFollowerDropdown" style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:300;padding:4px;max-height:200px;overflow-y:auto">
          ${nonFollowers.length === 0
            ? `<div style="padding:10px;font-size:12px;color:var(--color-text-3);text-align:center">Todos já adicionados</div>`
            : nonFollowers.map(u => `
              <button class="add-follower-opt" data-id="${u.id}" style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;background:none;cursor:pointer;border-radius:6px;font-size:13px;color:var(--color-text-1);text-align:left">
                <div class="assign-mini-avatar">${u.name[0].toUpperCase()}</div>
                ${u.name}
              </button>
            `).join('')}
        </div>
      </div>
    </div>
  `;

  lucide.createIcons();

  const ownerToggle   = document.getElementById('ownerToggle');
  const ownerDropdown = document.getElementById('ownerDropdown');
  const addFollowerBtn      = document.getElementById('addFollowerBtn');
  const addFollowerDropdown = document.getElementById('addFollowerDropdown');

  ownerToggle?.addEventListener('click', e => {
    e.stopPropagation();
    ownerDropdown.style.display = ownerDropdown.style.display === 'none' ? 'block' : 'none';
    if (addFollowerDropdown) addFollowerDropdown.style.display = 'none';
  });

  box.querySelectorAll('.owner-opt').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.id || null;
      ownerDropdown.style.display = 'none';
      try {
        await apiFetch(`/api/conversations/${convId}/owner`, {
          method: 'PUT',
          body: JSON.stringify({ user_id: userId }),
        });
        await _renderConvInfoContent(convId, conv);
      } catch (err) { console.error('[assign owner]', err.message); }
    });
  });

  addFollowerBtn?.addEventListener('click', e => {
    e.stopPropagation();
    addFollowerDropdown.style.display = addFollowerDropdown.style.display === 'none' ? 'block' : 'none';
    if (ownerDropdown) ownerDropdown.style.display = 'none';
  });

  box.querySelectorAll('.add-follower-opt').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.id;
      addFollowerDropdown.style.display = 'none';
      try {
        await apiFetch(`/api/conversations/${convId}/followers`, {
          method: 'PUT',
          body: JSON.stringify({ user_ids: [...followers.map(f => f.id), userId] }),
        });
        await _renderConvInfoContent(convId, conv);
      } catch (err) { console.error('[add follower]', err.message); }
    });
  });

  box.querySelectorAll('.remove-follower-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.id;
      try {
        await apiFetch(`/api/conversations/${convId}/followers`, {
          method: 'PUT',
          body: JSON.stringify({ user_ids: followers.filter(f => f.id !== userId).map(f => f.id) }),
        });
        await _renderConvInfoContent(convId, conv);
      } catch (err) { console.error('[remove follower]', err.message); }
    });
  });
}

// ── Aba: Leads (oportunidades do contato) ────────────────────

function _convOppCardHtml(opp) {
  const st = _CONV_OPP_STATUS[opp.status] || _CONV_OPP_STATUS.open;
  const oppData = JSON.stringify({
    id: opp.id, title: opp.title, value: opp.value, status: opp.status,
    lost_reason: opp.lost_reason || '', pipeline_id: opp.pipeline_id,
    stage_id: opp.stage_id, custom_fields: opp.custom_fields || {},
  });
  return `
    <div style="border:1px solid var(--color-border);border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:6px">
        <div style="font-size:13px;font-weight:700;color:var(--color-text-1);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${opp.title}</div>
        <span class="badge ${st.cls}" style="flex-shrink:0">${st.label}</span>
      </div>
      <div style="font-size:11px;color:var(--color-text-3);margin-bottom:8px">${opp.pipeline_name || '—'} › ${opp.stage_name || '—'}</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:14px;font-weight:700;color:var(--color-text-1)">${_convFmtBRL(opp.value)}</span>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm conv-opp-edit" data-opp='${oppData}' style="padding:4px 6px" title="Editar"><i data-lucide="pencil" style="width:13px;height:13px"></i></button>
          <button class="btn btn-ghost btn-sm conv-opp-delete" data-id="${opp.id}" style="padding:4px 6px" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px;color:var(--color-red)"></i></button>
        </div>
      </div>
    </div>`;
}

async function _renderConvLeadsTab(box, conv) {
  const contactId = conv?.contact_id;
  let opps = [];
  try { opps = await apiFetch(`/api/contacts/${contactId}/opportunities`) || []; } catch {}

  box.innerHTML = `
    <div class="conv-info-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="conv-info-section-title" style="margin-bottom:0">Oportunidades${opps.length ? ` (${opps.length})` : ''}</div>
        <button id="convNewOppBtn" class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;height:auto;line-height:1.6">+ Nova</button>
      </div>
      <div id="convOppList">
        ${opps.length === 0
          ? `<div style="font-size:12px;color:var(--color-text-3);padding:4px 0">Nenhuma oportunidade vinculada ainda.</div>`
          : opps.map(_convOppCardHtml).join('')}
      </div>
    </div>
  `;
  lucide.createIcons();

  document.getElementById('convNewOppBtn')?.addEventListener('click', () => _convOpenOppModal(conv, null));

  box.querySelectorAll('.conv-opp-edit').forEach(btn => {
    btn.addEventListener('click', () => _convOpenOppModal(conv, JSON.parse(btn.dataset.opp)));
  });

  box.querySelectorAll('.conv-opp-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      showConfirmModal({
        title: 'Excluir oportunidade',
        message: 'Tem certeza que deseja excluir esta oportunidade?',
        onConfirm: async () => {
          await apiFetch(`/api/opportunities/${btn.dataset.id}`, { method: 'DELETE' });
          await _renderConvLeadsTab(box, conv);
        },
      });
    });
  });
}

async function _convOpenOppModal(conv, existingOpp) {
  const isEdit    = !!existingOpp;
  const contactId = conv?.contact_id;

  let pipelines = [];
  try { pipelines = await apiFetch('/api/pipelines') || []; } catch {}
  const cfDefs = await fetchCustomFieldDefs('opportunity');

  let curPipelineId = existingOpp?.pipeline_id || pipelines[0]?.id || '';
  let curStageId    = existingOpp?.stage_id    || '';
  const getStages = pid => pipelines.find(p => p.id === pid)?.stages || [];

  document.getElementById('convOppModal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'convOppModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  function render() {
    const stages    = getStages(curPipelineId);
    const curStatus = existingOpp?.status || 'open';

    overlay.innerHTML = `
      <div style="background:var(--color-surface);border-radius:14px;width:540px;max-width:100%;max-height:88vh;overflow:hidden;box-shadow:0 32px 64px rgba(0,0,0,.25);display:flex;flex-direction:column">
        <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div>
            <div style="font-size:15px;font-weight:700">${isEdit ? 'Editar oportunidade' : 'Nova oportunidade'}</div>
            <div style="font-size:12px;color:var(--color-text-3);margin-top:3px">${conv?.contact_name || 'Contato'}</div>
          </div>
          <button id="copp_close" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px"><i data-lucide="x" style="width:18px;height:18px"></i></button>
        </div>

        <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;flex:1">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">NOME DA OPORTUNIDADE *</label>
            <input type="text" id="copp_title" value="${existingOpp?.title || ''}" placeholder="Ex: Proposta de serviço"
              style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)" />
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">FUNIL *</label>
              <select id="copp_pipeline" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
                ${pipelines.map(p => `<option value="${p.id}" ${p.id === curPipelineId ? 'selected' : ''}>${p.name}</option>`).join('') || '<option value="">Nenhum funil</option>'}
              </select>
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">ETAPA *</label>
              <select id="copp_stage" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
                ${stages.map(s => `<option value="${s.id}" ${s.id === curStageId ? 'selected' : ''}>${s.name}</option>`).join('') || '<option value="">Selecione um funil</option>'}
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">VALOR (R$)</label>
              <input type="number" id="copp_value" value="${existingOpp?.value || ''}" min="0" step="0.01"
                style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)" />
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">STATUS</label>
              <select id="copp_status" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
                <option value="open" ${curStatus === 'open' ? 'selected' : ''}>Aberto</option>
                <option value="won"  ${curStatus === 'won'  ? 'selected' : ''}>Ganho</option>
                <option value="lost" ${curStatus === 'lost' ? 'selected' : ''}>Perdido</option>
              </select>
            </div>
          </div>

          <div id="copp_lostWrap" ${curStatus !== 'lost' ? 'style="display:none"' : ''}>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">MOTIVO DE PERDA</label>
            <textarea id="copp_lost_reason" rows="2"
              style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface);resize:vertical">${existingOpp?.lost_reason || ''}</textarea>
          </div>

          ${renderCustomFieldsSection(cfDefs, existingOpp?.custom_fields || {})}
        </div>

        <div style="padding:14px 22px;border-top:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-shrink:0">
          ${isEdit
            ? `<button id="copp_delete" class="btn btn-ghost btn-sm" style="color:var(--color-red)"><i data-lucide="trash-2" style="width:13px;height:13px"></i> Excluir</button>`
            : '<div></div>'}
          <div style="display:flex;align-items:center;gap:8px">
            <span id="copp_error" style="font-size:12px;color:var(--color-red)"></span>
            <button class="btn btn-secondary btn-sm" id="copp_cancel">Cancelar</button>
            <button class="btn btn-primary btn-sm" id="copp_save">${isEdit ? 'Salvar' : 'Criar'}</button>
          </div>
        </div>
      </div>`;

    lucide.createIcons();

    overlay.querySelector('#copp_close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#copp_cancel').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#copp_pipeline')?.addEventListener('change', e => {
      curPipelineId = e.target.value;
      curStageId = '';
      const sel = overlay.querySelector('#copp_stage');
      const newStages = getStages(curPipelineId);
      if (sel) sel.innerHTML = newStages.map(s => `<option value="${s.id}">${s.name}</option>`).join('') || '<option value="">—</option>';
    });

    overlay.querySelector('#copp_status')?.addEventListener('change', e => {
      overlay.querySelector('#copp_lostWrap').style.display = e.target.value === 'lost' ? '' : 'none';
    });

    overlay.querySelector('#copp_delete')?.addEventListener('click', () => {
      showConfirmModal({
        title: 'Excluir oportunidade',
        message: 'Tem certeza que deseja excluir esta oportunidade?',
        onConfirm: async () => {
          await apiFetch(`/api/opportunities/${existingOpp.id}`, { method: 'DELETE' });
          overlay.remove();
          await _renderConvInfoContent(null, conv);
        },
      });
    });

    overlay.querySelector('#copp_save').addEventListener('click', async () => {
      const title       = overlay.querySelector('#copp_title').value.trim();
      const pipeline_id = overlay.querySelector('#copp_pipeline').value;
      const stage_id    = overlay.querySelector('#copp_stage').value;
      const value       = overlay.querySelector('#copp_value').value;
      const status      = overlay.querySelector('#copp_status').value;
      const lost_reason = overlay.querySelector('#copp_lost_reason')?.value.trim() || null;
      const errEl       = overlay.querySelector('#copp_error');

      if (!title)       { errEl.textContent = 'Nome é obrigatório.'; return; }
      if (!pipeline_id) { errEl.textContent = 'Selecione um funil.'; return; }
      if (!stage_id)    { errEl.textContent = 'Selecione uma etapa.'; return; }
      errEl.textContent = '';

      const body = {
        pipeline_id, stage_id, contact_id: contactId, title,
        value: parseFloat(value) || 0, status,
        lost_reason: status === 'lost' ? lost_reason : null,
        custom_fields: collectCustomFieldsValues(cfDefs),
      };

      const btn = overlay.querySelector('#copp_save');
      btn.disabled = true; btn.textContent = 'Salvando...';
      try {
        if (isEdit) {
          await apiFetch(`/api/opportunities/${existingOpp.id}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          await apiFetch('/api/opportunities', { method: 'POST', body: JSON.stringify(body) });
        }
        overlay.remove();
        await _renderConvInfoContent(null, conv);
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false; btn.textContent = isEdit ? 'Salvar' : 'Criar';
      }
    });
  }

  render();
}

// ── Aba: Anotações ───────────────────────────────────────────

async function _renderConvNotesTab(box, conv) {
  const contactId = conv?.contact_id;
  let contact = null;
  try { contact = await apiFetch(`/api/contacts/${contactId}`); } catch {}
  const notes = contact?.notes || '';

  box.innerHTML = `
    <div class="conv-info-section">
      <div class="conv-info-section-title">Anotações e lembretes</div>
      <textarea id="convNotesInput" rows="12" placeholder="Adicione observações e lembretes sobre este contato..."
        style="width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:8px;font-size:13px;background:var(--color-surface);resize:vertical;line-height:1.6">${notes}</textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <button id="convNotesSave" class="btn btn-primary btn-sm">Salvar</button>
        <span id="convNotesMsg" style="font-size:12px"></span>
      </div>
    </div>
  `;
  lucide.createIcons();

  document.getElementById('convNotesSave')?.addEventListener('click', async () => {
    const val = document.getElementById('convNotesInput').value;
    const msg = document.getElementById('convNotesMsg');
    const btn = document.getElementById('convNotesSave');
    btn.disabled = true; btn.textContent = 'Salvando...';
    if (msg) msg.textContent = '';
    try {
      await apiFetch(`/api/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify({ notes: val }) });
      if (msg) { msg.style.color = 'var(--color-green)'; msg.textContent = 'Salvo!'; setTimeout(() => { if (msg) msg.textContent = ''; }, 2500); }
    } catch (err) {
      if (msg) { msg.style.color = 'var(--color-red)'; msg.textContent = err.message; }
    } finally {
      btn.disabled = false; btn.textContent = 'Salvar';
    }
  });
}

// ── Aba: Tarefas (em breve) ──────────────────────────────────

function _renderConvTasksTab(box) {
  box.innerHTML = `
    <div class="conv-info-section">
      <div class="conv-info-section-title">Tarefas</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:36px 12px;text-align:center">
        <i data-lucide="calendar-check" style="width:36px;height:36px;color:var(--color-text-3);opacity:.4"></i>
        <div style="position:relative;display:inline-block;padding:2px 4px">
          <span style="font-size:15px;font-weight:800;letter-spacing:.12em;color:var(--color-text-2)">EM BREVE</span>
          <span style="position:absolute;left:-2px;right:-2px;top:50%;height:2px;background:var(--color-red);transform:translateY(-50%)"></span>
        </div>
        <p style="font-size:12px;color:var(--color-text-3);line-height:1.6">Agenda de tarefas com checklist chegando em breve.</p>
      </div>
    </div>
  `;
  lucide.createIcons();
}

const _shieldSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const _sparkSvg  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`;

function renderMessageHtml(m, contactName) {
  const isInternal = !!m.is_internal;
  const isBot      = m.sender_type === 'bot' && !isInternal;
  const isInbound  = m.direction === 'inbound';
  const isAudio    = m.message_type === 'audio';
  const isImage    = m.message_type === 'image' || m.message_type === 'imagem';
  const bubbleClass = isInternal ? ' internal' : isBot ? ' ai' : '';

  let bubbleContent, bubbleStyle;
  if (isAudio) {
    bubbleContent = `<audio controls src="${m.file_data || ''}" style="width:240px;max-width:100%;outline:none;display:block"></audio>`;
    bubbleStyle   = isInbound ? 'background:#dbeafe;padding:8px 12px' : 'background:#1d4ed8;padding:8px 12px';
  } else if (isImage && m.file_data) {
    bubbleContent = `<img src="${m.file_data}" alt="imagem" style="max-width:240px;max-height:320px;border-radius:8px;display:block;cursor:pointer" onclick="window.open(this.src,'_blank')">
      ${m.content ? `<div style="font-size:13px;margin-top:4px">${m.content}</div>` : ''}`;
    bubbleStyle   = 'padding:6px';
  } else if (isImage) {
    bubbleContent = `<span style="color:var(--color-text-3);font-size:13px">🖼️ Imagem${m.content ? ': ' + m.content : ''}</span>`;
    bubbleStyle   = '';
  } else {
    bubbleContent = m.content || '';
    bubbleStyle   = '';
  }

  return `
    <div class="msg-row ${isInbound ? 'incoming' : 'outgoing'}" data-msg-id="${m.id}">
      ${isInbound ? `<div class="conv-avatar" style="width:28px;height:28px;font-size:11px">${(contactName||'?')[0].toUpperCase()}</div>` : ''}
      <div class="msg-content">
        ${isInternal ? `<div class="internal-note-label">${_shieldSvg} Nota interna${m.sender_name ? ` · ${m.sender_name}` : ''}</div>` : ''}
        ${isBot ? `<div class="ai-label">${_sparkSvg} Clara AI</div>` : ''}
        <div class="msg-bubble${bubbleClass}" ${bubbleStyle ? `style="${bubbleStyle}"` : ''}>${bubbleContent}</div>
        <div class="msg-time">${new Date(m.sent_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>`;
}

async function loadAndRenderChat(convId, conv) {
  _convStopPolling();
  _lastMsgSentAt  = null;
  _isInternalMode  = false;
  _pendingMentions = new Set();

  const chatArea = document.getElementById('chatArea');
  if (!chatArea) return;

  chatArea.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%"><div style="width:24px;height:24px;border:2px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin 0.7s linear infinite"></div></div>`;

  const [messages, instances, freshMembers] = await Promise.all([
    apiFetch(`/api/conversations/${convId}/messages`).catch(() => []),
    apiFetch('/api/whatsapp-instances').catch(() => []),
    _convUsers.length ? Promise.resolve(_convUsers) : apiFetch('/api/conversations/members').catch(() => []),
  ]);
  if (!_convUsers.length && Array.isArray(freshMembers)) _convUsers = freshMembers;
  const msgs = Array.isArray(messages) ? messages : [];
  const insts = Array.isArray(instances) ? instances : [];

  let activeInstanceId = insts[0]?.id || null;

  // Track last message time for delta polling
  if (msgs.length) _lastMsgSentAt = msgs[msgs.length - 1].sent_at;

  // Reset unread badge on open
  apiFetch(`/api/conversations/${convId}/read`, { method: 'POST' }).catch(() => {});

  const instanceSwitcherHtml = insts.length > 1 ? `
    <div style="position:relative;display:inline-block" id="instSwitchWrap">
      <button id="instSwitchBtn" class="btn btn-ghost btn-sm" style="gap:5px;font-size:12px;border:1px solid var(--color-border)">
        <span style="width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block;flex-shrink:0"></span>
        <span id="instSwitchLabel">${insts[0]?.instance_name || 'Instância 1'}</span>
        <i data-lucide="chevron-down" style="width:12px;height:12px"></i>
      </button>
      <div id="instDropdown" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:190px;z-index:200;padding:4px">
        ${insts.map(inst => `
          <button class="inst-opt" data-id="${inst.id}" data-name="${inst.instance_name}" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:none;cursor:pointer;border-radius:6px;font-size:13px;color:var(--color-text-1);text-align:left">
            <span style="width:7px;height:7px;border-radius:50%;background:${inst.status === 'connected' ? '#22c55e' : '#9ca3af'};flex-shrink:0"></span>
            ${inst.instance_name}
          </button>
        `).join('')}
      </div>
    </div>
  ` : '';

  chatArea.innerHTML = `
    <div class="chat-header">
      <div class="conv-avatar" style="width:38px;height:38px;font-size:13px">${(conv?.contact_name||'?')[0].toUpperCase()}</div>
      <div class="chat-header-info">
        <div class="chat-header-name">${conv?.contact_name || 'Desconhecido'}</div>
        <div class="chat-header-status">${conv?.contact_phone || conv?.channel || '—'}</div>
      </div>
      <div style="display:flex;gap:6px;margin-left:auto;align-items:center">
        ${instanceSwitcherHtml}
      </div>
    </div>
    <div class="chat-messages" id="chatMessages">
      ${msgs.length === 0 ? `
        <div style="text-align:center;color:var(--color-text-3);font-size:13px;padding:24px">Nenhuma mensagem ainda.</div>
      ` : msgs.slice().reverse().map(m => renderMessageHtml(m, conv?.contact_name)).join('')}
    </div>
    <div class="chat-input-area" id="chatInputArea">
      <div id="mentionDropdown" class="mention-dropdown" style="display:none"></div>
      <div id="imagePreviewArea" style="display:none;padding:6px 8px 0;position:relative">
        <img id="imagePreviewThumb" src="" alt="" style="max-height:100px;max-width:180px;border-radius:6px;border:1px solid var(--color-border);display:block">
        <button id="imagePreviewRemove" style="position:absolute;top:2px;left:2px;background:rgba(0,0,0,.55);border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0" title="Remover imagem">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <input type="file" id="imageFileInput" accept="image/*" style="display:none">
      <div style="display:flex;gap:4px;align-items:center">
        <button class="btn btn-ghost btn-sm" id="attachImageBtn" style="padding:6px" title="Anexar imagem"><i data-lucide="paperclip" style="width:16px;height:16px"></i></button>
        <button id="internalToggle" class="internal-toggle-btn" title="Mensagem interna — não enviada ao contato">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Interno
        </button>
      </div>
      <textarea class="chat-input" id="chatInput" rows="1" placeholder="Digite uma mensagem..."></textarea>
      <button id="audioRecordBtn" class="btn btn-ghost btn-sm" style="padding:6px;flex-shrink:0" title="Gravar áudio"><i data-lucide="mic" style="width:16px;height:16px"></i></button>
      <button class="chat-send-btn" id="chatSendBtn"><i data-lucide="send" style="width:16px;height:16px"></i></button>
    </div>
  `;

  lucide.createIcons();
  const chatMessages = document.getElementById('chatMessages');

  // Carrega o painel lateral (contato, leads, anotações, tarefas)
  renderInfoPanel(convId, conv);

  // Botão de mensagem interna
  const internalToggle  = document.getElementById('internalToggle');
  const chatInputArea   = document.getElementById('chatInputArea');
  const mentionDropdown = document.getElementById('mentionDropdown');

  internalToggle?.addEventListener('click', () => {
    _isInternalMode = !_isInternalMode;
    internalToggle.classList.toggle('active', _isInternalMode);
    chatInputArea.classList.toggle('internal-mode', _isInternalMode);
    const chatInput = document.getElementById('chatInput');
    if (chatInput) chatInput.placeholder = _isInternalMode
      ? 'Nota interna — visível apenas no CRM. Use @ para mencionar usuários...'
      : 'Digite uma mensagem...';
    chatInput?.focus();
  });

  // ── Anexar imagem ─────────────────────────────────────────────
  const attachImageBtn    = document.getElementById('attachImageBtn');
  const imageFileInput    = document.getElementById('imageFileInput');
  const imagePreviewArea  = document.getElementById('imagePreviewArea');
  const imagePreviewThumb = document.getElementById('imagePreviewThumb');
  const imagePreviewRemove = document.getElementById('imagePreviewRemove');
  let _pendingImageData = null;

  attachImageBtn?.addEventListener('click', () => imageFileInput?.click());

  imageFileInput?.addEventListener('change', () => {
    const file = imageFileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Selecione um arquivo de imagem.'); return; }
    if (file.size > 10 * 1024 * 1024) { alert('Imagem muito grande. Máximo 10 MB.'); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      _pendingImageData = reader.result;
      imagePreviewThumb.src = _pendingImageData;
      imagePreviewArea.style.display = 'block';
    };
    reader.readAsDataURL(file);
    imageFileInput.value = '';
  });

  imagePreviewRemove?.addEventListener('click', () => {
    _pendingImageData = null;
    imagePreviewArea.style.display = 'none';
    imagePreviewThumb.src = '';
  });

  async function sendImage(fileData, caption) {
    const tempId  = `temp-${Date.now()}`;
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const container = document.getElementById('chatMessages');

    // Preview otimista
    if (container) {
      const tempRow = document.createElement('div');
      tempRow.className = 'msg-row outgoing';
      tempRow.id = tempId;
      tempRow.innerHTML = `
        <div class="msg-content">
          <div class="msg-bubble" style="padding:6px">
            <img src="${fileData}" alt="imagem" style="max-width:240px;max-height:320px;border-radius:8px;display:block;cursor:pointer" onclick="window.open(this.src,'_blank')">
            ${caption ? `<div style="font-size:13px;margin-top:4px">${caption}</div>` : ''}
          </div>
          <div class="msg-time">${timeStr}</div>
        </div>`;
      container.prepend(tempRow);
      container.scrollTop = 0;
    }

    // Limpa preview
    _pendingImageData = null;
    imagePreviewArea.style.display = 'none';
    imagePreviewThumb.src = '';

    try {
      const saved = await apiFetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: caption || '',
          message_type: 'image',
          file_data: fileData,
          instance_id: activeInstanceId,
          is_internal: _isInternalMode,
        }),
      });
      const tempRow = document.getElementById(tempId);
      if (tempRow && saved?.id) tempRow.dataset.msgId = saved.id;
      if (saved?.sent_at) _lastMsgSentAt = saved.sent_at;
    } catch (err) {
      console.error('[send image]', err.message);
      const tempRow = document.getElementById(tempId);
      if (tempRow) {
        tempRow.style.opacity = '0.6';
        const timeEl = tempRow.querySelector('.msg-time');
        if (timeEl) timeEl.textContent += ' · erro ao enviar';
      }
    }
  }

  // @menção
  function closeMentionDropdown() {
    if (mentionDropdown) mentionDropdown.style.display = 'none';
  }

  function handleMentionInput(textarea) {
    const text   = textarea.value;
    const cursor = textarea.selectionStart;
    const before = text.slice(0, cursor);
    const atIdx  = before.lastIndexOf('@');
    if (atIdx === -1 || before.slice(atIdx).includes(' ')) { closeMentionDropdown(); return; }
    const query = before.slice(atIdx + 1).toLowerCase();
    const users = (_convUsers || []).filter(u => u.name.toLowerCase().includes(query));
    if (!users.length) { closeMentionDropdown(); return; }

    mentionDropdown.innerHTML = users.map(u => `
      <button class="mention-opt" data-id="${u.id}" data-name="${u.name}">
        <div class="assign-mini-avatar">${u.name[0].toUpperCase()}</div>
        ${u.name}
      </button>`).join('');
    mentionDropdown.style.display = 'block';

    mentionDropdown.querySelectorAll('.mention-opt').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        const name   = btn.dataset.name;
        const userId = btn.dataset.id;
        if (userId) _pendingMentions.add(userId);
        const after = text.slice(cursor);
        textarea.value = before.slice(0, atIdx) + '@' + name + ' ' + after;
        textarea.dispatchEvent(new Event('input'));
        textarea.focus();
        textarea.setSelectionRange(atIdx + name.length + 2, atIdx + name.length + 2);
        closeMentionDropdown();
      });
    });
  }

  // Instance switcher logic
  const instBtn = document.getElementById('instSwitchBtn');
  const instDropdown = document.getElementById('instDropdown');
  if (instBtn && instDropdown) {
    instBtn.addEventListener('click', e => {
      e.stopPropagation();
      instDropdown.style.display = instDropdown.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { instDropdown.style.display = 'none'; }, { once: false });
    instDropdown.querySelectorAll('.inst-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        activeInstanceId = btn.dataset.id;
        document.getElementById('instSwitchLabel').textContent = btn.dataset.name;
        instDropdown.style.display = 'none';
      });
    });
  }

  // Poll for new messages every 3s
  _pollMsgInterval = setInterval(async () => {
    if (activeConvId !== convId) return;
    try {
      const since = _lastMsgSentAt ? `?since=${encodeURIComponent(_lastMsgSentAt)}` : '';
      const newMsgs = await apiFetch(`/api/conversations/${convId}/messages${since}`);
      if (!Array.isArray(newMsgs) || !newMsgs.length) return;

      _lastMsgSentAt = newMsgs[newMsgs.length - 1].sent_at;
      const container = document.getElementById('chatMessages');
      if (!container) return;

      const wasAtBottom = container.scrollTop < 60;
      newMsgs.forEach(m => {
        if (container.querySelector(`[data-msg-id="${m.id}"]`)) return;
        if (m.direction === 'outbound') {
          const tempRow = container.querySelector('.msg-row.outgoing:not([data-msg-id])');
          if (tempRow) { tempRow.dataset.msgId = m.id; return; }
        }
        const tmp = document.createElement('div');
        tmp.innerHTML = renderMessageHtml(m, conv?.contact_name);
        const row = tmp.firstElementChild;
        container.prepend(row);
      });
      if (wasAtBottom) container.scrollTop = 0;

      // Update sidebar unread for this conv
      const sideItem = document.querySelector(`.conv-item[data-conv-id="${convId}"] .conv-time`);
      if (sideItem) sideItem.textContent = new Date(_lastMsgSentAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    } catch {}
  }, 1000);

  // Poll sidebar conv list every 5s for new conversations from other contacts
  _pollListInterval = setInterval(async () => {
    try {
      const fresh = await apiFetch('/api/conversations');
      if (!Array.isArray(fresh)) return;
      const list = document.getElementById('convList');
      if (!list) return;
      fresh.forEach(c => {
        const item = list.querySelector(`.conv-item[data-conv-id="${c.id}"]`);
        if (!item) {
          // Nova conversa — adiciona ao topo da lista
          const newItem = document.createElement('div');
          newItem.className = `conv-item${c.unread_count > 0 ? ' unread' : ''}`;
          newItem.dataset.convId = c.id;
          newItem.innerHTML = `
            <div class="conv-avatar" style="position:relative">
              ${(c.contact_name || '?')[0].toUpperCase()}
              ${c.channel === 'whatsapp' ? `<div style="position:absolute;bottom:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:#25D366;border:2px solid var(--color-surface);display:flex;align-items:center;justify-content:center"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="8" height="8" fill="#fff"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg></div>` : ''}
            </div>
            <div class="conv-info">
              <div class="conv-name">${c.contact_name || 'Desconhecido'}</div>
              <div class="conv-preview">${c.contact_phone || c.channel || '—'}</div>
            </div>
            <div class="conv-meta">
              <div class="conv-time">${c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'}</div>
              ${c.unread_count > 0 ? `<div class="conv-unread-count">${c.unread_count}</div>` : ''}
            </div>`;
          list.prepend(newItem);
          newItem.addEventListener('click', async () => {
            document.querySelectorAll('.conv-item').forEach(e => e.classList.remove('active'));
            newItem.classList.add('active');
            activeConvId = c.id;
            await loadAndRenderChat(c.id, c);
          });
          return;
        }
        const badge = item.querySelector('.conv-unread-count');
        const timeEl = item.querySelector('.conv-time');
        if (c.id !== activeConvId && c.unread_count > 0) {
          item.classList.add('unread');
          if (badge) badge.textContent = c.unread_count;
          else {
            const meta = item.querySelector('.conv-meta');
            if (meta) meta.insertAdjacentHTML('beforeend', `<div class="conv-unread-count">${c.unread_count}</div>`);
          }
        }
        if (timeEl && c.last_message_at) {
          timeEl.textContent = new Date(c.last_message_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        }
      });
    } catch {}
  }, 5000);

  // Enviar mensagem
  const sendBtn   = document.getElementById('chatSendBtn');
  const chatInput = document.getElementById('chatInput');

  chatInput?.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    if (_isInternalMode) handleMentionInput(chatInput);
    else closeMentionDropdown();
  });

  chatInput?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMentionDropdown(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (mentionDropdown && mentionDropdown.style.display !== 'none') { e.preventDefault(); return; }
      e.preventDefault();
      sendMessage();
    }
  });

  async function sendMessage() {
    // Se há imagem pendente, envia como imagem (caption = texto do input)
    if (_pendingImageData) {
      const caption = chatInput.value.trim();
      chatInput.value = '';
      chatInput.style.height = 'auto';
      await sendImage(_pendingImageData, caption);
      return;
    }
    const content = chatInput.value.trim();
    if (!content) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    closeMentionDropdown();

    const isInternal  = _isInternalMode;
    const mentionIds  = [..._pendingMentions];
    _pendingMentions  = new Set();
    const container   = document.getElementById('chatMessages');
    const tempId     = `temp-${Date.now()}`;
    let tempRow = null;
    if (container) {
      tempRow = document.createElement('div');
      tempRow.className = 'msg-row outgoing';
      tempRow.id = tempId;
      const internalLabel = isInternal
        ? `<div class="internal-note-label">${_shieldSvg} Nota interna</div>`
        : '';
      tempRow.innerHTML = `
        <div class="msg-content">
          ${internalLabel}
          <div class="msg-bubble${isInternal ? ' internal' : ''}">${content}</div>
          <div class="msg-time">${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>`;
      container.prepend(tempRow);
      container.scrollTop = 0;
    }

    try {
      const saved = await apiFetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, instance_id: activeInstanceId, is_internal: isInternal, mention_ids: mentionIds }),
      });
      if (tempRow && saved?.id) {
        const existing = container?.querySelector(`[data-msg-id="${saved.id}"]`);
        if (existing && existing !== tempRow) tempRow.remove();
        else tempRow.dataset.msgId = saved.id;
      }
      if (saved?.sent_at) _lastMsgSentAt = saved.sent_at;
    } catch (err) {
      console.error('[send message]', err.message);
      document.getElementById(tempId)?.remove();
    }
  }

  sendBtn?.addEventListener('click', sendMessage);

  // ── Gravação de áudio ──────────────────────────────────────────
  const audioRecordBtn = document.getElementById('audioRecordBtn');
  let _mediaRecorder = null;
  let _audioChunks   = [];
  let _recTimerEl    = null;
  let _recSeconds    = 0;
  let _recInterval   = null;

  function _stopRecordingUI() {
    clearInterval(_recInterval);
    _recTimerEl?.remove();
    _recTimerEl = null;
    audioRecordBtn.style.color = '';
    audioRecordBtn.innerHTML = '<i data-lucide="mic" style="width:16px;height:16px"></i>';
    lucide.createIcons({ nodes: [audioRecordBtn] });
  }

  audioRecordBtn?.addEventListener('click', async () => {
    console.log('[audio] click — state:', _mediaRecorder?.state ?? 'null');
    if (_mediaRecorder && _mediaRecorder.state === 'recording') {
      console.log('[audio] stopping recorder');
      _mediaRecorder.stop();
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[audio] mic ok');
    } catch (e) {
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
      console.error('[audio] mic error:', e);
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    console.log('[audio] mimeType:', mimeType);

    _audioChunks   = [];
    _mediaRecorder = new MediaRecorder(stream, { mimeType });

    _mediaRecorder.ondataavailable = e => {
      console.log('[audio] data chunk:', e.data.size);
      if (e.data.size > 0) _audioChunks.push(e.data);
    };

    _mediaRecorder.onstop = () => {
      console.log('[audio] onstop — chunks:', _audioChunks.length);
      stream.getTracks().forEach(t => t.stop());
      _stopRecordingUI();

      const blob    = new Blob(_audioChunks, { type: mimeType });
      console.log('[audio] blob size:', blob.size, 'type:', blob.type);
      const tempId  = `temp-${Date.now()}`;
      const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      // Lê como base64 primeiro — audio elements não suportam range requests em blob URLs
      const reader = new FileReader();
      reader.onloadend = async () => {
        console.log('[audio] reader done, fileData length:', reader.result?.length, 'convId:', convId, 'instanceId:', activeInstanceId);
        const fileData  = reader.result;
        const container = document.getElementById('chatMessages');

        if (container) {
          // Cria o elemento de áudio via DOM API para evitar problemas com innerHTML + base64 longa
          const audioEl = document.createElement('audio');
          audioEl.controls = true;
          audioEl.src = fileData;
          audioEl.style.cssText = 'width:240px;outline:none;display:block';

          const bubble = document.createElement('div');
          bubble.className = 'msg-bubble';
          bubble.style.cssText = 'background:#1d4ed8;padding:8px 12px';
          bubble.appendChild(audioEl);

          const timeEl = document.createElement('div');
          timeEl.className = 'msg-time';
          timeEl.textContent = timeStr;

          const content = document.createElement('div');
          content.className = 'msg-content';
          content.appendChild(bubble);
          content.appendChild(timeEl);

          const tempRow = document.createElement('div');
          tempRow.className = 'msg-row outgoing';
          tempRow.id = tempId;
          tempRow.appendChild(content);

          container.prepend(tempRow);
          container.scrollTop = 0;
          console.log('[audio] player inserido — scrollTop após prepend:', container.scrollTop);
        } else {
          console.warn('[audio] chatMessages container não encontrado');
        }

        try {
          console.log('[audio] enviando para API...');
          const saved = await apiFetch(`/api/conversations/${convId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content: '', message_type: 'audio', file_data: fileData, instance_id: activeInstanceId, is_internal: _isInternalMode }),
          });
          console.log('[audio] API ok:', saved?.id);
          const tempRow = document.getElementById(tempId);
          if (tempRow && saved?.id) tempRow.dataset.msgId = saved.id;
          if (saved?.sent_at) _lastMsgSentAt = saved.sent_at;
        } catch (err) {
          console.error('[audio send] erro:', err);
          const tempRow = document.getElementById(tempId);
          if (tempRow) {
            tempRow.style.opacity = '0.6';
            const timeEl = tempRow.querySelector('.msg-time');
            if (timeEl) timeEl.textContent += ' · erro ao enviar';
          }
        }
      };
      reader.readAsDataURL(blob);
    };

    _mediaRecorder.start(1000);

    // UI de gravação
    audioRecordBtn.style.color = '#ef4444';
    audioRecordBtn.innerHTML = '<i data-lucide="stop-circle" style="width:16px;height:16px"></i>';
    lucide.createIcons({ nodes: [audioRecordBtn] });

    _recSeconds = 0;
    _recTimerEl = document.createElement('span');
    _recTimerEl.style.cssText = 'font-size:11px;color:#ef4444;font-variant-numeric:tabular-nums;min-width:32px';
    _recTimerEl.textContent = '0:00';
    audioRecordBtn.insertAdjacentElement('beforebegin', _recTimerEl);

    _recInterval = setInterval(() => {
      _recSeconds++;
      const m = Math.floor(_recSeconds / 60);
      const s = String(_recSeconds % 60).padStart(2, '0');
      if (_recTimerEl) _recTimerEl.textContent = `${m}:${s}`;
      if (_recSeconds >= 120) _mediaRecorder?.stop();
    }, 1000);
  });
}

window.unloadConversations = function() {
  _convStopPolling();
  _convUsers = [];
};

window.initConversations = function(data) {
  const convs = Array.isArray(data) ? data : [];

  // Fecha dropdowns do painel ao clicar fora
  document.addEventListener('click', () => {
    const d1 = document.getElementById('ownerDropdown');
    const d2 = document.getElementById('addFollowerDropdown');
    if (d1) d1.style.display = 'none';
    if (d2) d2.style.display = 'none';
  });

  document.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', async () => {
      document.querySelectorAll('.conv-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      activeConvId = el.dataset.convId;
      const conv = convs.find(c => c.id === activeConvId);
      await loadAndRenderChat(activeConvId, conv);
    });
  });

  // Abertura via notificação de @menção
  const notifConvId = window.__openConversationId;
  if (notifConvId) {
    window.__openConversationId = null;
    const conv = convs.find(c => c.id === notifConvId);
    if (conv) {
      activeConvId = notifConvId;
      document.querySelectorAll('.conv-item').forEach(el => {
        el.classList.toggle('active', el.dataset.convId === notifConvId);
      });
      loadAndRenderChat(notifConvId, conv);
      return;
    }
  }

  // Contato vindo da aba Contatos
  const pending = window.__convContact;
  if (pending) {
    window.__convContact = null;
    const existing = convs.find(c => c.contact_id === pending.id);
    if (existing) {
      // Conversa já existe — abre diretamente
      activeConvId = existing.id;
      document.querySelectorAll('.conv-item').forEach(el => {
        el.classList.toggle('active', el.dataset.convId === existing.id);
      });
      loadAndRenderChat(existing.id, existing);
    } else {
      // Sem conversa — exibe estado vazio com botão de iniciar
      const chatArea = document.getElementById('chatArea');
      if (chatArea) {
        chatArea.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;color:var(--color-text-3)">
            <div style="width:56px;height:56px;border-radius:50%;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:var(--color-text-1)">
              ${pending.name[0].toUpperCase()}
            </div>
            <div style="text-align:center">
              <div style="font-size:15px;font-weight:600;color:var(--color-text-1);margin-bottom:4px">${pending.name}</div>
              ${pending.phone ? `<div style="font-size:13px;color:var(--color-text-3)">${pending.phone}</div>` : ''}
            </div>
            <p style="font-size:13px;color:var(--color-text-3)">Você ainda não iniciou uma conversa com este contato.</p>
            <button class="btn btn-primary btn-sm" id="btnStartConv" style="gap:6px">
              <i data-lucide="message-circle-plus" style="width:15px;height:15px"></i>
              Iniciar conversa
            </button>
          </div>
        `;
        lucide.createIcons();

        document.getElementById('btnStartConv')?.addEventListener('click', async () => {
          document.getElementById('btnStartConv').disabled = true;
          document.getElementById('btnStartConv').textContent = 'Criando...';
          try {
            const conv = await apiFetch('/api/conversations', {
              method: 'POST',
              body: JSON.stringify({ contact_id: pending.id }),
            });
            // Recarrega a lista de conversas e abre o chat
            const newData = await window.loadConversations();
            const content = document.getElementById('pageContent');
            activeConvId = conv.id;
            content.innerHTML = window.pageConversations(newData);
            lucide.createIcons();
            window.initConversations(newData);
            loadAndRenderChat(conv.id, conv);
            document.querySelectorAll('.conv-item').forEach(el => {
              el.classList.toggle('active', el.dataset.convId === conv.id);
            });
          } catch (err) {
            alert(err.message);
          }
        });
      }
    }
    return;
  }

  // Carrega a primeira conversa automaticamente
  if (activeConvId && convs.length > 0) {
    const conv = convs.find(c => c.id === activeConvId) || convs[0];
    loadAndRenderChat(activeConvId, conv);
  }
};
