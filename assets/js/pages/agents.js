// ======================================
// FAVX CRM — Agentes de IA
// ======================================

window.loadAgents = async function () {
  return null;
};

function isAiActive() {
  return localStorage.getItem('favx_ai_enabled') !== 'false';
}

window.pageAgents = function () {
  const active = isAiActive();

  return `
  <div class="page-header" style="margin-bottom:24px">
    <div>
      <h1 class="page-title">Agentes de IA</h1>
      <p class="page-subtitle">Gerencie a inteligência artificial da sua subconta</p>
    </div>
  </div>

  <!-- STATUS CARD -->
  <div style="max-width:560px">
    <div class="card" style="padding:28px 28px 24px;display:flex;flex-direction:column;gap:24px">

      <!-- Plano + status -->
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

      <!-- Descrição -->
      <p style="font-size:13px;color:var(--color-text-3);line-height:1.6;border-top:1px solid var(--color-border);padding-top:20px">
        Com a IA ativa, sua subconta conta com respostas automáticas, movimentação inteligente no funil,
        qualificação de leads e muito mais — tudo executado de forma autônoma pelos agentes configurados internamente.
      </p>

      <!-- Ação -->
      ${window.favxCan('manage_ai') ? `<div style="display:flex;justify-content:flex-end;border-top:1px solid var(--color-border);padding-top:20px">
        ${active
          ? `<button class="btn btn-sm" id="btnToggleAi" style="background:var(--color-red-lite);color:var(--color-red);border:1px solid var(--color-red);gap:6px;font-weight:600">
               <i data-lucide="power" style="width:14px;height:14px"></i>
               Desativar IA
             </button>`
          : `<button class="btn btn-primary btn-sm" id="btnToggleAi" style="gap:6px">
               <i data-lucide="power" style="width:14px;height:14px"></i>
               Ativar IA
             </button>`
        }
      </div>` : ''}

    </div>
  </div>
  `;
};

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
  const m = document.getElementById('aiModal');
  if (m) m.remove();
}

function openDeactivateConfirm() {
  showAiModal(`
    <div style="background:var(--color-surface);border-radius:16px;width:420px;max-width:100%;padding:36px 32px 28px;display:flex;flex-direction:column;align-items:center;gap:0;box-shadow:0 32px 64px rgba(0,0,0,.25)">

      <!-- Ícone de alerta -->
      <div style="width:64px;height:64px;border-radius:50%;background:var(--color-yellow-lite);display:flex;align-items:center;justify-content:center;margin-bottom:20px">
        <i data-lucide="alert-triangle" style="width:30px;height:30px;color:var(--color-yellow)"></i>
      </div>

      <!-- Texto -->
      <p style="font-size:14px;color:var(--color-text-2);text-align:center;line-height:1.65;margin-bottom:28px">
        Desativar a IA desativará funções automáticas como respostas automáticas,
        movimentação do funil e etc.<br><br>
        Tem certeza que deseja continuar?
      </p>

      <!-- Ações -->
      <div style="display:flex;flex-direction:column;gap:10px;width:100%">
        <button class="btn btn-primary" id="btnAiBack" style="width:100%;justify-content:center;padding:11px">
          Voltar
        </button>
        <button class="btn btn-secondary" id="btnAiConfirmDeactivate" style="width:100%;justify-content:center;padding:10px;color:var(--color-text-3);font-weight:500">
          Desativar IA
        </button>
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

function reloadAgentsPage() {
  const content = document.getElementById('pageContent');
  if (!content) return;
  content.innerHTML = window.pageAgents();
  lucide.createIcons();
  window.initAgents();
}

window.initAgents = function () {
  const btn = document.getElementById('btnToggleAi');
  if (!btn) return;

  if (isAiActive()) {
    btn.addEventListener('click', openDeactivateConfirm);
  } else {
    btn.addEventListener('click', () => {
      localStorage.setItem('favx_ai_enabled', 'true');
      reloadAgentsPage();
    });
  }
};
