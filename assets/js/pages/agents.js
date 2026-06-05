// ======================================
// FAVX CRM — Agentes de IA
// ======================================

window.loadAgents = async function () {
  return apiFetch('/api/agent-webhooks').catch(() => []);
};

function isAiActive() {
  return localStorage.getItem('favx_ai_enabled') !== 'false';
}

const WEBHOOK_EVENTS = [
  {
    id: 'message_activity',
    label: 'Atividade de mensagem',
    desc: 'Disparado a cada mensagem recebida ou enviada no WhatsApp.',
    fields: ['contact_name','phone_number','instance','message','from_me','message_type','context','assigned_contact'],
  },
];

window.pageAgents = function (webhooks) {
  const active = isAiActive();
  const whs = Array.isArray(webhooks) ? webhooks : [];

  return `
  <div class="page-header" style="margin-bottom:24px">
    <div>
      <h1 class="page-title">Agentes de IA</h1>
      <p class="page-subtitle">Gerencie a inteligência artificial da sua subconta</p>
    </div>
  </div>

  <!-- STATUS CARD -->
  <div style="max-width:560px;margin-bottom:32px">
    <div class="card" style="padding:28px 28px 24px;display:flex;flex-direction:column;gap:24px">
      <div style="display:flex;align-items:center;gap:18px">
        <div style="width:52px;height:52px;border-radius:14px;background:${active ? 'var(--color-black)' : 'var(--color-border-2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i data-lucide="cpu" style="width:24px;height:24px;color:${active ? '#fff' : 'var(--color-text-3)'}"></i>
        </div>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3);margin-bottom:4px">Plano atual</div>
          <div style="font-size:18px;font-weight:800;color:var(--color-text-1);line-height:1.2">IA ${active ? 'Ativa' : 'Inativa'}</div>
        </div>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:99px;font-size:12px;font-weight:600;
          background:${active ? 'var(--color-green-lite)' : 'var(--color-accent-lite)'};
          color:${active ? 'var(--color-green)' : 'var(--color-text-3)'}">
          <span style="width:6px;height:6px;border-radius:50%;background:${active ? 'var(--color-green)' : 'var(--color-text-3)'}"></span>
          ${active ? 'Online' : 'Offline'}
        </span>
      </div>
      <p style="font-size:13px;color:var(--color-text-3);line-height:1.6;border-top:1px solid var(--color-border);padding-top:20px">
        Com a IA ativa, sua subconta conta com respostas automáticas, movimentação inteligente no funil,
        qualificação de leads e muito mais — tudo executado de forma autônoma pelos agentes configurados internamente.
      </p>
      ${window.favxCan('manage_ai') ? `<div style="display:flex;justify-content:flex-end;border-top:1px solid var(--color-border);padding-top:20px">
        ${active
          ? `<button class="btn btn-sm" id="btnToggleAi" style="background:var(--color-red-lite);color:var(--color-red);border:1px solid var(--color-red);gap:6px;font-weight:600">
               <i data-lucide="power" style="width:14px;height:14px"></i> Desativar IA
             </button>`
          : `<button class="btn btn-primary btn-sm" id="btnToggleAi" style="gap:6px">
               <i data-lucide="power" style="width:14px;height:14px"></i> Ativar IA
             </button>`
        }
      </div>` : ''}
    </div>
  </div>

  <!-- WEBHOOKS -->
  <div style="max-width:760px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div>
        <div style="font-size:16px;font-weight:700;color:var(--color-text-1)">Webhooks</div>
        <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">Notifique sistemas externos a cada evento selecionado</div>
      </div>
      <button class="btn btn-primary btn-sm" id="btnNewWebhook" style="gap:6px">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Novo webhook
      </button>
    </div>

    ${whs.length === 0 ? `
      <div class="card" style="padding:36px;text-align:center;color:var(--color-text-3)">
        <i data-lucide="webhook" style="width:36px;height:36px;opacity:.25;display:block;margin:0 auto 12px"></i>
        <div style="font-size:13px">Nenhum webhook configurado ainda.</div>
      </div>
    ` : `
      <div style="display:flex;flex-direction:column;gap:10px" id="webhookList">
        ${whs.map(wh => _webhookCard(wh)).join('')}
      </div>
    `}
  </div>
  `;
};

function _webhookCard(wh) {
  const events = Array.isArray(wh.events) ? wh.events : [];
  const evLabels = events.map(e => WEBHOOK_EVENTS.find(x => x.id === e)?.label || e).join(', ') || '—';
  return `
    <div class="card" style="padding:18px 20px;display:flex;align-items:center;gap:14px" data-wh-id="${wh.id}">
      <div style="width:38px;height:38px;border-radius:10px;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i data-lucide="webhook" style="width:18px;height:18px;color:var(--color-text-2)"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:var(--color-text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${wh.name}</div>
        <div style="font-size:12px;color:var(--color-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">${wh.url}</div>
        <div style="font-size:11px;color:var(--color-text-3);margin-top:4px">Eventos: ${evLabels}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;
          background:${wh.is_active ? 'var(--color-green-lite)' : 'var(--color-border-2)'};
          color:${wh.is_active ? 'var(--color-green)' : 'var(--color-text-3)'}">
          <span style="width:5px;height:5px;border-radius:50%;background:currentColor"></span>
          ${wh.is_active ? 'Ativo' : 'Inativo'}
        </span>
        <button class="btn btn-ghost btn-sm btn-edit-wh" data-id="${wh.id}" style="padding:5px 8px">
          <i data-lucide="pencil" style="width:14px;height:14px"></i>
        </button>
        <button class="btn btn-ghost btn-sm btn-delete-wh" data-id="${wh.id}" style="padding:5px 8px;color:var(--color-red)">
          <i data-lucide="trash-2" style="width:14px;height:14px"></i>
        </button>
      </div>
    </div>`;
}

function showAiModal(html) {
  let m = document.getElementById('aiModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'aiModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
    m.addEventListener('click', e => { if (e.target === m) closeAiModal(); });
    document.body.appendChild(m);
  }
  m.innerHTML = html;
  lucide.createIcons();
}

function closeAiModal() {
  document.getElementById('aiModal')?.remove();
}

function openWebhookModal(existing) {
  const isEdit = !!existing;
  const events = existing?.events || [];

  showAiModal(`
    <div style="background:var(--color-surface);border-radius:16px;width:520px;max-width:100%;box-shadow:0 32px 64px rgba(0,0,0,.25);overflow:hidden">
      <div style="padding:24px 24px 0;border-bottom:1px solid var(--color-border);padding-bottom:18px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:16px;font-weight:700;color:var(--color-text-1)">${isEdit ? 'Editar webhook' : 'Novo webhook'}</div>
        <button class="btn btn-ghost btn-sm" id="btnCloseWhModal" style="padding:4px"><i data-lucide="x" style="width:16px;height:16px"></i></button>
      </div>
      <div style="padding:20px 24px;display:flex;flex-direction:column;gap:16px">

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--color-text-2);letter-spacing:.06em;display:block;margin-bottom:6px">NOME <span style="color:var(--color-red)">*</span></label>
          <input id="whName" class="settings-input" style="width:100%" placeholder="Ex: Notificação de mensagem" value="${existing?.name || ''}">
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--color-text-2);letter-spacing:.06em;display:block;margin-bottom:6px">URL DO WEBHOOK <span style="color:var(--color-red)">*</span></label>
          <input id="whUrl" class="settings-input" style="width:100%" placeholder="https://..." value="${existing?.url || ''}">
        </div>

        <div>
          <label style="font-size:11px;font-weight:700;color:var(--color-text-2);letter-spacing:.06em;display:block;margin-bottom:10px">CASOS DE ATIVAÇÃO</label>
          <div style="display:flex;flex-direction:column;gap:0;border:1px solid var(--color-border);border-radius:10px;overflow:hidden">
            ${WEBHOOK_EVENTS.map((ev, i) => `
              <label style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;${i > 0 ? 'border-top:1px solid var(--color-border);' : ''}background:var(--color-surface)">
                <input type="checkbox" class="wh-event-check" value="${ev.id}" ${events.includes(ev.id) ? 'checked' : ''} style="margin-top:2px;accent-color:var(--color-accent);width:15px;height:15px;flex-shrink:0">
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--color-text-1)">${ev.label}</div>
                  <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">${ev.desc}</div>
                  <div id="fields-${ev.id}" style="display:none;margin-top:10px;background:var(--color-bg-2);border-radius:8px;padding:12px;font-size:12px;color:var(--color-text-2)">
                    <div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--color-text-3);margin-bottom:8px">PAYLOAD ENVIADO</div>
                    <div style="display:flex;flex-direction:column;gap:4px;font-family:monospace">
                      <span>contact_name</span>
                      <span>phone_number</span>
                      <span>instance</span>
                      <span>message</span>
                      <span>from_me</span>
                      <span>message_type <span style="color:var(--color-text-3)">(texto / audio / imagem / video / documento)</span></span>
                      <span style="color:var(--color-text-3)">context <span style="font-size:10px">(em breve)</span></span>
                      <span style="color:var(--color-text-3)">assigned_contact <span style="font-size:10px">(em breve)</span></span>
                    </div>
                  </div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>

        ${isEdit ? `
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="whActive" ${existing.is_active ? 'checked' : ''} style="accent-color:var(--color-accent);width:15px;height:15px">
          <span style="font-size:13px;color:var(--color-text-1)">Webhook ativo</span>
        </label>` : ''}

        <div id="whErr" style="font-size:12px;color:var(--color-red);min-height:16px"></div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-secondary btn-sm" id="btnCancelWh">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="btnSaveWh" style="gap:6px">
          <i data-lucide="${isEdit ? 'check' : 'plus'}" style="width:13px;height:13px"></i>
          ${isEdit ? 'Salvar' : 'Criar webhook'}
        </button>
      </div>
    </div>
  `);

  // Toggle payload preview when checkbox changes
  document.querySelectorAll('.wh-event-check').forEach(cb => {
    const panel = document.getElementById(`fields-${cb.value}`);
    if (panel) {
      panel.style.display = cb.checked ? 'block' : 'none';
      cb.addEventListener('change', () => { panel.style.display = cb.checked ? 'block' : 'none'; });
    }
  });

  document.getElementById('btnCloseWhModal')?.addEventListener('click', closeAiModal);
  document.getElementById('btnCancelWh')?.addEventListener('click', closeAiModal);

  document.getElementById('btnSaveWh')?.addEventListener('click', async () => {
    const name = document.getElementById('whName').value.trim();
    const url  = document.getElementById('whUrl').value.trim();
    const selEvents = [...document.querySelectorAll('.wh-event-check:checked')].map(c => c.value);
    const errEl = document.getElementById('whErr');

    if (!name) { errEl.textContent = 'Nome é obrigatório.'; return; }
    if (!url)  { errEl.textContent = 'URL é obrigatória.'; return; }
    if (!selEvents.length) { errEl.textContent = 'Selecione pelo menos um caso de ativação.'; return; }

    const btn = document.getElementById('btnSaveWh');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      const body = { name, url, events: selEvents };
      if (isEdit) body.is_active = document.getElementById('whActive')?.checked ?? true;

      if (isEdit) {
        await apiFetch(`/api/agent-webhooks/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/agent-webhooks', { method: 'POST', body: JSON.stringify(body) });
      }
      closeAiModal();
      reloadAgentsPage();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = isEdit ? 'Salvar' : 'Criar webhook';
    }
  });
}

function openDeactivateConfirm() {
  showAiModal(`
    <div style="background:var(--color-surface);border-radius:16px;width:420px;max-width:100%;padding:36px 32px 28px;display:flex;flex-direction:column;align-items:center;gap:0;box-shadow:0 32px 64px rgba(0,0,0,.25)">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--color-yellow-lite);display:flex;align-items:center;justify-content:center;margin-bottom:20px">
        <i data-lucide="alert-triangle" style="width:30px;height:30px;color:var(--color-yellow)"></i>
      </div>
      <p style="font-size:14px;color:var(--color-text-2);text-align:center;line-height:1.65;margin-bottom:28px">
        Desativar a IA desativará funções automáticas como respostas automáticas,
        movimentação do funil e etc.<br><br>
        Tem certeza que deseja continuar?
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;width:100%">
        <button class="btn btn-primary" id="btnAiBack" style="width:100%;justify-content:center;padding:11px">Voltar</button>
        <button class="btn btn-secondary" id="btnAiConfirmDeactivate" style="width:100%;justify-content:center;padding:10px;color:var(--color-text-3);font-weight:500">Desativar IA</button>
      </div>
    </div>
  `);
  document.getElementById('btnAiBack')?.addEventListener('click', closeAiModal);
  document.getElementById('btnAiConfirmDeactivate')?.addEventListener('click', () => {
    localStorage.setItem('favx_ai_enabled', 'false');
    closeAiModal();
    reloadAgentsPage();
  });
}

async function reloadAgentsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  const data = await window.loadAgents().catch(() => []);
  content.innerHTML = window.pageAgents(data);
  lucide.createIcons();
  window.initAgents(data);
}

window.initAgents = function (webhooks) {
  // AI toggle
  const btn = document.getElementById('btnToggleAi');
  if (btn) {
    if (isAiActive()) {
      btn.addEventListener('click', openDeactivateConfirm);
    } else {
      btn.addEventListener('click', () => {
        localStorage.setItem('favx_ai_enabled', 'true');
        reloadAgentsPage();
      });
    }
  }

  // New webhook
  document.getElementById('btnNewWebhook')?.addEventListener('click', () => openWebhookModal(null));

  // Edit / Delete
  document.querySelectorAll('.btn-edit-wh').forEach(b => {
    b.addEventListener('click', () => {
      const whs = Array.isArray(webhooks) ? webhooks : [];
      const wh  = whs.find(w => w.id === b.dataset.id);
      if (wh) openWebhookModal(wh);
    });
  });

  document.querySelectorAll('.btn-delete-wh').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Excluir este webhook?')) return;
      try {
        await apiFetch(`/api/agent-webhooks/${b.dataset.id}`, { method: 'DELETE' });
        reloadAgentsPage();
      } catch (err) {
        alert(err.message);
      }
    });
  });
};
