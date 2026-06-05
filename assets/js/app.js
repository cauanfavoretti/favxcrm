// ======================================
// FAVX CRM — Main Application Controller
// ======================================

// ---- Guarda de autenticação ----
(function authGuard() {
  const token = localStorage.getItem('favx_token') || sessionStorage.getItem('favx_token');
  if (!token) window.location.href = 'login.html';
})();

// ---- Role helpers (acessíveis por todas as páginas) ----
window.favxCurrentUser = function() {
  const t = localStorage.getItem('favx_token') || sessionStorage.getItem('favx_token');
  if (!t) return null;
  try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; }
};

// Ações restritas ao role "user": editar dashboards, gerenciar IA, alterar configurações
window.favxCan = function(action) {
  const role = window.favxCurrentUser()?.role;
  if (!role) return false;
  if (role === 'super_admin' || role === 'admin') return true;
  const restricted = new Set(['edit_dashboard', 'manage_ai', 'manage_settings']);
  return !restricted.has(action);
};

const ROLE_DISPLAY = { super_admin: 'Desenvolvedor', admin: 'Admin', user: 'Usuário' };

// Pages that require admin / super_admin role
const ADMIN_ONLY_PAGES = new Set(['subaccounts']);

const PAGE_MAP = {
  'dashboard':    { load: window.loadDashboard,    render: window.pageDashboard,    init: window.initDashboard,    label: 'Dashboard' },
  'contacts':     { load: window.loadContacts,     render: window.pageContacts,     init: window.initContacts,     label: 'Contatos' },
  'conversations':{ load: window.loadConversations,render: window.pageConversations,init: window.initConversations,label: 'Conversas' },
  'funnels':      { load: window.loadFunnels,      render: window.pageFunnels,      init: window.initFunnels,      label: 'Funis' },
  'agents':       { load: window.loadAgents,       render: window.pageAgents,       init: window.initAgents,       label: 'Agentes de IA' },
  'ai-dashboard': { load: null,                    render: window.pageAiDashboard,  init: window.initAiDashboard,  label: 'Painel da IA' },
  'automations':  { load: window.loadAutomations,  render: window.pageAutomations,  init: window.initAutomations,  label: 'Automações' },
  'settings':     { load: null,                    render: window.pageSettings,     init: window.initSettings,     label: 'Configurações' },
  'integrations': { load: window.loadIntegrations, render: window.pageIntegrations, init: window.initIntegrations, label: 'Integrações' },
  'subaccounts':  { load: window.loadSubaccounts,  render: window.pageSubaccounts,  init: window.initSubaccounts,  label: 'Subcontas' },
};

let currentPage = 'dashboard';

function showPageLoading(content) {
  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:300px;flex-direction:column;gap:12px">
      <div style="width:32px;height:32px;border:3px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin 0.7s linear infinite"></div>
      <span style="font-size:13px;color:#9ca3af">Carregando...</span>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
}

async function navigateTo(page) {
  if (!PAGE_MAP[page]) return;

  // Teardown hooks for pages that need cleanup
  if (currentPage === 'conversations' && typeof window.unloadConversations === 'function') {
    window.unloadConversations();
  }

  // Block admin-only pages for non-super_admin users
  if (ADMIN_ONLY_PAGES.has(page)) {
    const u = decodeToken();
    if (u?.role !== 'super_admin') {
      page = 'dashboard';
    }
  }
  currentPage = page;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  const bc = document.getElementById('breadcrumb');
  if (bc) bc.textContent = PAGE_MAP[page].label;

  const content = document.getElementById('pageContent');
  const entry   = PAGE_MAP[page];

  showPageLoading(content);

  let data = null;
  if (typeof entry.load === 'function') {
    try {
      data = await entry.load();
    } catch (err) {
      console.error(`[nav] Erro ao carregar ${page}:`, err.message);
    }
  }

  content.innerHTML = entry.render(data);
  lucide.createIcons();

  if (typeof entry.init === 'function') entry.init(data);

  content.querySelectorAll('[data-page]').forEach(el => {
    if (el.tagName === 'A' || el.classList.contains('nav-link-btn')) {
      el.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(el.dataset.page);
      });
    }
  });

  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('mobile-open')) sidebar.classList.remove('mobile-open');
}

// ---- Sidebar toggle ----
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

// ---- Mobile menu ----
document.getElementById('mobileMenuBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('mobile-open');
});

// ---- Nav links ----
document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(el.dataset.page);
  });
});

// ---- Subaccount switcher ----

function decodeToken() {
  const token = localStorage.getItem('favx_token') || sessionStorage.getItem('favx_token');
  if (!token) return null;
  try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
}

window.updateSubaccountSwitcher = function (sub) {
  const nameEl = document.getElementById('subaccountSwitcherName');
  if (nameEl && sub) nameEl.textContent = sub.name;
};

async function initSubaccountSwitcher() {
  const user = decodeToken();
  if (!user) return;

  const isSuperAdmin = user.role === 'super_admin';

  // Mostra/oculta nav item de subcontas e o switcher de subconta (só super_admin)
  document.querySelectorAll('.nav-admin-only').forEach(el => {
    el.style.display = isSuperAdmin ? '' : 'none';
  });
  const switcherWrap = document.getElementById('subaccountSwitcherWrap');
  if (switcherWrap) switcherWrap.style.display = isSuperAdmin ? '' : 'none';

  // Preenche nome inicial a partir do que estiver em cache
  const currentSub = JSON.parse(localStorage.getItem('favx_subaccount') || 'null');
  if (currentSub) window.updateSubaccountSwitcher(currentSub);

  // Dropdown do switcher
  const btn  = document.getElementById('subaccountSwitcherBtn');
  const menu = document.getElementById('subaccountSwitcherMenu');

  btn?.addEventListener('click', async e => {
    e.stopPropagation();
    if (!menu.hidden) { menu.hidden = true; return; }

    menu.innerHTML = `<div style="padding:8px 14px;font-size:12px;color:var(--color-text-3)">Carregando...</div>`;
    menu.hidden = false;

    try {
      const subs = await apiFetch('/api/subaccounts');
      const fresh = decodeToken();
      menu.innerHTML = subs.map(s => `
        <button class="switcher-item" data-id="${s.id}" data-name="${s.name}" style="
          display:flex;align-items:center;gap:10px;width:100%;padding:8px 14px;
          background:none;border:none;cursor:pointer;font-size:13px;text-align:left;
          color:var(--color-text-1);${s.id === fresh?.subaccount_id ? 'font-weight:700;' : ''}
        ">
          <span style="width:24px;height:24px;border-radius:6px;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${s.name[0].toUpperCase()}</span>
          <span style="flex:1">${s.name}</span>
          ${s.id === fresh?.subaccount_id ? '<i data-lucide="check" style="width:13px;height:13px;color:#22c55e"></i>' : ''}
        </button>
      `).join('') || `<div style="padding:8px 14px;font-size:12px;color:var(--color-text-3)">Nenhuma subconta.</div>`;
      lucide.createIcons();

      menu.querySelectorAll('.switcher-item').forEach(item => {
        item.addEventListener('click', async () => {
          menu.hidden = true;
          const fresh2 = decodeToken();
          if (item.dataset.id === fresh2?.subaccount_id) return;
          try {
            const res = await apiFetch('/api/subaccounts/switch', {
              method: 'POST',
              body: JSON.stringify({ subaccount_id: item.dataset.id }),
            });
            const storage = localStorage.getItem('favx_token') ? localStorage : sessionStorage;
            storage.setItem('favx_token', res.token);
            localStorage.setItem('favx_subaccount', JSON.stringify(res.subaccount));
            window.updateSubaccountSwitcher(res.subaccount);
            navigateTo(currentPage);
          } catch (err) { alert(err.message); }
        });
      });
    } catch {
      menu.innerHTML = `<div style="padding:8px 14px;font-size:12px;color:var(--color-red)">Erro ao carregar.</div>`;
    }
  });

  document.addEventListener('click', () => { if (menu) menu.hidden = true; });
}

// ---- Theme toggle ----
(function initTheme() {
  const saved = localStorage.getItem('favx_theme') || 'light';
  applyTheme(saved, false);

  document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark', true);
  });
})();

function applyTheme(theme, animate) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('favx_theme', theme);

  const icon = document.getElementById('themeIcon');
  const btn  = document.getElementById('themeToggleBtn');
  if (!icon) return;

  const newIcon = theme === 'dark' ? 'moon' : 'sun';

  if (animate && btn && !btn.classList.contains('theme-animating')) {
    btn.classList.add('theme-animating');

    // Troca o ícone no pico da expansão (50% da duração = 360ms)
    setTimeout(() => {
      icon.setAttribute('data-lucide', newIcon);
      lucide.createIcons();
    }, 360);

    // Remove a classe ao fim da animação (720ms)
    setTimeout(() => btn.classList.remove('theme-animating'), 720);
  } else {
    icon.setAttribute('data-lucide', newIcon);
    lucide.createIcons();
  }
}

// ---- Welcome splash ----
function showWelcomeSplash(onDone) {
  const FADE = 420;
  const TOTAL = 2600; // total antes do fade
  const TEXT  = 'Boas vindas a FAVX';

  const splash = document.createElement('div');
  splash.id = 'welcomeSplash';
  splash.style.cssText = `position:fixed;inset:0;background:#06060e;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:opacity ${FADE}ms ease`;

  splash.innerHTML = `<style>
    /* Skew aleatório no wrapper */
    @keyframes ws-skew {
      0%,100%{transform:skewX(0deg) skewY(0deg)}
      18%{transform:skewX(-1.4deg) skewY(.3deg)}
      36%{transform:skewX(.9deg)  skewY(-.2deg)}
      54%{transform:skewX(-.5deg) skewY(.1deg)}
      72%{transform:skewX(.3deg)  skewY(0deg)}
    }
    /* Flicker geral */
    @keyframes ws-flicker {
      0%,100%{opacity:1}
      6%{opacity:.55}
      9%{opacity:1}
      27%{opacity:.7}
      30%{opacity:1}
      52%{opacity:.6}
      55%{opacity:1}
      80%{opacity:.85}
      83%{opacity:1}
    }
    /* Texto principal: sai do caos e estabiliza */
    @keyframes ws-settle {
      0%  {filter:blur(6px) brightness(2);letter-spacing:.12em;opacity:.4}
      60% {filter:blur(1px) brightness(1.1);letter-spacing:.01em;opacity:.95}
      100%{filter:blur(0)   brightness(1);  letter-spacing:-.01em;opacity:1}
    }
    /* Canal vermelho — fatias com deslocamento horizontal */
    @keyframes ws-cr {
      0%  {clip-path:inset(40% 0 48% 0);transform:translate(-5px,0)}
      20% {clip-path:inset(5%  0 82% 0);transform:translate( 6px,0)}
      40% {clip-path:inset(68% 0 14% 0);transform:translate(-4px,0)}
      60% {clip-path:inset(22% 0 60% 0);transform:translate( 5px,0)}
      80% {clip-path:inset(55% 0 30% 0);transform:translate(-3px,0)}
      100%{clip-path:inset(40% 0 48% 0);transform:translate(-5px,0)}
    }
    /* Canal ciano — defasado do vermelho */
    @keyframes ws-cb {
      0%  {clip-path:inset(58% 0 24% 0);transform:translate( 5px,0)}
      25% {clip-path:inset(3%  0 88% 0);transform:translate(-6px,0)}
      50% {clip-path:inset(75% 0 8%  0);transform:translate( 4px,0)}
      75% {clip-path:inset(15% 0 72% 0);transform:translate(-3px,0)}
      100%{clip-path:inset(58% 0 24% 0);transform:translate( 5px,0)}
    }
    /* Fade-out dos canais coloridos quando o texto estabiliza */
    @keyframes ws-ghost-out { to{opacity:0} }
    /* Feixe de luz varrendo da esquerda para direita */
    @keyframes ws-beam {
      0%  {left:-60%;opacity:0}
      8%  {opacity:1}
      92% {opacity:.8}
      100%{left:135%;opacity:0}
    }
    /* Brilho residual no texto após o feixe passar */
    @keyframes ws-glow {
      0%  {text-shadow:none}
      50% {text-shadow:0 0 30px rgba(120,180,255,.9),0 0 60px rgba(80,140,255,.5)}
      100%{text-shadow:0 0 8px  rgba(120,180,255,.2)}
    }

    #ws-wrap {
      position:relative;
      display:inline-block;
      animation:ws-skew .22s step-end 5, ws-flicker .16s step-end 6;
    }
    #ws-main {
      font-family:'Inter',sans-serif;
      font-size:clamp(24px,4.2vw,54px);
      font-weight:800;
      color:#fff;
      line-height:1;
      user-select:none;
      white-space:nowrap;
      letter-spacing:.12em;
      filter:blur(6px) brightness(2);
      opacity:.4;
      animation:
        ws-settle .75s cubic-bezier(.4,0,.2,1) .55s both,
        ws-glow   .5s ease 1.4s both;
    }
    .ws-ghost {
      position:absolute;inset:0;
      font-family:'Inter',sans-serif;
      font-size:clamp(24px,4.2vw,54px);
      font-weight:800;
      line-height:1;
      user-select:none;
      pointer-events:none;
      white-space:nowrap;
    }
    #ws-cr {
      color:#ff2244;
      animation:
        ws-cr .20s linear infinite,
        ws-ghost-out .35s ease 1.25s forwards;
    }
    #ws-cb {
      color:#00ddff;
      animation:
        ws-cb .17s linear infinite,
        ws-ghost-out .35s ease 1.1s forwards;
    }
    #ws-beam {
      position:absolute;
      top:-40%; height:180%; width:52%;
      left:-60%;
      background:linear-gradient(
        90deg,
        transparent           0%,
        rgba(100,170,255,.08) 25%,
        rgba(180,220,255,.65) 48%,
        rgba(255,255,255,.85) 50%,
        rgba(180,220,255,.65) 52%,
        rgba(100,170,255,.08) 75%,
        transparent           100%
      );
      filter:blur(10px);
      mix-blend-mode:screen;
      pointer-events:none;
      animation:ws-beam .9s cubic-bezier(.3,0,.55,1) .45s both;
    }
  </style>
  <div id="ws-wrap">
    <div id="ws-main">${TEXT}</div>
    <div class="ws-ghost" id="ws-cr" aria-hidden="true">${TEXT}</div>
    <div class="ws-ghost" id="ws-cb" aria-hidden="true">${TEXT}</div>
    <div id="ws-beam"></div>
  </div>`;

  document.body.appendChild(splash);

  setTimeout(() => {
    showCircularReveal(() => {
      splash.remove();
      onDone();
    });
  }, TOTAL);
}

function showCircularReveal(onDone) {
  const reveal = document.createElement('div');
  reveal.style.cssText = [
    'position:fixed;inset:0',
    'background:var(--color-bg)',
    'z-index:10000',
    'clip-path:circle(0% at 2% 98%)',
    'transition:clip-path 780ms cubic-bezier(0.65,0,0.35,1)',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(reveal);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    reveal.style.clipPath = 'circle(160% at 2% 98%)';
  }));

  setTimeout(() => {
    reveal.remove();
    if (onDone) onDone();
  }, 820);
}

// ---- Sidebar user card ----
function initSidebarUser() {
  const stored = localStorage.getItem('favx_user') || sessionStorage.getItem('favx_user');
  if (!stored) return;
  try {
    const u = JSON.parse(stored);
    const nameEl   = document.querySelector('.user-name');
    const roleEl   = document.querySelector('.user-role');
    const avatarEl = document.querySelector('.user-avatar');
    if (nameEl)   nameEl.textContent   = u.name || u.email || '—';
    if (roleEl)   roleEl.textContent   = ROLE_DISPLAY[u.role] || u.role || '—';
    if (avatarEl) avatarEl.textContent = (u.name || u.email || '?')[0].toUpperCase();
  } catch {}
}

// ---- Logout ----
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  ['favx_token', 'favx_user', 'favx_subaccount'].forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
  window.location.href = 'login.html';
});

// ---- Initial load ----
initSidebarUser();
initSubaccountSwitcher();

const _showWelcome = sessionStorage.getItem('favx_show_welcome') === '1';
sessionStorage.removeItem('favx_show_welcome');

if (_showWelcome) {
  showWelcomeSplash(() => checkSubaccountOrNavigate());
} else {
  const blocker = document.createElement('div');
  blocker.style.cssText = 'position:fixed;inset:0;background:#06060e;z-index:9999;pointer-events:none';
  document.body.appendChild(blocker);
  showCircularReveal(() => {
    blocker.remove();
    checkSubaccountOrNavigate();
  });
}

// ============================================================
// SUBACCOUNT PICKER
// ============================================================

async function checkSubaccountOrNavigate() {
  const current = JSON.parse(localStorage.getItem('favx_subaccount') || 'null');
  if (current) { navigateTo('dashboard'); return; }

  const user = decodeToken();
  let subs = [];
  try { subs = (await apiFetch('/api/subaccounts')) || []; } catch {}

  // Usuário fixo a uma única subconta — entra direto
  if (subs.length === 1 && user?.role !== 'super_admin') {
    const s = subs[0];
    localStorage.setItem('favx_subaccount', JSON.stringify({ id: s.id, name: s.name, slug: s.slug }));
    window.updateSubaccountSwitcher(s);
    navigateTo('dashboard');
    return;
  }

  _showSubaccountPicker(subs, user);
}

function _showSubaccountPicker(subs, user) {
  const isSuperAdmin = user?.role === 'super_admin';
  const stored = JSON.parse(localStorage.getItem('favx_user') || sessionStorage.getItem('favx_user') || 'null');
  const firstName = (stored?.name || stored?.email || '').split(' ')[0] || 'bem-vindo';

  const overlay = document.createElement('div');
  overlay.id = 'subPickerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--color-bg);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;opacity:0;transition:opacity .3s ease';

  overlay.innerHTML = `
    <div style="width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:36px">

      <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="var(--color-accent)"/>
            <path d="M8 22L14 10L20 18L24 13L28 22H8Z" fill="#fff" opacity=".9"/>
          </svg>
          <span style="font-size:20px;font-weight:800;letter-spacing:.06em;color:var(--color-text-1)">FAVX <span style="color:var(--color-text-3);font-weight:500">CRM</span></span>
        </div>
        <div style="font-size:27px;font-weight:800;color:var(--color-text-1);text-align:center">
          Olá, ${firstName}
        </div>
        <div style="font-size:14px;color:var(--color-text-3);text-align:center">
          Selecione uma subconta para continuar
        </div>
      </div>

      <div id="subPickerGrid" style="width:100%;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px">
        ${_subPickerCards(subs)}
      </div>

      ${isSuperAdmin ? `
      <button id="btnPickerCreate" style="display:flex;align-items:center;gap:8px;padding:10px 22px;border-radius:10px;border:1.5px dashed var(--color-border-2);font-size:13px;font-weight:600;color:var(--color-text-3);background:none;cursor:pointer;transition:border-color .15s,color .15s">
        <i data-lucide="plus-circle" style="width:16px;height:16px"></i> Nova subconta
      </button>` : ''}
    </div>`;

  document.body.appendChild(overlay);
  lucide.createIcons();
  requestAnimationFrame(() => overlay.style.opacity = '1');

  _bindPickerCards(overlay);
  overlay.querySelector('#btnPickerCreate')?.addEventListener('click', () => {
    window.openSubaccountWizard(sub => {
      const ol = document.getElementById('subPickerOverlay');
      if (ol) { ol.style.opacity = '0'; setTimeout(() => ol.remove(), 280); }
      navigateTo('dashboard');
    });
  });
}

function _subPickerCards(subs) {
  if (!subs.length) return `
    <div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--color-text-3);font-size:13px">
      <i data-lucide="layers" style="width:40px;height:40px;opacity:.18;display:block;margin:0 auto 12px"></i>
      Nenhuma subconta encontrada.
    </div>`;
  return subs.map(s => `
    <button class="sub-picker-card" data-id="${s.id}" data-name="${s.name}" data-slug="${s.slug || ''}" style="
      background:var(--color-surface);border:1.5px solid var(--color-border);border-radius:14px;
      padding:22px 20px;text-align:left;cursor:pointer;
      transition:border-color .15s,box-shadow .15s,transform .12s;
      display:flex;flex-direction:column;gap:12px;
    ">
      <div style="width:46px;height:46px;border-radius:12px;background:var(--color-accent);color:#fff;font-size:20px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        ${s.name[0].toUpperCase()}
      </div>
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--color-text-1);margin-bottom:4px">${s.name}</div>
        <div style="font-size:12px;color:var(--color-text-3)">
          ${s.user_count ?? 0} usuário${(s.user_count ?? 0) !== 1 ? 's' : ''} &middot; ${s.contact_count ?? 0} contato${(s.contact_count ?? 0) !== 1 ? 's' : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--color-accent);font-weight:600;margin-top:2px">
        Entrar <i data-lucide="arrow-right" style="width:13px;height:13px"></i>
      </div>
    </button>`).join('');
}

function _bindPickerCards(overlay) {
  overlay.querySelectorAll('.sub-picker-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--color-accent)';
      card.style.boxShadow   = 'var(--shadow-md)';
      card.style.transform   = 'translateY(-3px)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'var(--color-border)';
      card.style.boxShadow   = 'none';
      card.style.transform   = '';
    });
    card.addEventListener('click', () => {
      const sub = { id: card.dataset.id, name: card.dataset.name, slug: card.dataset.slug };
      localStorage.setItem('favx_subaccount', JSON.stringify(sub));
      window.updateSubaccountSwitcher(sub);
      const ol = document.getElementById('subPickerOverlay');
      if (ol) { ol.style.opacity = '0'; setTimeout(() => ol.remove(), 280); }
      navigateTo('dashboard');
    });
  });
}

window.openSubaccountWizard = function(onSuccess) {
  document.getElementById('subWizardOverlay')?.remove();

  const TIMEZONES = [
    ['America/Sao_Paulo','América/São Paulo (BRT)'],
    ['America/Manaus','América/Manaus (AMT)'],
    ['America/Belem','América/Belém (BRT)'],
    ['America/Fortaleza','América/Fortaleza (BRT)'],
    ['America/Noronha','América/Noronha (FNT)'],
    ['UTC','UTC'],
  ];
  const INDUSTRIES = [
    'Tecnologia e Software','E-commerce e Varejo Online','Saúde e Bem-estar',
    'Educação e Treinamento','Alimentação e Gastronomia','Imobiliário e Construção',
    'Finanças e Contabilidade','Marketing e Publicidade','Jurídico e Advocacia',
    'Consultoria e Gestão','Moda e Vestuário','Beleza e Estética',
    'Turismo e Hospitalidade','Logística e Transporte','Indústria e Manufatura',
    'Agronegócio','Entretenimento e Mídia','Esporte e Fitness',
    'Arquitetura e Design','Eventos e Produção','Automotivo','Pet e Veterinária','Outro',
  ];
  const COMPANY_TYPES = [
    'MEI – Microempreendedor Individual','ME – Microempresa',
    'EPP – Empresa de Pequeno Porte','SLU – Sociedade Limitada Unipessoal',
    'LTDA – Sociedade Limitada','SA – Sociedade Anônima',
    'Associação / ONG','Cooperativa','Outra',
  ];

  let step = 1;
  const d = {};

  const STEP_META = [
    { n:1, icon:'layers',    label:'Subconta',    title:'Sobre a subconta',      sub:'Nome e identificador únicos' },
    { n:2, icon:'building',  label:'Empresa',     title:'Sobre a empresa',       sub:'Informações básicas da empresa' },
    { n:3, icon:'map-pin',   label:'Localização', title:'Contato & Localização', sub:'Como chegar e entrar em contato' },
  ];

  function slugify(v) {
    return v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  }

  function stepperHtml() {
    return `<div style="display:flex;align-items:flex-start;justify-content:center;gap:0;margin-bottom:32px">
      ${STEP_META.map((s, i) => `
        <div style="display:flex;align-items:center">
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;min-width:72px">
            <div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;transition:all .2s;
              ${s.n < step
                ? 'background:var(--color-accent);color:#fff'
                : s.n === step
                  ? 'background:var(--color-accent);color:#fff;box-shadow:0 0 0 5px var(--color-accent-lite)'
                  : 'background:var(--color-bg-2);color:var(--color-text-3)'}">
              ${s.n < step
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                : s.n}
            </div>
            <div style="font-size:10px;font-weight:600;letter-spacing:.04em;white-space:nowrap;
              color:${s.n <= step ? 'var(--color-text-1)' : 'var(--color-text-3)'}">${s.label}</div>
          </div>
          ${i < STEP_META.length - 1
            ? `<div style="width:56px;height:2px;margin:0 0 18px;background:${s.n < step ? 'var(--color-accent)' : 'var(--color-border)'};transition:background .3s"></div>`
            : ''}
        </div>`).join('')}
    </div>`;
  }

  function fieldHtml(id, label, type, placeholder, val, required, hint) {
    const req = required ? `<span style="color:var(--color-red)"> *</span>` : '';
    const hintHtml = hint ? `<div style="font-size:11px;color:var(--color-text-3);margin-top:4px">${hint}</div>` : '';
    return `<div>
      <label style="font-size:11px;font-weight:700;color:var(--color-text-2);display:block;margin-bottom:6px;letter-spacing:.06em">${label}${req}</label>
      <input id="${id}" class="settings-input" style="width:100%" type="${type}" placeholder="${placeholder}" value="${val||''}">
      ${hintHtml}
    </div>`;
  }

  function selectHtml(id, label, options, val, placeholder, required) {
    const req = required ? `<span style="color:var(--color-red)"> *</span>` : '';
    return `<div>
      <label style="font-size:11px;font-weight:700;color:var(--color-text-2);display:block;margin-bottom:6px;letter-spacing:.06em">${label}${req}</label>
      <select id="${id}" class="settings-input" style="width:100%">
        ${placeholder ? `<option value="">${placeholder}</option>` : ''}
        ${options.map(o => {
          const [v,l] = Array.isArray(o) ? o : [o,o];
          return `<option value="${v}" ${v===val?'selected':''}>${l}</option>`;
        }).join('')}
      </select>
    </div>`;
  }

  function bodyHtml() {
    const m = STEP_META[step - 1];
    let fields = '';
    if (step === 1) {
      fields = `
        ${fieldHtml('wName','NOME DA SUBCONTA','text','Ex: Empresa ABC',d.name,true,'')}
        ${fieldHtml('wSlug','IDENTIFICADOR (SLUG)','text','empresa-abc',d.slug,true,'Gerado automaticamente. Não pode ser alterado depois.')}
        ${selectHtml('wTz','FUSO HORÁRIO',TIMEZONES,d.timezone||'America/Sao_Paulo','',false)}`;
    } else if (step === 2) {
      fields = `
        ${fieldHtml('wFantasyName','NOME FANTASIA','text','Nome da marca ou empresa',d.fantasy_name,false,'')}
        ${selectHtml('wIndustry','NICHO / SEGMENTO',INDUSTRIES,d.industry,'Selecione o segmento...',false)}
        ${selectHtml('wCompanyType','TIPO DE EMPRESA',COMPANY_TYPES,d.company_type,'Selecione...',false)}
        ${fieldHtml('wRegId','CNPJ / ID DE REGISTRO','text','00.000.000/0001-00',d.registration_id,false,'')}`;
    } else {
      fields = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${fieldHtml('wEmail','EMAIL COMERCIAL','email','contato@empresa.com',d.commercial_email,false,'')}
          ${fieldHtml('wPhone','TELEFONE COMERCIAL','tel','(11) 99999-9999',d.commercial_phone,false,'')}
        </div>
        ${fieldHtml('wAddress','ENDEREÇO FÍSICO','text','Rua, número, bairro, cidade – Estado, CEP',d.address,true,'')}
        ${fieldHtml('wRegions','REGIÕES DE OPERAÇÃO','text','Ex: Brasil, América Latina',d.operating_regions,false,'')}`;
    }
    return `
      <div style="margin-bottom:22px">
        <div style="font-size:17px;font-weight:800;color:var(--color-text-1);margin-bottom:3px">${m.title}</div>
        <div style="font-size:13px;color:var(--color-text-3)">${m.sub}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">${fields}</div>`;
  }

  function render() {
    modal.innerHTML = `
      <div style="padding:28px 28px 0">
        ${stepperHtml()}
        <div id="wBody">${bodyHtml()}</div>
      </div>
      <div style="padding:18px 28px;margin-top:24px;border-top:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between">
        <span id="wErr" style="font-size:12px;color:var(--color-red);flex:1;padding-right:12px"></span>
        <div style="display:flex;gap:8px;flex-shrink:0">
          ${step === 1
            ? `<button id="wCancel" class="btn btn-secondary btn-sm">Cancelar</button>`
            : `<button id="wBack" class="btn btn-secondary btn-sm" style="display:flex;align-items:center;gap:5px"><i data-lucide="arrow-left" style="width:13px;height:13px"></i> Voltar</button>`}
          <button id="wNext" class="btn btn-primary btn-sm" style="display:flex;align-items:center;gap:5px">
            ${step < 3
              ? `Próximo <i data-lucide="arrow-right" style="width:13px;height:13px"></i>`
              : `<i data-lucide="check" style="width:13px;height:13px"></i> Criar subconta`}
          </button>
        </div>
      </div>`;
    lucide.createIcons();
    bind();
  }

  function collect() {
    if (step === 1) {
      d.name     = modal.querySelector('#wName')?.value.trim()  || '';
      d.slug     = modal.querySelector('#wSlug')?.value.trim()  || '';
      d.timezone = modal.querySelector('#wTz')?.value           || 'America/Sao_Paulo';
    } else if (step === 2) {
      d.fantasy_name   = modal.querySelector('#wFantasyName')?.value.trim() || '';
      d.industry       = modal.querySelector('#wIndustry')?.value           || '';
      d.company_type   = modal.querySelector('#wCompanyType')?.value        || '';
      d.registration_id = modal.querySelector('#wRegId')?.value.trim()      || '';
    } else {
      d.commercial_email  = modal.querySelector('#wEmail')?.value.trim()   || '';
      d.commercial_phone  = modal.querySelector('#wPhone')?.value.trim()   || '';
      d.address           = modal.querySelector('#wAddress')?.value.trim() || '';
      d.operating_regions = modal.querySelector('#wRegions')?.value.trim() || '';
    }
  }

  function validate() {
    const err = modal.querySelector('#wErr');
    if (step === 1) {
      if (!d.name) { err.textContent = 'Nome é obrigatório.';         return false; }
      if (!d.slug) { err.textContent = 'Identificador é obrigatório.'; return false; }
    }
    if (step === 3 && !d.address) {
      err.textContent = 'Endereço físico é obrigatório.'; return false;
    }
    return true;
  }

  function bind() {
    const nameEl = modal.querySelector('#wName');
    const slugEl = modal.querySelector('#wSlug');
    if (nameEl && slugEl) {
      nameEl.addEventListener('input', () => {
        slugEl.value = slugify(nameEl.value);
        d.slug = slugEl.value;
      });
      setTimeout(() => nameEl.focus(), 40);
    }

    modal.querySelector('#wCancel')?.addEventListener('click', () => overlay.remove());

    modal.querySelector('#wBack')?.addEventListener('click', () => {
      collect();
      step--;
      render();
    });

    modal.querySelector('#wNext')?.addEventListener('click', async () => {
      collect();
      if (!validate()) return;

      if (step < 3) { step++; render(); return; }

      const btn = modal.querySelector('#wNext');
      btn.disabled = true;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin .7s linear infinite"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Criando...`;

      try {
        const created = await apiFetch('/api/subaccounts', {
          method: 'POST',
          body: JSON.stringify({ name: d.name, slug: d.slug, timezone: d.timezone }),
        });

        const switched = await apiFetch('/api/subaccounts/switch', {
          method: 'POST',
          body: JSON.stringify({ subaccount_id: created.id }),
        });
        const store = localStorage.getItem('favx_token') ? localStorage : sessionStorage;
        store.setItem('favx_token', switched.token);
        localStorage.setItem('favx_subaccount', JSON.stringify(switched.subaccount));
        if (typeof window.updateSubaccountSwitcher === 'function') {
          window.updateSubaccountSwitcher(switched.subaccount);
        }

        await apiFetch('/api/subaccount-settings', {
          method: 'PUT',
          body: JSON.stringify({
            fantasy_name:    d.fantasy_name    || null,
            industry:        d.industry        || null,
            company_type:    d.company_type    || null,
            registration_id: d.registration_id || null,
            commercial_email: d.commercial_email || null,
            commercial_phone: d.commercial_phone || null,
            address:         d.address         || null,
            operating_regions: d.operating_regions || null,
          }),
        });

        overlay.remove();
        if (typeof onSuccess === 'function') onSuccess(switched.subaccount);
      } catch (err) {
        modal.querySelector('#wErr').textContent = err.message;
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="check" style="width:13px;height:13px"></i> Criar subconta`;
        lucide.createIcons();
      }
    });
  }

  const overlay = document.createElement('div');
  overlay.id = 'subWizardOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.52);z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--color-surface);border-radius:16px;width:520px;max-width:100%;box-shadow:0 32px 80px rgba(0,0,0,.3);overflow:hidden;display:flex;flex-direction:column;max-height:90vh;overflow-y:auto';

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  render();
};
