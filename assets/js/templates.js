// ======================================
// FAVX CRM — Modelos de Mensagens (pastas + modelos)
// ======================================

let _tplFolders   = [];
let _tplTemplates = [];

async function _tplLoad() {
  const [folders, templates] = await Promise.all([
    apiFetch('/api/template-folders').catch(() => []),
    apiFetch('/api/message-templates').catch(() => []),
  ]);
  _tplFolders   = Array.isArray(folders) ? folders : [];
  _tplTemplates = Array.isArray(templates) ? templates : [];
}

function _tplEsc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Codifica um objeto para caber num atributo HTML com aspas duplas.
// O parser do navegador decodifica as entidades ao ler via dataset,
// então basta JSON.parse(el.dataset.x) para recuperar.
function _tplAttr(obj) {
  return JSON.stringify(obj)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── View de gerenciamento (aba "Modelos") ────────────────────

async function renderTemplatesView(container) {
  container.innerHTML = `<div style="padding:48px;display:flex;justify-content:center"><div style="width:24px;height:24px;border:3px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin .7s linear infinite"></div></div>`;
  await _tplLoad();
  _tplRenderList(container);
}

function _tplCardHtml(t) {
  const preview = _tplEsc((t.body || '').slice(0, 120)) + ((t.body || '').length > 120 ? '…' : '');
  const data = _tplAttr(t);
  return `
    <div class="tpl-card" style="border:1px solid var(--color-border);border-radius:10px;padding:12px 14px;background:var(--color-surface)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--color-text-1)">${_tplEsc(t.name)}</div>
          ${t.header_content ? `<div style="font-size:11px;color:var(--color-text-2);font-weight:600;margin-top:3px">${_tplEsc(t.header_content)}</div>` : ''}
          <div style="font-size:12px;color:var(--color-text-3);margin-top:4px;white-space:pre-wrap;line-height:1.5">${preview}</div>
        </div>
        <div style="display:flex;gap:2px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm tpl-edit" data-tpl="${data}" style="padding:5px" title="Editar"><i data-lucide="pencil" style="width:13px;height:13px"></i></button>
          <button class="btn btn-ghost btn-sm tpl-del" data-id="${t.id}" data-name="${_tplEsc(t.name)}" style="padding:5px" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px;color:var(--color-red)"></i></button>
        </div>
      </div>
    </div>`;
}

function _tplRenderList(container) {
  const byFolder = id => _tplTemplates.filter(t => (t.folder_id || null) === id);
  const loose = byFolder(null);
  const isEmpty = _tplTemplates.length === 0 && _tplFolders.length === 0;

  // Estado totalmente vazio (sem modelos e sem pastas)
  if (isEmpty) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;min-height:60vh;text-align:center;color:var(--color-text-3)">
        <i data-lucide="file-text" style="width:48px;height:48px;opacity:.25"></i>
        <div style="font-size:15px;font-weight:600;color:var(--color-text-2)">Você ainda não tem modelos</div>
        <button class="btn btn-primary btn-sm" id="tplEmptyCreate"><i data-lucide="plus" style="width:14px;height:14px"></i> Criar modelo</button>
      </div>`;
    lucide.createIcons();
    document.getElementById('tplEmptyCreate')?.addEventListener('click', () => _tplOpenTemplateModal(null, container));
    return;
  }

  let looseSection = '';
  if (loose.length) {
    looseSection = `
      ${_tplFolders.length ? `<div style="font-size:11px;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Sem pasta</div>` : ''}
      <div class="tpl-grid">${loose.map(_tplCardHtml).join('')}</div>`;
  }

  const folderBlocks = _tplFolders.map(f => {
    const items = byFolder(f.id);
    return `
      <div class="tpl-folder" style="border:1px solid var(--color-border);border-radius:12px;overflow:hidden;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--color-bg-2)">
          <i data-lucide="folder" style="width:16px;height:16px;color:var(--color-accent)"></i>
          <span style="font-size:13px;font-weight:700;color:var(--color-text-1);flex:1">${_tplEsc(f.name)}</span>
          <span style="font-size:11px;color:var(--color-text-3)">${items.length} modelo${items.length !== 1 ? 's' : ''}</span>
          <button class="btn btn-ghost btn-sm tpl-folder-rename" data-id="${f.id}" data-name="${_tplEsc(f.name)}" style="padding:4px" title="Renomear pasta"><i data-lucide="pencil" style="width:13px;height:13px"></i></button>
          <button class="btn btn-ghost btn-sm tpl-folder-del" data-id="${f.id}" data-name="${_tplEsc(f.name)}" style="padding:4px" title="Excluir pasta"><i data-lucide="trash-2" style="width:13px;height:13px;color:var(--color-red)"></i></button>
        </div>
        <div style="padding:12px 14px">
          ${items.length ? `<div class="tpl-grid">${items.map(_tplCardHtml).join('')}</div>` : `<div style="font-size:12px;color:var(--color-text-3)">Nenhum modelo nesta pasta.</div>`}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <button class="btn btn-secondary btn-sm" id="tplNewFolder"><i data-lucide="folder-plus" style="width:14px;height:14px"></i> Pasta</button>
      <button class="btn btn-primary btn-sm" id="tplNewTemplate"><i data-lucide="plus" style="width:14px;height:14px"></i> Modelo</button>
      <span style="font-size:12px;color:var(--color-text-3);margin-left:auto">${_tplTemplates.length} modelo${_tplTemplates.length !== 1 ? 's' : ''} · ${_tplFolders.length} pasta${_tplFolders.length !== 1 ? 's' : ''}</span>
    </div>

    ${folderBlocks}

    <div style="margin-top:4px">${looseSection}</div>
  `;
  lucide.createIcons();
  _tplBindList(container);
}

function _tplBindList(container) {
  document.getElementById('tplNewFolder')?.addEventListener('click', () => _tplOpenFolderModal(null, container));
  document.getElementById('tplNewTemplate')?.addEventListener('click', () => _tplOpenTemplateModal(null, container));

  container.querySelectorAll('.tpl-folder-rename').forEach(btn =>
    btn.addEventListener('click', () => _tplOpenFolderModal({ id: btn.dataset.id, name: btn.dataset.name }, container)));

  container.querySelectorAll('.tpl-folder-del').forEach(btn =>
    btn.addEventListener('click', () => {
      showConfirmModal({
        title: 'Excluir pasta',
        message: `Excluir a pasta "${btn.dataset.name}"? Os modelos dela não serão apagados — ficarão em "Sem pasta".`,
        confirmLabel: 'Excluir',
        onConfirm: async () => {
          await apiFetch(`/api/template-folders/${btn.dataset.id}`, { method: 'DELETE' });
          await _tplLoad();
          _tplRenderList(container);
        },
      });
    }));

  container.querySelectorAll('.tpl-edit').forEach(btn =>
    btn.addEventListener('click', () => _tplOpenTemplateModal(JSON.parse(btn.dataset.tpl), container)));

  container.querySelectorAll('.tpl-del').forEach(btn =>
    btn.addEventListener('click', () => {
      showConfirmModal({
        title: 'Excluir modelo',
        message: `Excluir o modelo "${btn.dataset.name}"?`,
        confirmLabel: 'Excluir',
        onConfirm: async () => {
          await apiFetch(`/api/message-templates/${btn.dataset.id}`, { method: 'DELETE' });
          await _tplLoad();
          _tplRenderList(container);
        },
      });
    }));
}

// ── Modal de pasta ───────────────────────────────────────────

function _tplOpenFolderModal(existing, container) {
  document.getElementById('tplFolderModal')?.remove();
  const isEdit = !!existing;
  const overlay = document.createElement('div');
  overlay.id = 'tplFolderModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:14px;width:400px;max-width:100%;box-shadow:0 32px 64px rgba(0,0,0,.25)">
      <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);font-size:15px;font-weight:700">${isEdit ? 'Renomear pasta' : 'Nova pasta'}</div>
      <div style="padding:20px 22px">
        <label class="settings-label">NOME DA PASTA *</label>
        <input id="tplFolderName" class="settings-input" placeholder="Ex: Saudações" value="${_tplEsc(existing?.name || '')}" />
        <span id="tplFolderErr" style="font-size:12px;color:var(--color-red);display:block;min-height:16px;margin-top:6px"></span>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-secondary btn-sm" id="tplFolderCancel">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="tplFolderSave">${isEdit ? 'Salvar' : 'Criar pasta'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#tplFolderName');
  input.focus();
  overlay.querySelector('#tplFolderCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#tplFolderSave').addEventListener('click', async () => {
    const name = input.value.trim();
    const err  = overlay.querySelector('#tplFolderErr');
    if (!name) { err.textContent = 'Nome é obrigatório.'; return; }
    const btn = overlay.querySelector('#tplFolderSave');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      if (isEdit) await apiFetch(`/api/template-folders/${existing.id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      else        await apiFetch('/api/template-folders', { method: 'POST', body: JSON.stringify({ name }) });
      overlay.remove();
      await _tplLoad();
      _tplRenderList(container);
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = isEdit ? 'Salvar' : 'Criar pasta'; }
  });
}

// ── Modal de modelo ──────────────────────────────────────────

function _tplOpenTemplateModal(existing, container) {
  document.getElementById('tplModal')?.remove();
  const isEdit = !!existing;
  const overlay = document.createElement('div');
  overlay.id = 'tplModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:14px;width:520px;max-width:100%;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 32px 64px rgba(0,0,0,.25)">
      <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);font-size:15px;font-weight:700">${isEdit ? 'Editar modelo' : 'Novo modelo'}</div>
      <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;overflow-y:auto">
        <div>
          <label class="settings-label">NOME DO MODELO *</label>
          <input id="tplName" class="settings-input" placeholder="Ex: Boas-vindas" value="${_tplEsc(existing?.name || '')}" />
        </div>
        <div>
          <label class="settings-label">PASTA</label>
          <select id="tplFolder" class="settings-input">
            <option value="">Sem pasta</option>
            ${_tplFolders.map(f => `<option value="${f.id}" ${existing?.folder_id === f.id ? 'selected' : ''}>${_tplEsc(f.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="settings-label">CABEÇALHO <span style="color:var(--color-text-3);font-weight:400">(opcional)</span></label>
          <input id="tplHeader" class="settings-input" placeholder="Ex: 👋 Olá!" value="${_tplEsc(existing?.header_content || '')}" />
        </div>
        <div>
          <label class="settings-label">CORPO DA MENSAGEM *</label>
          <textarea id="tplBody" class="settings-input" rows="6" style="resize:vertical;line-height:1.6" placeholder="Escreva o conteúdo da mensagem...">${_tplEsc(existing?.body || '')}</textarea>
        </div>
        <span id="tplErr" style="font-size:12px;color:var(--color-red);min-height:16px"></span>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-secondary btn-sm" id="tplCancel">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="tplSave">${isEdit ? 'Salvar' : 'Criar modelo'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#tplName').focus();
  overlay.querySelector('#tplCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#tplSave').addEventListener('click', async () => {
    const name   = overlay.querySelector('#tplName').value.trim();
    const body   = overlay.querySelector('#tplBody').value.trim();
    const header = overlay.querySelector('#tplHeader').value.trim();
    const folder = overlay.querySelector('#tplFolder').value || null;
    const err    = overlay.querySelector('#tplErr');
    if (!name) { err.textContent = 'Nome do modelo é obrigatório.'; return; }
    if (!body) { err.textContent = 'Corpo da mensagem é obrigatório.'; return; }
    const btn = overlay.querySelector('#tplSave');
    btn.disabled = true; btn.textContent = 'Salvando...';
    const payload = { name, body, header_content: header, folder_id: folder };
    try {
      if (isEdit) await apiFetch(`/api/message-templates/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else        await apiFetch('/api/message-templates', { method: 'POST', body: JSON.stringify(payload) });
      overlay.remove();
      await _tplLoad();
      _tplRenderList(container);
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = isEdit ? 'Salvar' : 'Criar modelo'; }
  });
}

// ── Picker (inserção rápida no chat) ─────────────────────────

async function openTemplatePicker(onPick) {
  document.getElementById('tplPicker')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'tplPicker';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:14px;width:460px;max-width:100%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 32px 64px rgba(0,0,0,.25)">
      <div style="padding:16px 20px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:15px;font-weight:700">Inserir modelo</div>
        <button id="tplPickerClose" style="background:none;border:none;cursor:pointer;padding:4px"><i data-lucide="x" style="width:18px;height:18px"></i></button>
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid var(--color-border)">
        <div class="search-wrapper" style="min-width:unset">
          <i data-lucide="search"></i>
          <input type="text" id="tplPickerSearch" placeholder="Buscar modelo..." />
        </div>
      </div>
      <div id="tplPickerList" style="overflow-y:auto;padding:8px"></div>
    </div>`;
  document.body.appendChild(overlay);
  lucide.createIcons();
  overlay.querySelector('#tplPickerClose').addEventListener('click', () => overlay.remove());

  const listEl = overlay.querySelector('#tplPickerList');
  listEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--color-text-3);font-size:13px">Carregando...</div>`;
  await _tplLoad();

  const folderName = id => _tplFolders.find(f => f.id === id)?.name || null;

  function renderPicker(q = '') {
    const term = q.trim().toLowerCase();
    const items = _tplTemplates.filter(t =>
      !term || t.name.toLowerCase().includes(term) || (t.body || '').toLowerCase().includes(term));
    if (!items.length) {
      listEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--color-text-3);font-size:13px">${_tplTemplates.length ? 'Nenhum modelo encontrado.' : 'Nenhum modelo cadastrado. Crie modelos na aba "Modelos".'}</div>`;
      return;
    }
    listEl.innerHTML = items.map(t => {
      const fn = folderName(t.folder_id);
      const preview = _tplEsc((t.body || '').slice(0, 90)) + ((t.body || '').length > 90 ? '…' : '');
      return `
        <button class="tpl-pick-item" data-id="${t.id}" style="display:block;width:100%;text-align:left;border:none;background:none;cursor:pointer;padding:10px 12px;border-radius:8px"
          onmouseover="this.style.background='var(--color-bg-2)'" onmouseout="this.style.background='none'">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:13px;font-weight:700;color:var(--color-text-1)">${_tplEsc(t.name)}</span>
            ${fn ? `<span style="font-size:10px;color:var(--color-text-3);background:var(--color-bg-2);padding:1px 6px;border-radius:6px">${_tplEsc(fn)}</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--color-text-3);margin-top:3px;white-space:pre-wrap;line-height:1.4">${preview}</div>
        </button>`;
    }).join('');
    listEl.querySelectorAll('.tpl-pick-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpl = _tplTemplates.find(t => t.id === btn.dataset.id);
        overlay.remove();
        if (tpl) onPick(tpl);
      });
    });
  }
  renderPicker();

  const search = overlay.querySelector('#tplPickerSearch');
  search.focus();
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => renderPicker(search.value), 150); });
}

window.renderTemplatesView = renderTemplatesView;
window.openTemplatePicker  = openTemplatePicker;
