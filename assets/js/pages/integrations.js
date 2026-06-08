// ======================================
// FAVX CRM — Página de Integrações (multi-instância)
// ======================================

const _WA_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="28" height="28" fill="#25D366"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>`;

const _OTHER_INTEGRATIONS = [
  { icon: '📸', name: 'Instagram DM',      desc: 'Receba e responda mensagens do Instagram diretamente no CRM.',         soon: true },
  { icon: '📧', name: 'Email (SMTP/IMAP)', desc: 'Configure seu servidor de email para centralizar as comunicações.',     soon: true },
  { icon: '🤖', name: 'OpenAI / GPT',      desc: 'Conecte sua chave da OpenAI para potencializar os agentes de IA.',     soon: true },
  { icon: '💬', name: 'Telegram',          desc: 'Integre o bot do Telegram para atendimento via chat.',                  soon: true },
  { icon: '🔗', name: 'Webhook',           desc: 'Configure webhooks personalizados para integrar com qualquer sistema.', soon: true },
  { icon: '📋', name: 'Zapier / Make',     desc: 'Conecte o FAVX CRM a centenas de apps via Zapier ou Make.',            soon: true },
];

let _waInstances = [];

window.loadIntegrations = async function() {
  try { _waInstances = await apiFetch('/api/whatsapp-instances'); } catch { _waInstances = []; }
  return _waInstances;
};

window.pageIntegrations = function(instances) {
  _waInstances = Array.isArray(instances) ? instances : [];
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Integrações</h1>
      <p class="page-subtitle">Conecte o FAVX CRM com suas ferramentas favoritas</p>
    </div>
  </div>

  <!-- WhatsApp section -->
  <div style="margin-bottom:32px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px">
        ${_WA_ICON}
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--color-text-1)">WhatsApp</div>
          <div style="font-size:12px;color:var(--color-text-3)">Múltiplos números via Evolution API</div>
        </div>
      </div>
      <button id="btnAddWa" class="btn btn-primary btn-sm" style="display:flex;align-items:center;gap:6px">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Adicionar número
      </button>
    </div>

    <div id="waInstancesList" style="display:flex;flex-direction:column;gap:10px">
      ${_waInstances.length === 0
        ? `<div style="padding:24px;text-align:center;color:var(--color-text-3);font-size:13px;background:var(--color-surface);border:1px dashed var(--color-border);border-radius:12px">
             Nenhum número conectado ainda. Clique em <b>Adicionar número</b> para começar.
           </div>`
        : _waInstances.map((inst, i) => _waInstanceCard(inst, i)).join('')
      }
    </div>
  </div>

  <!-- Other integrations -->
  <div style="margin-bottom:12px;font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.08em">OUTRAS INTEGRAÇÕES</div>
  <div class="integration-grid">
    ${_OTHER_INTEGRATIONS.map(i => `
    <div class="integration-card integration-soon">
      <div class="integration-icon">${i.icon}</div>
      <div>
        <div class="integration-name">${i.name}</div>
        <div class="integration-desc">${i.desc}</div>
      </div>
      <div class="integration-footer">
        <span class="badge badge-gray">Em breve</span>
        <button class="btn btn-secondary btn-sm" disabled>Em breve</button>
      </div>
    </div>`).join('')}
  </div>`;
};

function _waInstanceCard(inst, i) {
  const isConnected = inst.status === 'connected';
  const label = inst.phone_number || `Número ${i + 1}`;
  return `
  <div class="integration-card" id="waCard_${inst.id}" style="flex-direction:row;align-items:center;gap:16px;padding:16px 20px">
    <div style="width:42px;height:42px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      ${_WA_ICON}
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-size:14px;font-weight:700;color:var(--color-text-1)">${label}</div>
      <div style="font-size:11px;color:var(--color-text-3);font-family:monospace;margin-top:2px">${inst.instance_name}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      <span class="badge ${isConnected ? 'badge-green' : 'badge-yellow'}">${isConnected ? 'Conectado' : 'Desconectado'}</span>
      ${!isConnected ? `<button class="btn btn-primary btn-sm" onclick="_waOpenQr('${inst.id}','${inst.instance_name}')">Conectar</button>` : ''}
      <button class="btn btn-ghost btn-sm" title="Re-sincronizar webhook (resolve mensagens externas não aparecendo no CRM)" onclick="_waSyncWebhook('${inst.id}')">
        <i data-lucide="refresh-cw" style="width:14px;height:14px"></i>
      </button>
      <button class="btn btn-ghost btn-sm" style="color:var(--color-red)" onclick="_waDeleteInstance('${inst.id}')">
        <i data-lucide="trash-2" style="width:14px;height:14px"></i>
      </button>
    </div>
  </div>`;
}

window.initIntegrations = function() {
  document.getElementById('btnAddWa')?.addEventListener('click', _openAddWaModal);
};

// ── Add new instance modal ────────────────────────────────────

function _openAddWaModal() {
  document.getElementById('waAddModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'waAddModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.52);z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--color-surface);border-radius:16px;width:460px;max-width:100%;box-shadow:0 32px 80px rgba(0,0,0,.28);overflow:hidden';
  modal.innerHTML = `
    <div style="padding:20px 24px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:14px">
      <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0">${_WA_ICON}</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:700;color:var(--color-text-1)">Adicionar número</div>
        <div style="font-size:12px;color:var(--color-text-3)">Via Evolution API</div>
      </div>
      <button id="waAddClose" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--color-text-3)"><i data-lucide="x" style="width:18px;height:18px"></i></button>
    </div>
    <div style="padding:24px;display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--color-text-2);display:block;margin-bottom:6px;letter-spacing:.06em">URL DA EVOLUTION API <span style="color:var(--color-red)">*</span></label>
        <input id="waAddUrl" class="settings-input" style="width:100%" placeholder="https://evo.seuservidor.com" />
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--color-text-2);display:block;margin-bottom:6px;letter-spacing:.06em">CHAVE DA API GLOBAL <span style="color:var(--color-red)">*</span></label>
        <input id="waAddKey" class="settings-input" style="width:100%" type="password" placeholder="••••••••••••••••••" />
      </div>
      <div id="waAddErr" style="font-size:12px;color:var(--color-red);min-height:14px"></div>
    </div>
    <div style="padding:16px 24px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:8px">
      <button id="waAddCancel" class="btn btn-secondary btn-sm">Cancelar</button>
      <button id="waAddNext" class="btn btn-primary btn-sm" style="display:flex;align-items:center;gap:6px">
        Próximo <i data-lucide="arrow-right" style="width:13px;height:13px"></i>
      </button>
    </div>`;

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  lucide.createIcons();

  modal.querySelector('#waAddClose').addEventListener('click', () => overlay.remove());
  modal.querySelector('#waAddCancel').addEventListener('click', () => overlay.remove());
  setTimeout(() => modal.querySelector('#waAddUrl')?.focus(), 40);

  modal.querySelector('#waAddNext').addEventListener('click', async () => {
    const api_url = modal.querySelector('#waAddUrl').value.trim();
    const api_key = modal.querySelector('#waAddKey').value.trim();
    const errEl   = modal.querySelector('#waAddErr');
    if (!api_url) { errEl.textContent = 'URL é obrigatória.'; return; }
    if (!api_key) { errEl.textContent = 'Chave é obrigatória.'; return; }
    errEl.textContent = '';

    const btn = modal.querySelector('#waAddNext');
    btn.disabled = true;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin .7s linear infinite"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Conectando...`;

    try {
      const result = await apiFetch('/api/whatsapp-instances', {
        method: 'POST',
        body: JSON.stringify({ api_url, api_key }),
      });
      overlay.remove();
      _waOpenQrModal(result.id, result.instance_name, result.base64);
      _waInstances.push(result);
      _refreshWaList();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.innerHTML = `Próximo <i data-lucide="arrow-right" style="width:13px;height:13px"></i>`;
      lucide.createIcons();
    }
  });
}

// ── QR modal ─────────────────────────────────────────────────

window._waOpenQr = function(id, instanceName, base64) {
  _waOpenQrModal(id, instanceName, base64 || null);
};

function _waOpenQrModal(id, instanceName, base64) {
  document.getElementById('waQrModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'waQrModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.52);z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--color-surface);border-radius:16px;width:460px;max-width:100%;box-shadow:0 32px 80px rgba(0,0,0,.28);overflow:hidden';

  function render(b64) {
    modal.innerHTML = `
      <div style="padding:20px 24px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:14px">
        <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0">${_WA_ICON}</div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700;color:var(--color-text-1)">Escanear QR Code</div>
          <div style="font-size:12px;color:var(--color-text-3);font-family:monospace">${instanceName}</div>
        </div>
        <button id="waQrClose" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--color-text-3)"><i data-lucide="x" style="width:18px;height:18px"></i></button>
      </div>
      <div style="padding:28px 24px;display:flex;flex-direction:column;align-items:center;gap:16px">
        ${b64
          ? `<img id="waQrImg" src="${b64}" style="width:220px;height:220px;border-radius:12px;border:2px solid var(--color-border)" />`
          : `<div style="width:220px;height:220px;border-radius:12px;border:2px solid var(--color-border);background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:var(--color-text-3)">
               <div style="width:28px;height:28px;border:2.5px solid var(--color-border);border-top-color:var(--color-accent);border-radius:50%;animation:spin .7s linear infinite"></div>
               <div style="font-size:12px">Carregando QR...</div>
             </div>`}
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-3)">
          <div id="waStatusDot" style="width:8px;height:8px;border-radius:50%;background:#fbbf24;animation:pulse 1.4s ease-in-out infinite"></div>
          <span id="waQrStatus">Aguardando leitura do QR code...</span>
        </div>
      </div>
      <div style="padding:14px 24px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end">
        <button id="waQrRefresh" class="btn btn-secondary btn-sm" style="display:flex;align-items:center;gap:5px">
          <i data-lucide="refresh-cw" style="width:13px;height:13px"></i> Atualizar QR
        </button>
      </div>`;
    lucide.createIcons();

    modal.querySelector('#waQrClose').addEventListener('click', () => { clearInterval(_qrPoll); clearInterval(_stPoll); overlay.remove(); });
    modal.querySelector('#waQrRefresh').addEventListener('click', async () => {
      try {
        const data = await apiFetch(`/api/whatsapp-instances/${id}/qr`);
        const nb64 = data?.qrcode?.base64 || data?.base64;
        if (nb64) { const img = modal.querySelector('#waQrImg'); if (img) img.src = nb64; }
      } catch {}
    });
  }

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) { clearInterval(_qrPoll); clearInterval(_stPoll); overlay.remove(); } });
  document.body.appendChild(overlay);
  render(base64);

  let _qrPoll = setInterval(async () => {
    try {
      const data = await apiFetch(`/api/whatsapp-instances/${id}/qr`);
      const nb64 = data?.qrcode?.base64 || data?.base64;
      if (nb64) { const img = modal.querySelector('#waQrImg'); if (img) img.src = nb64; }
    } catch {}
  }, 25000);

  let _stPoll = setInterval(async () => {
    try {
      const { state } = await apiFetch(`/api/whatsapp-instances/${id}/status`);
      if (state === 'open') {
        clearInterval(_qrPoll); clearInterval(_stPoll);
        const dot = modal.querySelector('#waStatusDot');
        const txt = modal.querySelector('#waQrStatus');
        if (dot) { dot.style.background = '#22c55e'; dot.style.animation = 'none'; }
        if (txt) txt.textContent = 'WhatsApp conectado!';
        setTimeout(() => { overlay.remove(); _refreshWaList(); }, 1200);
        const inst = _waInstances.find(i => i.id === id);
        if (inst) inst.status = 'connected';
        _refreshWaList();
      }
    } catch {}
  }, 3000);
}

// ── Sync webhook ─────────────────────────────────────────────

window._waSyncWebhook = async function(id) {
  try {
    const btn = document.querySelector(`#waCard_${id} [onclick*="_waSyncWebhook"]`);
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    await apiFetch(`/api/whatsapp-instances/${id}/sync-webhook`, { method: 'POST' });
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    alert('Webhook re-sincronizado! Mensagens enviadas externamente (n8n, API) agora aparecerão no CRM.');
  } catch (err) {
    alert('Erro ao sincronizar: ' + err.message);
  }
};

// ── Delete instance ───────────────────────────────────────────

window._waDeleteInstance = async function(id) {
  if (!confirm('Desconectar e remover este número?')) return;
  try {
    await apiFetch(`/api/whatsapp-instances/${id}`, { method: 'DELETE' });
    _waInstances = _waInstances.filter(i => i.id !== id);
    _refreshWaList();
  } catch (err) {
    alert(err.message);
  }
};

// ── Refresh list in DOM ───────────────────────────────────────

function _refreshWaList() {
  const list = document.getElementById('waInstancesList');
  if (!list) return;
  list.innerHTML = _waInstances.length === 0
    ? `<div style="padding:24px;text-align:center;color:var(--color-text-3);font-size:13px;background:var(--color-surface);border:1px dashed var(--color-border);border-radius:12px">
         Nenhum número conectado ainda. Clique em <b>Adicionar número</b> para começar.
       </div>`
    : _waInstances.map((inst, i) => _waInstanceCard(inst, i)).join('');
  lucide.createIcons();
}
