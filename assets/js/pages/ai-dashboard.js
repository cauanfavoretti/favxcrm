// ======================================
// FAVX CRM — Painel da IA
// ======================================
// Os dados vêm dos eventos que as IAs reportam em POST /api/ai-events/:token.
// Vale tanto para IA externa (n8n, agente próprio) quanto para as IAs criadas
// dentro do CRM — a diferença é só o campo agent_source de cada evento.

let _aiRange     = '24h';
let _aiChart     = null;
let _aiToken     = null;

const _AI_RANGES = [
  { id: '24h', label: '24 horas' },
  { id: '7d',  label: '7 dias'   },
  { id: '30d', label: '30 dias'  },
];

const _AI_STATUS_BADGE = {
  success:   ['badge-green',  'Sucesso'],
  escalated: ['badge-yellow', 'Escalado'],
  warning:   ['badge-yellow', 'Aviso'],
  error:     ['badge-red',    'Erro'],
};

function _aiEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function _aiNum(n) {
  return (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR');
}

function _aiDuration(ms) {
  if (ms == null || isNaN(ms)) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1).replace('.', ',')}s`;
}

function _aiTime(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

window.pageAiDashboard = function () {
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Painel da IA</h1>
      <p class="page-subtitle">Ações reportadas pelos agentes de inteligência artificial</p>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <div class="wbuild-btn-group" id="aiRangeGroup">
        ${_AI_RANGES.map(r => `<button class="wbuild-btn${r.id===_aiRange?' active':''}" data-range="${r.id}">${r.label}</button>`).join('')}
      </div>
      <button class="btn btn-secondary btn-sm" id="aiRefreshBtn">
        <i data-lucide="refresh-cw" style="width:14px;height:14px"></i> Atualizar
      </button>
    </div>
  </div>
  <div id="aiPanelBody">
    <div class="dash-load-state"><div class="dash-load-spin"></div><span>Carregando painel...</span></div>
  </div>`;
};

function _aiEmptyState() {
  return `
  <div class="dash-empty-widgets">
    <div class="dash-empty-icon"><i data-lucide="bot" style="width:28px;height:28px"></i></div>
    <div class="dash-empty-title">Nenhuma ação registrada ainda</div>
    <div class="dash-empty-text">
      Este painel é preenchido pelas ações que os agentes de IA reportam ao CRM.
      Assim que um agente começar a reportar, os dados aparecem aqui.
    </div>
  </div>`;
}

function _aiMetricsHtml(t) {
  const delta = (t.prev_total && t.prev_total > 0)
    ? Math.round((t.total - t.prev_total) * 100 / t.prev_total)
    : null;
  const deltaHtml = delta === null ? '' : `
    <span class="stat-delta ${delta >= 0 ? 'up' : 'down'}">
      <i data-lucide="trending-${delta >= 0 ? 'up' : 'down'}" style="width:12px;height:12px"></i>
      ${delta >= 0 ? '+' : ''}${delta}%
    </span>`;
  const card = (icon, cls, value, label, extra = '') => `
    <div class="stat-card">
      <div class="stat-card-top">
        <div class="stat-icon ${cls}"><i data-lucide="${icon}" style="width:18px;height:18px"></i></div>
        ${extra}
      </div>
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
    </div>`;
  return `
  <div class="ai-metrics-row">
    ${card('zap', 'black', _aiNum(t.total), 'Ações no período', deltaHtml)}
    ${card('check-circle', 'green',
        t.resolution_rate === null ? '—' : `${String(t.resolution_rate).replace('.', ',')}%`,
        'Taxa de resolução')}
    ${card('clock', 'blue', _aiDuration(t.avg_ms), 'Tempo médio de resposta')}
    ${card('alert-triangle', 'yellow', _aiNum(t.escalated), 'Escaladas para humano')}
  </div>`;
}

function _aiAgentsHtml(agents) {
  const palette = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4'];
  if (!agents.length) return `<div class="widget-empty">Nenhum agente reportou ações no período</div>`;
  return agents.map((a, i) => {
    const decided = a.success + a.escalated;
    const pct     = decided ? Math.round(a.success * 100 / decided) : 0;
    const color   = palette[i % palette.length];
    return `
    <div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;gap:8px">
        <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${_aiEsc(a.agent_name)}
          <span class="badge ${a.agent_source === 'internal' ? 'badge-purple' : 'badge-gray'}"
                style="margin-left:4px">${a.agent_source === 'internal' ? 'Interna' : 'Externa'}</span>
        </span>
        <span style="font-weight:700;flex-shrink:0">${decided ? pct + '%' : '—'} · ${_aiNum(a.total)}</span>
      </div>
      <div style="height:6px;background:var(--color-bg);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width .6s ease"></div>
      </div>
    </div>`;
  }).join('');
}

function _aiLogHtml(rows) {
  if (!rows.length) return `<div class="widget-empty" style="padding:24px 0">Nenhum evento registrado</div>`;
  return `
  <div class="table-wrapper" style="border:none;border-radius:0">
    <table class="ai-log-table">
      <thead>
        <tr><th>Horário</th><th>Agente</th><th>Contato</th><th>Evento</th><th>Duração</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const [cls, label] = _AI_STATUS_BADGE[r.status] || ['badge-gray', r.status || '—'];
          return `
          <tr>
            <td style="font-family:monospace;font-size:11px;color:var(--color-text-3)">${_aiTime(r.occurred_at)}</td>
            <td style="font-weight:600">${_aiEsc(r.agent_name)}</td>
            <td>${_aiEsc(r.contact_name) || '—'}</td>
            <td>${_aiEsc(r.description || r.event_type)}</td>
            <td style="color:var(--color-text-3)">${_aiDuration(r.duration_ms)}</td>
            <td><span class="badge ${cls}">${_aiEsc(label)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function _aiRenderPanel(data) {
  const body = document.getElementById('aiPanelBody');
  if (!body) return;

  if (!data.totals.total && !data.recent.length) {
    body.innerHTML = _aiEmptyState();
    lucide.createIcons();
    return;
  }

  body.innerHTML = `
    ${_aiMetricsHtml(data.totals)}
    <div class="ai-chart-row">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Volume de ações</div>
            <div class="card-subtitle">Por agente, ao longo do período</div>
          </div>
        </div>
        <div class="chart-area" style="height:200px"><canvas id="chartAiVolume"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Taxa de resolução por agente</div></div>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">
          ${_aiAgentsHtml(data.agents)}
        </div>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="card-header" style="padding:16px;border-bottom:1px solid var(--color-border)">
        <div>
          <div class="card-title">Log de eventos</div>
          <div class="card-subtitle">Últimas ${data.recent.length} interações reportadas</div>
        </div>
      </div>
      ${_aiLogHtml(data.recent)}
    </div>`;
  lucide.createIcons();
  _aiRenderChart(data.series);
}

function _aiRenderChart(series) {
  const ctx = document.getElementById('chartAiVolume');
  if (!ctx || !window.Chart) return;
  if (_aiChart) { _aiChart.destroy(); _aiChart = null; }
  if (!series.length) return;

  const buckets = [...new Set(series.map(s => s.bucket))].sort();
  const agents  = [...new Set(series.map(s => s.agent_name))];
  const palette = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4'];
  const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
  const grid    = isDark ? 'rgba(255,255,255,.06)' : '#f3f4f6';
  const text    = isDark ? '#b0b8cc' : '#9ca3af';

  const datasets = agents.slice(0, 6).map((name, i) => {
    const color = palette[i % palette.length];
    const byBucket = Object.fromEntries(
      series.filter(s => s.agent_name === name).map(s => [s.bucket, s.total]));
    return {
      label: name,
      data: buckets.map(b => byBucket[b] || 0),
      borderColor: color,
      backgroundColor: color + '14',
      fill: true, tension: .4, pointRadius: 2,
    };
  });

  _aiChart = new Chart(ctx, {
    type: 'line',
    data: { labels: buckets.map(b => b.slice(11) + 'h'), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position:'bottom', labels:{ font:{size:11}, usePointStyle:true, pointStyleWidth:8, color:text } } },
      scales: {
        x: { grid:{ display:false }, ticks:{ font:{size:10}, color:text, maxTicksLimit:12 } },
        y: { beginAtZero:true, grid:{ color:grid }, ticks:{ font:{size:10}, color:text, precision:0 } },
      },
    },
  });
}

async function _aiLoad() {
  const body = document.getElementById('aiPanelBody');
  if (body) body.innerHTML = `<div class="dash-load-state">
    <div class="dash-load-spin"></div><span>Carregando painel...</span></div>`;
  try {
    const data = await apiFetch(`/api/ai-dashboard?range=${_aiRange}`);
    _aiRenderPanel(data);
  } catch (err) {
    if (body) body.innerHTML = `<div class="widget-error" style="padding:32px 0">
      <i data-lucide="alert-circle" style="width:14px;height:14px"></i> ${_aiEsc(err.message || 'Erro ao carregar')}</div>`;
    lucide.createIcons();
  }
}

// Tela com o endereço e o token que o agente de IA precisa usar, mais um
// exemplo pronto de requisição.
//
// Propositalmente SEM botão na interface: a ingestão continua ativa no
// backend (POST /api/ai-events/:token) para a IA externa e, no futuro, para
// as IAs criadas no CRM. Para consultar o token quando for configurar um
// agente, chame _aiOpenSetup() pelo console ou GET /api/ai-events-token.
async function _aiOpenSetup() {
  document.getElementById('aiSetupOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'aiSetupOverlay';
  overlay.className = 'wrec-overlay';
  overlay.innerHTML = `
    <div class="wrec-dialog" style="width:760px">
      <div class="wrec-header">
        <div>
          <div class="wrec-title">Conectar uma IA a este painel</div>
          <div class="wrec-sub">Vale para agentes externos e para as IAs criadas no CRM</div>
        </div>
        <button class="wrec-close" id="aiSetupClose" title="Fechar">
          <i data-lucide="x" style="width:16px;height:16px"></i>
        </button>
      </div>
      <div class="wrec-body" style="padding:18px 20px" id="aiSetupBody">
        <div class="dash-load-state"><div class="dash-load-spin"></div><span>Carregando...</span></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  lucide.createIcons();

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  overlay.querySelector('#aiSetupClose').addEventListener('click', close);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  try {
    if (!_aiToken) _aiToken = (await apiFetch('/api/ai-events-token')).token;
    _aiRenderSetup(overlay);
  } catch (err) {
    overlay.querySelector('#aiSetupBody').innerHTML =
      `<div class="widget-error"><i data-lucide="alert-circle" style="width:14px;height:14px"></i> ${_aiEsc(err.message)}</div>`;
    lucide.createIcons();
  }
}

function _aiRenderSetup(overlay) {
  const url  = `${location.origin}/api/ai-events/${_aiToken}`;
  const body = overlay.querySelector('#aiSetupBody');
  const exemplo = JSON.stringify({
    agent: 'Clara AI',
    event: 'message_processed',
    status: 'success',
    description: 'Respondeu dúvida sobre preço',
    contact_name: 'João Silva',
    conversation_id: '(opcional) uuid da conversa',
    duration_ms: 820,
    tokens: 350,
  }, null, 2);

  body.innerHTML = `
    <div class="wbuild-section" style="margin-bottom:16px">
      <div class="wbuild-section-title">1. Endereço para onde a IA envia as ações</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="form-input" id="aiSetupUrl" readonly value="${_aiEsc(url)}" style="font-family:monospace;font-size:12px;flex:1">
        <button class="btn btn-secondary btn-sm" id="aiCopyUrl">Copiar</button>
      </div>
      <div style="font-size:11px;color:var(--color-text-3);margin-top:6px">
        O token identifica a sua subconta — trate como senha. Método <strong>POST</strong>, corpo em JSON.
      </div>
    </div>

    <div class="wbuild-section" style="margin-bottom:16px">
      <div class="wbuild-section-title">2. Exemplo do que enviar</div>
      <pre style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:8px;padding:12px;font-size:11.5px;overflow-x:auto;margin:0">${_aiEsc(exemplo)}</pre>
      <div style="font-size:11px;color:var(--color-text-3);margin-top:6px">
        Só <code>agent</code> e <code>event</code> são obrigatórios. Para mandar vários de uma vez,
        envie <code>{"events": [ ... ]}</code> (até 500).
      </div>
    </div>

    <div class="wbuild-section" style="margin-bottom:16px">
      <div class="wbuild-section-title">3. Campos aceitos</div>
      <table class="wrec-table" style="font-size:12px">
        <tbody>
          <tr><td><code>agent</code></td><td>Nome do agente, como aparece no painel <em>(obrigatório)</em></td></tr>
          <tr><td><code>event</code></td><td>O que aconteceu, ex: <code>message_processed</code> <em>(obrigatório)</em></td></tr>
          <tr><td><code>status</code></td><td><code>success</code>, <code>escalated</code>, <code>warning</code> ou <code>error</code> — define a taxa de resolução</td></tr>
          <tr><td><code>description</code></td><td>Texto livre exibido na coluna Evento</td></tr>
          <tr><td><code>duration_ms</code></td><td>Tempo de resposta, usado na média</td></tr>
          <tr><td><code>contact_name</code> / <code>contact_id</code></td><td>A quem a ação se refere</td></tr>
          <tr><td><code>conversation_id</code></td><td>Vincula o evento a uma conversa do CRM</td></tr>
          <tr><td><code>tokens</code> / <code>cost_usd</code></td><td>Consumo, para acompanhar custo</td></tr>
          <tr><td><code>agent_id</code></td><td>Preenchido pelas IAs criadas no CRM; marca o agente como interno</td></tr>
        </tbody>
      </table>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span style="font-size:11px;color:var(--color-text-3)">
        Gerar um token novo invalida o atual — a IA precisará ser reconfigurada.
      </span>
      <button class="btn btn-secondary btn-sm" id="aiRotate">Gerar novo token</button>
    </div>`;

  overlay.querySelector('#aiCopyUrl').addEventListener('click', () => {
    const input = overlay.querySelector('#aiSetupUrl');
    input.select();
    navigator.clipboard?.writeText(url).catch(() => document.execCommand('copy'));
    const btn = overlay.querySelector('#aiCopyUrl');
    btn.textContent = 'Copiado!';
    setTimeout(() => { btn.textContent = 'Copiar'; }, 1500);
  });

  overlay.querySelector('#aiRotate').addEventListener('click', () => {
    showConfirmModal({
      title: 'Gerar novo token',
      message: 'O token atual deixa de funcionar imediatamente e as IAs que o utilizam param de reportar até serem reconfiguradas. Deseja continuar?',
      confirmLabel: 'Sim, gerar',
      onConfirm: async () => {
        _aiToken = (await apiFetch('/api/ai-events-token/rotate', { method:'POST' })).token;
        _aiRenderSetup(overlay);
      },
    });
  });
}

window.initAiDashboard = function () {
  document.getElementById('aiRefreshBtn')?.addEventListener('click', _aiLoad);
  document.getElementById('aiRangeGroup')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-range]');
    if (!btn || btn.dataset.range === _aiRange) return;
    _aiRange = btn.dataset.range;
    document.querySelectorAll('#aiRangeGroup .wbuild-btn')
      .forEach(b => b.classList.toggle('active', b.dataset.range === _aiRange));
    _aiLoad();
  });
  _aiLoad();
};
