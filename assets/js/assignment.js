// ======================================
// FAVX CRM — Responsável e seguidores
// ======================================
// Um único componente para contatos, oportunidades e conversas: as três rotas
// têm o mesmo contrato no servidor (/assignment, /owner, /followers), então
// duplicar a interface só criaria três lugares para corrigir o mesmo bug.

function _asgEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const _ASG_LABELS = {
  contacts:      'Quem cuida deste contato',
  opportunities: 'Quem cuida desta oportunidade',
  conversations: 'Quem cuida desta conversa',
};

// Abre o modal de atribuição. `path` é o segmento da rota: contacts,
// opportunities ou conversations. `onChange` roda depois de qualquer alteração
// salva, para a tela de trás se atualizar.
window.favxOpenAssignment = async function({ path, id, title, onChange }) {
  document.getElementById('asgOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'asgOverlay';
  overlay.className = 'asg-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `<div class="asg-box"><div class="asg-loading">Carregando...</div></div>`;
  document.body.appendChild(overlay);

  let users = [], assignment = { owner: null, followers: [] };
  try {
    // /api/conversations/members e não /api/users: aquele lista os usuários
    // ativos da subconta para qualquer autenticado, enquanto este é restrito a
    // admin — e um usuário comum também precisa poder adicionar seguidores.
    [users, assignment] = await Promise.all([
      apiFetch('/api/conversations/members').catch(() => []),
      apiFetch(`/api/${path}/${id}/assignment`),
    ]);
  } catch (err) {
    overlay.querySelector('.asg-box').innerHTML =
      `<div class="asg-loading" style="color:var(--color-red)">${_asgEsc(err.message)}</div>`;
    return;
  }
  users = users || [];

  let owner     = assignment.owner || null;
  let followers = Array.isArray(assignment.followers) ? assignment.followers : [];
  let dirty     = false;

  const render = () => {
    const followerIds = new Set(followers.map(f => f.id));
    // Quem já é responsável não aparece como candidato a seguidor: ele já vê
    // o registro, e marcá-lo seria redundante.
    const candidates = users.filter(u => u.id !== owner?.id && !followerIds.has(u.id));

    overlay.querySelector('.asg-box').innerHTML = `
      <div class="asg-head">
        <div>
          <div class="asg-title">${_asgEsc(_ASG_LABELS[path] || 'Atribuição')}</div>
          ${title ? `<div class="asg-sub">${_asgEsc(title)}</div>` : ''}
        </div>
        <button class="asg-close" title="Fechar"><i data-lucide="x"></i></button>
      </div>

      <div class="asg-body">
        <div class="asg-section-title">Responsável</div>
        <select class="asg-select" id="asgOwner">
          <option value="">Sem responsável — visível para todos</option>
          ${users.map(u => `
            <option value="${u.id}" ${owner?.id === u.id ? 'selected' : ''}>${_asgEsc(u.name)}</option>
          `).join('')}
        </select>
        <p class="asg-hint">
          Sem responsável, o registro fica visível para todo mundo da subconta — inclusive
          para quem só enxerga os próprios dados.
        </p>

        <div class="asg-section-title" style="margin-top:18px">
          Seguidores${followers.length ? ` (${followers.length})` : ''}
        </div>
        <div class="asg-list">
          ${followers.length
            ? followers.map(f => `
              <div class="asg-item">
                <span class="asg-avatar">${_asgEsc((f.name || '?')[0].toUpperCase())}</span>
                <span class="asg-name">${_asgEsc(f.name)}<span class="asg-email">${_asgEsc(f.email || '')}</span></span>
                <button class="asg-remove" data-id="${f.id}" title="Remover"><i data-lucide="x"></i></button>
              </div>`).join('')
            : `<div class="asg-empty">Ninguém segue este registro ainda.</div>`}
        </div>

        ${candidates.length ? `
          <select class="asg-select" id="asgAdd" style="margin-top:10px">
            <option value="">Adicionar seguidor...</option>
            ${candidates.map(u => `<option value="${u.id}">${_asgEsc(u.name)}</option>`).join('')}
          </select>
        ` : `<p class="asg-hint">Todos os usuários da subconta já têm acesso.</p>`}

        <p class="asg-hint">
          Um seguidor enxerga o registro mesmo quando ele pertence a outra pessoa.
        </p>
      </div>

      <div class="asg-foot">
        <span class="asg-err" id="asgErr"></span>
        <button class="btn btn-secondary btn-sm asg-done">Fechar</button>
      </div>`;

    lucide.createIcons();

    overlay.querySelectorAll('.asg-close, .asg-done').forEach(b =>
      b.addEventListener('click', () => {
        overlay.remove();
        if (dirty && typeof onChange === 'function') onChange();
      }));

    const fail = err => { overlay.querySelector('#asgErr').textContent = err.message; };

    overlay.querySelector('#asgOwner').addEventListener('change', async e => {
      const userId = e.target.value || null;
      try {
        await apiFetch(`/api/${path}/${id}/owner`, {
          method: 'PUT', body: JSON.stringify({ user_id: userId }),
        });
        owner = userId ? users.find(u => u.id === userId) || null : null;
        dirty = true;
        render();
      } catch (err) { fail(err); }
    });

    const saveFollowers = async (next) => {
      try {
        await apiFetch(`/api/${path}/${id}/followers`, {
          method: 'PUT', body: JSON.stringify({ user_ids: next.map(f => f.id) }),
        });
        followers = next;
        dirty = true;
        render();
      } catch (err) { fail(err); }
    };

    overlay.querySelector('#asgAdd')?.addEventListener('change', e => {
      const u = users.find(x => x.id === e.target.value);
      if (u) saveFollowers([...followers, u]);
    });

    overlay.querySelectorAll('.asg-remove').forEach(b =>
      b.addEventListener('click', () => saveFollowers(followers.filter(f => f.id !== b.dataset.id))));
  };

  render();
};
