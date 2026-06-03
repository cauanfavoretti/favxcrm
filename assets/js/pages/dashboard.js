// ======================================
// FAVX CRM — Dashboard
// ======================================

let _dashData        = null;
let _activeMirrorIdx = 0;
let _activeDashId    = null;   // null = Visão Geral; string UUID = custom dashboard
let _chartInstances  = {};     // canvasId → Chart instance
let _wState          = null;   // widget builder state

// ── Formatters ──────────────────────────────────────────────
function _brl(v) {
  if (!v || isNaN(v)) return 'R$ 0';
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 }).format(v);
}
function _srcLabel(src) {
  const map = { whatsapp:'WhatsApp', instagram:'Instagram', site:'Site', email:'E-mail',
                indicacao:'Indicação', manual:'Manual', import:'Importação', __none__:'Sem origem' };
  return map[src] || (src ? src.charAt(0).toUpperCase() + src.slice(1) : 'Outros');
}
function _metricLabel(metric, pillar) {
  if (metric === 'sum_value') return 'soma do valor (R$)';
  if (metric === 'avg_value') return 'média do valor (R$)';
  const base = { contacts:'contatos', funnels:'oportunidades', conversations:'conversas' };
  return base[pillar] || 'total';
}

// ── Config global do Funil de Venda ─────────────────────────
function _getSalesCfg() {
  try { return JSON.parse(localStorage.getItem('dash_sales_cfg') || '{}'); } catch { return {}; }
}
function _setSalesCfg(cfg) {
  localStorage.setItem('dash_sales_cfg', JSON.stringify(cfg));
}
function _resolveStage(pipelines, mapping) {
  if (!mapping?.stage_id) return { count: 0, color: null, configured: false };
  const pipeline = pipelines.find(p => p.id === mapping.pipeline_id);
  const stage    = pipeline?.stages?.find(s => s.id === mapping.stage_id);
  if (!stage) return { count: 0, color: null, configured: false };
  return { count: parseInt(stage.open_count)||0, color: stage.color||'#6b7280',
           configured: true, stageName: stage.name, pipelineName: pipeline.name };
}
function _pipelineSelect(id, pipelines, activeIdx) {
  return `<select id="${id}" class="dash-funnel-select">
    ${pipelines.map((p,i) => `<option value="${i}" ${i===activeIdx?'selected':''}>${p.name}</option>`).join('')}
  </select>`;
}

// ════════════════════════════════════════════════════════════
// SEÇÃO: Faturamento
// ════════════════════════════════════════════════════════════
function _renderRevenue(rev) {
  const g = rev?.growth_pct;
  const trend = g !== null && g !== undefined
    ? `<span class="stat-delta ${g>=0?'up':'down'}" style="font-size:11px;display:flex;align-items:center;gap:3px">
         <i data-lucide="${g>=0?'trending-up':'trending-down'}" style="width:11px;height:11px"></i>
         ${g>=0?'+':''}${g.toFixed(1)}%
       </span>` : '';
  return `
  <div class="dash-section-title">Faturamento</div>
  <div class="grid-3">
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon black"><i data-lucide="trending-up" style="width:18px;height:18px"></i></div></div>
      <div class="stat-value" style="font-size:22px">${_brl(rev?.total)}</div>
      <div class="stat-label">Total Faturado</div>
      <div class="stat-sub">todas as oportunidades ganhas</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top">
        <div class="stat-icon green"><i data-lucide="calendar" style="width:18px;height:18px"></i></div>
        ${trend}
      </div>
      <div class="stat-value" style="font-size:22px">${_brl(rev?.this_month)}</div>
      <div class="stat-label">Este Mês</div>
      <div class="stat-sub">${rev?.won_count_month??0} negócios fechados</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon yellow"><i data-lucide="clock" style="width:18px;height:18px"></i></div></div>
      <div class="stat-value" style="font-size:22px">${_brl(rev?.last_month)}</div>
      <div class="stat-label">Mês Anterior</div>
      <div class="stat-sub">&nbsp;</div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// SEÇÃO: Funil de Venda
// ════════════════════════════════════════════════════════════
function _buildSalesRows(pipelines) {
  const cfg      = _getSalesCfg();
  const totalCRM = pipelines.reduce((s,p) => s+p.open_count+p.won_count+p.lost_count, 0);
  const totalWon = pipelines.reduce((s,p) => s+p.won_count, 0);
  const qual     = _resolveStage(pipelines, cfg.qualificados);
  const orc      = _resolveStage(pipelines, cfg.orcamentos);
  return [
    { key:'meta',         label:'Leads do Meta',        count:0,        color:'#6b7280', future:true },
    { key:'crm',          label:'Oportunidades no CRM', count:totalCRM, color:'#374151' },
    { key:'qualificados', label:'Qualificados',          ...qual,        role:'qualificados' },
    { key:'orcamentos',   label:'Orçamentos',            ...orc,         role:'orcamentos' },
    { key:'vendas',       label:'Vendas',                count:totalWon, color:'#059669' },
  ];
}

function _salesFunnelRows(rows) {
  const maxCount = Math.max(...rows.map(r => r.count), 1);
  return rows.map((row, idx) => {
    const isConfigurable = !!row.role;
    const isUnconfigured = isConfigurable && !row.configured;
    const pct  = isUnconfigured ? 25 : Math.max(12, Math.round(row.count/maxCount*100));
    const prev = idx > 0 ? rows[idx-1].count : null;
    const conv = (prev !== null && prev > 0 && !isUnconfigured) ? Math.round(row.count/prev*100) : null;
    const mapHint = isConfigurable && row.configured
      ? `<span style="font-size:10px;color:var(--color-text-3);font-weight:400">${row.pipelineName} › ${row.stageName}</span>` : '';
    return `
    <div class="dash-funnel-row">
      <div class="dash-funnel-label" style="flex-direction:column;align-items:flex-end;gap:1px">
        <span>${row.label}${row.future?` <span style="font-size:10px;color:var(--color-text-3);font-weight:400">(futuro)</span>`:''}</span>
        ${mapHint}
      </div>
      <div class="dash-funnel-bar-wrap">
        <div class="dash-funnel-bar ${isUnconfigured?'dash-funnel-bar--empty':''}"
          style="width:${pct}%;background:${isUnconfigured?'var(--color-border-2)':row.color}">
          <span class="dash-funnel-bar-val">${isUnconfigured?'— configurar':row.count.toLocaleString('pt-BR')}</span>
        </div>
      </div>
      <div class="dash-funnel-meta">${conv!==null?`<span class="dash-funnel-conv">${conv}%</span>`:''}</div>
    </div>`;
  }).join('');
}

function _renderSalesFunnel(pipelines) {
  if (!pipelines?.length) return '';
  const rows      = _buildSalesRows(pipelines);
  const totalWon  = pipelines.reduce((s,p) => s+p.won_count, 0);
  const totalOpen = pipelines.reduce((s,p) => s+p.open_count, 0);
  return `
  <div class="dash-section-title">Funil de Venda</div>
  <div class="card">
    <div class="card-header">
      <div>
        <div class="card-title">Métricas do Funil</div>
        <div class="card-subtitle">${totalOpen} em aberto · ${totalWon} ganhos · todos os funis</div>
      </div>
      <button id="btnConfigSalesFunnel" class="btn btn-secondary btn-sm">
        <i data-lucide="settings-2" style="width:13px;height:13px"></i> Configurar
      </button>
    </div>
    <div id="salesFunnelViz" class="dash-funnel">
      <div class="dash-funnel-header">
        <span class="dash-funnel-col-label">Etapa</span><span></span>
        <span class="dash-funnel-col-conv">Conversão</span>
      </div>
      ${_salesFunnelRows(rows)}
    </div>
  </div>`;
}

function _openSalesCfgModal(pipelines) {
  document.getElementById('salesCfgModalOverlay')?.remove();
  const cfg   = _getSalesCfg();
  const roles = [
    { key:'qualificados', label:'Qualificados', color:'#2563eb' },
    { key:'orcamentos',   label:'Orçamentos',   color:'#7c3aed' },
  ];
  function currentMapLabel(mapping) {
    if (!mapping?.stage_id) return '<span style="color:var(--color-text-3)">Não configurado</span>';
    const s = _resolveStage(pipelines, mapping);
    if (!s.configured) return '<span style="color:var(--color-red)">Etapa não encontrada</span>';
    return `<span style="color:var(--color-green)">${s.pipelineName} › ${s.stageName}</span>`;
  }
  function stagePickerHtml(roleKey) {
    const current = cfg[roleKey];
    return pipelines.map(p => `
      <div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;display:flex;align-items:center;gap:6px">
          <i data-lucide="filter" style="width:11px;height:11px"></i> ${p.name}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${(p.stages||[]).map(s => {
            const isSel = current?.stage_id===s.id && current?.pipeline_id===p.id;
            return `<button class="sales-cfg-stage-btn" data-pipeline-id="${p.id}" data-stage-id="${s.id}" data-role="${roleKey}"
              style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:var(--radius-md);font-size:12px;font-weight:600;cursor:pointer;
                     border:2px solid ${isSel?(s.color||'#000'):'var(--color-border)'};
                     background:${isSel?(s.color||'#000')+'18':'var(--color-surface)'};color:var(--color-text-1)">
              <span style="width:8px;height:8px;border-radius:50%;background:${s.color||'#6b7280'};flex-shrink:0"></span>
              ${s.name} <span style="font-size:10px;color:var(--color-text-3);font-weight:400">(${s.open_count})</span>
            </button>`;
          }).join('')}
          ${!(p.stages||[]).length?`<span style="font-size:12px;color:var(--color-text-3)">Nenhuma etapa</span>`:''}
        </div>
      </div>`).join('');
  }
  const overlay = document.createElement('div');
  overlay.id = 'salesCfgModalOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
  <div style="background:var(--color-surface);border-radius:14px;width:640px;max-width:100%;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 32px 64px rgba(0,0,0,.28)">
    <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0">
      <div>
        <div style="font-size:16px;font-weight:700;color:var(--color-text-1)">Configurar Funil de Venda</div>
        <div style="font-size:12px;color:var(--color-text-3);margin-top:3px">Mapeie de qual funil e etapa cada linha vai puxar os dados</div>
      </div>
      <button id="closeSalesCfgBtn" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px;color:var(--color-text-3)">
        <i data-lucide="x" style="width:18px;height:18px"></i>
      </button>
    </div>
    <div style="overflow-y:auto;flex:1;padding:20px 22px;display:flex;flex-direction:column;gap:0">
      ${roles.map(r => `
      <div class="sales-cfg-role-section" data-role="${r.key}" style="padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid var(--color-border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;border-radius:50%;background:${r.color};flex-shrink:0"></span>
            <span style="font-size:14px;font-weight:700;color:var(--color-text-1)">${r.label}</span>
          </div>
          <div style="font-size:12px" id="cfgCurrentLabel_${r.key}">${currentMapLabel(cfg[r.key])}</div>
        </div>
        <div class="sales-cfg-picker" data-role="${r.key}" style="background:var(--color-bg);border-radius:var(--radius-md);padding:12px">
          ${stagePickerHtml(r.key)}
        </div>
        ${cfg[r.key]?`<button class="sales-cfg-clear-btn" data-role="${r.key}"
          style="margin-top:8px;font-size:11px;color:var(--color-text-3);background:none;border:none;cursor:pointer;text-decoration:underline">
          ✕ Remover mapeamento</button>`:''}
      </div>`).join('')}
      <div style="font-size:12px;color:var(--color-text-3);display:flex;align-items:flex-start;gap:6px">
        <i data-lucide="info" style="width:13px;height:13px;flex-shrink:0;margin-top:1px"></i>
        As linhas <strong>Leads do Meta</strong>, <strong>Oportunidades no CRM</strong> e <strong>Vendas</strong> são calculadas automaticamente.
      </div>
    </div>
    <div style="padding:14px 22px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;flex-shrink:0">
      <button id="closeSalesCfgBtn2" class="btn btn-primary btn-sm">Fechar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  lucide.createIcons();
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target===overlay) close(); });
  overlay.querySelector('#closeSalesCfgBtn')?.addEventListener('click', close);
  overlay.querySelector('#closeSalesCfgBtn2')?.addEventListener('click', close);
  overlay.querySelectorAll('.sales-cfg-stage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newCfg = _getSalesCfg();
      newCfg[btn.dataset.role] = { pipeline_id: btn.dataset.pipelineId, stage_id: btn.dataset.stageId };
      _setSalesCfg(newCfg);
      overlay.remove(); _openSalesCfgModal(pipelines); _refreshSalesFunnel(pipelines);
    });
  });
  overlay.querySelectorAll('.sales-cfg-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newCfg = _getSalesCfg(); delete newCfg[btn.dataset.role]; _setSalesCfg(newCfg);
      overlay.remove(); _openSalesCfgModal(pipelines); _refreshSalesFunnel(pipelines);
    });
  });
}

// ════════════════════════════════════════════════════════════
// SEÇÃO: Espelho do Funil
// ════════════════════════════════════════════════════════════
function _mirrorFunnelRows(stages) {
  if (!stages.length)
    return `<div style="text-align:center;padding:24px;color:var(--color-text-3);font-size:13px">Este funil não tem etapas cadastradas.</div>`;
  const maxCount = Math.max(...stages.map(s => s.open_count), 1);
  return stages.map((stage, idx) => {
    const pct  = Math.min(100, Math.max(14, Math.round(stage.open_count/maxCount*100)));
    const prev = idx > 0 ? stages[idx-1].open_count : null;
    const conv = (prev !== null && prev > 0) ? Math.round(stage.open_count/prev*100) : null;
    return `
    <div class="funnel-mirror-row">
      <div class="funnel-mirror-bar-wrap">
        <div class="funnel-mirror-bar" style="width:${pct}%;background:${stage.color||'#374151'}">
          <span class="funnel-mirror-label">${stage.name}</span>
          <span class="funnel-mirror-count">${stage.open_count}</span>
        </div>
      </div>
      ${conv!==null
        ?`<div class="funnel-mirror-conv"><i data-lucide="arrow-down" style="width:10px;height:10px"></i> ${conv}%</div>`
        :'<div class="funnel-mirror-conv"></div>'}
    </div>`;
  }).join('');
}

function _renderFunnelMirror(pipelines) {
  if (!pipelines?.length) return '';
  const pipeline  = pipelines[_activeMirrorIdx] || pipelines[0];
  const stages    = pipeline.stages || [];
  const totalOpen = pipeline.open_count;
  return `
  <div class="dash-section-title">Exibição do Funil</div>
  <div class="card">
    <div class="card-header">
      <div>
        <div class="card-title">Etapas do Funil</div>
        <div class="card-subtitle" id="mirrorFunnelSubtitle">${totalOpen} oportunidade${totalOpen!==1?'s':''} em aberto · ${stages.length} etapa${stages.length!==1?'s':''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${_pipelineSelect('mirrorFunnelSelect', pipelines, _activeMirrorIdx)}
        <a href="#" data-page="funnels" class="btn btn-ghost btn-sm nav-link-btn" title="Editar funil">
          <i data-lucide="external-link" style="width:13px;height:13px"></i>
        </a>
      </div>
    </div>
    <div id="mirrorFunnelViz" class="funnel-mirror">${_mirrorFunnelRows(stages)}</div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// SEÇÃO: Oportunidades por Origem
// ════════════════════════════════════════════════════════════
function _renderOppsBySource(oppsBySource) {
  const total = (oppsBySource||[]).reduce((s,r) => s+r.count, 0);
  if (!oppsBySource?.length) return `
    <div class="dash-section-title">Oportunidades por Origem</div>
    <div class="card" style="display:flex;align-items:center;justify-content:center;min-height:80px;color:var(--color-text-3);font-size:13px">
      Nenhuma oportunidade cadastrada.</div>`;
  const palette = { whatsapp:'#000', instagram:'#7c3aed', site:'#2563eb', email:'#d97706',
                    indicacao:'#059669', manual:'#6b7280', __none__:'#d1d5db' };
  const rows = oppsBySource.map(r => {
    const pct   = total>0 ? (r.count/total*100) : 0;
    const color = palette[r.source] || '#9ca3af';
    const isNone = r.source === '__none__';
    return `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:120px;flex-shrink:0;font-size:12px;font-weight:${isNone?'400':'600'};color:${isNone?'var(--color-text-3)':'var(--color-text-2)'};text-align:right">
        ${_srcLabel(r.source)}
      </div>
      <div style="flex:1;height:28px;position:relative;display:flex;align-items:center">
        <div style="position:absolute;left:0;top:4px;bottom:4px;border-radius:4px;background:${color};width:${Math.max(2,pct)}%;opacity:${isNone?.4:1}"></div>
      </div>
      <div style="width:70px;flex-shrink:0;display:flex;justify-content:space-between;font-size:12px">
        <span style="font-weight:700">${r.count}</span>
        <span style="color:var(--color-text-3)">${pct.toFixed(0)}%</span>
      </div>
    </div>`;
  }).join('');
  return `
  <div class="dash-section-title">Oportunidades por Origem <span style="font-size:12px;font-weight:400;color:var(--color-text-3);margin-left:6px">${total} total</span></div>
  <div class="card"><div style="display:flex;flex-direction:column;gap:4px">${rows}</div></div>`;
}

// ════════════════════════════════════════════════════════════
// SEÇÃO: Oportunidades Perdidas
// ════════════════════════════════════════════════════════════
function _renderLostSection(lostOpps, lostByReason) {
  const total = lostOpps?.length ?? 0;
  const listHtml = !total
    ? `<div style="text-align:center;padding:24px;color:var(--color-text-3);font-size:13px">Nenhuma oportunidade perdida.</div>`
    : `<div class="table-wrapper"><table>
        <thead><tr><th>Contato</th><th>Oportunidade</th><th>Funil</th><th style="text-align:right">Valor</th><th style="text-align:right">Data</th></tr></thead>
        <tbody>${lostOpps.map(o => `
        <tr>
          <td style="font-weight:600">${o.contact_name}</td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.title}</td>
          <td><span class="badge badge-gray">${o.pipeline_name}</span></td>
          <td style="text-align:right;font-weight:600">${_brl(o.value)}</td>
          <td style="text-align:right;color:var(--color-text-3);white-space:nowrap">${o.lost_date}</td>
        </tr>`).join('')}
        </tbody></table></div>`;
  const reasonHtml = !lostByReason?.length
    ? `<div style="text-align:center;padding:24px;color:var(--color-text-3);font-size:13px">Sem dados.</div>`
    : (() => {
        const totalR = lostByReason.reduce((s,r) => s+r.count, 0);
        return lostByReason.map((r,i) => {
          const pct   = totalR>0 ? Math.round(r.count/totalR*100) : 0;
          const isNone= r.reason==='__none__';
          return `
          <div style="display:flex;flex-direction:column;gap:4px;padding:10px 0;${i<lostByReason.length-1?'border-bottom:1px solid var(--color-border)':''}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:13px;font-weight:${isNone?'400':'600'};color:${isNone?'var(--color-text-3)':'var(--color-text-1)'}">
                ${isNone?'Sem motivo preenchido':r.reason}
              </span>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;color:var(--color-text-3)">${_brl(r.value)}</span>
                <span class="badge ${isNone?'badge-gray':'badge-red'}">${r.count}</span>
              </div>
            </div>
            <div style="height:4px;border-radius:2px;background:var(--color-bg);overflow:hidden">
              <div style="height:100%;border-radius:2px;background:${isNone?'var(--color-border-2)':'var(--color-red)'};width:${pct}%"></div>
            </div>
          </div>`;
        }).join('');
      })();
  return `
  <div class="dash-section-title">Oportunidades Perdidas <span style="font-size:12px;font-weight:400;color:var(--color-text-3);margin-left:6px">${total} registros</span></div>
  <div class="grid-2" style="align-items:start">
    <div class="card" style="padding:0;overflow:hidden">
      <div class="card-header" style="padding:14px 18px"><div class="card-title">Lista de Perdas</div></div>
      ${listHtml}
    </div>
    <div class="card">
      <div class="card-header"><div><div class="card-title">Motivos de Perda</div><div class="card-subtitle">Agrupado pelo campo motivo</div></div></div>
      <div style="display:flex;flex-direction:column">${reasonHtml}</div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// TABS
// ════════════════════════════════════════════════════════════
function _renderDashTabs(dashboards) {
  const tabs = (dashboards||[]).map(d =>
    `<button class="dash-tab${_activeDashId===d.id?' active':''}" data-dash-id="${d.id}">${d.name}</button>`
  ).join('');
  return `
  <div class="dash-tabs" id="dashTabsBar">
    <button class="dash-tab${!_activeDashId?' active':''}" data-dash-id="">Visão Geral</button>
    ${tabs}
    ${window.favxCan('edit_dashboard') ? `<button class="dash-tab-new" id="btnNewDash">
      <i data-lucide="plus" style="width:12px;height:12px"></i> Novo Dashboard
    </button>` : ''}
  </div>`;
}

// ════════════════════════════════════════════════════════════
// CUSTOM DASHBOARD — widget grid
// ════════════════════════════════════════════════════════════
const _PILLAR_ICON  = { contacts:'users', funnels:'filter', conversations:'message-circle' };
const _PILLAR_LABEL = { contacts:'Contatos', funnels:'Funis', conversations:'Conversas' };
const _WIDTH_CLASS  = { third:'widget-w-third', half:'widget-w-half', full:'widget-w-full' };

async function _loadAndRenderCustomDash(dashId, pipelines) {
  const content = document.getElementById('dashMainContent');
  if (!content) return;
  content.innerHTML = `<div class="dash-load-state">
    <div class="dash-load-spin"></div><span>Carregando dashboard...</span></div>`;

  let widgets = [];
  try { widgets = await apiFetch(`/api/custom-dashboards/${dashId}/widgets`); }
  catch { widgets = []; }

  const results = await Promise.allSettled(
    widgets.map(w => apiFetch(`/api/dashboard-widgets/${w.id}/data`, { method:'POST' }))
  );
  const dataMap = {};
  widgets.forEach((w,i) => { dataMap[w.id] = results[i].status==='fulfilled' ? results[i].value : null; });

  content.innerHTML = _renderWidgetGrid(widgets, dataMap, dashId, pipelines);
  lucide.createIcons();
  _initAllCharts(widgets, dataMap);
  _bindWidgetGridEvents(dashId, pipelines);
}

function _renderWidgetGrid(widgets, dataMap, dashId, pipelines) {
  const dash = (_dashData?.dashboards||[]).find(d => d.id===dashId);
  const grid = !widgets.length
    ? `<div class="dash-empty-widgets">
        <div class="dash-empty-icon"><i data-lucide="layout-dashboard" style="width:28px;height:28px"></i></div>
        <div class="dash-empty-title">Dashboard vazio</div>
        <div class="dash-empty-text">Adicione widgets para visualizar dados de contatos, funis e conversas.</div>
       </div>`
    : `<div class="widget-grid">${widgets.map(w => _renderWidgetCard(w, dataMap[w.id])).join('')}</div>`;
  return `
  <div class="dash-custom-toolbar">
    <div>
      <div style="font-size:16px;font-weight:700;color:var(--color-text-1)">${dash?.name||'Dashboard'}</div>
      <div style="font-size:12px;color:var(--color-text-3);margin-top:2px">${widgets.length} widget${widgets.length!==1?'s':''}</div>
    </div>
    ${window.favxCan('edit_dashboard') ? `<div style="display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" id="btnAddWidget">
        <i data-lucide="plus" style="width:13px;height:13px"></i> Adicionar Widget
      </button>
      <button class="btn btn-secondary btn-sm" id="btnRenameDash" title="Renomear">
        <i data-lucide="pencil" style="width:13px;height:13px"></i>
      </button>
      <button class="btn btn-secondary btn-sm" id="btnDeleteDash" title="Excluir dashboard">
        <i data-lucide="trash-2" style="width:13px;height:13px"></i>
      </button>
    </div>` : ''}
  </div>
  ${grid}`;
}

function _renderWidgetCard(widget, data) {
  const { id, title, pillar, display, width } = widget;
  const icon  = _PILLAR_ICON[pillar] || 'bar-chart-2';
  const wc    = _WIDTH_CLASS[width]  || 'widget-w-third';
  const body  = _renderWidgetContent(widget, data);
  return `
  <div class="widget-card ${wc}" id="widget-${id}">
    <div class="widget-card-header">
      <div class="widget-card-meta">
        <i data-lucide="${icon}" style="width:12px;height:12px;color:var(--color-text-3)"></i>
        <span class="widget-card-title">${title || _PILLAR_LABEL[pillar] || 'Widget'}</span>
      </div>
      ${window.favxCan('edit_dashboard') ? `<div class="widget-actions">
        <button class="widget-edit-btn"   data-widget-id="${id}" title="Editar"><i data-lucide="pencil"  style="width:12px;height:12px"></i></button>
        <button class="widget-delete-btn" data-widget-id="${id}" title="Excluir"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
      </div>` : ''}
    </div>
    <div class="widget-card-body" id="widget-body-${id}">${body}</div>
  </div>`;
}

function _renderWidgetContent(widget, data) {
  if (!data) return `<div class="widget-error"><i data-lucide="alert-circle" style="width:14px;height:14px"></i> Erro ao carregar</div>`;
  const metric  = widget.config?.metric || 'count';
  const isMoney = metric==='sum_value' || metric==='avg_value';

  if (data.type==='scalar' || widget.display==='kpi') {
    const val       = data.type==='scalar' ? +data.value : (data.rows||[]).reduce((s,r) => s+(+r.value), 0);
    const formatted = isMoney ? _brl(val) : val.toLocaleString('pt-BR');
    return `<div class="widget-kpi">
      <div class="widget-kpi-value">${formatted}</div>
      <div class="widget-kpi-label">${_metricLabel(metric, widget.pillar)}</div>
    </div>`;
  }
  if (!data.rows?.length) return `<div class="widget-empty">Sem dados para exibir</div>`;
  if (widget.display==='table') return `<div class="widget-table-wrap">${_renderWidgetTable(data.rows, isMoney)}</div>`;
  return `<div class="widget-chart-wrap"><canvas id="chart-${widget.id}"></canvas></div>`;
}

function _renderWidgetTable(rows, isMoney) {
  return `<table class="widget-table">
    <thead><tr><th>Item</th><th style="text-align:right">${isMoney?'Valor':'Qtde'}</th></tr></thead>
    <tbody>${rows.slice(0,15).map(r => `
      <tr>
        <td>${r.label||'—'}</td>
        <td style="text-align:right;font-weight:600">${isMoney?_brl(r.value):(+r.value).toLocaleString('pt-BR')}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function _initAllCharts(widgets, dataMap) {
  widgets.forEach(w => {
    if (!['bar','pie','line'].includes(w.display)) return;
    const data = dataMap[w.id];
    if (data?.type==='series' && data.rows?.length)
      _initChart(`chart-${w.id}`, data.rows, w.display, w.config?.metric||'count');
  });
}

function _initChart(canvasId, rows, display, metric) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (_chartInstances[canvasId]) { _chartInstances[canvasId].destroy(); delete _chartInstances[canvasId]; }

  const isDark   = document.documentElement.getAttribute('data-theme')==='dark';
  const gridClr  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textClr  = isDark ? '#b0b8cc' : '#6b7280';
  const isMoney  = metric==='sum_value' || metric==='avg_value';
  const labels   = rows.map(r => String(r.label||'—'));
  const values   = rows.map(r => +r.value);
  const palette  = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];
  const colors   = rows.map((_,i) => palette[i % palette.length]);

  _chartInstances[canvasId] = new Chart(canvas, {
    type: display==='pie' ? 'doughnut' : display,
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: display==='pie' ? colors : colors[0]+'99',
        borderColor:     display==='pie' ? 'transparent' : colors[0],
        borderWidth: display==='line' ? 2 : 1,
        fill: false, tension: 0.35,
        pointRadius: display==='line' ? 3 : 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: display==='pie', position:'right', labels:{ color:textClr, font:{size:11} } },
        tooltip: { callbacks: { label: ctx => {
          const v = ctx.parsed?.y ?? ctx.parsed ?? ctx.raw;
          return ' '+(isMoney?_brl(v):(+v).toLocaleString('pt-BR'));
        }}},
      },
      scales: display!=='pie' ? {
        y: { beginAtZero:true, grid:{color:gridClr}, ticks:{color:textClr, font:{size:10}, callback: v => isMoney?_brl(v):v } },
        x: { grid:{display:false}, ticks:{color:textClr, font:{size:10}} },
      } : undefined,
    },
  });
}

function _bindWidgetGridEvents(dashId, pipelines) {
  document.getElementById('btnAddWidget')?.addEventListener('click', () => {
    _openWidgetBuilder(dashId, pipelines, null);
  });

  document.getElementById('btnRenameDash')?.addEventListener('click', async () => {
    const dash = (_dashData?.dashboards||[]).find(d => d.id===dashId);
    const name = prompt('Novo nome do dashboard:', dash?.name||'');
    if (!name?.trim()) return;
    try {
      await apiFetch(`/api/custom-dashboards/${dashId}`, { method:'PUT', body:JSON.stringify({ name:name.trim() }) });
      _dashData.dashboards = await apiFetch('/api/custom-dashboards');
      _rebuildTabBar(pipelines);
    } catch(e) { alert(e.message); }
  });

  document.getElementById('btnDeleteDash')?.addEventListener('click', async () => {
    if (!confirm('Excluir este dashboard e todos os widgets?')) return;
    try {
      await apiFetch(`/api/custom-dashboards/${dashId}`, { method:'DELETE' });
      _dashData.dashboards = await apiFetch('/api/custom-dashboards');
      _activeDashId = null;
      _rebuildTabBar(pipelines);
      document.getElementById('dashOverviewContent').style.display = '';
      document.getElementById('dashMainContent').innerHTML = '';
    } catch(e) { alert(e.message); }
  });

  document.querySelectorAll('.widget-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const wid     = btn.dataset.widgetId;
      const widgets = await apiFetch(`/api/custom-dashboards/${dashId}/widgets`).catch(()=>[]);
      const widget  = widgets.find(w => w.id===wid);
      if (widget) _openWidgetBuilder(dashId, pipelines, widget);
    });
  });

  document.querySelectorAll('.widget-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir este widget?')) return;
      try {
        await apiFetch(`/api/dashboard-widgets/${btn.dataset.widgetId}`, { method:'DELETE' });
        const inst = _chartInstances[`chart-${btn.dataset.widgetId}`];
        if (inst) { inst.destroy(); delete _chartInstances[`chart-${btn.dataset.widgetId}`]; }
        await _loadAndRenderCustomDash(dashId, pipelines);
      } catch(e) { alert(e.message); }
    });
  });
}

function _rebuildTabBar(pipelines) {
  const bar = document.getElementById('dashTabsBar');
  if (!bar) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = _renderDashTabs(_dashData?.dashboards||[]);
  bar.replaceWith(tmp.firstElementChild);
  lucide.createIcons();
  _bindTabEvents(pipelines);
}

function _bindTabEvents(pipelines) {
  document.getElementById('dashTabsBar')?.querySelectorAll('.dash-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.dashId;
      _activeDashId = id || null;
      document.querySelectorAll('#dashTabsBar .dash-tab').forEach(t => t.classList.toggle('active', t===tab));
      const overview = document.getElementById('dashOverviewContent');
      const custom   = document.getElementById('dashMainContent');
      if (!id) {
        overview.style.display = '';
        custom.innerHTML = '';
      } else {
        overview.style.display = 'none';
        _loadAndRenderCustomDash(id, pipelines);
      }
    });
  });

  document.getElementById('btnNewDash')?.addEventListener('click', async () => {
    const name = prompt('Nome do novo dashboard:');
    if (!name?.trim()) return;
    try {
      const dash = await apiFetch('/api/custom-dashboards', { method:'POST', body:JSON.stringify({ name:name.trim() }) });
      _dashData.dashboards = await apiFetch('/api/custom-dashboards');
      _activeDashId = dash.id;
      _rebuildTabBar(pipelines);
      document.getElementById('dashOverviewContent').style.display = 'none';
      _loadAndRenderCustomDash(dash.id, pipelines);
    } catch(e) { alert(e.message); }
  });
}

// ════════════════════════════════════════════════════════════
// WIDGET BUILDER
// ════════════════════════════════════════════════════════════
const _WF = {
  contacts:      [
    { id:'created_at',      label:'Data de criação',     type:'date' },
    { id:'updated_at',      label:'Data de atualização', type:'date' },
    { id:'source',          label:'Origem',              type:'source_multi' },
  ],
  funnels: [
    { id:'pipeline_id',     label:'Funil',               type:'pipeline_multi' },
    { id:'stage_id',        label:'Etapa',               type:'stage_multi' },
    { id:'status',          label:'Status',              type:'funnel_status' },
    { id:'value',           label:'Valor (R$)',           type:'number' },
    { id:'created_at',      label:'Data de criação',     type:'date' },
    { id:'updated_at',      label:'Data de atualização', type:'date' },
  ],
  conversations: [
    { id:'status',          label:'Status',              type:'conv_status' },
    { id:'created_at',      label:'Data de criação',     type:'date' },
    { id:'updated_at',      label:'Data de atualização', type:'date' },
    { id:'last_message_at', label:'Última mensagem',     type:'date' },
  ],
};
const _DATE_OPS = [
  { id:'today',       label:'Hoje' },
  { id:'yesterday',   label:'Ontem' },
  { id:'this_week',   label:'Esta semana' },
  { id:'last_week',   label:'Semana passada' },
  { id:'this_month',  label:'Este mês' },
  { id:'last_month',  label:'Mês passado' },
  { id:'last_7_days', label:'Últimos 7 dias' },
  { id:'last_30_days',label:'Últimos 30 dias' },
  { id:'last_90_days',label:'Últimos 90 dias' },
];
const _NUM_OPS = [
  { id:'gt',  label:'Maior que (>)' },
  { id:'gte', label:'Maior ou igual (≥)' },
  { id:'lt',  label:'Menor que (<)' },
  { id:'lte', label:'Menor ou igual (≤)' },
  { id:'eq',  label:'Igual a (=)' },
];
const _GROUP_BY = {
  contacts:      [
    { id:'',           label:'Nenhum — valor único' },
    { id:'source',     label:'Por origem' },
    { id:'date_month', label:'Por mês (criação)' },
    { id:'date_day',   label:'Por dia (criação)' },
  ],
  funnels: [
    { id:'',           label:'Nenhum — valor único' },
    { id:'pipeline',   label:'Por funil' },
    { id:'stage',      label:'Por etapa' },
    { id:'status',     label:'Por status' },
    { id:'date_month', label:'Por mês (criação)' },
  ],
  conversations: [
    { id:'',           label:'Nenhum — valor único' },
    { id:'status',     label:'Por status' },
    { id:'date_month', label:'Por mês (criação)' },
    { id:'date_day',   label:'Por dia (criação)' },
  ],
};
const _METRICS = {
  contacts:      [{ id:'count',     label:'Contagem de contatos' }],
  funnels:       [{ id:'count',     label:'Contagem de oportunidades' },
                  { id:'sum_value', label:'Soma do valor (R$)' },
                  { id:'avg_value', label:'Média do valor (R$)' }],
  conversations: [{ id:'count',     label:'Contagem de conversas' }],
};

function _wFieldDef(pillar, fieldId) {
  return (_WF[pillar]||[]).find(f => f.id===fieldId);
}

function _wCondValueHtml(cond, idx, pillar, pipelines) {
  const def = _wFieldDef(pillar, cond.field);
  if (!def) return '';
  if (def.type==='date') return '';

  if (def.type==='number') {
    return `<input type="number" class="form-input cond-val-num" data-idx="${idx}"
      placeholder="Valor" value="${cond.value??''}" style="font-size:12px;width:90px;flex-shrink:0">`;
  }

  const sel = new Set(Array.isArray(cond.value) ? cond.value : []);
  let opts = [];
  if (def.type==='source_multi')   opts = [
    {id:'whatsapp',label:'WhatsApp'},{id:'instagram',label:'Instagram'},
    {id:'site',label:'Site'},{id:'email',label:'E-mail'},
    {id:'indicacao',label:'Indicação'},{id:'manual',label:'Manual'},
    {id:'__none__',label:'Sem origem'},
  ];
  if (def.type==='pipeline_multi') opts = (pipelines||[]).map(p=>({id:p.id,label:p.name}));
  if (def.type==='stage_multi')    opts = (pipelines||[]).flatMap(p=>(p.stages||[]).map(s=>({id:s.id,label:`${p.name} › ${s.name}`})));
  if (def.type==='funnel_status')  opts = [{id:'open',label:'Em aberto'},{id:'won',label:'Ganho'},{id:'lost',label:'Perdido'}];
  if (def.type==='conv_status')    opts = [{id:'open',label:'Aberta'},{id:'closed',label:'Fechada'}];

  return `<div class="wbuild-multicheck">
    ${opts.map(o=>`<label class="wbuild-check-item"><input type="checkbox" class="cond-val-check" data-idx="${idx}" value="${o.id}" ${sel.has(o.id)?'checked':''}> ${o.label}</label>`).join('')}
  </div>`;
}

function _wCondRowHtml(cond, idx, pillar, pipelines) {
  const fields    = _WF[pillar]||[];
  const def       = _wFieldDef(pillar, cond.field) || fields[0];
  const connector = cond.connector || 'and';
  const fSel   = `<select class="form-input cond-field" data-idx="${idx}" style="font-size:12px;min-width:130px;flex:0 0 auto">
    ${fields.map(f=>`<option value="${f.id}" ${f.id===cond.field?'selected':''}>${f.label}</option>`).join('')}
  </select>`;
  let opHtml = '';
  if (def?.type==='date') {
    opHtml = `<select class="form-input cond-op" data-idx="${idx}" style="font-size:12px;min-width:140px;flex:0 0 auto">
      ${_DATE_OPS.map(o=>`<option value="${o.id}" ${o.id===cond.operator?'selected':''}>${o.label}</option>`).join('')}
    </select>`;
  } else if (def?.type==='number') {
    opHtml = `<select class="form-input cond-op" data-idx="${idx}" style="font-size:12px;min-width:140px;flex:0 0 auto">
      ${_NUM_OPS.map(o=>`<option value="${o.id}" ${o.id===cond.operator?'selected':''}>${o.label}</option>`).join('')}
    </select>`;
  } else {
    opHtml = `<span style="font-size:11px;color:var(--color-text-3);padding:0 4px;white-space:nowrap;align-self:center;flex-shrink:0">é um de</span>`;
  }
  const valHtml   = _wCondValueHtml(cond, idx, pillar, pipelines);
  const connHtml  = idx > 0 ? `<div class="wbuild-conn-toggle">
    <button class="wbuild-conn-btn${connector==='and'?' active':''}" data-idx="${idx}" data-conn="and">E</button>
    <button class="wbuild-conn-btn${connector==='or'?' active':''}" data-idx="${idx}" data-conn="or">OU</button>
  </div>` : '';
  const orSep = (idx > 0 && connector === 'or') ? `<div class="wbuild-or-sep"><span>OU</span></div>` : '';
  return `${orSep}<div class="wbuild-cond-row" data-idx="${idx}">
    ${connHtml}${fSel}${opHtml}${valHtml}
    <button class="wbuild-cond-remove" data-idx="${idx}"><i data-lucide="x" style="width:11px;height:11px"></i></button>
  </div>`;
}

function _wConditionsHtml(conditions, pillar, pipelines) {
  if (!conditions.length)
    return `<div id="wbConditions" style="font-size:12px;color:var(--color-text-3);padding:8px 0">Sem condições — mostrará todos os dados.</div>`;
  return `<div id="wbConditions">${conditions.map((c,i)=>_wCondRowHtml(c,i,pillar,pipelines)).join('')}</div>`;
}

function _wReRenderConditions(overlay) {
  const old = overlay.querySelector('#wbConditions');
  if (!old) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = _wConditionsHtml(_wState.conditions, _wState.pillar, _wState.pipelines);
  old.replaceWith(tmp.firstElementChild || tmp);
  lucide.createIcons();
  _wBindCondEvents(overlay);
}

function _wBindCondEvents(overlay) {
  const wrap = overlay.querySelector('#wbConditions');
  if (!wrap) return;

  wrap.addEventListener('change', e => {
    const idx = parseInt(e.target.dataset.idx);
    if (isNaN(idx)) return;
    if (e.target.classList.contains('cond-field')) {
      const field     = e.target.value;
      const def       = _wFieldDef(_wState.pillar, field);
      const op        = def?.type==='date' ? 'this_month' : def?.type==='number' ? 'gt' : 'in';
      const connector = _wState.conditions[idx]?.connector || 'and';
      _wState.conditions[idx] = { field, operator:op, value:null, connector };
      _wReRenderConditions(overlay);
    } else if (e.target.classList.contains('cond-op')) {
      _wState.conditions[idx].operator = e.target.value;
      _wState.conditions[idx].value    = null;
    } else if (e.target.classList.contains('cond-val-check')) {
      const c = _wState.conditions[idx];
      if (!Array.isArray(c.value)) c.value = [];
      if (e.target.checked) { if (!c.value.includes(e.target.value)) c.value.push(e.target.value); }
      else { c.value = c.value.filter(v => v!==e.target.value); }
    } else if (e.target.classList.contains('cond-val-num')) {
      _wState.conditions[idx].value = e.target.value!=='' ? parseFloat(e.target.value) : null;
    }
  });

  wrap.addEventListener('click', e => {
    const connBtn = e.target.closest('.wbuild-conn-btn');
    if (connBtn) {
      const idx  = parseInt(connBtn.dataset.idx);
      const conn = connBtn.dataset.conn;
      if (!isNaN(idx) && _wState.conditions[idx]) {
        _wState.conditions[idx].connector = conn;
        _wReRenderConditions(overlay);
      }
      return;
    }
    const btn = e.target.closest('.wbuild-cond-remove');
    if (!btn) return;
    _wState.conditions.splice(parseInt(btn.dataset.idx), 1);
    _wReRenderConditions(overlay);
  });
}

// ── Step 1: pillar picker ─────────────────────────────────────
function _wFillPillarPicker(overlay, dashId) {
  const inner = overlay.querySelector('#wbInner');
  inner.innerHTML = `
    <div class="wpillar-picker">
      <p class="wpillar-picker-hint">Selecione o tipo de dado que o widget irá exibir</p>
      <div class="wpillar-grid">

        <button class="wpillar-card wpillar-card--funnels" data-pillar="funnels">
          <div class="wpillar-icon-wrap wpillar-icon-wrap--funnels">
            <i data-lucide="filter" style="width:38px;height:38px"></i>
          </div>
          <div class="wpillar-label">Funis</div>
          <div class="wpillar-desc">Oportunidades, estágios e receita de pipeline</div>
          <div class="wpillar-arrow"><i data-lucide="arrow-right" style="width:14px;height:14px"></i></div>
        </button>

        <button class="wpillar-card wpillar-card--contacts" data-pillar="contacts">
          <div class="wpillar-icon-wrap wpillar-icon-wrap--contacts">
            <i data-lucide="users" style="width:38px;height:38px"></i>
          </div>
          <div class="wpillar-label">Contatos</div>
          <div class="wpillar-desc">Leads, clientes e perfis de contato</div>
          <div class="wpillar-arrow"><i data-lucide="arrow-right" style="width:14px;height:14px"></i></div>
        </button>

        <button class="wpillar-card wpillar-card--conversations" data-pillar="conversations">
          <div class="wpillar-icon-wrap wpillar-icon-wrap--conversations">
            <i data-lucide="message-circle" style="width:38px;height:38px"></i>
          </div>
          <div class="wpillar-label">Conversas</div>
          <div class="wpillar-desc">Atendimentos, mensagens e suporte ao cliente</div>
          <div class="wpillar-arrow"><i data-lucide="arrow-right" style="width:14px;height:14px"></i></div>
        </button>

      </div>
    </div>`;
  lucide.createIcons();

  inner.querySelectorAll('.wpillar-card').forEach(card => {
    card.addEventListener('click', () => {
      _wState.pillar = card.dataset.pillar;
      const sub = overlay.querySelector('#wbDialogSub');
      if (sub) sub.textContent = 'Configure os dados e a visualização do widget';
      _wFillForm(overlay, dashId, null);
    });
  });
}

// ── Step 2: full config form ──────────────────────────────────
function _wFillForm(overlay, dashId, existingWidget) {
  const PILLAR_META = {
    funnels:       { label: 'Funis',     icon: 'filter',         cls: 'funnels' },
    contacts:      { label: 'Contatos',  icon: 'users',          cls: 'contacts' },
    conversations: { label: 'Conversas', icon: 'message-circle', cls: 'conversations' },
  };
  function wBtn(label, key, val) {
    return `<button class="wbuild-btn${_wState[key]===val?' active':''}" data-wkey="${key}" data-wval="${val}">${label}</button>`;
  }

  // For editing show pillar buttons; for new widget show a badge with "Alterar" link
  const isEditing = !!_wState.editId;
  const pm = PILLAR_META[_wState.pillar] || PILLAR_META.funnels;
  const pillarSection = isEditing
    ? `<div class="wbuild-section">
        <div class="wbuild-section-title">Pilar de dados</div>
        <div class="wbuild-btn-group" id="wbPillarGroup">
          ${wBtn('<i data-lucide="filter" style="width:12px;height:12px"></i>&nbsp;Funis','pillar','funnels')}
          ${wBtn('<i data-lucide="users" style="width:12px;height:12px"></i>&nbsp;Contatos','pillar','contacts')}
          ${wBtn('<i data-lucide="message-circle" style="width:12px;height:12px"></i>&nbsp;Conversas','pillar','conversations')}
        </div>
      </div>`
    : `<div class="wbuild-section">
        <div class="wbuild-section-title">Pilar de dados</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="wpillar-badge wpillar-badge--${pm.cls}">
            <i data-lucide="${pm.icon}" style="width:12px;height:12px"></i>
            ${pm.label}
          </span>
          <button id="wbChangePillar" style="background:none;border:none;padding:0;cursor:pointer;font-size:11px;color:var(--color-text-3);text-decoration:underline">Alterar</button>
        </div>
      </div>`;

  overlay.querySelector('#wbInner').innerHTML = `
    <div style="overflow-y:auto;flex:1;padding:20px 22px;display:flex;flex-direction:column;gap:18px;min-height:0">

      <div class="wbuild-section">
        <div class="wbuild-section-title">Título</div>
        <input id="wbTitle" class="form-input" placeholder="Ex: Novos contatos este mês" value="${_wState.title}" style="font-size:13px">
      </div>

      ${pillarSection}

      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div class="wbuild-section" style="flex:1;min-width:180px">
          <div class="wbuild-section-title">Exibição</div>
          <div class="wbuild-btn-group" id="wbDisplayGroup">
            ${wBtn('KPI','display','kpi')}${wBtn('Barra','display','bar')}
            ${wBtn('Pizza','display','pie')}${wBtn('Linha','display','line')}${wBtn('Tabela','display','table')}
          </div>
        </div>
        <div class="wbuild-section" style="flex:1;min-width:140px">
          <div class="wbuild-section-title">Largura</div>
          <div class="wbuild-btn-group">
            ${wBtn('1/3','width','third')}${wBtn('1/2','width','half')}${wBtn('Inteiro','width','full')}
          </div>
        </div>
      </div>

      <div class="wbuild-section">
        <div class="wbuild-section-title">Métrica</div>
        <div class="wbuild-btn-group" id="wbMetricGroup">
          ${(_METRICS[_wState.pillar]||[]).map(m =>
            `<button class="wbuild-btn${_wState.metric===m.id?' active':''}" data-wkey="metric" data-wval="${m.id}">${m.label}</button>`
          ).join('')}
        </div>
      </div>

      <div class="wbuild-section">
        <div class="wbuild-section-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Condições <span style="font-size:10px;font-weight:400;color:var(--color-text-3)">(filtros aplicados à consulta)</span></span>
          <button id="wbAddCond" class="wbuild-add-cond"><i data-lucide="plus" style="width:11px;height:11px"></i> Condição</button>
        </div>
        ${_wConditionsHtml(_wState.conditions, _wState.pillar, _wState.pipelines)}
      </div>

      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div class="wbuild-section" style="flex:1;min-width:180px">
          <div class="wbuild-section-title">Agrupar por</div>
          <select id="wbGroupBy" class="form-input" style="font-size:13px">
            ${(_GROUP_BY[_wState.pillar]||[]).map(g =>
              `<option value="${g.id}" ${g.id===_wState.group_by?'selected':''}>${g.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="wbuild-section" style="flex:1;min-width:140px">
          <div class="wbuild-section-title">Ordenação</div>
          <select id="wbSort" class="form-input" style="font-size:13px">
            <option value="desc" ${_wState.sort==='desc'?'selected':''}>Maior primeiro</option>
            <option value="asc"  ${_wState.sort==='asc' ?'selected':''}>Menor primeiro</option>
          </select>
        </div>
      </div>

    </div>

    <div style="padding:14px 22px;border-top:1px solid var(--color-border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
      <button id="wbCancel" class="btn btn-secondary btn-sm">Cancelar</button>
      <button id="wbSave" class="btn btn-primary btn-sm">
        <i data-lucide="check" style="width:13px;height:13px"></i> ${isEditing?'Salvar Alterações':'Adicionar Widget'}
      </button>
    </div>`;

  lucide.createIcons();

  const close = () => overlay.remove();
  overlay.querySelector('#wbCancel')?.addEventListener('click', close);

  // "Alterar" → back to pillar picker (new widget flow only)
  overlay.querySelector('#wbChangePillar')?.addEventListener('click', () => {
    const sub = overlay.querySelector('#wbDialogSub');
    if (sub) sub.textContent = 'Escolha o pilar de dados do widget';
    _wFillPillarPicker(overlay, dashId);
  });

  // Toggle / pillar-change buttons
  const inner = overlay.querySelector('#wbInner');
  inner.addEventListener('click', e => {
    const btn = e.target.closest('[data-wkey]');
    if (!btn || btn.id === 'wbAddCond') return;
    const key = btn.dataset.wkey;
    const val = btn.dataset.wval;
    if (key === 'pillar' && val !== _wState.pillar) {
      _wState.pillar     = val;
      _wState.conditions = [];
      _wState.group_by   = '';
      _wState.metric     = 'count';
      inner.querySelectorAll('#wbPillarGroup .wbuild-btn').forEach(b => b.classList.toggle('active', b.dataset.wval === val));
      inner.querySelector('#wbMetricGroup').innerHTML = (_METRICS[val]||[]).map(m =>
        `<button class="wbuild-btn${m.id==='count'?' active':''}" data-wkey="metric" data-wval="${m.id}">${m.label}</button>`
      ).join('');
      inner.querySelector('#wbGroupBy').innerHTML = (_GROUP_BY[val]||[]).map(g =>
        `<option value="${g.id}">${g.label}</option>`
      ).join('');
      _wReRenderConditions(overlay);
    } else {
      _wState[key] = val;
      inner.querySelectorAll(`[data-wkey="${key}"]`).forEach(b => b.classList.toggle('active', b.dataset.wval === val));
    }
  });

  // Add condition
  inner.querySelector('#wbAddCond')?.addEventListener('click', () => {
    const fields = _WF[_wState.pillar]||[];
    const def    = fields[0];
    const op     = def?.type==='date' ? 'this_month' : def?.type==='number' ? 'gt' : 'in';
    _wState.conditions.push({ field: def?.id||'', operator: op, value: null, connector: 'and' });
    _wReRenderConditions(overlay);
  });

  _wBindCondEvents(overlay);

  // Save
  inner.querySelector('#wbSave')?.addEventListener('click', async () => {
    const title    = inner.querySelector('#wbTitle').value.trim();
    const group_by = inner.querySelector('#wbGroupBy').value || null;
    const sort     = inner.querySelector('#wbSort').value;
    const payload  = {
      title:   title || null,
      pillar:  _wState.pillar,
      display: _wState.display,
      width:   _wState.width,
      config: {
        metric:     _wState.metric,
        conditions: _wState.conditions.filter(c => c.field),
        group_by:   group_by || null,
        sort,
      },
    };
    const saveBtn = inner.querySelector('#wbSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    try {
      if (_wState.editId) {
        await apiFetch(`/api/dashboard-widgets/${_wState.editId}`, { method:'PUT', body:JSON.stringify(payload) });
      } else {
        await apiFetch(`/api/custom-dashboards/${dashId}/widgets`, { method:'POST', body:JSON.stringify(payload) });
      }
      close();
      await _loadAndRenderCustomDash(dashId, _wState.pipelines);
    } catch(err) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i data-lucide="check" style="width:13px;height:13px"></i> ${isEditing?'Salvar Alterações':'Adicionar Widget'}`;
      lucide.createIcons();
      alert(err.message);
    }
  });
}

// ── Entry point ───────────────────────────────────────────────
function _openWidgetBuilder(dashId, pipelines, existingWidget = null) {
  document.getElementById('wBuilderOverlay')?.remove();

  const isNew = !existingWidget;
  _wState = existingWidget ? {
    title:      existingWidget.title || '',
    pillar:     existingWidget.pillar || 'funnels',
    display:    existingWidget.display || 'kpi',
    width:      existingWidget.width || 'third',
    metric:     existingWidget.config?.metric || 'count',
    conditions: (existingWidget.config?.conditions||[]).map(c=>({...c})),
    group_by:   existingWidget.config?.group_by || '',
    sort:       existingWidget.config?.sort || 'desc',
    editId:     existingWidget.id,
    pipelines,
  } : { title:'', pillar:'funnels', display:'kpi', width:'third',
        metric:'count', conditions:[], group_by:'', sort:'desc', editId:null, pipelines };

  const overlay = document.createElement('div');
  overlay.id = 'wBuilderOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';

  overlay.innerHTML = `
  <div id="wbDialog" style="background:var(--color-surface);border-radius:14px;width:700px;max-width:100%;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 32px 64px rgba(0,0,0,.3);max-height:92vh">
    <div style="padding:18px 22px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
      <div>
        <div style="font-size:16px;font-weight:700;color:var(--color-text-1)">${isNew?'Adicionar Widget':'Editar Widget'}</div>
        <div id="wbDialogSub" style="font-size:12px;color:var(--color-text-3);margin-top:2px">${isNew?'Escolha o pilar de dados do widget':'Configure os dados e a visualização do widget'}</div>
      </div>
      <button id="wbClose" style="background:none;border:none;cursor:pointer;color:var(--color-text-3);padding:4px;border-radius:6px">
        <i data-lucide="x" style="width:18px;height:18px"></i>
      </button>
    </div>
    <div id="wbInner" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>
  </div>`;

  document.body.appendChild(overlay);
  lucide.createIcons();

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#wbClose')?.addEventListener('click', close);

  if (isNew) {
    _wFillPillarPicker(overlay, dashId);
  } else {
    _wFillForm(overlay, dashId, existingWidget);
  }
}

// ════════════════════════════════════════════════════════════
// Partial refresh
// ════════════════════════════════════════════════════════════
function _refreshSalesFunnel(pipelines) {
  const viz = document.getElementById('salesFunnelViz');
  if (!viz) return;
  const rows = _buildSalesRows(pipelines);
  viz.innerHTML = `
    <div class="dash-funnel-header">
      <span class="dash-funnel-col-label">Etapa</span><span></span>
      <span class="dash-funnel-col-conv">Conversão</span>
    </div>
    ${_salesFunnelRows(rows)}`;
  lucide.createIcons();
}

function _refreshMirrorFunnel(pipelines) {
  const viz = document.getElementById('mirrorFunnelViz');
  if (!viz) return;
  const pipeline  = pipelines[_activeMirrorIdx] || pipelines[0];
  const stages    = pipeline.stages || [];
  const totalOpen = pipeline.open_count;
  viz.innerHTML = _mirrorFunnelRows(stages);
  const sub = viz.closest('.card')?.querySelector('#mirrorFunnelSubtitle');
  if (sub) sub.textContent = `${totalOpen} oportunidade${totalOpen!==1?'s':''} em aberto · ${stages.length} etapa${stages.length!==1?'s':''}`;
  lucide.createIcons();
}

// ════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════
window.loadDashboard = async function () {
  const [advanced, dashboards] = await Promise.all([
    apiFetch('/api/dashboard/advanced').catch(() => null),
    apiFetch('/api/custom-dashboards').catch(() => []),
  ]);
  return { advanced, dashboards: dashboards || [] };
};

window.pageDashboard = function (data) {
  _dashData = data;
  const adv        = data?.advanced;
  const dashboards = data?.dashboards || [];
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Dashboard</h1>
      <p class="page-subtitle">Visão geral da operação</p>
    </div>
    <button class="btn btn-secondary btn-sm" onclick="window.location.reload()">
      <i data-lucide="refresh-cw" style="width:14px;height:14px"></i> Atualizar
    </button>
  </div>
  ${_renderDashTabs(dashboards)}
  <div id="dashOverviewContent">
    ${_renderRevenue(adv?.revenue)}
    ${_renderSalesFunnel(adv?.pipelines)}
    ${_renderFunnelMirror(adv?.pipelines)}
    ${_renderOppsBySource(adv?.opps_by_source)}
    ${_renderLostSection(adv?.lost_opps, adv?.lost_by_reason)}
  </div>
  <div id="dashMainContent"></div>`;
};

window.initDashboard = function () {
  const pipelines = _dashData?.advanced?.pipelines || [];

  document.getElementById('btnConfigSalesFunnel')?.addEventListener('click', () => {
    _openSalesCfgModal(pipelines);
  });
  document.getElementById('mirrorFunnelSelect')?.addEventListener('change', e => {
    _activeMirrorIdx = parseInt(e.target.value);
    _refreshMirrorFunnel(pipelines);
  });

  _bindTabEvents(pipelines);

  if (_activeDashId) {
    document.querySelectorAll('#dashTabsBar .dash-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.dashId===_activeDashId)
    );
    document.getElementById('dashOverviewContent').style.display = 'none';
    _loadAndRenderCustomDash(_activeDashId, pipelines);
  }
};
