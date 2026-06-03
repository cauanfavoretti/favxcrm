// ======================================
// FAVX CRM — Página de Integrações
// ======================================

const _WA_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="28" height="28" fill="#25D366"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>`;

const _INTEGRATIONS = [
  { key: 'whatsapp', icon: _WA_ICON,  name: 'WhatsApp',          desc: 'Conecte via Evolution API para enviar e receber mensagens diretamente no CRM.', soon: false },
  { key: null, icon: '📸',            name: 'Instagram DM',      desc: 'Receba e responda mensagens diretas do Instagram diretamente no CRM.',           soon: true  },
  { key: null, icon: '📧',            name: 'Email (SMTP/IMAP)', desc: 'Configure seu servidor de email para centralizar todas as comunicações.',         soon: true  },
  { key: null, icon: '🤖',            name: 'OpenAI / GPT',      desc: 'Conecte sua chave da OpenAI para potencializar os agentes de IA internos.',      soon: true  },
  { key: null, icon: '💬',            name: 'Telegram',          desc: 'Integre o bot do Telegram para atendimento via chat nesta plataforma.',           soon: true  },
  { key: null, icon: '📊',            name: 'Google Analytics',  desc: 'Monitore conversões e eventos do CRM no seu painel do Google Analytics.',        soon: true  },
  { key: null, icon: '🔗',            name: 'Webhook',           desc: 'Configure webhooks personalizados para integrar com qualquer sistema externo.',   soon: true  },
  { key: null, icon: '📋',            name: 'Zapier / Make',     desc: 'Conecte o FAVX CRM a centenas de apps via Zapier ou Make (Integromat).',         soon: true  },
];

window.pageIntegrations = function() {
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Integrações</h1>
      <p class="page-subtitle">Conecte o FAVX CRM com suas ferramentas favoritas</p>
    </div>
  </div>

  <div class="integration-grid">
    ${_INTEGRATIONS.map(i => `
    <div class="integration-card${i.soon ? ' integration-soon' : ''}" ${i.key ? `id="intCard_${i.key}"` : ''}>
      <div class="integration-icon">${i.icon}</div>
      <div>
        <div class="integration-name">${i.name}</div>
        <div class="integration-desc">${i.desc}</div>
      </div>
      <div class="integration-footer" ${i.key ? `id="intFooter_${i.key}"` : ''}>
        ${i.soon
          ? `<span class="badge badge-gray">Em breve</span><button class="btn btn-secondary btn-sm" disabled>Em breve</button>`
          : `<span class="badge badge-blue" id="intBadge_${i.key}">Disponível</span>
             <button class="btn btn-primary btn-sm" id="intBtn_${i.key}">Conectar</button>`}
      </div>
    </div>`).join('')}
  </div>`;
};

window.initIntegrations = async function() {
  // Load WhatsApp status and update card
  try {
    const wa = await apiFetch('/api/integrations/whatsapp');
    _waUpdateCard(wa);
  } catch {}

  document.getElementById('intBtn_whatsapp')?.addEventListener('click', _openWaModal);
};

// ── Card state ────────────────────────────────────────────────

function _waUpdateCard(wa) {
  const badge = document.getElementById('intBadge_whatsapp');
  const btn   = document.getElementById('intBtn_whatsapp');
  if (!badge || !btn) return;

  if (wa?.state === 'open') {
    badge.className = 'badge badge-green';
    badge.textContent = 'Conectado';
    btn.textContent = 'Gerenciar';
    btn.className = 'btn btn-secondary btn-sm';
  } else if (wa?.configured) {
    badge.className = 'badge badge-yellow';
    badge.textContent = 'Desconectado';
    btn.textContent = 'Reconectar';
    btn.className = 'btn btn-primary btn-sm';
  } else {
    badge.className = 'badge badge-blue';
    badge.textContent = 'Disponível';
    btn.textContent = 'Conectar';
    btn.className = 'btn btn-primary btn-sm';
  }
}

// ── WhatsApp modal ────────────────────────────────────────────

let _waStatusInterval = null;
let _waQrInterval     = null;

function _waClearTimers() {
  clearInterval(_waStatusInterval);
  clearInterval(_waQrInterval);
  _waStatusInterval = null;
  _waQrInterval     = null;
}

async function _openWaModal() {
  document.getElementById('waModal')?.remove();
  _waClearTimers();

  let waInfo = { configured: false, state: null, instance_name: null };
  try { waInfo = await apiFetch('/api/integrations/whatsapp'); } catch {}

  const overlay = document.createElement('div');
  overlay.id = 'waModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.52);z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--color-surface);border-radius:16px;width:480px;max-width:100%;box-shadow:0 32px 80px rgba(0,0,0,.28);overflow:hidden;display:flex;flex-direction:column';

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) _closeWaModal(overlay); });
  document.body.appendChild(overlay);

  if (waInfo.state === 'open') {
    _waRenderConnected(modal, waInfo, overlay);
  } else if (waInfo.configured) {
    _waRenderQr(modal, null, waInfo.instance_name, overlay);
    _waStartConnect(modal, null, null, waInfo.instance_name, overlay);
  } else {
    _waRenderConfig(modal, overlay);
  }
}

function _closeWaModal(overlay) {
  _waClearTimers();
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity .2s';
  setTimeout(() => overlay.remove(), 200);
}

// ── Modal header ──────────────────────────────────────────────

function _waHeader(title, sub, onClose) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:20px 24px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:14px;flex-shrink:0';
  wrap.innerHTML = `
    <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      ${_WA_ICON}
    </div>
    <div style="flex:1">
      <div style="font-size:15px;font-weight:700;color:var(--color-text-1)">${title}</div>
      <div style="font-size:12px;color:var(--color-text-3);margin-top:1px">${sub}</div>
    </div>
    <button id="waBtnClose" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px;color:var(--color-text-3);flex-shrink:0">
      <i data-lucide="x" style="width:18px;height:18px"></i>
    </button>`;
  wrap.querySelector('#waBtnClose').addEventListener('click', onClose);
  lucide.createIcons();
  return wrap;
}

// ── Phase: Config ─────────────────────────────────────────────

function _waRenderConfig(modal, overlay) {
  modal.innerHTML = '';
  const close = () => _closeWaModal(overlay);
  modal.appendChild(_waHeader('Conectar WhatsApp', 'Via Evolution API', close));

  const body = document.createElement('div');
  body.style.cssText = 'padding:24px;display:flex;flex-direction:column;gap:16px';
  body.innerHTML = `
    <div>
      <label style="font-size:11px;font-weight:700;color:var(--color-text-2);display:block;margin-bottom:7px;letter-spacing:.06em">
        URL DA API EVOLUTION <span style="color:var(--color-red)">*</span>
      </label>
      <input id="waApiUrl" class="settings-input" style="width:100%" placeholder="https://evo.seuservidor.com" />
      <div style="font-size:11px;color:var(--color-text-3);margin-top:5px">Sem barra no final. Ex: <code style="font-size:11px;background:var(--color-bg-2);padding:1px 5px;border-radius:4px">https://evo.seudominio.com</code></div>
    </div>
    <div>
      <label style="font-size:11px;font-weight:700;color:var(--color-text-2);display:block;margin-bottom:7px;letter-spacing:.06em">
        CHAVE DA API GLOBAL <span style="color:var(--color-red)">*</span>
      </label>
      <input id="waApiKey" class="settings-input" style="width:100%" type="password" placeholder="••••••••••••••••••••••••" />
      <div style="font-size:11px;color:var(--color-text-3);margin-top:5px">Encontrada em: Evolution API → Settings → Global API Key</div>
    </div>
    <div id="waConfigErr" style="font-size:12px;color:var(--color-red);min-height:14px"></div>`;

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:16px 24px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0';
  footer.innerHTML = `
    <button id="waConfigCancel" class="btn btn-secondary btn-sm">Cancelar</button>
    <button id="waConfigNext" class="btn btn-primary btn-sm" style="display:flex;align-items:center;gap:6px">
      Próximo <i data-lucide="arrow-right" style="width:13px;height:13px"></i>
    </button>`;

  modal.appendChild(body);
  modal.appendChild(footer);
  lucide.createIcons();

  footer.querySelector('#waConfigCancel').addEventListener('click', close);
  footer.querySelector('#waConfigNext').addEventListener('click', async () => {
    const url = body.querySelector('#waApiUrl').value.trim();
    const key = body.querySelector('#waApiKey').value.trim();
    const err = body.querySelector('#waConfigErr');
    if (!url) { err.textContent = 'URL da API é obrigatória.'; return; }
    if (!key) { err.textContent = 'Chave da API é obrigatória.'; return; }
    err.textContent = '';

    const btn = footer.querySelector('#waConfigNext');
    btn.disabled = true;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin .7s linear infinite"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Conectando...`;

    _waStartConnect(modal, url, key, null, overlay, () => {
      btn.disabled = false;
      btn.innerHTML = `Próximo <i data-lucide="arrow-right" style="width:13px;height:13px"></i>`;
      lucide.createIcons();
    }, (msg) => {
      err.textContent = msg;
      btn.disabled = false;
      btn.innerHTML = `Próximo <i data-lucide="arrow-right" style="width:13px;height:13px"></i>`;
      lucide.createIcons();
    });
  });

  setTimeout(() => body.querySelector('#waApiUrl')?.focus(), 40);
}

// ── Phase: QR ─────────────────────────────────────────────────

function _waRenderQr(modal, base64, instanceName, overlay) {
  modal.innerHTML = '';
  const close = () => _closeWaModal(overlay);
  modal.appendChild(_waHeader('Escanear QR Code', `Instância: ${instanceName || '—'}`, close));

  const body = document.createElement('div');
  body.style.cssText = 'padding:28px 24px;display:flex;flex-direction:column;align-items:center;gap:0';

  const qrBox = base64
    ? `<img id="waQrImg" src="${base64}" style="width:220px;height:220px;border-radius:12px;border:2px solid var(--color-border)" />`
    : `<div id="waQrImg" style="width:220px;height:220px;border-radius:12px;border:2px solid var(--color-border);background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:var(--color-text-3)">
        <div style="width:28px;height:28px;border:2.5px solid var(--color-border);border-top-color:var(--color-accent);border-radius:50%;animation:spin .7s linear infinite"></div>
        <div style="font-size:12px">Carregando QR...</div>
      </div>`;

  body.innerHTML = `
    ${qrBox}
    <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px;width:100%;max-width:360px">
      <div style="font-size:12px;font-weight:700;color:var(--color-text-1);margin-bottom:2px">Como conectar:</div>
      ${['Abra o WhatsApp no seu celular', 'Toque em ⋮ → Aparelhos conectados', 'Toque em <b>Conectar aparelho</b>', 'Aponte a câmera para o QR Code acima'].map((s,i) => `
        <div style="display:flex;align-items:flex-start;gap:10px;font-size:12px;color:var(--color-text-2)">
          <div style="width:20px;height:20px;border-radius:50%;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--color-text-3);flex-shrink:0;margin-top:1px">${i+1}</div>
          <span>${s}</span>
        </div>`).join('')}
    </div>
    <div style="margin-top:20px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-3)">
      <div style="width:8px;height:8px;border-radius:50%;background:#fbbf24;animation:pulse 1.4s ease-in-out infinite"></div>
      <span id="waQrStatus">Aguardando leitura do QR code...</span>
    </div>`;

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:14px 24px;border-top:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0';
  footer.innerHTML = `
    <button id="waBtnReconfig" class="btn btn-ghost btn-sm" style="display:flex;align-items:center;gap:5px;font-size:12px">
      <i data-lucide="settings" style="width:13px;height:13px"></i> Reconfigurar
    </button>
    <button id="waBtnRefreshQr" class="btn btn-secondary btn-sm" style="display:flex;align-items:center;gap:5px">
      <i data-lucide="refresh-cw" style="width:13px;height:13px"></i> Atualizar QR
    </button>`;

  modal.appendChild(body);
  modal.appendChild(footer);
  lucide.createIcons();

  footer.querySelector('#waBtnReconfig').addEventListener('click', () => {
    _waClearTimers();
    _waRenderConfig(modal, overlay);
  });

  footer.querySelector('#waBtnRefreshQr').addEventListener('click', async () => {
    const btn = footer.querySelector('#waBtnRefreshQr');
    btn.disabled = true;
    try {
      const data = await apiFetch('/api/integrations/whatsapp/qr');
      const newB64 = data?.qrcode?.base64 || data?.base64;
      if (newB64) _waSetQrImage(modal, newB64);
    } catch {}
    btn.disabled = false;
  });
}

function _waSetQrImage(modal, base64) {
  const img = modal.querySelector('#waQrImg');
  if (!img) return;
  img.outerHTML = `<img id="waQrImg" src="${base64}" style="width:220px;height:220px;border-radius:12px;border:2px solid var(--color-border)" />`;
}

// ── Phase: Connected ──────────────────────────────────────────

function _waRenderConnected(modal, waInfo, overlay) {
  modal.innerHTML = '';
  const close = () => _closeWaModal(overlay);
  modal.appendChild(_waHeader('WhatsApp Conectado', 'Integração ativa e funcionando', close));

  const body = document.createElement('div');
  body.style.cssText = 'padding:32px 24px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center';
  body.innerHTML = `
    <div style="width:72px;height:72px;border-radius:50%;background:#dcfce7;display:flex;align-items:center;justify-content:center">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </div>
    <div>
      <div style="font-size:16px;font-weight:800;color:var(--color-text-1);margin-bottom:6px">Conectado com sucesso!</div>
      <div style="font-size:13px;color:var(--color-text-3)">O WhatsApp está ativo e pronto para uso no CRM.</div>
    </div>
    <div style="background:var(--color-bg-2);border-radius:10px;padding:12px 20px;width:100%;max-width:300px">
      <div style="font-size:11px;color:var(--color-text-3);font-weight:600;letter-spacing:.06em;margin-bottom:4px">INSTÂNCIA</div>
      <div style="font-size:14px;font-weight:700;color:var(--color-text-1);font-family:monospace">${waInfo.instance_name || '—'}</div>
    </div>`;

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:16px 24px;border-top:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0';
  footer.innerHTML = `
    <button id="waBtnDisconnect" class="btn btn-ghost btn-sm" style="color:var(--color-red);display:flex;align-items:center;gap:5px">
      <i data-lucide="log-out" style="width:13px;height:13px"></i> Desconectar
    </button>
    <button id="waBtnCloseConnected" class="btn btn-primary btn-sm">Fechar</button>`;

  modal.appendChild(body);
  modal.appendChild(footer);
  lucide.createIcons();

  footer.querySelector('#waBtnCloseConnected').addEventListener('click', close);
  footer.querySelector('#waBtnDisconnect').addEventListener('click', async () => {
    if (!confirm('Desconectar o WhatsApp desta subconta?')) return;
    const btn = footer.querySelector('#waBtnDisconnect');
    btn.disabled = true;
    btn.textContent = 'Desconectando...';
    try {
      await apiFetch('/api/integrations/whatsapp/disconnect', { method: 'DELETE' });
      _waUpdateCard({ configured: true, state: 'close' });
      _closeWaModal(overlay);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="log-out" style="width:13px;height:13px"></i> Desconectar`;
      lucide.createIcons();
      alert(err.message);
    }
  });
}

// ── Connect flow + polling ────────────────────────────────────

async function _waStartConnect(modal, apiUrl, apiKey, existingInstance, overlay, onQrShown, onError) {
  try {
    const body = {};
    if (apiUrl) body.api_url = apiUrl;
    if (apiKey) body.api_key = apiKey;

    const result = await apiFetch('/api/integrations/whatsapp/connect', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (result.state === 'open') {
      _waUpdateCard({ configured: true, state: 'open', instance_name: result.instance_name });
      _waRenderConnected(modal, result, overlay);
      if (onQrShown) onQrShown();
      return;
    }

    _waRenderQr(modal, result.base64, result.instance_name, overlay);
    if (onQrShown) onQrShown();
    _waStartPolling(modal, result.instance_name, overlay);
  } catch (err) {
    if (onError) onError(err.message);
    else {
      const errEl = modal.querySelector('#waConfigErr');
      if (errEl) errEl.textContent = err.message;
    }
  }
}

function _waStartPolling(modal, instanceName, overlay) {
  _waClearTimers();

  // Poll status every 3s
  _waStatusInterval = setInterval(async () => {
    try {
      const { state } = await apiFetch('/api/integrations/whatsapp/status');
      if (state === 'open') {
        _waClearTimers();
        _waUpdateCard({ configured: true, state: 'open', instance_name: instanceName });
        const statusEl = modal.querySelector('#waQrStatus');
        if (statusEl) {
          statusEl.style.color = 'var(--color-green)';
          statusEl.textContent = 'WhatsApp conectado! Redirecionando...';
          const dot = statusEl.previousElementSibling;
          if (dot) { dot.style.background = '#22c55e'; dot.style.animation = 'none'; }
        }
        setTimeout(() => _waRenderConnected(modal, { instance_name: instanceName }, overlay), 900);
      }
    } catch {}
  }, 3000);

  // Refresh QR every 25s (QR codes expire in ~60s)
  _waQrInterval = setInterval(async () => {
    try {
      const data = await apiFetch('/api/integrations/whatsapp/qr');
      const newB64 = data?.qrcode?.base64 || data?.base64;
      if (newB64) {
        const img = modal.querySelector('#waQrImg');
        if (img) img.src = newB64;
      }
    } catch {}
  }, 25000);
}
