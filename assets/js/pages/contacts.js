let contactsState = { page: 1, limit: 20, search: '', status: 'all', total: 0 };

window.loadContacts = async function() {
  const { page, limit, search, status } = contactsState;
  const params = new URLSearchParams({ page, limit });
  if (search) params.set('search', search);
  if (status && status !== 'all') params.set('status', status);
  const res = await apiFetch(`/api/contacts?${params}`);
  if (res) contactsState.total = res.total;
  return res;
};

window.pageContacts = function(data) {
  const contacts = data?.data || [];
  const total    = data?.total ?? 0;
  const page     = data?.page  ?? 1;
  const limit    = data?.limit ?? 20;
  const pages    = Math.max(1, Math.ceil(total / limit));

  const statusBadge = s => {
    const map = { lead:'badge-blue', customer:'badge-black', churned:'badge-gray' };
    const label = { lead:'Lead', customer:'Cliente', churned:'Inativo' };
    return `<span class="badge ${map[s]||'badge-gray'}">${label[s]||s}</span>`;
  };

  const sourceFmt = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';

  const dateFmt = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

  const emptyRow = contacts.length === 0 ? `
    <tr>
      <td colspan="8" style="text-align:center;padding:40px;color:var(--color-text-3)">
        Nenhum contato encontrado.
      </td>
    </tr>` : '';

  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Contatos</h1>
      <p class="page-subtitle">${total.toLocaleString('pt-BR')} contato${total !== 1 ? 's' : ''} cadastrado${total !== 1 ? 's' : ''}</p>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary btn-sm"><i data-lucide="upload" style="width:14px;height:14px"></i> Importar</button>
      <button class="btn btn-primary btn-sm" id="btnNewContact"><i data-lucide="user-plus" style="width:14px;height:14px"></i> Novo Contato</button>
    </div>
  </div>

  <!-- NOVO CONTATO FORM (oculto) -->
  <div id="newContactPanel" hidden style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:20px;margin-bottom:16px">
    <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">Novo Contato</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0">
        <label>Nome *</label>
        <input type="text" id="nc_name" placeholder="Nome completo" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px" />
      </div>
      <div class="form-group" style="margin:0">
        <label>Telefone</label>
        <input type="text" id="nc_phone" placeholder="(11) 99999-0000" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px" />
      </div>
      <div class="form-group" style="margin:0">
        <label>E-mail</label>
        <input type="email" id="nc_email" placeholder="email@exemplo.com" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px" />
      </div>
      <div class="form-group" style="margin:0">
        <label>Empresa</label>
        <input type="text" id="nc_company" placeholder="Empresa" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px" />
      </div>
      <div class="form-group" style="margin:0">
        <label>Origem</label>
        <select id="nc_source" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
          <option value="manual">Manual</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="email">E-mail</option>
          <option value="site">Site</option>
        </select>
      </div>
      <div class="form-group" style="margin:0">
        <label>Status</label>
        <select id="nc_status" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
          <option value="lead">Lead</option>
          <option value="customer">Cliente</option>
          <option value="churned">Inativo</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn btn-primary btn-sm" id="btnSaveContact">Salvar</button>
      <button class="btn btn-secondary btn-sm" id="btnCancelContact">Cancelar</button>
      <span id="contactFormError" style="font-size:12px;color:var(--color-red);align-self:center"></span>
    </div>
  </div>

  <div class="card" style="padding:0;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--color-border)">
      <div class="search-wrapper" style="min-width:unset;flex:1;max-width:320px">
        <i data-lucide="search"></i>
        <input type="text" id="contactSearch" placeholder="Buscar contatos..." value="${contactsState.search}" />
      </div>
      <div style="display:flex;gap:6px;margin-left:auto">
        ${['all','lead','customer','churned'].map(s => {
          const labels = {all:'Todos',lead:'Leads',customer:'Clientes',churned:'Inativos'};
          const active = contactsState.status === s;
          return `<button class="btn ${active?'btn-primary':'btn-ghost'} btn-sm contact-filter-btn" data-status="${s}">${labels[s]}</button>`;
        }).join('')}
      </div>
    </div>
    <div class="table-wrapper" style="border:none;border-radius:0">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Telefone</th>
            <th>E-mail</th>
            <th>Empresa</th>
            <th>Origem</th>
            <th>Criado em</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${emptyRow}
          ${contacts.map(c => `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div class="avatar">${c.name[0].toUpperCase()}</div>
                <span style="font-weight:600;color:var(--color-text-1)">${c.name}</span>
              </div>
            </td>
            <td>${c.phone || '—'}</td>
            <td style="color:var(--color-text-3)">${c.email || '—'}</td>
            <td>${c.company || '—'}</td>
            <td>${sourceFmt(c.source)}</td>
            <td>${dateFmt(c.created_at)}</td>
            <td>${statusBadge(c.status)}</td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-sm btn-open-conv" data-id="${c.id}" data-name="${c.name}" data-phone="${c.phone || ''}" style="padding:4px 8px" title="Abrir conversa">
                <i data-lucide="message-circle" style="width:14px;height:14px;color:var(--color-text-2)"></i>
              </button>
              <button class="btn btn-ghost btn-sm btn-open-funnel" data-id="${c.id}" data-name="${c.name}" style="padding:4px 8px" title="Ver oportunidades">
                <i data-lucide="filter" style="width:14px;height:14px;color:var(--color-text-2)"></i>
              </button>
              <button class="btn btn-ghost btn-sm btn-delete-contact" data-id="${c.id}" data-name="${c.name}" style="padding:4px 8px" title="Excluir contato">
                <i data-lucide="trash-2" style="width:14px;height:14px;color:var(--color-red)"></i>
              </button>
            </td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--color-border)">
      <span style="font-size:12px;color:var(--color-text-3)">
        Mostrando ${contacts.length} de ${total.toLocaleString('pt-BR')} contato${total !== 1 ? 's' : ''}
      </span>
      <div style="display:flex;gap:4px">
        <button class="btn btn-secondary btn-sm" id="btnPrevPage" ${page <= 1 ? 'disabled' : ''}>
          <i data-lucide="chevron-left" style="width:14px;height:14px"></i>
        </button>
        ${Array.from({length: Math.min(pages, 5)}, (_, i) => {
          const p = i + 1;
          return `<button class="btn ${p === page ? 'btn-primary' : 'btn-secondary'} btn-sm contact-page-btn" data-page="${p}">${p}</button>`;
        }).join('')}
        <button class="btn btn-secondary btn-sm" id="btnNextPage" ${page >= pages ? 'disabled' : ''}>
          <i data-lucide="chevron-right" style="width:14px;height:14px"></i>
        </button>
      </div>
    </div>
  </div>
  `;
};

window.initContacts = function() {
  // Busca ao digitar
  const searchInput = document.getElementById('contactSearch');
  if (searchInput) {
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        contactsState.search = searchInput.value.trim();
        contactsState.page   = 1;
        const data = await window.loadContacts();
        document.getElementById('pageContent').innerHTML = window.pageContacts(data);
        lucide.createIcons();
        window.initContacts();
      }, 400);
    });
  }

  // Filtros de status
  document.querySelectorAll('.contact-filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      contactsState.status = btn.dataset.status;
      contactsState.page   = 1;
      const data = await window.loadContacts();
      document.getElementById('pageContent').innerHTML = window.pageContacts(data);
      lucide.createIcons();
      window.initContacts();
    });
  });

  // Paginação
  document.querySelectorAll('.contact-page-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      contactsState.page = parseInt(btn.dataset.page);
      const data = await window.loadContacts();
      document.getElementById('pageContent').innerHTML = window.pageContacts(data);
      lucide.createIcons();
      window.initContacts();
    });
  });

  document.getElementById('btnPrevPage')?.addEventListener('click', async () => {
    if (contactsState.page > 1) {
      contactsState.page--;
      const data = await window.loadContacts();
      document.getElementById('pageContent').innerHTML = window.pageContacts(data);
      lucide.createIcons();
      window.initContacts();
    }
  });

  document.getElementById('btnNextPage')?.addEventListener('click', async () => {
    contactsState.page++;
    const data = await window.loadContacts();
    document.getElementById('pageContent').innerHTML = window.pageContacts(data);
    lucide.createIcons();
    window.initContacts();
  });

  // Novo contato toggle
  document.getElementById('btnNewContact')?.addEventListener('click', () => {
    document.getElementById('newContactPanel').hidden = false;
  });
  document.getElementById('btnCancelContact')?.addEventListener('click', () => {
    document.getElementById('newContactPanel').hidden = true;
  });

  // Salvar contato
  document.getElementById('btnSaveContact')?.addEventListener('click', async () => {
    const name    = document.getElementById('nc_name').value.trim();
    const phone   = document.getElementById('nc_phone').value.trim();
    const email   = document.getElementById('nc_email').value.trim();
    const company = document.getElementById('nc_company').value.trim();
    const source  = document.getElementById('nc_source').value;
    const status  = document.getElementById('nc_status').value;
    const errEl   = document.getElementById('contactFormError');

    if (!name) { errEl.textContent = 'Nome é obrigatório.'; return; }
    errEl.textContent = '';

    try {
      await apiFetch('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ name, phone, email, company, source, status }),
      });
      contactsState.page = 1;
      const data = await window.loadContacts();
      document.getElementById('pageContent').innerHTML = window.pageContacts(data);
      lucide.createIcons();
      window.initContacts();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Abrir painel de oportunidades
  document.querySelectorAll('.btn-open-funnel').forEach(btn => {
    btn.addEventListener('click', () => openOppPanel(btn.dataset.id, btn.dataset.name));
  });

  // Abrir conversa do contato
  document.querySelectorAll('.btn-open-conv').forEach(btn => {
    btn.addEventListener('click', () => {
      window.__convContact = { id: btn.dataset.id, name: btn.dataset.name, phone: btn.dataset.phone };
      if (typeof navigateTo === 'function') navigateTo('conversations');
    });
  });

  // Deletar contato
  document.querySelectorAll('.btn-delete-contact').forEach(btn => {
    btn.addEventListener('click', () => openDeleteContactModal(btn.dataset.id, btn.dataset.name));
  });
};

// ── MODAL EXCLUIR CONTATO ─────────────────────────────────────

function openDeleteContactModal(contactId, contactName) {
  let overlay = document.getElementById('deleteContactOverlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'deleteContactOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:16px;width:400px;max-width:100%;padding:36px 32px 28px;display:flex;flex-direction:column;align-items:center;box-shadow:0 32px 64px rgba(0,0,0,.25)">

      <div style="width:60px;height:60px;border-radius:50%;background:var(--color-red-lite);display:flex;align-items:center;justify-content:center;margin-bottom:18px">
        <i data-lucide="trash-2" style="width:26px;height:26px;color:var(--color-red)"></i>
      </div>

      <div style="font-size:15px;font-weight:700;color:var(--color-text-1);margin-bottom:8px;text-align:center">Excluir contato</div>
      <p style="font-size:13px;color:var(--color-text-3);text-align:center;line-height:1.6;margin-bottom:28px">
        Tem certeza que deseja excluir <strong style="color:var(--color-text-1)">${contactName}</strong>?<br>
        Esta ação não pode ser desfeita.
      </p>

      <div style="display:flex;flex-direction:column;gap:10px;width:100%">
        <button class="btn btn-secondary" id="btnCancelDeleteContact" style="width:100%;justify-content:center;padding:11px">
          Cancelar
        </button>
        <button class="btn btn-sm" id="btnConfirmDeleteContact"
          style="width:100%;justify-content:center;padding:11px;background:var(--color-red);color:#fff;border-radius:var(--radius-md);font-weight:600;font-size:13px">
          Excluir contato
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(overlay);
  lucide.createIcons();

  document.getElementById('btnCancelDeleteContact')?.addEventListener('click', () => overlay.remove());

  document.getElementById('btnConfirmDeleteContact')?.addEventListener('click', async () => {
    const confirmBtn = document.getElementById('btnConfirmDeleteContact');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Excluindo...';
    try {
      await apiFetch(`/api/contacts/${contactId}`, { method: 'DELETE' });
      overlay.remove();
      const data = await window.loadContacts();
      document.getElementById('pageContent').innerHTML = window.pageContacts(data);
      lucide.createIcons();
      window.initContacts();
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Excluir contato';
      const p = overlay.querySelector('p');
      if (p) p.innerHTML += `<br><span style="color:var(--color-red);font-size:12px">${err.message}</span>`;
    }
  });
}

// ── PAINEL DE OPORTUNIDADES ───────────────────────────────────

function closeOppPanel() {
  document.getElementById('oppPanel')?.remove();
  document.getElementById('oppPanelBackdrop')?.remove();
}

const oppStatusMap = {
  open: { label: 'Aberto',  cls: 'badge-blue'  },
  won:  { label: 'Ganho',   cls: 'badge-black'  },
  lost: { label: 'Perdido', cls: 'badge-gray'   },
};

const fmtBRLContact = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmtShort  = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

function renderOppCards(opps, contactId, contactName) {
  if (!opps.length) {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 0;color:var(--color-text-3)">
        <i data-lucide="filter" style="width:32px;height:32px;opacity:.3"></i>
        <p style="font-size:13px">Nenhuma oportunidade vinculada.</p>
      </div>`;
  }

  return opps.map(opp => {
    const st     = oppStatusMap[opp.status] || oppStatusMap.open;
    const source = opp.custom_fields?.source || '';
    return `
    <div class="card opp-card" data-opp-id="${opp.id}" style="padding:14px 16px;margin-bottom:10px;cursor:default">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div style="min-width:0">
          <button class="btn-opp-goto-funnel" data-pipeline-id="${opp.pipeline_id}" data-opp-id="${opp.id}"
            style="background:none;border:none;padding:0;cursor:pointer;font-size:13px;font-weight:700;color:var(--color-text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;max-width:100%;text-align:left"
            onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'"
            title="Ver no funil">${opp.title}</button>
          <div style="font-size:11px;color:var(--color-text-3);margin-top:2px">
            <span>${opp.pipeline_name}</span>
            <span style="margin:0 4px">›</span>
            <span style="display:inline-flex;align-items:center;gap:4px">
              <span style="width:7px;height:7px;border-radius:50%;background:${opp.stage_color || '#6b7280'};display:inline-block"></span>
              ${opp.stage_name}
            </span>
          </div>
        </div>
        <span class="badge ${st.cls}" style="flex-shrink:0">${st.label}</span>
      </div>

      <div style="font-size:15px;font-weight:700;color:var(--color-text-1);margin-bottom:10px">${fmtBRLContact(opp.value)}</div>

      <div class="opp-details" data-id="${opp.id}" style="display:none;border-top:1px solid var(--color-border);padding-top:10px;margin-bottom:10px;font-size:12px;color:var(--color-text-3);display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div><span style="font-weight:600;color:var(--color-text-2)">Origem:</span> ${source || '—'}</div>
          <div><span style="font-weight:600;color:var(--color-text-2)">Criado:</span> ${dateFmtShort(opp.created_at)}</div>
          ${opp.status === 'lost' && opp.lost_reason ? `<div style="grid-column:1/-1"><span style="font-weight:600;color:var(--color-text-2)">Motivo da perda:</span> ${opp.lost_reason}</div>` : ''}
        </div>
      </div>

      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm btn-opp-details" data-id="${opp.id}"
          style="font-size:11px;padding:4px 10px;flex:1">
          <i data-lucide="eye" style="width:12px;height:12px"></i> Ver detalhes
        </button>
        <button class="btn btn-secondary btn-sm btn-opp-edit"
          data-opp='${JSON.stringify({ id: opp.id, title: opp.title, value: opp.value, status: opp.status, lost_reason: opp.lost_reason || '', pipeline_id: opp.pipeline_id, stage_id: opp.stage_id, custom_fields: opp.custom_fields || {} })}'
          data-contact-id="${contactId}" data-contact-name="${contactName}"
          style="font-size:11px;padding:4px 10px;flex:1">
          <i data-lucide="pencil" style="width:12px;height:12px"></i> Editar
        </button>
      </div>
    </div>`;
  }).join('');
}

function bindOppPanelEvents(opps, contactId, contactName) {
  // Navegar ao funil
  document.querySelectorAll('.btn-opp-goto-funnel').forEach(btn => {
    btn.addEventListener('click', () => {
      window.__openOppInFunnel = { pipeline_id: btn.dataset.pipelineId, opp_id: btn.dataset.oppId };
      closeOppPanel();
      if (typeof navigateTo === 'function') navigateTo('funnels');
    });
  });

  // Toggle detalhes
  document.querySelectorAll('.btn-opp-details').forEach(btn => {
    btn.addEventListener('click', () => {
      const det = document.querySelector(`.opp-details[data-id="${btn.dataset.id}"]`);
      if (!det) return;
      const open = det.style.display !== 'none';
      det.style.display = open ? 'none' : 'block';
      btn.innerHTML = open
        ? '<i data-lucide="eye" style="width:12px;height:12px"></i> Ver detalhes'
        : '<i data-lucide="eye-off" style="width:12px;height:12px"></i> Ocultar';
      lucide.createIcons();
    });
  });

  // Editar oportunidade
  document.querySelectorAll('.btn-opp-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const opp     = JSON.parse(btn.dataset.opp);
      const contact = { id: btn.dataset.contactId, name: btn.dataset.contactName };
      await openOppEditModal(opp, contact);
    });
  });
}

async function openOppPanel(contactId, contactName) {
  closeOppPanel();

  const backdrop = document.createElement('div');
  backdrop.id = 'oppPanelBackdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:1400';
  backdrop.addEventListener('click', closeOppPanel);
  document.body.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.id = 'oppPanel';
  panel.style.cssText = `
    position:fixed;top:0;right:0;height:100vh;width:400px;max-width:92vw;
    background:var(--color-surface);border-left:1px solid var(--color-border);
    box-shadow:-8px 0 32px rgba(0,0,0,.15);z-index:1500;
    display:flex;flex-direction:column;
    animation:slideInRight .22s cubic-bezier(.4,0,.2,1);
  `;
  panel.innerHTML = `
    <style>@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}</style>
    <div style="padding:18px 20px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
      <div>
        <div style="font-size:15px;font-weight:700">${contactName}</div>
        <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">Oportunidades vinculadas</div>
      </div>
      <button id="btnCloseOppPanel" style="background:none;border:none;cursor:pointer;padding:6px;border-radius:8px"
        onmouseover="this.style.background='var(--color-bg-2)'" onmouseout="this.style.background='none'">
        <i data-lucide="x" style="width:18px;height:18px"></i>
      </button>
    </div>
    <div id="oppPanelContent" style="flex:1;overflow-y:auto;padding:16px">
      <div style="display:flex;justify-content:center;padding:40px 0">
        <div style="width:24px;height:24px;border:3px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin .7s linear infinite"></div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  lucide.createIcons();
  document.getElementById('btnCloseOppPanel')?.addEventListener('click', closeOppPanel);

  try {
    const opps = await apiFetch(`/api/contacts/${contactId}/opportunities`);
    const content = document.getElementById('oppPanelContent');
    if (!content) return;
    content.innerHTML = renderOppCards(opps || [], contactId, contactName);
    lucide.createIcons();
    bindOppPanelEvents(opps || [], contactId, contactName);
  } catch (err) {
    const content = document.getElementById('oppPanelContent');
    if (content) content.innerHTML = `<p style="color:var(--color-red);font-size:13px;padding:16px">${err.message}</p>`;
  }
}

async function openOppEditModal(opp, contact) {
  // Carrega pipelines para o formulário
  let pipelines = [];
  try { pipelines = await apiFetch('/api/pipelines') || []; } catch {}

  const curPipelineId = opp.pipeline_id || '';
  let   curStageId    = opp.stage_id    || '';

  function getStages(pid) {
    return pipelines.find(p => p.id === pid)?.stages || [];
  }

  function renderEditModal() {
    const stages    = getStages(curPipelineId);
    const curStatus = opp.status || 'open';
    const curSource = opp.custom_fields?.source || '';

    const overlay = document.getElementById('oppEditOverlay') || (() => {
      const el = document.createElement('div');
      el.id = 'oppEditOverlay';
      el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
      el.addEventListener('click', e => { if (e.target === el) el.remove(); });
      document.body.appendChild(el);
      return el;
    })();

    overlay.innerHTML = `
      <div style="background:var(--color-surface);border-radius:14px;width:540px;max-width:100%;max-height:88vh;overflow-y:auto;box-shadow:0 32px 64px rgba(0,0,0,.25);display:flex;flex-direction:column">

        <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div>
            <div style="font-size:15px;font-weight:700">Editar oportunidade</div>
            <div style="font-size:12px;color:var(--color-text-3);margin-top:3px">${contact.name}</div>
          </div>
          <button id="btnCloseEditOpp" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px">
            <i data-lucide="x" style="width:18px;height:18px"></i>
          </button>
        </div>

        <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;flex:1">

          <div>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">NOME DA OPORTUNIDADE *</label>
            <input type="text" id="eopp_title" value="${opp.title || ''}"
              style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)" />
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">FUNIL *</label>
              <select id="eopp_pipeline" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
                ${pipelines.map(p => `<option value="${p.id}" ${p.id === curPipelineId ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">ETAPA *</label>
              <select id="eopp_stage" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
                ${stages.map(s => `<option value="${s.id}" ${s.id === curStageId ? 'selected' : ''}>${s.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">VALOR (R$)</label>
              <input type="number" id="eopp_value" value="${opp.value || ''}" min="0" step="0.01"
                style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)" />
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">STATUS</label>
              <select id="eopp_status" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
                <option value="open" ${curStatus === 'open' ? 'selected' : ''}>Aberto</option>
                <option value="won"  ${curStatus === 'won'  ? 'selected' : ''}>Ganho</option>
                <option value="lost" ${curStatus === 'lost' ? 'selected' : ''}>Perdido</option>
              </select>
            </div>
          </div>

          <div>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">ORIGEM</label>
            <select id="eopp_source" style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
              <option value="">Não informada</option>
              <option value="whatsapp"  ${curSource === 'whatsapp'  ? 'selected' : ''}>WhatsApp</option>
              <option value="instagram" ${curSource === 'instagram' ? 'selected' : ''}>Instagram</option>
              <option value="site"      ${curSource === 'site'      ? 'selected' : ''}>Site</option>
              <option value="email"     ${curSource === 'email'     ? 'selected' : ''}>E-mail</option>
              <option value="indicacao" ${curSource === 'indicacao' ? 'selected' : ''}>Indicação</option>
              <option value="manual"    ${curSource === 'manual'    ? 'selected' : ''}>Manual</option>
            </select>
          </div>

          <div id="eopp_lostWrap" ${curStatus !== 'lost' ? 'style="display:none"' : ''}>
            <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">MOTIVO DE PERDA</label>
            <textarea id="eopp_lost_reason" rows="2"
              style="width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface);resize:vertical">${opp.lost_reason || ''}</textarea>
          </div>

        </div>

        <div style="padding:14px 22px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-shrink:0">
          <span id="eopp_error" style="font-size:12px;color:var(--color-red);margin-right:auto"></span>
          <button class="btn btn-secondary btn-sm" id="btnCancelEditOpp">Cancelar</button>
          <button class="btn btn-primary btn-sm" id="btnSaveEditOpp">Salvar alterações</button>
        </div>

      </div>`;

    lucide.createIcons();

    document.getElementById('btnCloseEditOpp')?.addEventListener('click', () => overlay.remove());
    document.getElementById('btnCancelEditOpp')?.addEventListener('click', () => overlay.remove());

    document.getElementById('eopp_pipeline')?.addEventListener('change', e => {
      curStageId = '';
      const newStages = getStages(e.target.value);
      const sel = document.getElementById('eopp_stage');
      if (sel) sel.innerHTML = newStages.map(s => `<option value="${s.id}">${s.name}</option>`).join('') || '<option value="">—</option>';
    });

    document.getElementById('eopp_status')?.addEventListener('change', e => {
      document.getElementById('eopp_lostWrap').style.display = e.target.value === 'lost' ? '' : 'none';
    });

    document.getElementById('btnSaveEditOpp')?.addEventListener('click', async () => {
      const title       = document.getElementById('eopp_title').value.trim();
      const pipeline_id = document.getElementById('eopp_pipeline').value;
      const stage_id    = document.getElementById('eopp_stage').value;
      const value       = document.getElementById('eopp_value').value;
      const status      = document.getElementById('eopp_status').value;
      const source      = document.getElementById('eopp_source').value;
      const lost_reason = document.getElementById('eopp_lost_reason')?.value.trim() || null;
      const errEl       = document.getElementById('eopp_error');

      if (!title) { errEl.textContent = 'Nome é obrigatório.'; return; }
      errEl.textContent = '';

      const btn = document.getElementById('btnSaveEditOpp');
      btn.disabled = true; btn.textContent = 'Salvando...';

      try {
        await apiFetch(`/api/opportunities/${opp.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            title, pipeline_id, stage_id,
            value: parseFloat(value) || 0,
            status,
            lost_reason: status === 'lost' ? lost_reason : null,
            custom_fields: source ? { source } : {},
          }),
        });
        overlay.remove();
        // Recarrega o painel com os dados atualizados
        await openOppPanel(contact.id, contact.name);
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false; btn.textContent = 'Salvar alterações';
      }
    });
  }

  renderEditModal();
}
