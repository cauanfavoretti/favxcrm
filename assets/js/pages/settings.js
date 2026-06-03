// ======================================
// FAVX CRM — Página de Configurações
// ======================================

let _stgTab  = 'perfil';
let _stgUser = null;

function _stgDecode() {
  const t = localStorage.getItem('favx_token') || sessionStorage.getItem('favx_token');
  if (!t) return null;
  try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; }
}

function _stgStoredUser() {
  const s = localStorage.getItem('favx_user') || sessionStorage.getItem('favx_user');
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

function _stgIsAdmin() {
  return ['super_admin', 'admin'].includes(_stgUser?.role);
}

// ── Nav ───────────────────────────────────────────────────────

function _stgNavHtml() {
  const canSettings = window.favxCan?.('manage_settings') !== false;
  const tabs = [
    { id: 'perfil',       icon: 'user',        label: 'Perfil' },
    ...(canSettings ? [{ id: 'empresa', icon: 'building', label: 'Empresa' }] : []),
    { id: 'notificacoes', icon: 'bell',         label: 'Notificações' },
    { id: 'seguranca',    icon: 'shield',       label: 'Segurança' },
    { id: 'faturamento',  icon: 'credit-card',  label: 'Faturamento' },
    { id: 'equipe',       icon: 'users',        label: 'Equipe' },
  ];
  if (_stgIsAdmin()) {
    tabs.unshift({ id: 'contas', icon: 'user-cog', label: 'Contas', admin: true });
  }
  return tabs.map(t => `
    <div class="settings-nav-item${_stgTab === t.id ? ' active' : ''}" data-tab="${t.id}">
      <i data-lucide="${t.icon}" style="width:15px;height:15px"></i>
      <span style="flex:1">${t.label}</span>
      ${t.admin ? '<span class="stg-admin-badge">Admin</span>' : ''}
    </div>
  `).join('');
}

// ── Tab content ───────────────────────────────────────────────

function _stgPerfilHtml(profile) {
  const su = profile || _stgStoredUser();
  const firstName   = su?.name      || '';
  const lastName    = su?.last_name  || '';
  const displayEmail = su?.email    || '';
  const phone        = su?.phone    || '';
  const avatarLetter = (firstName || displayEmail || '?')[0].toUpperCase();
  const displayName  = [firstName, lastName].filter(Boolean).join(' ') || displayEmail || '—';
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header" style="margin-bottom:20px">
        <div class="card-title">Informações do Perfil</div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
        <div id="stgAvatarCircle" style="width:72px;height:72px;border-radius:50%;background:var(--color-accent);color:#fff;font-size:28px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${avatarLetter}</div>
        <div>
          <div id="stgDisplayName" style="font-size:14px;font-weight:700;margin-bottom:4px">${displayName}</div>
          <div style="font-size:12px;color:var(--color-text-3)">${displayEmail}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="settings-field">
          <label class="settings-label">Nome</label>
          <input id="stgFirstName" class="settings-input" value="${firstName}" placeholder="Seu nome" />
        </div>
        <div class="settings-field">
          <label class="settings-label">Sobrenome</label>
          <input id="stgLastName" class="settings-input" value="${lastName}" placeholder="Seu sobrenome" />
        </div>
        <div class="settings-field">
          <label class="settings-label">Email</label>
          <input id="stgEmail" class="settings-input" type="email" value="${displayEmail}" placeholder="seu@email.com" />
        </div>
        <div class="settings-field">
          <label class="settings-label">Telefone</label>
          <input id="stgPhone" class="settings-input" type="tel" value="${phone}" placeholder="(11) 99999-9999" />
        </div>
      </div>
      <div style="margin-top:16px;display:flex;align-items:center;gap:12px">
        <button id="btnSavePerfil" class="btn btn-primary btn-sm">Salvar alterações</button>
        <span id="stgPerfilMsg" style="font-size:12px"></span>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="margin-bottom:16px">
        <div class="card-title">Preferências do Sistema</div>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="label">Notificações por Email</div>
          <div class="desc">Receba resumos diários e alertas por email</div>
        </div>
        <label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="label">Som de notificação</div>
          <div class="desc">Reproduzir som ao receber nova mensagem</div>
        </div>
        <label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <div class="settings-row-info">
          <div class="label">Modo Escuro</div>
          <div class="desc">Usar tema escuro na interface</div>
        </div>
        <label class="toggle"><input type="checkbox" disabled><span class="toggle-slider"></span></label>
      </div>
    </div>`;
}

// ── Empresa ───────────────────────────────────────────────────

const _STG_INDUSTRIES = [
  'Tecnologia e Software','E-commerce e Varejo Online','Saúde e Bem-estar',
  'Educação e Treinamento','Alimentação e Gastronomia','Imobiliário e Construção',
  'Finanças e Contabilidade','Marketing e Publicidade','Jurídico e Advocacia',
  'Consultoria e Gestão','Moda e Vestuário','Beleza e Estética',
  'Turismo e Hospitalidade','Logística e Transporte','Indústria e Manufatura',
  'Agronegócio','Entretenimento e Mídia','Serviços Domésticos',
  'Esporte e Fitness','Arquitetura e Design','Eventos e Produção',
  'Automotivo','Pet e Veterinária','Outro',
];

const _STG_CURRENCIES = [
  ['BRL','R$ — Real Brasileiro'],['USD','$ — Dólar Americano'],['EUR','€ — Euro'],
  ['GBP','£ — Libra Esterlina'],['ARS','$ — Peso Argentino'],['CLP','$ — Peso Chileno'],
  ['COP','$ — Peso Colombiano'],['PEN','S/ — Sol Peruano'],['PYG','₲ — Guarani Paraguaio'],
  ['UYU','$ — Peso Uruguaio'],['BOB','Bs — Boliviano'],['VES','Bs — Bolívar Venezuelano'],
  ['MXN','$ — Peso Mexicano'],['CAD','CA$ — Dólar Canadense'],['AUD','A$ — Dólar Australiano'],
  ['CHF','CHF — Franco Suíço'],['JPY','¥ — Iene Japonês'],['CNY','¥ — Yuan Chinês'],
  ['KRW','₩ — Won Coreano'],['INR','₹ — Rúpia Indiana'],['RUB','₽ — Rublo Russo'],
  ['ZAR','R — Rand Sul-Africano'],['AED','د.إ — Dirham Emirados'],['SAR','﷼ — Riyal Saudita'],
];

const _STG_COMPANY_TYPES = [
  'MEI – Microempreendedor Individual','ME – Microempresa',
  'EPP – Empresa de Pequeno Porte','SLU – Sociedade Limitada Unipessoal',
  'LTDA – Sociedade Limitada','SA – Sociedade Anônima','EIRELI',
  'SS – Sociedade Simples','Associação / ONG','Cooperativa','Outra',
];

const _STG_SECTORS = [
  'Comércio','Serviços','Indústria','Agropecuária','Construção Civil',
  'Tecnologia','Financeiro','Saúde','Educação','Entretenimento','Outro',
];

const _STG_REG_TYPES = [
  'CNPJ (Brasil)','CPF (Brasil)','EIN (EUA)','VAT (Europa)',
  'RUC (Argentina / Paraguai)','RFC (México)','RUT (Chile / Uruguai)',
  'NIT (Colômbia / Bolívia)','RUC (Peru)','Outro',
];

const _STG_LANGUAGES = [
  ['pt-BR','Português (Brasil)'],['pt-PT','Português (Portugal)'],
  ['en-US','Inglês (EUA)'],['en-GB','Inglês (Reino Unido)'],
  ['es','Espanhol'],['fr','Francês'],['de','Alemão'],
  ['it','Italiano'],['ja','Japonês'],['zh','Chinês (Simplificado)'],
  ['ar','Árabe'],
];

function _sel(id, options, val, placeholder = '') {
  return `<select id="${id}" class="settings-input" style="width:100%">
    ${placeholder ? `<option value="">${placeholder}</option>` : ''}
    ${options.map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`;
    }).join('')}
  </select>`;
}

function _stgEmpresaHtml(d = {}) {
  const industryIsOther = d.industry === 'Outro';
  return `
  <div class="card" style="margin-bottom:16px">
    <div class="card-header" style="margin-bottom:20px">
      <div>
        <div class="card-title">Dados da Empresa</div>
        <div class="card-subtitle">Informações vinculadas a esta subconta</div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:20px">

      <!-- Identificação -->
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Identificação</div>
        <div class="grid-2">
          <div class="settings-field" style="margin:0">
            <label class="settings-label">NOME FANTASIA</label>
            <input id="eFantasyName" class="settings-input" placeholder="Nome da marca" value="${d.fantasy_name||''}" />
          </div>
          <div class="settings-field" style="margin:0">
            <label class="settings-label">RAZÃO SOCIAL</label>
            <input id="eLegalName" class="settings-input" placeholder="Nome jurídico da empresa" value="${d.legal_name||''}" />
          </div>
          <div class="settings-field" style="margin:0">
            <label class="settings-label">TIPO DE ID DE REGISTRO</label>
            ${_sel('eRegType', _STG_REG_TYPES, d.registration_id_type||'', 'Selecione...')}
          </div>
          <div class="settings-field" style="margin:0">
            <label class="settings-label">NÚMERO DE REGISTRO (CNPJ / ID)</label>
            <input id="eRegId" class="settings-input" placeholder="00.000.000/0001-00" value="${d.registration_id||''}" />
          </div>
        </div>
      </div>

      <!-- Contato -->
      <div style="border-top:1px solid var(--color-border);padding-top:20px">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Contato</div>
        <div class="grid-2">
          <div class="settings-field" style="margin:0">
            <label class="settings-label">EMAIL COMERCIAL</label>
            <input id="eCommEmail" class="settings-input" type="email" placeholder="contato@empresa.com" value="${d.commercial_email||''}" />
          </div>
          <div class="settings-field" style="margin:0">
            <label class="settings-label">TELEFONE COMERCIAL</label>
            <input id="eCommPhone" class="settings-input" type="tel" placeholder="(11) 99999-9999" value="${d.commercial_phone||''}" />
          </div>
          <div class="settings-field" style="margin:0;grid-column:1/-1">
            <label class="settings-label">SITE COMERCIAL</label>
            <input id="eWebsite" class="settings-input" type="url" placeholder="https://www.empresa.com.br" value="${d.website||''}" />
          </div>
        </div>
      </div>

      <!-- Classificação -->
      <div style="border-top:1px solid var(--color-border);padding-top:20px">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Classificação</div>
        <div class="grid-2">
          <div class="settings-field" style="margin:0">
            <label class="settings-label">TIPO DE EMPRESA</label>
            ${_sel('eCompanyType', _STG_COMPANY_TYPES, d.company_type||'', 'Selecione...')}
          </div>
          <div class="settings-field" style="margin:0">
            <label class="settings-label">SETOR EMPRESARIAL</label>
            ${_sel('eSector', _STG_SECTORS, d.business_sector||'', 'Selecione...')}
          </div>
          <div class="settings-field" style="margin:0">
            <label class="settings-label">NICHO DA EMPRESA</label>
            ${_sel('eIndustry', _STG_INDUSTRIES, d.industry||'', 'Selecione...')}
          </div>
          <div class="settings-field" style="margin:0" id="eIndustryOtherWrap" ${industryIsOther?'':'hidden'}>
            <label class="settings-label">DESCREVA O NICHO</label>
            <input id="eIndustryOther" class="settings-input" placeholder="Ex: Consultoria para startups" value="${d.industry_other||''}" />
          </div>
        </div>
      </div>

      <!-- Localização e operação -->
      <div style="border-top:1px solid var(--color-border);padding-top:20px">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Localização e Operação</div>
        <div class="grid-2">
          <div class="settings-field" style="margin:0;grid-column:1/-1">
            <label class="settings-label">ENDEREÇO FÍSICO DA EMPRESA <span style="color:var(--color-red)">*</span></label>
            <input id="eAddress" class="settings-input" placeholder="Rua, número, bairro, cidade – Estado, CEP" value="${d.address||''}" />
          </div>
          <div class="settings-field" style="margin:0;grid-column:1/-1">
            <label class="settings-label">REGIÕES DE OPERAÇÃO</label>
            <input id="eRegions" class="settings-input" placeholder="Ex: Brasil, América Latina, Mundial" value="${d.operating_regions||''}" />
          </div>
        </div>
      </div>

      <!-- Preferências -->
      <div style="border-top:1px solid var(--color-border);padding-top:20px">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Preferências</div>
        <div class="grid-2">
          <div class="settings-field" style="margin:0">
            <label class="settings-label">MOEDA DA EMPRESA</label>
            ${_sel('eCurrency', _STG_CURRENCIES, d.currency||'BRL', '')}
          </div>
          <div class="settings-field" style="margin:0">
            <label class="settings-label">IDIOMA</label>
            ${_sel('eLanguage', _STG_LANGUAGES, d.language||'pt-BR', '')}
          </div>
          <div class="settings-field" style="margin:0">
            <label class="settings-label">REPRESENTANTE AUTORIZADO</label>
            <input id="eAuthorizedRep" class="settings-input" placeholder="Nome do responsável legal" value="${d.authorized_rep||''}" />
          </div>
        </div>
      </div>

      <!-- Informações adicionais -->
      <div style="border-top:1px solid var(--color-border);padding-top:20px">
        <div class="settings-field" style="margin:0">
          <label class="settings-label">INFORMAÇÕES ADICIONAIS <span style="color:var(--color-text-3);font-weight:400">(opcional)</span></label>
          <textarea id="eAddInfo" class="settings-input" rows="3" style="resize:vertical;line-height:1.6" placeholder="Observações, detalhes internos ou contexto sobre a empresa...">${d.additional_info||''}</textarea>
        </div>
      </div>

    </div>

    <div style="margin-top:24px;display:flex;align-items:center;gap:12px;padding-top:20px;border-top:1px solid var(--color-border)">
      <button id="btnSaveEmpresa" class="btn btn-primary btn-sm">Salvar alterações</button>
      <span id="stgEmpresaMsg" style="font-size:12px"></span>
    </div>
  </div>`;
}

function _stgContasHtml() {
  return `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--color-text-1)">Contas de Usuários</div>
          <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">Gerencie os acessos dentro desta subconta</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btnNewUser">
          <i data-lucide="plus" style="width:14px;height:14px"></i> Novo usuário
        </button>
      </div>
      <div id="usersTableWrap">
        <div style="display:flex;align-items:center;justify-content:center;padding:48px;color:var(--color-text-3);gap:10px">
          <div style="width:20px;height:20px;border:2px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin .7s linear infinite"></div>
          Carregando usuários...
        </div>
      </div>
    </div>`;
}

// ── Page render ───────────────────────────────────────────────

window.pageSettings = function() {
  _stgUser = _stgDecode();
  if (!_stgIsAdmin() && _stgTab === 'contas') _stgTab = 'perfil';
  if (!window.favxCan?.('manage_settings') && _stgTab === 'empresa') _stgTab = 'perfil';

  let initialContent;
  if (_stgTab === 'contas')  initialContent = _stgContasHtml();
  else if (_stgTab === 'empresa') initialContent = _stgEmpresaHtml({});
  else initialContent = _stgPerfilHtml(null);

  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Configurações</h1>
      <p class="page-subtitle">Gerencie sua conta e preferências do FAVX CRM</p>
    </div>
  </div>
  <div class="settings-layout">
    <div class="settings-sidebar" id="settingsNav">
      ${_stgNavHtml()}
    </div>
    <div id="settingsContent">
      ${initialContent}
    </div>
  </div>`;
};

// ── User table ────────────────────────────────────────────────

const _ROLE_LABEL = { super_admin: 'Desenvolvedor', admin: 'Admin', user: 'Usuário' };
const _ROLE_BADGE = { super_admin: 'badge-purple', admin: 'badge-blue', user: 'badge-gray' };

function _renderUsersTable(users) {
  const wrap = document.getElementById('usersTableWrap');
  if (!wrap) return;

  if (!users.length) {
    wrap.innerHTML = `<div style="padding:48px;text-align:center;color:var(--color-text-3);font-size:13px">
      <i data-lucide="users" style="width:36px;height:36px;opacity:.2;display:block;margin:0 auto 12px"></i>
      Nenhum usuário cadastrado ainda.<br>
      <span style="font-size:12px">Clique em "Novo usuário" para adicionar o primeiro.</span>
    </div>`;
    lucide.createIcons();
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrapper" style="border-radius:0;border:none">
      <table>
        <thead>
          <tr>
            <th>Usuário</th>
            <th>Email</th>
            <th>Perfil</th>
            <th>Status</th>
            <th style="width:80px"></th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:32px;height:32px;border-radius:50%;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${u.name[0].toUpperCase()}</div>
                <span style="font-size:13px;font-weight:600;color:var(--color-text-1)">${u.name}</span>
              </div>
            </td>
            <td style="font-size:12px;color:var(--color-text-2)">${u.email}</td>
            <td><span class="badge ${_ROLE_BADGE[u.role] || 'badge-gray'}">${_ROLE_LABEL[u.role] || u.role}</span></td>
            <td><span class="badge ${u.is_active ? 'badge-green' : 'badge-gray'}">${u.is_active ? 'Ativo' : 'Inativo'}</span></td>
            <td>
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="btn btn-ghost btn-sm btn-edit-user" title="Editar"
                  data-id="${u.id}" data-name="${u.name}" data-email="${u.email}" data-active="${u.is_active}" data-role="${u.role}"
                  style="padding:5px">
                  <i data-lucide="pencil" style="width:13px;height:13px"></i>
                </button>
                <button class="btn btn-ghost btn-sm btn-delete-user" title="Excluir"
                  data-id="${u.id}" data-name="${u.name}"
                  style="padding:5px">
                  <i data-lucide="trash-2" style="width:13px;height:13px;color:var(--color-red)"></i>
                </button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  lucide.createIcons();
  _bindUserTableEvents();
}

async function _loadUsers() {
  try {
    const users = await apiFetch('/api/users');
    _renderUsersTable(users || []);
  } catch (err) {
    const wrap = document.getElementById('usersTableWrap');
    if (wrap) wrap.innerHTML = `<div style="padding:32px;text-align:center;color:var(--color-red);font-size:13px">${err.message}</div>`;
  }
}

function _bindUserTableEvents() {
  document.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', () => _openUserModal({
      id:     btn.dataset.id,
      name:   btn.dataset.name,
      email:  btn.dataset.email,
      active: btn.dataset.active === 'true',
      role:   btn.dataset.role || 'user',
    }));
  });

  document.querySelectorAll('.btn-delete-user').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Excluir o usuário "${btn.dataset.name}"?\nEsta ação não pode ser desfeita.`)) return;
      try {
        await apiFetch(`/api/users/${btn.dataset.id}`, { method: 'DELETE' });
        await _loadUsers();
      } catch (err) { alert(err.message); }
    });
  });
}

// ── User modal ────────────────────────────────────────────────

function _openUserModal(existing = null) {
  document.getElementById('userModal')?.remove();
  const isEdit = !!existing;

  const overlay = document.createElement('div');
  overlay.id = 'userModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';

  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:14px;width:460px;max-width:100%;box-shadow:0 32px 64px rgba(0,0,0,.25);overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div>
          <div style="font-size:15px;font-weight:700">${isEdit ? 'Editar usuário' : 'Novo usuário'}</div>
          <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">${isEdit ? 'Atualize os dados do usuário' : 'Preencha os dados para criar o acesso'}</div>
        </div>
        <button id="btnCloseUserModal" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px;color:var(--color-text-3)">
          <i data-lucide="x" style="width:18px;height:18px"></i>
        </button>
      </div>

      <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px">

        <div class="settings-field" style="margin:0">
          <label class="settings-label">NOME COMPLETO *</label>
          <input id="uName" class="settings-input" placeholder="Ex: João Silva" value="${existing?.name || ''}" />
        </div>

        <div class="settings-field" style="margin:0">
          <label class="settings-label">EMAIL *</label>
          <input id="uEmail" class="settings-input" type="email" placeholder="joao@empresa.com" value="${existing?.email || ''}" />
        </div>

        <div class="settings-field" style="margin:0">
          <label class="settings-label">${isEdit ? 'NOVA SENHA (deixe em branco para não alterar)' : 'SENHA *'}</label>
          <input id="uPassword" class="settings-input" type="password" placeholder="${isEdit ? '••••••••' : 'Mínimo 6 caracteres'}" />
        </div>

        <div class="settings-field" style="margin:0">
          <label class="settings-label">PERFIL DE ACESSO *</label>
          <div style="display:flex;gap:8px;margin-top:4px">
            <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;border:1.5px solid ${(existing?.role||'user')==='admin'?'var(--color-black)':'var(--color-border)'};cursor:pointer;background:${(existing?.role||'user')==='admin'?'var(--color-bg-2)':'var(--color-surface)'};transition:border-color .15s,background .15s" id="roleAdminLabel">
              <input type="radio" name="uRole" id="uRoleAdmin" value="admin" ${(existing?.role||'user')==='admin'?'checked':''} style="accent-color:var(--color-accent)">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--color-text-1)">Admin</div>
                <div style="font-size:11px;color:var(--color-text-3)">Controle total da subconta</div>
              </div>
            </label>
            <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;border:1.5px solid ${(existing?.role||'user')==='user'?'var(--color-black)':'var(--color-border)'};cursor:pointer;background:${(existing?.role||'user')==='user'?'var(--color-bg-2)':'var(--color-surface)'};transition:border-color .15s,background .15s" id="roleUserLabel">
              <input type="radio" name="uRole" id="uRoleUser" value="user" ${(existing?.role||'user')==='user'?'checked':''} style="accent-color:var(--color-accent)">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--color-text-1)">Usuário</div>
                <div style="font-size:11px;color:var(--color-text-3)">Acesso básico à subconta</div>
              </div>
            </label>
          </div>
        </div>

        ${isEdit ? `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0 4px;border-top:1px solid var(--color-border)">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--color-text-1)">Conta ativa</div>
            <div style="font-size:12px;color:var(--color-text-3)">Desativar bloqueia o login deste usuário</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="uActive" ${existing?.active ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>` : ''}

        <span id="uError" style="font-size:12px;color:var(--color-red);display:block;min-height:16px"></span>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
        <button id="btnCancelUser" class="btn btn-secondary btn-sm">Cancelar</button>
        <button id="btnSubmitUser" class="btn btn-primary btn-sm">
          <i data-lucide="${isEdit ? 'check' : 'user-plus'}" style="width:13px;height:13px"></i>
          ${isEdit ? 'Salvar alterações' : 'Criar usuário'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  lucide.createIcons();

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#btnCloseUserModal').addEventListener('click', close);
  overlay.querySelector('#btnCancelUser').addEventListener('click', close);
  overlay.querySelector('#uName').focus();

  // Radio visual highlight
  overlay.querySelectorAll('input[name="uRole"]').forEach(radio => {
    radio.addEventListener('change', () => {
      overlay.querySelector('#roleAdminLabel').style.borderColor = radio.value === 'admin' ? 'var(--color-black)' : 'var(--color-border)';
      overlay.querySelector('#roleAdminLabel').style.background  = radio.value === 'admin' ? 'var(--color-bg-2)'   : 'var(--color-surface)';
      overlay.querySelector('#roleUserLabel').style.borderColor  = radio.value === 'user'  ? 'var(--color-black)' : 'var(--color-border)';
      overlay.querySelector('#roleUserLabel').style.background   = radio.value === 'user'  ? 'var(--color-bg-2)'   : 'var(--color-surface)';
    });
  });

  overlay.querySelector('#btnSubmitUser').addEventListener('click', async () => {
    const name      = overlay.querySelector('#uName').value.trim();
    const email     = overlay.querySelector('#uEmail').value.trim();
    const password  = overlay.querySelector('#uPassword').value;
    const is_active = overlay.querySelector('#uActive')?.checked ?? true;
    const role      = overlay.querySelector('input[name="uRole"]:checked')?.value || 'user';
    const errEl     = overlay.querySelector('#uError');
    errEl.textContent = '';

    if (!name)                        { errEl.textContent = 'Nome é obrigatório.'; return; }
    if (!email)                       { errEl.textContent = 'Email é obrigatório.'; return; }
    if (!isEdit && !password)         { errEl.textContent = 'Senha é obrigatória.'; return; }
    if (password && password.length < 6) { errEl.textContent = 'Senha deve ter pelo menos 6 caracteres.'; return; }

    const btn = overlay.querySelector('#btnSubmitUser');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      const body = { name, email, role };
      if (password)       body.password  = password;
      if (isEdit)         body.is_active = is_active;

      if (isEdit) {
        await apiFetch(`/api/users/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(body) });
      }
      close();
      await _loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="${isEdit ? 'check' : 'user-plus'}" style="width:13px;height:13px"></i> ${isEdit ? 'Salvar alterações' : 'Criar usuário'}`;
      lucide.createIcons();
    }
  });
}

// ── Init ──────────────────────────────────────────────────────

function _stgBindContas() {
  _loadUsers();
  document.getElementById('btnNewUser')?.addEventListener('click', () => _openUserModal());
}

window.initSettings = function() {
  // Tab switching
  document.querySelectorAll('#settingsNav .settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      _stgTab = item.dataset.tab;
      document.querySelectorAll('#settingsNav .settings-nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.tab === _stgTab)
      );
      const content = document.getElementById('settingsContent');
      if (!content) return;
      if (_stgTab === 'contas') {
        content.innerHTML = _stgContasHtml();
        lucide.createIcons();
        _stgBindContas();
      } else if (_stgTab === 'empresa') {
        content.innerHTML = _stgEmpresaHtml({});
        lucide.createIcons();
        _stgLoadAndBindEmpresa();
      } else {
        content.innerHTML = _stgPerfilHtml(null);
        lucide.createIcons();
        _stgLoadAndBindPerfil();
      }
    });
  });

  // First load
  if (_stgTab === 'contas') {
    _stgBindContas();
  } else if (_stgTab === 'empresa') {
    _stgLoadAndBindEmpresa();
  } else {
    _stgLoadAndBindPerfil();
  }
};

async function _stgLoadAndBindEmpresa() {
  try {
    const d = await apiFetch('/api/subaccount-settings');
    const content = document.getElementById('settingsContent');
    if (!content) return;
    content.innerHTML = _stgEmpresaHtml(d || {});
    lucide.createIcons();
  } catch {}

  const industryEl = document.getElementById('eIndustry');
  const otherWrap  = document.getElementById('eIndustryOtherWrap');
  if (industryEl && otherWrap) {
    industryEl.addEventListener('change', () => {
      otherWrap.hidden = industryEl.value !== 'Outro';
    });
  }

  const btn = document.getElementById('btnSaveEmpresa');
  const msg = document.getElementById('stgEmpresaMsg');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const address = document.getElementById('eAddress')?.value.trim();
    if (!address) {
      if (msg) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Endereço físico é obrigatório.'; }
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Salvando...';
    if (msg) msg.textContent = '';

    const body = {
      fantasy_name:         document.getElementById('eFantasyName')?.value.trim()    || null,
      legal_name:           document.getElementById('eLegalName')?.value.trim()       || null,
      commercial_email:     document.getElementById('eCommEmail')?.value.trim()       || null,
      commercial_phone:     document.getElementById('eCommPhone')?.value.trim()        || null,
      website:              document.getElementById('eWebsite')?.value.trim()          || null,
      industry:             document.getElementById('eIndustry')?.value               || null,
      industry_other:       document.getElementById('eIndustryOther')?.value.trim()   || null,
      currency:             document.getElementById('eCurrency')?.value               || 'BRL',
      additional_info:      document.getElementById('eAddInfo')?.value.trim()         || null,
      company_type:         document.getElementById('eCompanyType')?.value            || null,
      business_sector:      document.getElementById('eSector')?.value                 || null,
      registration_id_type: document.getElementById('eRegType')?.value               || null,
      registration_id:      document.getElementById('eRegId')?.value.trim()           || null,
      operating_regions:    document.getElementById('eRegions')?.value.trim()         || null,
      address,
      language:             document.getElementById('eLanguage')?.value               || 'pt-BR',
      authorized_rep:       document.getElementById('eAuthorizedRep')?.value.trim()   || null,
    };

    try {
      await apiFetch('/api/subaccount-settings', { method: 'PUT', body: JSON.stringify(body) });
      if (msg) { msg.style.color = 'var(--color-green)'; msg.textContent = 'Alterações salvas!'; }
      setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
    } catch (err) {
      if (msg) { msg.style.color = 'var(--color-red)'; msg.textContent = err.message; }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    }
  });
}

async function _stgLoadAndBindPerfil() {
  try {
    const profile = await apiFetch('/api/profile');
    const content = document.getElementById('settingsContent');
    if (!content) return;
    content.innerHTML = _stgPerfilHtml(profile);
    lucide.createIcons();
  } catch {}

  const btn  = document.getElementById('btnSavePerfil');
  const msg  = document.getElementById('stgPerfilMsg');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const name      = document.getElementById('stgFirstName')?.value.trim();
    const last_name = document.getElementById('stgLastName')?.value.trim();
    const email     = document.getElementById('stgEmail')?.value.trim();
    const phone     = document.getElementById('stgPhone')?.value.trim();

    if (!name)  { if (msg) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Nome é obrigatório.'; } return; }
    if (!email) { if (msg) { msg.style.color = 'var(--color-red)'; msg.textContent = 'Email é obrigatório.'; } return; }

    btn.disabled = true;
    btn.textContent = 'Salvando...';
    if (msg) msg.textContent = '';

    try {
      const updated = await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, last_name, email, phone }),
      });

      // Update stored user so sidebar reflects new name
      const key = localStorage.getItem('favx_token') ? 'localStorage' : 'sessionStorage';
      const stored = JSON.parse(window[key].getItem('favx_user') || '{}');
      stored.name  = updated.name;
      stored.email = updated.email;
      window[key].setItem('favx_user', JSON.stringify(stored));

      // Refresh sidebar card
      if (typeof initSidebarUser === 'function') initSidebarUser();

      // Refresh avatar preview in form
      const newDisplay = [updated.name, updated.last_name].filter(Boolean).join(' ') || updated.email;
      const avatarEl   = document.getElementById('stgAvatarCircle');
      const nameEl     = document.getElementById('stgDisplayName');
      if (avatarEl) avatarEl.textContent = (updated.name || updated.email || '?')[0].toUpperCase();
      if (nameEl)   nameEl.textContent   = newDisplay;

      if (msg) { msg.style.color = 'var(--color-green)'; msg.textContent = 'Alterações salvas!'; }
      setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
    } catch (err) {
      if (msg) { msg.style.color = 'var(--color-red)'; msg.textContent = err.message; }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    }
  });
}
