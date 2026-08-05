// ======================================
// FAVX CRM — Documentos
// ======================================

let docsState = {
  folderId: null,
  search: '',
  data: { breadcrumb: [], folders: [], documents: [], can_manage: false },
  allFolders: [],
};

// Delegado no documento: a bandeja é redesenhada a cada atualização da lista,
// então um listener preso ao botão se perderia.
document.addEventListener('click', e => {
  if (!e.target.closest?.('.doc-tray-close')) return;
  const tray = document.getElementById('docUploadTray');
  if (tray) { tray.innerHTML = ''; tray.hidden = true; }
});

function _docEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _docSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function _docDate(d) {
  return d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

// A extensão é mais confiável que o mime type aqui: navegadores devolvem
// vazio ou application/octet-stream para vários formatos do Office.
function _docKind(name, mime = '') {
  const ext = (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf')            return { key: 'pdf',   icon: 'file-type-2',    color: '#dc2626', label: 'PDF' };
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext))            return { key: 'word',  icon: 'file-text',      color: '#2563eb', label: 'Word' };
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext))            return { key: 'sheet', icon: 'file-spreadsheet', color: '#16a34a', label: 'Planilha' };
  if (['ppt', 'pptx', 'odp'].includes(ext))                   return { key: 'slide', icon: 'presentation',   color: '#ea580c', label: 'Apresentação' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return { key: 'image', icon: 'file-image', color: '#7c3aed', label: 'Imagem' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))        return { key: 'zip',   icon: 'file-archive',   color: '#6b7280', label: 'Compactado' };
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext))     return { key: 'video', icon: 'file-video',     color: '#0891b2', label: 'Vídeo' };
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext))             return { key: 'audio', icon: 'file-audio',     color: '#0891b2', label: 'Áudio' };
  if (['txt', 'md', 'log'].includes(ext))                     return { key: 'text',  icon: 'file-text',      color: '#6b7280', label: 'Texto' };
  return { key: 'file', icon: 'file', color: '#6b7280', label: ext ? ext.toUpperCase() : 'Arquivo' };
}

// Só PDF e imagem abrem dentro do CRM. Word e planilha não têm visualizador
// nativo no navegador — para esses, a ação é baixar.
function _docCanPreview(kind) {
  return kind.key === 'pdf' || kind.key === 'image';
}

window.loadDocuments = async function() {
  const fetchLevel = async () => {
    const params = new URLSearchParams();
    if (docsState.folderId) params.set('folder_id', docsState.folderId);
    if (docsState.search)   params.set('search', docsState.search);
    return apiFetch(`/api/documents?${params}`);
  };

  let data;
  try {
    data = await fetchLevel();
  } catch (err) {
    // A pasta guardada pode ter sido apagada, ou pertencer à subconta anterior
    // depois de uma troca. Nesses casos volta para a raiz em vez de travar.
    if (!docsState.folderId) throw err;
    docsState.folderId = null;
    data = await fetchLevel();
  }

  docsState.data = data || docsState.data;
  docsState.allFolders = await apiFetch('/api/document-folders').catch(() => []);
  return docsState.data;
};

window.pageDocuments = function(data) {
  const d          = data || docsState.data;
  const folders    = d.folders || [];
  const documents  = d.documents || [];
  const breadcrumb = d.breadcrumb || [];
  const searching  = Boolean(docsState.search);
  const totalSize  = documents.reduce((a, x) => a + Number(x.size_bytes || 0), 0);

  const trail = `
    <div class="doc-trail">
      <button class="doc-crumb" data-folder="">
        <i data-lucide="hard-drive" style="width:14px;height:14px"></i> Todos os documentos
      </button>
      ${breadcrumb.map(b => `
        <i data-lucide="chevron-right" class="doc-crumb-sep"></i>
        <button class="doc-crumb" data-folder="${b.id}">${_docEsc(b.name)}</button>
      `).join('')}
    </div>`;

  const folderCards = folders.map(f => `
    <div class="doc-card doc-card-folder" data-folder="${f.id}">
      <div class="doc-card-icon" style="color:#f59e0b">
        <i data-lucide="folder"></i>
      </div>
      <div class="doc-card-body">
        <div class="doc-card-name" title="${_docEsc(f.name)}">${_docEsc(f.name)}</div>
        <div class="doc-card-meta">
          ${Number(f.folder_count) ? `${f.folder_count} pasta${Number(f.folder_count) > 1 ? 's' : ''} · ` : ''}${f.file_count} arquivo${Number(f.file_count) !== 1 ? 's' : ''}
        </div>
      </div>
      <button class="doc-kebab" data-kind="folder" data-id="${f.id}" data-name="${_docEsc(f.name)}" title="Opções">
        <i data-lucide="more-vertical"></i>
      </button>
    </div>`).join('');

  const fileCards = documents.map(x => {
    const k = _docKind(x.name, x.mime_type);
    const assigned = Array.isArray(x.assigned_users) ? x.assigned_users : [];
    const badge = x.visibility === 'restricted'
      ? `<span class="doc-badge doc-badge-lock" title="${assigned.length ? 'Liberado para: ' + _docEsc(assigned.map(u => u.name).join(', ')) : 'Sem usuários atribuídos'}">
           <i data-lucide="lock" style="width:11px;height:11px"></i>
           ${assigned.length ? assigned.length + ' usuário' + (assigned.length > 1 ? 's' : '') : 'Restrito'}
         </span>`
      : '';
    return `
    <div class="doc-card doc-card-file" data-doc="${x.id}" data-name="${_docEsc(x.name)}">
      <div class="doc-card-icon" style="color:${k.color}">
        <i data-lucide="${k.icon}"></i>
      </div>
      <div class="doc-card-body">
        <div class="doc-card-name" title="${_docEsc(x.name)}">${_docEsc(x.name)}</div>
        <div class="doc-card-meta">
          ${k.label} · ${_docSize(x.size_bytes)} · ${_docDate(x.created_at)}
          ${x.created_by_name ? ' · ' + _docEsc(x.created_by_name) : ''}
        </div>
        ${badge}
      </div>
      <button class="doc-kebab" data-kind="file" data-id="${x.id}" data-name="${_docEsc(x.name)}" title="Opções">
        <i data-lucide="more-vertical"></i>
      </button>
    </div>`;
  }).join('');

  const empty = (!folders.length && !documents.length) ? `
    <div class="doc-empty">
      <i data-lucide="${searching ? 'search-x' : 'folder-open'}"></i>
      <div class="doc-empty-title">${searching ? 'Nada encontrado' : 'Esta pasta está vazia'}</div>
      <div class="doc-empty-sub">${searching
        ? 'Nenhuma pasta ou documento com esse nome.'
        : d.storage_ready === false
          ? 'Crie pastas normalmente. O envio de arquivos volta assim que o armazenamento for configurado no servidor.'
          : 'Arraste arquivos para cá ou use o botão Enviar arquivos. PDF, Word, Excel, PowerPoint, imagens e outros.'}</div>
    </div>` : '';

  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Documentos</h1>
      <p class="page-subtitle">
        ${folders.length} pasta${folders.length !== 1 ? 's' : ''} ·
        ${documents.length} arquivo${documents.length !== 1 ? 's' : ''}${totalSize ? ' · ' + _docSize(totalSize) : ''}
      </p>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary btn-sm" id="btnNewFolder">
        <i data-lucide="folder-plus" style="width:14px;height:14px"></i> Nova pasta
      </button>
      <button class="btn btn-primary btn-sm" id="btnUploadDoc"
        ${d.storage_ready === false ? 'disabled title="Armazenamento não configurado no servidor."' : ''}>
        <i data-lucide="upload" style="width:14px;height:14px"></i> Enviar arquivos
      </button>
    </div>
  </div>

  <input type="file" id="docFileInput" multiple hidden />

  ${d.storage_ready === false ? `
  <div class="doc-warn">
    <i data-lucide="alert-triangle"></i>
    <div>
      <strong>O envio de arquivos está desligado.</strong>
      O armazenamento não foi configurado no servidor. Pastas funcionam normalmente, mas nenhum
      arquivo pode ser enviado até que as variáveis <code>SUPABASE_URL</code> e
      <code>SUPABASE_SERVICE_ROLE_KEY</code> sejam definidas no ambiente e o projeto redeployado.
    </div>
  </div>` : ''}

  <div class="card" style="padding:0">
    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--color-border);flex-wrap:wrap">
      <div class="search-wrapper" style="min-width:unset;flex:1;max-width:320px">
        <i data-lucide="search"></i>
        <input type="text" id="docSearch" placeholder="Buscar em todos os documentos..." value="${_docEsc(docsState.search)}" />
      </div>
      ${searching ? `<button class="btn btn-ghost btn-sm" id="btnClearDocSearch">Limpar busca</button>` : trail}
    </div>

    <div class="doc-dropzone" id="docDropzone">
      <div class="doc-grid">
        ${empty}
        ${folderCards}
        ${fileCards}
      </div>
      <div class="doc-drop-overlay" id="docDropOverlay">
        <i data-lucide="upload-cloud"></i>
        <span>Solte os arquivos para enviar</span>
      </div>
    </div>
  </div>

  <div id="docUploadTray" class="doc-tray" hidden></div>
  `;
};

window.initDocuments = function() {
  const grid = document.getElementById('docDropzone');
  if (!grid) return;

  const go = async (folderId) => {
    docsState.folderId = folderId || null;
    docsState.search = '';
    await _docsRefresh();
  };

  document.querySelectorAll('.doc-crumb').forEach(el => {
    el.addEventListener('click', () => go(el.dataset.folder));
  });

  grid.querySelectorAll('.doc-card-folder').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.doc-kebab')) return;
      go(el.dataset.folder);
    });
  });

  grid.querySelectorAll('.doc-card-file').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.doc-kebab')) return;
      _docOpen(el.dataset.doc, el.dataset.name);
    });
  });

  grid.querySelectorAll('.doc-kebab').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      _docMenu(el, el.dataset.kind, el.dataset.id, el.dataset.name);
    });
  });

  // ---- Busca ----
  const search = document.getElementById('docSearch');
  let searchTimer;
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      docsState.search = search.value.trim();
      await _docsRefresh({ keepFocus: true });
    }, 350);
  });
  document.getElementById('btnClearDocSearch')?.addEventListener('click', async () => {
    docsState.search = '';
    await _docsRefresh();
  });

  // ---- Nova pasta ----
  document.getElementById('btnNewFolder')?.addEventListener('click', _docNewFolder);

  // ---- Upload ----
  const input = document.getElementById('docFileInput');
  document.getElementById('btnUploadDoc')?.addEventListener('click', () => input.click());
  input?.addEventListener('change', () => {
    if (input.files?.length) _docUpload(Array.from(input.files));
    input.value = '';
  });

  // ---- Arrastar e soltar ----
  const overlay = document.getElementById('docDropOverlay');
  let dragDepth = 0;
  grid.addEventListener('dragenter', e => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('active');
  });
  grid.addEventListener('dragover', e => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  });
  grid.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('active'); }
  });
  grid.addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    if (docsState.data?.storage_ready === false) { e.preventDefault(); dragDepth = 0; overlay.classList.remove('active'); return; }
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('active');
    _docUpload(Array.from(e.dataTransfer.files));
  });
};

// Recarrega e redesenha a página sem passar pelo roteador, para não perder
// a bandeja de uploads em andamento.
async function _docsRefresh({ keepFocus = false } = {}) {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const tray = document.getElementById('docUploadTray');
  const trayHtml = tray && !tray.hidden ? tray.innerHTML : null;
  try {
    const data = await window.loadDocuments();
    content.innerHTML = window.pageDocuments(data);
    lucide.createIcons();
    window.initDocuments();
    if (trayHtml) {
      const t = document.getElementById('docUploadTray');
      t.innerHTML = trayHtml;
      t.hidden = false;
      lucide.createIcons();
    }
    if (keepFocus) {
      const s = document.getElementById('docSearch');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
  } catch (err) {
    console.error('[documents] refresh:', err.message);
  }
}

// ============================================================
// UPLOAD
// ============================================================

function _docTrayRow(id, name) {
  const tray = document.getElementById('docUploadTray');
  tray.hidden = false;
  if (!tray.querySelector('.doc-tray-head')) {
    const head = document.createElement('div');
    head.className = 'doc-tray-head';
    head.innerHTML = `<span>Enviando arquivos</span>
      <button class="doc-tray-close" title="Fechar"><i data-lucide="x"></i></button>`;
    tray.appendChild(head);
  }
  const row = document.createElement('div');
  row.className = 'doc-tray-row';
  row.id = `up_${id}`;
  row.innerHTML = `
    <i data-lucide="file-up" style="width:15px;height:15px;color:var(--color-text-3);flex:none"></i>
    <div style="flex:1;min-width:0">
      <div class="doc-tray-name">${_docEsc(name)}</div>
      <div class="doc-tray-bar"><span style="width:0%"></span></div>
    </div>
    <span class="doc-tray-pct">0%</span>`;
  tray.appendChild(row);
  lucide.createIcons();
  return row;
}

function _docTrayDone(row, ok, msg) {
  row.querySelector('.doc-tray-pct').textContent = ok ? 'Enviado' : 'Falhou';
  row.querySelector('.doc-tray-pct').style.color = ok ? 'var(--color-green)' : 'var(--color-red)';
  row.querySelector('.doc-tray-bar span').style.background = ok ? 'var(--color-green)' : 'var(--color-red)';

  if (!ok && msg) {
    // O motivo da falha tem que ficar na tela. Escondê-lo num tooltip fez um
    // upload bloqueado por configuração parecer um defeito sem explicação.
    const bar = row.querySelector('.doc-tray-bar');
    const err = document.createElement('div');
    err.className = 'doc-tray-err';
    err.textContent = msg;
    bar.replaceWith(err);
  }

  // A linha com erro fica até o usuário fechar a bandeja; só as bem-sucedidas
  // somem sozinhas.
  if (!ok) return;
  setTimeout(() => {
    row.remove();
    const tray = document.getElementById('docUploadTray');
    if (tray && !tray.querySelector('.doc-tray-row')) tray.hidden = true;
  }, 2000);
}

// O PUT vai direto do navegador para o Supabase Storage com uma URL assinada
// pelo servidor. XHR em vez de fetch por causa do progresso de upload.
function _docPutFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`Envio recusado pelo armazenamento (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error('Falha de rede durante o envio.'));
    xhr.send(file);
  });
}

async function _docUpload(files) {
  const folderId = docsState.folderId;
  let anyOk = false;

  for (const file of files) {
    const rowId = Math.random().toString(36).slice(2);
    const row   = _docTrayRow(rowId, file.name);
    try {
      const prep = await apiFetch('/api/documents/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          folder_id: folderId,
          size_bytes: file.size,
          mime_type: file.type || 'application/octet-stream',
        }),
      });
      await _docPutFile(prep.upload_url, file, pct => {
        row.querySelector('.doc-tray-bar span').style.width = pct + '%';
        row.querySelector('.doc-tray-pct').textContent = pct + '%';
      });
      await apiFetch(`/api/documents/${prep.document_id}/confirm`, { method: 'POST' });
      _docTrayDone(row, true);
      anyOk = true;
    } catch (err) {
      console.error('[documents] upload:', err.message);
      _docTrayDone(row, false, err.message);
    }
  }

  if (anyOk) await _docsRefresh();
}

// ============================================================
// AÇÕES
// ============================================================

async function _docOpen(id, name) {
  const kind = _docKind(name);
  try {
    const link = await apiFetch(`/api/documents/${id}/link${_docCanPreview(kind) ? '' : '?download=1'}`);
    if (_docCanPreview(kind)) _docPreviewModal(link.url, name, kind);
    else window.open(link.url, '_blank');
  } catch (err) {
    alert(err.message);
  }
}

async function _docDownload(id) {
  try {
    const link = await apiFetch(`/api/documents/${id}/link?download=1`);
    window.open(link.url, '_blank');
  } catch (err) {
    alert(err.message);
  }
}

function _docPreviewModal(url, name, kind) {
  document.getElementById('docPreviewOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'docPreviewOverlay';
  overlay.className = 'doc-preview-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="doc-preview-box">
      <div class="doc-preview-head">
        <i data-lucide="${kind.icon}" style="width:16px;height:16px;color:${kind.color};flex:none"></i>
        <span class="doc-preview-title">${_docEsc(name)}</span>
        <a class="btn btn-secondary btn-sm" href="${url}" target="_blank" rel="noopener">
          <i data-lucide="external-link" style="width:13px;height:13px"></i> Abrir em nova aba
        </a>
        <button class="btn btn-ghost btn-sm" id="docPreviewClose"><i data-lucide="x" style="width:15px;height:15px"></i></button>
      </div>
      <div class="doc-preview-body">
        ${kind.key === 'image'
          ? `<img src="${url}" alt="${_docEsc(name)}" />`
          : `<iframe src="${url}" title="${_docEsc(name)}"></iframe>`}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  lucide.createIcons();
  overlay.querySelector('#docPreviewClose').addEventListener('click', () => overlay.remove());
}

function _docMenu(anchor, kind, id, name) {
  document.getElementById('docMenuPopup')?.remove();
  const canManage = docsState.data?.can_manage;

  const items = kind === 'folder'
    ? [
        { icon: 'folder-open', label: 'Abrir',    act: () => { docsState.folderId = id; docsState.search = ''; _docsRefresh(); } },
        { icon: 'pencil',      label: 'Renomear', act: () => _docRename('folder', id, name) },
        { icon: 'move',        label: 'Mover',    act: () => _docMove('folder', id, name) },
        { icon: 'trash-2',     label: 'Excluir',  act: () => _docDelete('folder', id, name), danger: true },
      ]
    : [
        { icon: 'eye',         label: 'Abrir',    act: () => _docOpen(id, name) },
        { icon: 'download',    label: 'Baixar',   act: () => _docDownload(id) },
        { icon: 'pencil',      label: 'Renomear', act: () => _docRename('file', id, name) },
        { icon: 'move',        label: 'Mover',    act: () => _docMove('file', id, name) },
        ...(canManage ? [{ icon: 'users', label: 'Quem pode ver', act: () => _docAccess(id, name) }] : []),
        { icon: 'trash-2',     label: 'Excluir',  act: () => _docDelete('file', id, name), danger: true },
      ];

  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'docMenuPopup';
  menu.className = 'doc-menu-popup';
  menu.style.top  = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(8, rect.right - 190)}px`;
  menu.innerHTML = items.map((it, i) => `
    <button class="doc-menu-item${it.danger ? ' danger' : ''}" data-i="${i}">
      <i data-lucide="${it.icon}"></i> ${it.label}
    </button>`).join('');
  document.body.appendChild(menu);
  lucide.createIcons();

  menu.querySelectorAll('.doc-menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const it = items[Number(btn.dataset.i)];
      menu.remove();
      it.act();
    });
  });

  const close = e => {
    if (e && menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener('click', close, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
  };
  setTimeout(() => {
    document.addEventListener('click', close, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
  }, 0);
}

// ---- Modal genérico de formulário ----
function _docModal({ title, icon = 'folder-plus', bodyHtml, confirmLabel = 'Salvar', onConfirm }) {
  document.getElementById('docFormOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'docFormOverlay';
  overlay.className = 'doc-form-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="doc-form-box">
      <div class="doc-form-head">
        <i data-lucide="${icon}" style="width:16px;height:16px"></i>
        <span>${_docEsc(title)}</span>
      </div>
      <div class="doc-form-body">${bodyHtml}</div>
      <div class="doc-form-foot">
        <span id="docFormErr" style="font-size:12px;color:var(--color-red);flex:1"></span>
        <button class="btn btn-secondary btn-sm" id="docFormCancel">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="docFormOk">${_docEsc(confirmLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  lucide.createIcons();

  const ok = overlay.querySelector('#docFormOk');
  overlay.querySelector('#docFormCancel').addEventListener('click', () => overlay.remove());
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    const original = ok.textContent;
    ok.textContent = 'Salvando...';
    try {
      await onConfirm(overlay);
      overlay.remove();
      await _docsRefresh();
    } catch (err) {
      ok.disabled = false;
      ok.textContent = original;
      overlay.querySelector('#docFormErr').textContent = err.message;
    }
  });
  overlay.querySelector('input, select, textarea')?.focus();
  overlay.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') ok.click(); });
  return overlay;
}

function _docNewFolder() {
  _docModal({
    title: 'Nova pasta',
    icon: 'folder-plus',
    bodyHtml: `
      <label class="doc-label">Nome da pasta</label>
      <input type="text" class="doc-input" id="docFolderName" placeholder="Ex.: Contratos 2026" maxlength="200" />`,
    confirmLabel: 'Criar',
    onConfirm: async (ov) => {
      const name = ov.querySelector('#docFolderName').value.trim();
      if (!name) throw new Error('Informe um nome.');
      await apiFetch('/api/document-folders', {
        method: 'POST',
        body: JSON.stringify({ name, parent_id: docsState.folderId }),
      });
    },
  });
}

function _docRename(kind, id, name) {
  _docModal({
    title: kind === 'folder' ? 'Renomear pasta' : 'Renomear arquivo',
    icon: 'pencil',
    bodyHtml: `
      <label class="doc-label">Novo nome</label>
      <input type="text" class="doc-input" id="docRenameInput" value="${_docEsc(name)}" maxlength="300" />
      ${kind === 'file' ? `<p class="doc-hint">Mantenha a extensão (.pdf, .docx, …) para o arquivo continuar abrindo no programa certo.</p>` : ''}`,
    confirmLabel: 'Renomear',
    onConfirm: async (ov) => {
      const value = ov.querySelector('#docRenameInput').value.trim();
      if (!value) throw new Error('Informe um nome.');
      const url = kind === 'folder' ? `/api/document-folders/${id}` : `/api/documents/${id}`;
      await apiFetch(url, { method: 'PATCH', body: JSON.stringify({ name: value }) });
    },
  });
}

function _docFolderOptions(selectedId, excludeId) {
  // Achata a árvore em uma lista indentada, pulando a própria pasta e sua
  // descendência quando é uma pasta que está sendo movida.
  const all = docsState.allFolders || [];
  const banned = new Set();
  if (excludeId) {
    const walk = (pid) => {
      banned.add(pid);
      all.filter(f => f.parent_id === pid).forEach(f => walk(f.id));
    };
    walk(excludeId);
  }
  const out = [];
  const walk = (parentId, depth) => {
    all.filter(f => (f.parent_id || null) === parentId)
       .sort((a, b) => a.name.localeCompare(b.name))
       .forEach(f => {
         if (banned.has(f.id)) return;
         out.push(`<option value="${f.id}" ${f.id === selectedId ? 'selected' : ''}>${' '.repeat(depth * 4)}${_docEsc(f.name)}</option>`);
         walk(f.id, depth + 1);
       });
  };
  walk(null, 0);
  return `<option value="">Raiz — Todos os documentos</option>${out.join('')}`;
}

function _docMove(kind, id, name) {
  _docModal({
    title: `Mover "${name}"`,
    icon: 'move',
    bodyHtml: `
      <label class="doc-label">Pasta de destino</label>
      <select class="doc-input" id="docMoveTarget">${_docFolderOptions(null, kind === 'folder' ? id : null)}</select>`,
    confirmLabel: 'Mover',
    onConfirm: async (ov) => {
      const target = ov.querySelector('#docMoveTarget').value || null;
      const url  = kind === 'folder' ? `/api/document-folders/${id}` : `/api/documents/${id}`;
      const body = kind === 'folder' ? { parent_id: target } : { folder_id: target };
      await apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
    },
  });
}

async function _docAccess(id, name) {
  const doc = (docsState.data.documents || []).find(x => x.id === id);
  let users = [];
  try {
    users = await apiFetch('/api/users') || [];
  } catch {
    alert('Não foi possível carregar os usuários da subconta.');
    return;
  }
  const assigned = new Set((doc?.assigned_users || []).map(u => u.id));
  const restricted = doc?.visibility === 'restricted';

  const overlay = _docModal({
    title: `Quem pode ver "${name}"`,
    icon: 'users',
    bodyHtml: `
      <label class="doc-radio">
        <input type="radio" name="docVis" value="all" ${restricted ? '' : 'checked'} />
        <span><strong>Todos da subconta</strong><br><span class="doc-hint" style="margin:0">Qualquer usuário desta subconta vê e baixa o documento.</span></span>
      </label>
      <label class="doc-radio">
        <input type="radio" name="docVis" value="restricted" ${restricted ? 'checked' : ''} />
        <span><strong>Somente usuários atribuídos</strong><br><span class="doc-hint" style="margin:0">O documento some da lista para quem não estiver marcado.</span></span>
      </label>
      <div id="docUserList" class="doc-user-list" ${restricted ? '' : 'hidden'}>
        ${users.length ? users.map(u => `
          <label class="doc-user-item">
            <input type="checkbox" value="${u.id}" ${assigned.has(u.id) ? 'checked' : ''} />
            <span>${_docEsc(u.name)} <span class="doc-hint" style="margin:0">${_docEsc(u.email)}</span></span>
          </label>`).join('')
        : `<p class="doc-hint" style="margin:0">Nenhum outro usuário nesta subconta.</p>`}
      </div>
      <p class="doc-hint">Quem enviou o documento e o desenvolvedor continuam vendo em qualquer caso.</p>`,
    confirmLabel: 'Salvar acesso',
    onConfirm: async (ov) => {
      const visibility = ov.querySelector('input[name="docVis"]:checked').value;
      const ids = Array.from(ov.querySelectorAll('#docUserList input:checked')).map(i => i.value);
      if (visibility === 'restricted' && !ids.length)
        throw new Error('Selecione ao menos um usuário ou escolha "Todos da subconta".');
      await apiFetch(`/api/documents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility, assigned_user_ids: visibility === 'restricted' ? ids : [] }),
      });
    },
  });

  overlay.querySelectorAll('input[name="docVis"]').forEach(r => {
    r.addEventListener('change', () => {
      overlay.querySelector('#docUserList').hidden = r.value !== 'restricted' || !r.checked;
    });
  });
}

function _docDelete(kind, id, name) {
  const isFolder = kind === 'folder';
  showConfirmModal({
    title: isFolder ? 'Excluir pasta' : 'Excluir arquivo',
    message: isFolder
      ? `A pasta <strong>${_docEsc(name)}</strong> e <strong>tudo que está dentro dela</strong> serão apagados. Não dá para desfazer.`
      : `O arquivo <strong>${_docEsc(name)}</strong> será apagado. Não dá para desfazer.`,
    confirmLabel: 'Excluir',
    cancelLabel: 'Cancelar',
    onConfirm: async () => {
      await apiFetch(isFolder ? `/api/document-folders/${id}` : `/api/documents/${id}`, { method: 'DELETE' });
      await _docsRefresh();
    },
  });
}
