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

function _tagData(list) {
  return _tagEsc(JSON.stringify(list.map(t => ({ name: t.name, color: _tagColor(t.color) }))));
}

// Um chip "+N" com as tags escondidas dentro dele. Elas viajam no atributo
// porque as listas são re-renderizadas a cada filtro e busca — guardá-las num
// mapa em memória obrigaria a sincronizar dois lugares. O aria-label cobre
// quem navega por leitor de tela, que não tem "passar o mouse".
function _tagMoreChip(rest) {
  return `<span class="tag-chip tag-chip-more" data-tag-more="${_tagData(rest)}"
    aria-label="${_tagEsc(rest.map(t => t.name).join(', '))}">+${rest.length}</span>`;
}

// `fit`: além do limite de quantidade, corta pelo espaço real da coluna
// (ver favxTagsFit). Só faz sentido onde os chips ficam numa linha só.
window.favxTagChips = function(tags, max = 4, { fit = false } = {}) {
  const list = Array.isArray(tags) ? tags : [];
  if (!list.length) return '';
  const shown = list.slice(0, max).map(window.favxTagChip).join('');
  const rest  = list.slice(max);
  return `<span class="tag-chips${fit ? ' tag-chips-fit' : ''}"${fit ? ` data-tag-all="${_tagData(list)}"` : ''}
    >${shown}${rest.length ? _tagMoreChip(rest) : ''}</span>`;
};

// ============================================================
// CORTE PELO ESPAÇO DISPONÍVEL
// ============================================================
// Numa coluna estreita, deixar o flexbox encolher os chips transforma "Quente"
// em "Q…" — some justamente a informação. Aqui o que cabe fica inteiro e o
// resto vai para o "+N", que nunca é cortado.

const TAG_FIT_GAP = 4;

window.favxTagsFit = function(root) {
  (root || document).querySelectorAll('.tag-chips-fit').forEach(box => {
    let all = [];
    try { all = JSON.parse(box.dataset.tagAll || '[]'); } catch { return; }
    const chips = [...box.querySelectorAll('.tag-chip:not(.tag-chip-more)')];
    // Sem largura o elemento ainda não está na tela: medir agora daria zero.
    if (!chips.length || !box.clientWidth) return;

    // Mede sempre do zero: a mesma caixa pode ser remedida depois de um resize.
    chips.forEach(c => {
      c.style.display = '';
      c.style.maxWidth = '';
      c.classList.remove('tag-chip-cut');
    });
    const more = box.querySelector('.tag-chip-more');
    if (more) more.style.display = '';

    const avail = box.clientWidth;
    const moreW = (more ? more.offsetWidth : 26) + TAG_FIT_GAP;
    let used = 0, cabem = 0;
    for (const c of chips) {
      const w = c.offsetWidth + (cabem ? TAG_FIT_GAP : 0);
      // O "+N" só ocupa espaço se ainda sobrar tag depois desta.
      const reserva = cabem + 1 < all.length ? moreW : 0;
      // cabem > 0: uma tag de nome enorme sozinha aparece cortada, e não some.
      if (cabem > 0 && used + w + reserva > avail) break;
      used += w; cabem++;
    }

    chips.slice(cabem).forEach(c => { c.style.display = 'none'; });
    const rest = all.slice(cabem);

    // Uma única tag de nome enorme ocuparia a linha toda e empurraria o "+N"
    // para fora: corta o nome com reticências para o contador continuar visível.
    if (rest.length && used + moreW > avail) {
      const c = chips[cabem - 1];
      c.classList.add('tag-chip-cut');
      c.style.maxWidth = `${Math.max(30, avail - moreW)}px`;
    }

    if (!more) return;
    if (!rest.length) { more.style.display = 'none'; return; }
    more.textContent = `+${rest.length}`;
    more.dataset.tagMore = JSON.stringify(rest);
    more.setAttribute('aria-label', rest.map(t => t.name).join(', '));
  });
};

// A largura da coluna muda com a janela — remede, sem correr a cada pixel.
let _tagFitTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_tagFitTimer);
  _tagFitTimer = setTimeout(() => window.favxTagsFit(), 120);
});

// ============================================================
// BALÃO COM AS TAGS RESTANTES
// ============================================================
// Vai para o <body> com position:fixed porque as listas onde os chips aparecem
// — a tabela de contatos e a lista de conversas — rolam por dentro e cortariam
// um balão posicionado dentro delas.

let _tagPop = null;

function _tagPopClose() {
  _tagPop?.remove();
  _tagPop = null;
}

function _tagPopOpen(anchor) {
  if (_tagPop?._anchor === anchor) return;
  _tagPopClose();

  let rest = [];
  try { rest = JSON.parse(anchor.dataset.tagMore || '[]'); } catch { return; }
  if (!rest.length) return;

  const pop = document.createElement('div');
  pop.className = 'tag-pop';
  pop._anchor = anchor;
  pop.innerHTML = rest.map(window.favxTagChip).join('');
  document.body.appendChild(pop);

  // Mede depois de inserir: antes disso o balão não tem tamanho.
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8));
  // Abre para cima quando não cabe embaixo — o caso das últimas linhas da lista.
  const below = r.bottom + 6;
  const top = below + pop.offsetHeight > window.innerHeight - 8
    ? Math.max(8, r.top - pop.offsetHeight - 6)
    : below;
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;
  _tagPop = pop;
}

document.addEventListener('mouseover', e => {
  const chip = e.target.closest?.('.tag-chip-more');
  if (chip) _tagPopOpen(chip);
  else if (_tagPop && !e.target.closest?.('.tag-pop')) _tagPopClose();
});

// Em tela de toque não há hover: o toque abre o balão. O stopPropagation
// impede que o mesmo toque abra a conversa ou a linha por baixo do chip.
document.addEventListener('click', e => {
  const chip = e.target.closest?.('.tag-chip-more');
  if (!chip) { _tagPopClose(); return; }
  e.stopPropagation();
  _tagPopOpen(chip);
});

// O balão é fixo e o chip não: rolar deixaria os dois separados. `true` para
// capturar também a rolagem das listas internas, que não sobe até a janela.
window.addEventListener('scroll', _tagPopClose, true);

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
