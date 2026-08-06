// ======================================
// FAVX CRM — Tags de contato
// ======================================

const TAG_PALETTE = [
  '#6B7280', '#ef4444', '#f97316', '#f59e0b', '#16a34a',
  '#0891b2', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

function _tagEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A cor vem do usuário; um valor fora do formato entraria direto num atributo
// style. O servidor já recusa, mas a tela não depende disso para ser segura.
function _tagColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#6B7280';
}

// Chip usado na lista de contatos e nos modais.
window.favxTagChip = function(tag) {
  const color = _tagColor(tag.color);
  return `<span class="tag-chip" style="--tag:${color}">${_tagEsc(tag.name)}</span>`;
};

window.favxTagChips = function(tags, max = 3) {
  const list = Array.isArray(tags) ? tags : [];
  if (!list.length) return '';
  const shown = list.slice(0, max).map(window.favxTagChip).join('');
  const rest  = list.length - max;
  return `<span class="tag-chips">${shown}${rest > 0
    ? `<span class="tag-chip tag-chip-more" title="${_tagEsc(list.slice(max).map(t => t.name).join(', '))}">+${rest}</span>`
    : ''}</span>`;
};

function _tagModal({ title, bodyHtml, footHtml = '' }) {
  document.getElementById('tagOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'tagOverlay';
  overlay.className = 'tag-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="tag-box">
      <div class="tag-head">
        <span class="tag-title">${_tagEsc(title)}</span>
        <button class="tag-close" title="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="tag-body">${bodyHtml}</div>
      <div class="tag-foot"><span class="tag-err" id="tagErr"></span>${footHtml}</div>
    </div>`;
  document.body.appendChild(overlay);
  lucide.createIcons();
  overlay.querySelector('.tag-close').addEventListener('click', () => overlay.remove());
  return overlay;
}

// ============================================================
// APLICAR TAGS A UM CONTATO
// ============================================================

window.favxOpenContactTags = async function({ contactId, contactName, onChange }) {
  let all = [], current = [];
  try {
    const [tags, contact] = await Promise.all([
      apiFetch('/api/contact-tags'),
      apiFetch(`/api/contacts/${contactId}`),
    ]);
    all = tags || [];
    current = contact?.tags || [];
  } catch (err) {
    alert(err.message);
    return;
  }

  let selected = new Set(current.map(t => t.id));
  let dirty = false;
  const overlay = _tagModal({ title: `Tags de ${contactName || 'contato'}`, bodyHtml: '' });

  const save = async () => {
    try {
      await apiFetch(`/api/contacts/${contactId}/tags`, {
        method: 'PUT', body: JSON.stringify({ tag_ids: [...selected] }),
      });
      dirty = true;
    } catch (err) {
      overlay.querySelector('#tagErr').textContent = err.message;
    }
  };

  const render = () => {
    overlay.querySelector('.tag-body').innerHTML = all.length ? `
      <div class="tag-pick-list">
        ${all.map(t => `
          <label class="tag-pick">
            <input type="checkbox" value="${t.id}" ${selected.has(t.id) ? 'checked' : ''} />
            ${window.favxTagChip(t)}
            <span class="tag-count">${t.contact_count ?? 0} contato${(t.contact_count ?? 0) !== 1 ? 's' : ''}</span>
          </label>`).join('')}
      </div>
      <div class="tag-new">
        <input type="text" class="tag-input" id="tagNewName" placeholder="Criar nova tag..." maxlength="60" />
        <button class="btn btn-secondary btn-sm" id="tagNewBtn">Criar</button>
      </div>`
    : `<div class="tag-empty">
         Nenhuma tag criada ainda.
       </div>
       <div class="tag-new">
         <input type="text" class="tag-input" id="tagNewName" placeholder="Nome da primeira tag..." maxlength="60" />
         <button class="btn btn-secondary btn-sm" id="tagNewBtn">Criar</button>
       </div>`;

    lucide.createIcons();

    overlay.querySelectorAll('.tag-pick input').forEach(cb =>
      cb.addEventListener('change', async () => {
        cb.checked ? selected.add(cb.value) : selected.delete(cb.value);
        await save();
      }));

    const nameInput = overlay.querySelector('#tagNewName');
    const create = async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      try {
        // Cor sorteada da paleta para as tags nascerem distinguíveis entre si
        // sem obrigar a escolher — trocar depois é um clique no gerenciador.
        const color = TAG_PALETTE[all.length % TAG_PALETTE.length];
        const tag = await apiFetch('/api/contact-tags', {
          method: 'POST', body: JSON.stringify({ name, color }),
        });
        all.push(tag);
        all.sort((a, b) => a.name.localeCompare(b.name));
        selected.add(tag.id);
        await save();
        render();
      } catch (err) {
        overlay.querySelector('#tagErr').textContent = err.message;
      }
    };
    overlay.querySelector('#tagNewBtn').addEventListener('click', create);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  };

  render();
  overlay.querySelector('.tag-close').addEventListener('click', () => {
    if (dirty && typeof onChange === 'function') onChange();
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay && dirty && typeof onChange === 'function') onChange();
  });
};

// ============================================================
// GERENCIAR AS TAGS DA SUBCONTA
// ============================================================

window.favxOpenTagManager = async function({ onChange } = {}) {
  let all = [];
  try { all = await apiFetch('/api/contact-tags') || []; }
  catch (err) { alert(err.message); return; }

  let dirty = false;
  const overlay = _tagModal({ title: 'Gerenciar tags', bodyHtml: '' });

  const render = () => {
    overlay.querySelector('.tag-body').innerHTML = `
      ${all.length ? `
      <div class="tag-manage-list">
        ${all.map(t => `
          <div class="tag-manage-row" data-id="${t.id}">
            <span class="tag-swatch" style="background:${_tagColor(t.color)}"></span>
            <input type="text" class="tag-input tag-name" value="${_tagEsc(t.name)}" maxlength="60" />
            <span class="tag-count">${t.contact_count ?? 0}</span>
            <button class="tag-icon-btn tag-palette-btn" title="Cor"><i data-lucide="palette"></i></button>
            <button class="tag-icon-btn tag-del-btn" title="Excluir"><i data-lucide="trash-2"></i></button>
          </div>
          <div class="tag-palette" hidden>
            ${TAG_PALETTE.map(c => `<button class="tag-swatch tag-swatch-pick" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
          </div>`).join('')}
      </div>` : `<div class="tag-empty">Nenhuma tag criada ainda.</div>`}

      <div class="tag-new">
        <input type="text" class="tag-input" id="tagNewName" placeholder="Nome da nova tag..." maxlength="60" />
        <button class="btn btn-secondary btn-sm" id="tagNewBtn">Criar</button>
      </div>
      <p class="tag-hint">O número mostra quantos contatos usam a tag. Excluir remove a tag de todos eles.</p>`;

    lucide.createIcons();
    const fail = err => { overlay.querySelector('#tagErr').textContent = err.message; };

    overlay.querySelectorAll('.tag-manage-row').forEach(row => {
      const id  = row.dataset.id;
      const tag = all.find(t => t.id === id);

      // Salva ao sair do campo, não a cada tecla: renomear dispara uma
      // requisição por vez em vez de uma por caractere.
      const nameInput = row.querySelector('.tag-name');
      nameInput.addEventListener('blur', async () => {
        const name = nameInput.value.trim();
        if (!name || name === tag.name) { nameInput.value = tag.name; return; }
        try {
          const updated = await apiFetch(`/api/contact-tags/${id}`, {
            method: 'PUT', body: JSON.stringify({ name }),
          });
          tag.name = updated.name;
          dirty = true;
        } catch (err) { nameInput.value = tag.name; fail(err); }
      });
      nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

      const palette = row.nextElementSibling;
      row.querySelector('.tag-palette-btn').addEventListener('click', () => {
        palette.hidden = !palette.hidden;
      });
      palette.querySelectorAll('.tag-swatch-pick').forEach(sw =>
        sw.addEventListener('click', async () => {
          try {
            const updated = await apiFetch(`/api/contact-tags/${id}`, {
              method: 'PUT', body: JSON.stringify({ color: sw.dataset.color }),
            });
            tag.color = updated.color;
            dirty = true;
            render();
          } catch (err) { fail(err); }
        }));

      row.querySelector('.tag-del-btn').addEventListener('click', () => {
        showConfirmModal({
          title: 'Excluir tag',
          message: `A tag <strong>${_tagEsc(tag.name)}</strong> será removida de ${tag.contact_count ?? 0} contato(s). Não dá para desfazer.`,
          confirmLabel: 'Excluir',
          cancelLabel: 'Cancelar',
          onConfirm: async () => {
            await apiFetch(`/api/contact-tags/${id}`, { method: 'DELETE' });
            all = all.filter(t => t.id !== id);
            dirty = true;
            render();
          },
        });
      });
    });

    const nameInput = overlay.querySelector('#tagNewName');
    const create = async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      try {
        const tag = await apiFetch('/api/contact-tags', {
          method: 'POST',
          body: JSON.stringify({ name, color: TAG_PALETTE[all.length % TAG_PALETTE.length] }),
        });
        all.push(tag);
        all.sort((a, b) => a.name.localeCompare(b.name));
        dirty = true;
        render();
      } catch (err) { fail(err); }
    };
    overlay.querySelector('#tagNewBtn').addEventListener('click', create);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  };

  render();
  const finish = () => { if (dirty && typeof onChange === 'function') onChange(); };
  overlay.querySelector('.tag-close').addEventListener('click', finish);
  overlay.addEventListener('click', e => { if (e.target === overlay) finish(); });
};
