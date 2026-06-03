// ======================================
// FAVX CRM — Página de Subcontas
// ======================================

window.loadSubaccounts = async function () {
  return apiFetch('/api/subaccounts');
};

window.pageSubaccounts = function (data) {
  const list  = data || [];
  const token = localStorage.getItem('favx_token') || sessionStorage.getItem('favx_token');
  const user  = token ? JSON.parse(atob(token.split('.')[1])) : {};
  const isAdmin = ['super_admin', 'admin'].includes(user.role);
  const currentSubId = user.subaccount_id;

  const statusBadge = active =>
    active
      ? `<span class="badge badge-black">Ativa</span>`
      : `<span class="badge badge-gray">Inativa</span>`;

  const cards = list.map(s => `
    <div class="card" style="padding:20px;display:flex;flex-direction:column;gap:12px;position:relative">
      ${s.id === currentSubId ? `<div style="position:absolute;top:12px;right:12px;font-size:11px;font-weight:600;background:var(--color-accent);color:#fff;padding:2px 8px;border-radius:99px">Atual</div>` : ''}
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:10px;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0">
          ${s.name[0].toUpperCase()}
        </div>
        <div>
          <div style="font-weight:700;font-size:14px;color:var(--color-text-1)">${s.name}</div>
          <div style="font-size:12px;color:var(--color-text-3);margin-top:1px">/${s.slug}</div>
        </div>
      </div>
      <div style="display:flex;gap:16px;font-size:12px;color:var(--color-text-3)">
        <span><b style="color:var(--color-text-1)">${s.contact_count ?? 0}</b> contatos</span>
        <span><b style="color:var(--color-text-1)">${s.user_count ?? 0}</b> usuários</span>
        <span>${statusBadge(s.is_active)}</span>
      </div>
      <div style="font-size:11px;color:var(--color-text-3)">Criada em ${new Date(s.created_at).toLocaleDateString('pt-BR')}</div>
      <div style="display:flex;gap:8px;margin-top:4px">
        ${s.id !== currentSubId ? `<button class="btn btn-primary btn-sm btn-switch-sub" data-id="${s.id}" data-name="${s.name}">Acessar</button>` : ''}
        ${isAdmin ? `
          <button class="btn btn-secondary btn-sm btn-edit-sub"
            data-id="${s.id}" data-name="${s.name}"
            data-timezone="${s.timezone}" data-active="${s.is_active}">Editar</button>
          <button class="btn btn-ghost btn-sm btn-delete-sub" data-id="${s.id}" style="margin-left:auto">
            <i data-lucide="trash-2" style="width:14px;height:14px;color:var(--color-red)"></i>
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');

  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Subcontas</h1>
      <p class="page-subtitle">${list.length} subconta${list.length !== 1 ? 's' : ''} na sua conta</p>
    </div>
    ${isAdmin ? `<button class="btn btn-primary btn-sm" id="btnNewSubaccount"><i data-lucide="plus" style="width:14px;height:14px"></i> Nova Subconta</button>` : ''}
  </div>

  <!-- FORM NOVA / EDITAR SUBCONTA -->
  <div id="subaccountPanel" hidden style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:20px;margin-bottom:16px">
    <h3 style="font-size:14px;font-weight:700;margin-bottom:14px" id="subaccountPanelTitle">Nova Subconta</h3>
    <input type="hidden" id="sa_id" />
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0">
        <label>Nome *</label>
        <input type="text" id="sa_name" placeholder="Ex: Cliente ACME" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px" />
      </div>
      <div class="form-group" style="margin:0">
        <label>Slug *</label>
        <input type="text" id="sa_slug" placeholder="ex: cliente-acme" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px" />
      </div>
      <div class="form-group" style="margin:0">
        <label>Fuso horário</label>
        <select id="sa_timezone" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)">
          <option value="America/Sao_Paulo">America/Sao_Paulo</option>
          <option value="America/Manaus">America/Manaus</option>
          <option value="America/Belem">America/Belem</option>
          <option value="America/Fortaleza">America/Fortaleza</option>
          <option value="America/Noronha">America/Noronha</option>
          <option value="UTC">UTC</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn btn-primary btn-sm" id="btnSaveSubaccount">Salvar</button>
      <button class="btn btn-secondary btn-sm" id="btnCancelSubaccount">Cancelar</button>
      <span id="subaccountFormError" style="font-size:12px;color:var(--color-red);align-self:center"></span>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
    ${list.length === 0
      ? `<div style="color:var(--color-text-3);font-size:13px;grid-column:1/-1">Nenhuma subconta encontrada.</div>`
      : cards}
  </div>
  `;
};

window.initSubaccounts = function (data) {
  const token   = localStorage.getItem('favx_token') || sessionStorage.getItem('favx_token');
  const user    = token ? JSON.parse(atob(token.split('.')[1])) : {};
  const isAdmin = ['super_admin', 'admin'].includes(user.role);

  const reload = async () => {
    const d = await window.loadSubaccounts();
    document.getElementById('pageContent').innerHTML = window.pageSubaccounts(d);
    lucide.createIcons();
    window.initSubaccounts(d);
  };

  const openPanel = (title, id = '', name = '', timezone = 'America/Sao_Paulo') => {
    document.getElementById('subaccountPanelTitle').textContent = title;
    document.getElementById('sa_id').value       = id;
    document.getElementById('sa_name').value     = name;
    document.getElementById('sa_slug').value     = id ? '' : '';
    document.getElementById('sa_timezone').value = timezone;
    document.getElementById('subaccountFormError').textContent = '';

    const slugInput = document.getElementById('sa_slug');
    slugInput.disabled = !!id;
    slugInput.style.opacity = id ? '0.5' : '1';

    document.getElementById('subaccountPanel').hidden = false;
  };

  document.getElementById('btnNewSubaccount')?.addEventListener('click', () => {
    window.openSubaccountWizard(reload);
  });

  document.getElementById('btnCancelSubaccount')?.addEventListener('click', () => {
    document.getElementById('subaccountPanel').hidden = true;
  });

  document.getElementById('sa_name')?.addEventListener('input', e => {
    const slugInput = document.getElementById('sa_slug');
    if (!document.getElementById('sa_id').value) {
      slugInput.value = e.target.value.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
  });

  document.getElementById('btnSaveSubaccount')?.addEventListener('click', async () => {
    const id       = document.getElementById('sa_id').value;
    const name     = document.getElementById('sa_name').value.trim();
    const slug     = document.getElementById('sa_slug').value.trim();
    const timezone = document.getElementById('sa_timezone').value;
    const errEl    = document.getElementById('subaccountFormError');

    if (!name) { errEl.textContent = 'Nome é obrigatório.'; return; }
    if (!id && !slug) { errEl.textContent = 'Slug é obrigatório.'; return; }
    errEl.textContent = '';

    try {
      if (id) {
        await apiFetch(`/api/subaccounts/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, timezone }),
        });
      } else {
        await apiFetch('/api/subaccounts', {
          method: 'POST',
          body: JSON.stringify({ name, slug, timezone }),
        });
      }
      await reload();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.querySelectorAll('.btn-edit-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      openPanel('Editar Subconta', btn.dataset.id, btn.dataset.name, btn.dataset.timezone);
    });
  });

  document.querySelectorAll('.btn-delete-sub').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta subconta? Todos os dados serão removidos permanentemente.')) return;
      try {
        await apiFetch(`/api/subaccounts/${btn.dataset.id}`, { method: 'DELETE' });
        await reload();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  document.querySelectorAll('.btn-switch-sub').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const res = await apiFetch('/api/subaccounts/switch', {
          method: 'POST',
          body: JSON.stringify({ subaccount_id: btn.dataset.id }),
        });
        const storage = localStorage.getItem('favx_token') ? localStorage : sessionStorage;
        storage.setItem('favx_token', res.token);
        localStorage.setItem('favx_subaccount', JSON.stringify(res.subaccount));
        window.updateSubaccountSwitcher(res.subaccount);
        await reload();
      } catch (err) {
        alert(err.message);
      }
    });
  });
};
