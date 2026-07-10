// ======================================
// FAVX CRM — Página de Funis
// ======================================

const STAGE_COLORS = [
  '#3b82f6','#f59e0b','#8b5cf6','#ec4899',
  '#10b981','#ef4444','#f97316','#6366f1',
  '#14b8a6','#06b6d4','#84cc16','#6b7280',
];

let funnelsState = {
  pipelines:   [],
  activeIndex: 0,
  mode:        'view',
  newStages:   [],
};

const funnelOppsMap = {};

const fmtBRL = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── API ──────────────────────────────────────────────────────

window.loadFunnels = async function () {
  const data = await apiFetch('/api/pipelines');
  if (Array.isArray(data)) {
    funnelsState.pipelines = data;
    if (window.__openOppInFunnel) {
      const idx = data.findIndex(p => p.id === window.__openOppInFunnel.pipeline_id);
      if (idx !== -1) funnelsState.activeIndex = idx;
    } else if (funnelsState.activeIndex >= data.length) {
      funnelsState.activeIndex = 0;
    }
  }
  return data;
};

// ── MODAL ────────────────────────────────────────────────────

function showModal(html) {
  let m = document.getElementById('funnelModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'funnelModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div style="background:var(--color-surface);border-radius:14px;width:560px;max-width:100%;max-height:88vh;overflow-y:auto;box-shadow:0 32px 64px rgba(0,0,0,.25);display:flex;flex-direction:column">
      ${html}
    </div>`;
  lucide.createIcons();
}

function closeModal() {
  document.getElementById('funnelModal')?.remove();
}

// ── CONTACT PICKER ───────────────────────────────────────────

async function openContactPicker(stageId) {
  let allContacts = [];
  let search = '';

  showModal(`<div style="padding:60px;text-align:center;color:var(--color-text-3)">
    <div style="width:28px;height:28px;border:3px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px"></div>
    Carregando contatos...
  </div>`);

  try {
    const res = await apiFetch('/api/contacts?limit=100');
    allContacts = res?.data || [];
  } catch {}

  function renderPicker() {
    const q = search.toLowerCase();
    const filtered = allContacts.filter(c =>
      !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q)
    );

    showModal(`
      <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-size:15px;font-weight:700">Selecionar contato</div>
          <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">Escolha o contato para a oportunidade</div>
        </div>
        <button id="btnCloseModal" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px">
          <i data-lucide="x" style="width:18px;height:18px"></i>
        </button>
      </div>
      <div style="padding:10px 14px;border-bottom:1px solid var(--color-border);flex-shrink:0">
        <div class="search-wrapper">
          <i data-lucide="search"></i>
          <input type="text" id="contactPickerSearch" placeholder="Buscar por nome, telefone ou e-mail..." value="${search}" style="width:100%" />
        </div>
      </div>
      <div style="overflow-y:auto;flex:1">
        ${filtered.length === 0
          ? `<div style="padding:32px;text-align:center;color:var(--color-text-3);font-size:13px">Nenhum contato encontrado.</div>`
          : filtered.map(c => `
            <button class="contact-picker-item" data-id="${c.id}" data-name="${c.name}" data-phone="${c.phone || ''}"
              style="display:flex;align-items:center;gap:12px;width:100%;padding:11px 20px;background:none;border:none;border-bottom:1px solid var(--color-border);cursor:pointer;text-align:left"
              onmouseover="this.style.background='var(--color-bg-2)'"
              onmouseout="this.style.background='none'">
              <div style="width:36px;height:36px;border-radius:50%;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">
                ${c.name[0].toUpperCase()}
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:var(--color-text-1)">${c.name}</div>
                <div style="font-size:12px;color:var(--color-text-3)">${c.phone || c.email || '—'}</div>
              </div>
              <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--color-text-3);flex-shrink:0"></i>
            </button>
          `).join('')}
      </div>
    `);

    document.getElementById('btnCloseModal')?.addEventListener('click', closeModal);

    const searchInput = document.getElementById('contactPickerSearch');
    searchInput?.focus();
    let t;
    searchInput?.addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { search = e.target.value; renderPicker(); }, 250);
    });

    document.querySelectorAll('.contact-picker-item').forEach(btn => {
      btn.addEventListener('click', () => {
        openOppForm({ id: btn.dataset.id, name: btn.dataset.name, phone: btn.dataset.phone }, stageId, null);
      });
    });
  }

  renderPicker();
}

// ── OPPORTUNITY FORM ─────────────────────────────────────────

async function openOppForm(contact, stageId, existingOpp) {
  const pipelines  = funnelsState.pipelines;
  const isEdit     = !!existingOpp;
  let curPipelineId = existingOpp?.pipeline_id || pipelines[funnelsState.activeIndex]?.id || pipelines[0]?.id || '';
  let curStageId    = existingOpp?.stage_id    || stageId || '';
  const cfDefs = await fetchCustomFieldDefs('opportunity');

  function getStages(pid) {
    return pipelines.find(p => p.id === pid)?.stages || [];
  }

  function renderForm() {
    const stages     = getStages(curPipelineId);
    const curStatus  = existingOpp?.status || 'open';
    const curSource  = existingOpp?.custom_fields?.source || '';
    const lostReason = existingOpp?.lost_reason || '';

    showModal(`
      <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-size:15px;font-weight:700">${isEdit ? 'Editar oportunidade' : 'Nova oportunidade'}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <div style="width:20px;height:20px;border-radius:50%;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${contact.name[0].toUpperCase()}</div>
            <span style="font-size:12px;color:var(--color-text-3)">${contact.name}${contact.phone ? ' · ' + contact.phone : ''}</span>
          </div>
        </div>
        <button id="btnCloseOppModal" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px">
          <i data-lucide="x" style="width:18px;height:18px"></i>
        </button>
      </div>

      <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;flex:1">

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">NOME DA OPORTUNIDADE *</label>
          <input type="text" id="opp_title" value="${existingOpp?.title || ''}" placeholder="Ex: Proposta de marketing digital"
            style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">FUNIL *</label>
            <select id="opp_pipeline" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
              ${pipelines.map(p => `<option value="${p.id}" ${p.id === curPipelineId ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">ETAPA DO FUNIL *</label>
            <select id="opp_stage" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
              ${stages.length
                ? stages.map(s => `<option value="${s.id}" ${s.id === curStageId ? 'selected' : ''}>${s.name}</option>`).join('')
                : '<option value="">Selecione um funil primeiro</option>'}
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">VALOR DA OPORTUNIDADE (R$)</label>
            <input type="number" id="opp_value" value="${existingOpp?.value || ''}" placeholder="0,00" min="0" step="0.01"
              style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)" />
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">STATUS</label>
            <select id="opp_status" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
              <option value="open" ${curStatus === 'open' ? 'selected' : ''}>Aberto</option>
              <option value="won"  ${curStatus === 'won'  ? 'selected' : ''}>Ganho</option>
              <option value="lost" ${curStatus === 'lost' ? 'selected' : ''}>Perdido</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">ORIGEM</label>
          <select id="opp_source" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
            <option value="">Não informada</option>
            <option value="whatsapp"  ${curSource === 'whatsapp'  ? 'selected' : ''}>WhatsApp</option>
            <option value="instagram" ${curSource === 'instagram' ? 'selected' : ''}>Instagram</option>
            <option value="site"      ${curSource === 'site'      ? 'selected' : ''}>Site</option>
            <option value="email"     ${curSource === 'email'     ? 'selected' : ''}>E-mail</option>
            <option value="indicacao" ${curSource === 'indicacao' ? 'selected' : ''}>Indicação</option>
            <option value="manual"    ${curSource === 'manual'    ? 'selected' : ''}>Manual</option>
          </select>
        </div>

        <div id="lostReasonWrap" ${curStatus !== 'lost' ? 'style="display:none"' : ''}>
          <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">MOTIVO DE PERDA</label>
          <textarea id="opp_lost_reason" rows="2" placeholder="Descreva o motivo da perda..."
            style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface);resize:vertical">${lostReason}</textarea>
        </div>

        ${renderCustomFieldsSection(cfDefs, existingOpp?.custom_fields || {})}

      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        ${!isEdit
          ? `<button id="btnBackToPicker" class="btn btn-ghost btn-sm"><i data-lucide="arrow-left" style="width:13px;height:13px"></i> Voltar</button>`
          : '<div></div>'}
        <div style="display:flex;gap:8px;align-items:center">
          <span id="oppFormError" style="font-size:12px;color:var(--color-red)"></span>
          <button class="btn btn-secondary btn-sm" id="btnCancelOpp">Cancelar</button>
          <button class="btn btn-primary btn-sm" id="btnSubmitOpp">
            ${isEdit ? 'Salvar alterações' : 'Criar oportunidade'}
          </button>
        </div>
      </div>
    `);

    // Pipeline change → atualiza etapas
    document.getElementById('opp_pipeline')?.addEventListener('change', e => {
      curPipelineId = e.target.value;
      curStageId    = '';
      renderForm();
    });

    // Status change → exibe/oculta motivo de perda
    document.getElementById('opp_status')?.addEventListener('change', e => {
      document.getElementById('lostReasonWrap').style.display = e.target.value === 'lost' ? '' : 'none';
    });

    document.getElementById('btnCloseOppModal')?.addEventListener('click', closeModal);
    document.getElementById('btnCancelOpp')?.addEventListener('click', closeModal);
    document.getElementById('btnBackToPicker')?.addEventListener('click', () => openContactPicker(stageId));

    document.getElementById('btnSubmitOpp')?.addEventListener('click', async () => {
      const title       = document.getElementById('opp_title').value.trim();
      const pipeline_id = document.getElementById('opp_pipeline').value;
      const stage_id    = document.getElementById('opp_stage').value;
      const value       = document.getElementById('opp_value').value;
      const status      = document.getElementById('opp_status').value;
      const source      = document.getElementById('opp_source').value;
      const lost_reason = document.getElementById('opp_lost_reason')?.value.trim() || null;
      const errEl       = document.getElementById('oppFormError');

      if (!title)       { errEl.textContent = 'Nome é obrigatório.'; return; }
      if (!pipeline_id) { errEl.textContent = 'Selecione um funil.'; return; }
      if (!stage_id)    { errEl.textContent = 'Selecione uma etapa.'; return; }
      errEl.textContent = '';

      const body = {
        pipeline_id, stage_id,
        contact_id: contact.id,
        title,
        value: parseFloat(value) || 0,
        status,
        lost_reason: status === 'lost' ? lost_reason : null,
        custom_fields: { ...(source ? { source } : {}), ...collectCustomFieldsValues(cfDefs) },
      };

      const btn = document.getElementById('btnSubmitOpp');
      btn.disabled = true;
      btn.textContent = 'Salvando...';

      try {
        if (isEdit) {
          await apiFetch(`/api/opportunities/${existingOpp.id}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          await apiFetch('/api/opportunities', { method: 'POST', body: JSON.stringify(body) });
        }
        closeModal();
        await reloadFunnelsPage();
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = isEdit ? 'Salvar alterações' : 'Criar oportunidade';
      }
    });
  }

  renderForm();
}

// ── RENDER PRINCIPAL ─────────────────────────────────────────

window.pageFunnels = function (data) {
  const pipelines = Array.isArray(data) ? data : funnelsState.pipelines;
  if (funnelsState.mode === 'create') return renderCreateForm();
  return renderKanban(pipelines);
};

// ── FORMULÁRIO DE CRIAÇÃO ────────────────────────────────────

function renderStagesRows() {
  const stages = funnelsState.newStages;
  if (!stages.length) {
    return `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--color-text-3);font-size:13px">
      Nenhuma etapa. Clique em "Adicionar Etapa".
    </td></tr>`;
  }
  return stages.map((s, i) => `
    <tr>
      <td style="padding:8px 14px;font-size:12px;color:var(--color-text-3);font-weight:700">${i + 1}</td>
      <td style="padding:6px 8px">
        <input type="text" class="stage-name-input" data-idx="${i}" value="${s.name}"
          placeholder="Ex: Prospecção"
          style="width:100%;padding:7px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)" />
      </td>
      <td style="padding:6px 14px">
        <div style="display:flex;gap:5px;flex-wrap:wrap;max-width:200px">
          ${STAGE_COLORS.map(c => `
            <button type="button" class="stage-color-btn" data-idx="${i}" data-color="${c}"
              style="width:18px;height:18px;border-radius:50%;background:${c};flex-shrink:0;cursor:pointer;padding:0;
                border:${s.color === c ? '3px solid #000' : '2px solid transparent'};
                outline:${s.color === c ? '1px solid #fff' : 'none'};outline-offset:-3px;transition:transform .1s"
              onmouseover="this.style.transform='scale(1.2)'"
              onmouseout="this.style.transform='scale(1)'"></button>
          `).join('')}
        </div>
      </td>
      <td style="padding:6px 10px;text-align:center">
        <button type="button" class="stage-remove-btn" data-idx="${i}"
          style="background:none;border:none;cursor:pointer;padding:4px;border-radius:4px"
          onmouseover="this.style.background='var(--color-bg-2)'"
          onmouseout="this.style.background='none'">
          <i data-lucide="x" style="width:14px;height:14px;color:var(--color-red)"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function renderCreateForm() {
  const count = funnelsState.newStages.length;
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Novo Funil</h1>
      <p class="page-subtitle">Configure as etapas do seu pipeline</p>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary btn-sm" id="btnCancelCreate">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="btnSaveFunnel">
        <i data-lucide="check" style="width:14px;height:14px"></i> Criar Funil
      </button>
    </div>
  </div>

  <div class="card" style="padding:0;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid var(--color-border)">
      <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:8px">NOME DO FUNIL</label>
      <input type="text" id="funnelNameInput" placeholder="Ex: Funil de Vendas"
        style="width:100%;max-width:420px;padding:10px 14px;border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:15px;font-weight:600;background:var(--color-surface)" />
    </div>
    <div style="padding:20px 24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <span style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em">ETAPAS DO FUNIL</span>
          <span style="font-size:12px;color:var(--color-text-3);margin-left:8px">${count}/15</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="btnAddStage" ${count >= 15 ? 'disabled' : ''}>
          <i data-lucide="plus" style="width:13px;height:13px"></i>
          ${count >= 15 ? 'Limite atingido' : 'Adicionar Etapa'}
        </button>
      </div>
      <div class="table-wrapper" style="border-radius:var(--radius-md)">
        <table>
          <thead>
            <tr>
              <th style="width:40px">#</th>
              <th>Nome da Etapa</th>
              <th>Cor</th>
              <th style="width:44px"></th>
            </tr>
          </thead>
          <tbody id="stagesTbody">${renderStagesRows()}</tbody>
        </table>
      </div>
      <span id="funnelFormError" style="font-size:12px;color:var(--color-red);display:block;margin-top:10px"></span>
    </div>
  </div>`;
}

// ── KANBAN ───────────────────────────────────────────────────

function renderKanban(pipelines) {
  if (!pipelines.length) {
    return `
    <div class="page-header">
      <div><h1 class="page-title">Funis</h1><p class="page-subtitle">Pipeline de vendas e conversão</p></div>
      <button class="btn btn-primary btn-sm" id="btnNewFunnel">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Novo Funil
      </button>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--color-text-3)">
      <i data-lucide="filter" style="width:40px;height:40px;opacity:0.3"></i>
      <p style="font-size:13px">Nenhum funil cadastrado. Crie o primeiro!</p>
    </div>`;
  }

  const active     = pipelines[funnelsState.activeIndex];
  const totalCards = active.stages.reduce((s, st) => s + st.count, 0);
  const totalValue = active.stages.reduce((s, st) => s + st.total_value, 0);

  // Popula o mapa de oportunidades para edição
  active.stages.forEach(st => st.opportunities.forEach(o => { funnelOppsMap[o.id] = o; }));

  return `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <h1 class="page-title" style="margin:0">Funis</h1>
      <div style="display:flex;align-items:center;gap:8px">
        <select id="funnelSelect"
          style="padding:6px 32px 6px 12px;border:1px solid var(--color-border);border-radius:var(--radius-md);
                 font-size:13px;font-weight:600;background:var(--color-surface);cursor:pointer;min-width:180px;
                 -webkit-appearance:none;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>');
                 background-repeat:no-repeat;background-position:right 10px center">
          ${pipelines.map((p, i) => `<option value="${i}" ${i === funnelsState.activeIndex ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary btn-sm" id="btnManageFunnels">
        <i data-lucide="settings-2" style="width:14px;height:14px"></i> Gerenciar funis
      </button>
      <button class="btn btn-primary btn-sm" id="btnNewFunnel">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Novo Funil
      </button>
    </div>
  </div>

  <div class="grid-4" style="margin-bottom:20px">
    <div class="stat-card" style="padding:16px">
      <div class="stat-card-top"><div class="stat-icon blue" style="width:34px;height:34px"><i data-lucide="users" style="width:15px;height:15px"></i></div></div>
      <div class="stat-value" style="font-size:22px">${totalCards}</div>
      <div class="stat-label">Leads no funil</div>
    </div>
    <div class="stat-card" style="padding:16px">
      <div class="stat-card-top"><div class="stat-icon green" style="width:34px;height:34px"><i data-lucide="dollar-sign" style="width:15px;height:15px"></i></div></div>
      <div class="stat-value" style="font-size:22px">${fmtBRL(totalValue)}</div>
      <div class="stat-label">Valor total</div>
    </div>
    <div class="stat-card" style="padding:16px">
      <div class="stat-card-top"><div class="stat-icon black" style="width:34px;height:34px"><i data-lucide="layers" style="width:15px;height:15px"></i></div></div>
      <div class="stat-value" style="font-size:22px">${active.stages.length}</div>
      <div class="stat-label">Etapas</div>
    </div>
    <div class="stat-card" style="padding:16px">
      <div class="stat-card-top"><div class="stat-icon yellow" style="width:34px;height:34px"><i data-lucide="trophy" style="width:15px;height:15px"></i></div></div>
      <div class="stat-value" style="font-size:22px;font-size:14px;font-weight:700">${active.name}</div>
      <div class="stat-label">Funil ativo</div>
    </div>
  </div>

  <div class="funnel-pipeline">
    ${active.stages.map(stage => `
    <div class="funnel-column">
      <div class="funnel-col-header">
        <div class="funnel-col-title">
          <span style="width:8px;height:8px;border-radius:50%;background:${stage.color || '#6b7280'};display:inline-block;flex-shrink:0"></span>
          ${stage.name}
          <span class="funnel-col-count">${stage.count}</span>
        </div>
        <span class="funnel-col-sum">${fmtBRL(stage.total_value)}</span>
      </div>
      <div class="funnel-col-cards" data-stage-id="${stage.id}">
        ${stage.opportunities.length === 0
          ? `<div class="funnel-empty-drop" data-stage-id="${stage.id}">Nenhuma oportunidade</div>`
          : stage.opportunities.map(opp => `
            <div class="funnel-card" draggable="true" data-opp-id="${opp.id}" data-stage-id="${stage.id}" style="position:relative">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:6px;min-width:0">
                  <i class="funnel-drag-handle" data-lucide="grip-vertical" style="width:12px;height:12px;flex-shrink:0"></i>
                  <div style="width:28px;height:28px;border-radius:50%;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">
                    ${opp.contact_name[0].toUpperCase()}
                  </div>
                  <span class="funnel-card-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${opp.contact_name}</span>
                </div>
                <button class="btn-edit-opp" data-id="${opp.id}" draggable="false"
                  style="background:none;border:none;cursor:pointer;padding:2px;border-radius:4px;flex-shrink:0;opacity:.5"
                  onmouseover="this.style.opacity='1';this.style.background='var(--color-bg-2)'"
                  onmouseout="this.style.opacity='.5';this.style.background='none'">
                  <i data-lucide="pencil" style="width:12px;height:12px"></i>
                </button>
              </div>
              <div style="font-size:11px;color:var(--color-text-3);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${opp.title}</div>
              <div class="funnel-card-value">${fmtBRL(parseFloat(opp.value) || 0)}</div>
            </div>
          `).join('')}
        <button class="btn-add-opp" data-stage="${stage.id}"
          style="width:100%;margin-top:6px;padding:9px;border:1.5px dashed var(--color-border);border-radius:var(--radius-md);
                 font-size:12px;color:var(--color-text-3);background:none;cursor:pointer;transition:all var(--transition)"
          onmouseover="this.style.borderColor='#000';this.style.color='#000'"
          onmouseout="this.style.borderColor='';this.style.color=''">
          + Adicionar oportunidade
        </button>
      </div>
    </div>
    `).join('')}
  </div>`;
}

// ── HELPERS ──────────────────────────────────────────────────

function refreshCreateForm() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = renderCreateForm();
  lucide.createIcons();
  bindCreateFormEvents();
}

function bindStageRowEvents() {
  document.querySelectorAll('.stage-name-input').forEach(inp => {
    inp.addEventListener('input', e => {
      funnelsState.newStages[parseInt(e.target.dataset.idx)].name = e.target.value;
    });
  });
  document.querySelectorAll('.stage-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      funnelsState.newStages[parseInt(btn.dataset.idx)].color = btn.dataset.color;
      const tbody = document.getElementById('stagesTbody');
      if (tbody) { tbody.innerHTML = renderStagesRows(); lucide.createIcons(); bindStageRowEvents(); }
    });
  });
  document.querySelectorAll('.stage-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      funnelsState.newStages.splice(parseInt(btn.dataset.idx), 1);
      refreshCreateForm();
    });
  });
}

function bindCreateFormEvents() {
  bindStageRowEvents();

  document.getElementById('btnAddStage')?.addEventListener('click', () => {
    if (funnelsState.newStages.length >= 15) return;
    funnelsState.newStages.push({ name: '', color: STAGE_COLORS[funnelsState.newStages.length % STAGE_COLORS.length] });
    refreshCreateForm();
  });

  document.getElementById('btnCancelCreate')?.addEventListener('click', () => {
    funnelsState.mode = 'view';
    reloadFunnelsPage();
  });

  document.getElementById('btnSaveFunnel')?.addEventListener('click', async () => {
    const name  = document.getElementById('funnelNameInput')?.value.trim();
    const errEl = document.getElementById('funnelFormError');
    if (!name) { errEl.textContent = 'Nome do funil é obrigatório.'; return; }
    if (!funnelsState.newStages.length) { errEl.textContent = 'Adicione pelo menos uma etapa.'; return; }
    const unnamed = funnelsState.newStages.findIndex(s => !s.name.trim());
    if (unnamed !== -1) { errEl.textContent = `Etapa ${unnamed + 1} sem nome.`; return; }
    errEl.textContent = '';
    try {
      await apiFetch('/api/pipelines', { method: 'POST', body: JSON.stringify({ name, stages: funnelsState.newStages }) });
      funnelsState.mode = 'view';
      funnelsState.newStages = [];
      await reloadFunnelsPage();
      funnelsState.activeIndex = funnelsState.pipelines.length - 1;
      await reloadFunnelsPage();
    } catch (err) { errEl.textContent = err.message; }
  });
}

async function reloadFunnelsPage() {
  const data = await window.loadFunnels();
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = window.pageFunnels(data);
  lucide.createIcons();
  window.initFunnels(data);
}

// ── GERENCIAR FUNIS ──────────────────────────────────────────

async function openManageFunnelsModal() {
  showModal(`<div style="padding:60px;text-align:center;color:var(--color-text-3)">
    <div style="width:28px;height:28px;border:3px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto"></div>
  </div>`);

  let pipelines = [];
  try {
    const data = await apiFetch('/api/pipelines');
    pipelines = Array.isArray(data) ? data : [];
  } catch {}

  let expandedId    = null;
  let pendingStage  = null; // { pipeline_id, name, color }

  function renderManageModal() {
    showModal(`
      <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-size:15px;font-weight:700">Gerenciar funis</div>
          <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">${pipelines.length} funil${pipelines.length !== 1 ? 's' : ''} na subconta</div>
        </div>
        <button id="btnCloseMgr" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px"
          onmouseover="this.style.background='var(--color-bg-2)'" onmouseout="this.style.background='none'">
          <i data-lucide="x" style="width:18px;height:18px"></i>
        </button>
      </div>

      <div style="overflow-y:auto;flex:1;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        ${pipelines.length === 0
          ? `<div style="text-align:center;padding:40px;color:var(--color-text-3);font-size:13px">Nenhum funil criado ainda.</div>`
          : pipelines.map(p => renderPipelineItem(p)).join('')}
      </div>
    `);

    document.getElementById('btnCloseMgr')?.addEventListener('click', closeModal);

    // Toggle expand
    document.querySelectorAll('.btn-toggle-pipeline').forEach(btn => {
      btn.addEventListener('click', () => {
        expandedId   = expandedId === btn.dataset.id ? null : btn.dataset.id;
        pendingStage = null;
        renderManageModal();
      });
    });

    // Salvar nome do funil
    document.querySelectorAll('.btn-save-pname').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = document.getElementById(`pname_${btn.dataset.id}`)?.value.trim();
        if (!name) return;
        btn.disabled = true; btn.textContent = '...';
        try {
          const updated = await apiFetch(`/api/pipelines/${btn.dataset.id}`, {
            method: 'PUT', body: JSON.stringify({ name }),
          });
          const p = pipelines.find(pl => pl.id === btn.dataset.id);
          if (p) p.name = updated.name;
          renderManageModal();
          reloadFunnelsPage();
        } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = 'Salvar'; }
      });
    });

    // Excluir funil
    document.querySelectorAll('.btn-delete-pipeline-mgr').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Excluir "${btn.dataset.name}"? Todos os dados serão removidos.`)) return;
        try {
          await apiFetch(`/api/pipelines/${btn.dataset.id}`, { method: 'DELETE' });
          pipelines = pipelines.filter(p => p.id !== btn.dataset.id);
          if (expandedId === btn.dataset.id) expandedId = null;
          renderManageModal();
          funnelsState.activeIndex = 0;
          reloadFunnelsPage();
        } catch (err) { alert(err.message); }
      });
    });

    // Salvar etapa
    document.querySelectorAll('.btn-save-stage-mgr').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name  = document.getElementById(`sname_${btn.dataset.id}`)?.value.trim();
        const wrap  = document.querySelector(`.color-picker-wrap[data-stage-id="${btn.dataset.id}"]`);
        const color = wrap?.dataset.selectedColor || '#6b7280';
        if (!name) return;
        btn.disabled = true; btn.textContent = '...';
        try {
          await apiFetch(`/api/pipeline_stages/${btn.dataset.id}`, {
            method: 'PUT', body: JSON.stringify({ name, color }),
          });
          pipelines.forEach(p => (p.stages || []).forEach(s => {
            if (s.id === btn.dataset.id) { s.name = name; s.color = color; }
          }));
          renderManageModal();
          reloadFunnelsPage();
        } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = 'Salvar'; }
      });
    });

    // Seletor de cor de etapa (sem re-render)
    document.querySelectorAll('.mgr-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wrap = btn.closest('.color-picker-wrap');
        if (!wrap) return;
        wrap.dataset.selectedColor = btn.dataset.color;
        wrap.querySelectorAll('.mgr-color-btn').forEach(b => {
          b.style.border   = '2px solid transparent';
          b.style.outline  = 'none';
        });
        btn.style.border  = '3px solid #000';
        btn.style.outline = '1px solid #fff';
        btn.style.outlineOffset = '-3px';
        // Atualiza o dot de preview
        const dot = wrap.previousElementSibling;
        if (dot && dot.classList.contains('stage-dot-preview')) dot.style.background = btn.dataset.color;
      });
    });

    // Excluir etapa
    document.querySelectorAll('.btn-delete-stage-mgr').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir esta etapa? As oportunidades dentro dela também serão removidas.')) return;
        try {
          await apiFetch(`/api/pipeline_stages/${btn.dataset.id}`, { method: 'DELETE' });
          pipelines.forEach(p => { if (p.stages) p.stages = p.stages.filter(s => s.id !== btn.dataset.id); });
          renderManageModal();
          reloadFunnelsPage();
        } catch (err) { alert(err.message); }
      });
    });

    // Mostrar input de nova etapa
    document.querySelectorAll('.btn-show-add-stage').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pipelineId;
        const pipeline = pipelines.find(p => p.id === pid);
        const nextColor = STAGE_COLORS[(pipeline?.stages?.length || 0) % STAGE_COLORS.length];
        pendingStage = { pipeline_id: pid, name: '', color: nextColor };
        renderManageModal();
        document.getElementById('pendingStageInput')?.focus();
      });
    });

    // Cor do pending stage
    document.querySelectorAll('.pending-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (pendingStage) pendingStage.color = btn.dataset.color;
        document.querySelectorAll('.pending-color-btn').forEach(b => {
          b.style.border = '2px solid transparent'; b.style.outline = 'none';
        });
        btn.style.border = '3px solid #000';
        btn.style.outline = '1px solid #fff';
        btn.style.outlineOffset = '-3px';
      });
    });

    // Cancelar nova etapa
    document.getElementById('btnCancelPendingStage')?.addEventListener('click', () => {
      pendingStage = null; renderManageModal();
    });

    // Salvar nova etapa
    document.getElementById('btnSavePendingStage')?.addEventListener('click', async () => {
      const name = document.getElementById('pendingStageInput')?.value.trim();
      if (!name || !pendingStage) return;
      const btn = document.getElementById('btnSavePendingStage');
      btn.disabled = true; btn.textContent = '...';
      try {
        const newStage = await apiFetch('/api/pipeline_stages', {
          method: 'POST',
          body: JSON.stringify({ pipeline_id: pendingStage.pipeline_id, name, color: pendingStage.color }),
        });
        const pipeline = pipelines.find(p => p.id === pendingStage.pipeline_id);
        if (pipeline) { if (!pipeline.stages) pipeline.stages = []; pipeline.stages.push(newStage); }
        pendingStage = null;
        renderManageModal();
        reloadFunnelsPage();
      } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = 'Adicionar'; }
    });
  }

  function renderPipelineItem(pipeline) {
    const isExpanded = expandedId === pipeline.id;
    const stages     = pipeline.stages || [];
    return `
    <div style="border:1px solid var(--color-border);border-radius:var(--radius-md);overflow:hidden">

      <!-- Cabeçalho do funil -->
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--color-surface)">
        <i data-lucide="filter" style="width:14px;height:14px;color:var(--color-text-3);flex-shrink:0"></i>
        <input type="text" id="pname_${pipeline.id}" value="${pipeline.name}"
          style="flex:1;padding:6px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;font-weight:600;background:var(--color-surface)" />
        <button class="btn btn-secondary btn-sm btn-save-pname" data-id="${pipeline.id}" style="white-space:nowrap">Salvar</button>
        <button class="btn btn-ghost btn-sm btn-toggle-pipeline" data-id="${pipeline.id}"
          title="${isExpanded ? 'Fechar etapas' : 'Editar etapas'}" style="padding:5px 8px">
          <i data-lucide="${isExpanded ? 'chevron-up' : 'layers'}" style="width:14px;height:14px"></i>
        </button>
        <button class="btn btn-ghost btn-sm btn-delete-pipeline-mgr" data-id="${pipeline.id}" data-name="${pipeline.name}" style="padding:5px 8px">
          <i data-lucide="trash-2" style="width:14px;height:14px;color:var(--color-red)"></i>
        </button>
      </div>

      ${!isExpanded ? '' : `
      <!-- Etapas -->
      <div style="border-top:1px solid var(--color-border);background:var(--color-bg-2);padding:12px 14px;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;margin-bottom:2px">
          ETAPAS — ${stages.length} / 15
        </div>

        ${stages.map(s => `
        <div style="display:flex;align-items:center;gap:8px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:8px 12px">
          <span class="stage-dot-preview" style="width:12px;height:12px;border-radius:50%;background:${s.color || '#6b7280'};flex-shrink:0"></span>
          <input type="text" id="sname_${s.id}" value="${s.name}"
            style="flex:1;padding:5px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:12px;background:var(--color-surface)" />
          <div class="color-picker-wrap" data-stage-id="${s.id}" data-selected-color="${s.color || '#6b7280'}"
            style="display:flex;gap:3px;flex-wrap:wrap;max-width:130px">
            ${STAGE_COLORS.map(c => `
              <button type="button" class="mgr-color-btn" data-stage-id="${s.id}" data-color="${c}"
                style="width:14px;height:14px;border-radius:50%;background:${c};cursor:pointer;padding:0;flex-shrink:0;
                  border:${s.color===c?'3px solid #000':'2px solid transparent'};
                  outline:${s.color===c?'1px solid #fff':'none'};outline-offset:-3px"></button>
            `).join('')}
          </div>
          <button class="btn btn-secondary btn-sm btn-save-stage-mgr" data-id="${s.id}" style="font-size:11px;padding:4px 8px;white-space:nowrap">Salvar</button>
          <button class="btn btn-ghost btn-sm btn-delete-stage-mgr" data-id="${s.id}" style="padding:4px;flex-shrink:0">
            <i data-lucide="trash-2" style="width:12px;height:12px;color:var(--color-red)"></i>
          </button>
        </div>
        `).join('')}

        ${pendingStage?.pipeline_id === pipeline.id ? `
        <div style="display:flex;align-items:center;gap:8px;background:var(--color-surface);border:1.5px solid #3b82f6;border-radius:var(--radius-sm);padding:8px 12px">
          <span style="width:12px;height:12px;border-radius:50%;background:${pendingStage.color};flex-shrink:0"></span>
          <input type="text" id="pendingStageInput" placeholder="Nome da etapa" value="${pendingStage.name}"
            style="flex:1;padding:5px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:12px;background:var(--color-surface)" />
          <div style="display:flex;gap:3px;flex-wrap:wrap;max-width:130px">
            ${STAGE_COLORS.map(c => `
              <button type="button" class="pending-color-btn" data-color="${c}"
                style="width:14px;height:14px;border-radius:50%;background:${c};cursor:pointer;padding:0;flex-shrink:0;
                  border:${pendingStage.color===c?'3px solid #000':'2px solid transparent'};
                  outline:${pendingStage.color===c?'1px solid #fff':'none'};outline-offset:-3px"></button>
            `).join('')}
          </div>
          <button class="btn btn-primary btn-sm" id="btnSavePendingStage" style="font-size:11px;padding:4px 10px;white-space:nowrap">Adicionar</button>
          <button class="btn btn-ghost btn-sm" id="btnCancelPendingStage" style="padding:4px;flex-shrink:0">
            <i data-lucide="x" style="width:12px;height:12px"></i>
          </button>
        </div>
        ` : stages.length < 15 ? `
        <button class="btn btn-ghost btn-sm btn-show-add-stage" data-pipeline-id="${pipeline.id}"
          style="width:100%;padding:9px;border:1.5px dashed var(--color-border);border-radius:var(--radius-sm);font-size:12px;color:var(--color-text-3)"
          onmouseover="this.style.borderColor='#000';this.style.color='#000'"
          onmouseout="this.style.borderColor='';this.style.color=''">
          + Adicionar etapa
        </button>
        ` : `<div style="font-size:12px;color:var(--color-text-3);text-align:center;padding:8px">Limite de 15 etapas atingido.</div>`}
      </div>
      `}
    </div>`;
  }

  renderManageModal();
}

// ── DRAG & DROP ──────────────────────────────────────────────

function bindDragDrop() {
  let dragging = null; // { oppId, stageId }

  document.querySelectorAll('.funnel-card[data-opp-id]').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragging = { oppId: card.dataset.oppId, stageId: card.dataset.stageId };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.oppId);
      requestAnimationFrame(() => card.classList.add('is-dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      document.querySelectorAll('.funnel-col-cards.drag-over, .funnel-empty-drop.drag-over')
        .forEach(z => z.classList.remove('drag-over'));
      dragging = null;
    });
  });

  async function handleDrop(e, targetStageId) {
    e.preventDefault();
    document.querySelectorAll('.funnel-col-cards.drag-over, .funnel-empty-drop.drag-over')
      .forEach(z => z.classList.remove('drag-over'));
    const oppId = dragging?.oppId || e.dataTransfer.getData('text/plain');
    if (!oppId || !targetStageId) return;
    const opp = funnelOppsMap[oppId];
    if (!opp || opp.stage_id === targetStageId) return;
    try {
      await apiFetch(`/api/opportunities/${oppId}`, {
        method: 'PUT',
        body: JSON.stringify({
          pipeline_id:   opp.pipeline_id,
          stage_id:      targetStageId,
          contact_id:    opp.contact_id,
          title:         opp.title,
          value:         parseFloat(opp.value) || 0,
          status:        opp.status,
          lost_reason:   opp.lost_reason || null,
          custom_fields: opp.custom_fields || {},
        }),
      });
      await reloadFunnelsPage();
    } catch (err) {
      alert(err.message);
    }
  }

  document.querySelectorAll('.funnel-col-cards').forEach(zone => {
    zone.addEventListener('dragover', e => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.funnel-col-cards.drag-over').forEach(z => z.classList.remove('drag-over'));
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', e => {
      if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', e => handleDrop(e, zone.dataset.stageId));
  });

  // Drop zones in empty columns
  document.querySelectorAll('.funnel-empty-drop').forEach(zone => {
    zone.addEventListener('dragover', e => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', e => {
      if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', e => handleDrop(e, zone.dataset.stageId));
  });
}

// ── INIT ─────────────────────────────────────────────────────

window.initFunnels = function (data) {
  if (funnelsState.mode === 'create') { bindCreateFormEvents(); return; }

  // Vindo do painel de contatos → destaca o card da oportunidade
  const pendingOpp = window.__openOppInFunnel;
  if (pendingOpp) {
    window.__openOppInFunnel = null;
    setTimeout(() => {
      const editBtn = document.querySelector(`.btn-edit-opp[data-id="${pendingOpp.opp_id}"]`);
      const card    = editBtn?.closest('.funnel-card');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.transition  = 'outline .2s, box-shadow .2s';
        card.style.outline     = '2px solid #3b82f6';
        card.style.boxShadow   = '0 0 0 6px rgba(59,130,246,.18)';
        setTimeout(() => { card.style.outline = ''; card.style.boxShadow = ''; }, 2500);
      }
    }, 120);
  }

  document.getElementById('funnelSelect')?.addEventListener('change', e => {
    funnelsState.activeIndex = parseInt(e.target.value);
    const content = document.getElementById('pageContent');
    if (content) { content.innerHTML = window.pageFunnels(funnelsState.pipelines); lucide.createIcons(); window.initFunnels(funnelsState.pipelines); }
  });

  document.getElementById('btnNewFunnel')?.addEventListener('click', () => {
    funnelsState.mode = 'create';
    funnelsState.newStages = [{ name: '', color: STAGE_COLORS[0] }];
    refreshCreateForm();
  });

  document.getElementById('btnManageFunnels')?.addEventListener('click', () => openManageFunnelsModal());

  // Adicionar oportunidade
  document.querySelectorAll('.btn-add-opp').forEach(btn => {
    btn.addEventListener('click', () => openContactPicker(btn.dataset.stage));
  });

  // Editar oportunidade
  document.querySelectorAll('.btn-edit-opp').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const opp = funnelOppsMap[btn.dataset.id];
      if (opp) openOppForm({ id: opp.contact_id, name: opp.contact_name, phone: opp.contact_phone || '' }, opp.stage_id, opp);
    });
  });

  bindDragDrop();
};
