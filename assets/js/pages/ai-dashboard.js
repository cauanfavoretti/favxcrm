window.pageAiDashboard = function() {
  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Painel da IA</h1>
      <p class="page-subtitle">Monitoramento em tempo real dos agentes de inteligência artificial</p>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary btn-sm"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i> Atualizar</button>
    </div>
  </div>

  <!-- METRICS -->
  <div class="ai-metrics-row">
    <div class="stat-card">
      <div class="stat-card-top">
        <div class="stat-icon black"><i data-lucide="zap" style="width:18px;height:18px"></i></div>
        <span class="stat-delta up"><i data-lucide="trending-up" style="width:12px;height:12px"></i> +18%</span>
      </div>
      <div class="stat-value">974</div>
      <div class="stat-label">Mensagens Processadas Hoje</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top">
        <div class="stat-icon green"><i data-lucide="check-circle" style="width:18px;height:18px"></i></div>
        <span class="stat-delta up"><i data-lucide="trending-up" style="width:12px;height:12px"></i> +5%</span>
      </div>
      <div class="stat-value">91,3%</div>
      <div class="stat-label">Taxa de Resolução IA</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top">
        <div class="stat-icon blue"><i data-lucide="clock" style="width:18px;height:18px"></i></div>
        <span class="stat-delta down"><i data-lucide="trending-down" style="width:12px;height:12px"></i> -0.3s</span>
      </div>
      <div class="stat-value">1,4s</div>
      <div class="stat-label">Tempo Médio de Resposta</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top">
        <div class="stat-icon yellow"><i data-lucide="alert-triangle" style="width:18px;height:18px"></i></div>
      </div>
      <div class="stat-value">23</div>
      <div class="stat-label">Escaladas para Humano</div>
    </div>
  </div>

  <!-- CHARTS -->
  <div class="ai-chart-row">
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Volume de Mensagens — Últimas 24h</div>
          <div class="card-subtitle">Por agente de IA</div>
        </div>
      </div>
      <div class="chart-area" style="height:200px">
        <canvas id="chartAiVolume"></canvas>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Taxa de Resolução por Agente</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">
        ${[
          { name:'Agente Vendas',   pct:92, color:'#000' },
          { name:'Agente Suporte',  pct:88, color:'#3b82f6' },
          { name:'Agente Leads',    pct:96, color:'#10b981' },
          { name:'Agente Onboarding',pct:97,color:'#8b5cf6' },
        ].map(item => `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">
              <span style="font-weight:600">${item.name}</span>
              <span style="font-weight:700">${item.pct}%</span>
            </div>
            <div style="height:6px;background:var(--color-bg);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${item.pct}%;background:${item.color};border-radius:99px;transition:width 0.6s ease"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </div>

  <!-- LOGS TABLE -->
  <div class="card" style="padding:0">
    <div class="card-header" style="padding:16px;border-bottom:1px solid var(--color-border)">
      <div>
        <div class="card-title">Log de Eventos — Tempo Real</div>
        <div class="card-subtitle">Últimas interações dos agentes</div>
      </div>
      <button class="btn btn-secondary btn-sm"><i data-lucide="download" style="width:14px;height:14px"></i> Exportar</button>
    </div>
    <div class="table-wrapper" style="border:none;border-radius:0">
      <table class="ai-log-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Agente</th>
            <th>Contato</th>
            <th>Evento</th>
            <th>Duração</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${[
            { ts:'10:34:12', agent:'Agente Vendas',    contact:'João Silva',    event:'Proposta enviada',          dur:'0,8s', status:'success' },
            { ts:'10:32:55', agent:'Agente Suporte',   contact:'Maria Costa',   event:'FAQ respondido',            dur:'0,4s', status:'success' },
            { ts:'10:31:40', agent:'Agente Triagem',   contact:'Carlos Ferreira',event:'Escalado para humano',     dur:'1,2s', status:'escalated' },
            { ts:'10:29:18', agent:'Agente Leads',     contact:'Ana Souza',     event:'Lead qualificado',          dur:'2,1s', status:'success' },
            { ts:'10:28:07', agent:'Agente Vendas',    contact:'Pedro Lima',    event:'Reunião agendada',          dur:'1,4s', status:'success' },
            { ts:'10:26:33', agent:'Agente Onboarding',contact:'Lucia Mendes', event:'Tutorial enviado',          dur:'0,6s', status:'success' },
            { ts:'10:24:50', agent:'Agente Suporte',   contact:'Rafael Nunes',  event:'Erro: timeout na resposta', dur:'5,0s', status:'error' },
            { ts:'10:22:15', agent:'Agente Leads',     contact:'Camila Torres', event:'Lead descartado (fora ICP)',dur:'0,9s', status:'warning' },
          ].map(row => `
          <tr>
            <td style="font-family:monospace;font-size:11px;color:var(--color-text-3)">${row.ts}</td>
            <td style="font-weight:600">${row.agent}</td>
            <td>${row.contact}</td>
            <td>${row.event}</td>
            <td style="color:var(--color-text-3)">${row.dur}</td>
            <td>
              ${row.status === 'success'   ? '<span class="badge badge-green">Sucesso</span>' : ''}
              ${row.status === 'error'     ? '<span class="badge badge-red">Erro</span>' : ''}
              ${row.status === 'escalated' ? '<span class="badge badge-yellow">Escalado</span>' : ''}
              ${row.status === 'warning'   ? '<span class="badge badge-yellow">Aviso</span>' : ''}
            </td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
  `;
};

window.initAiDashboard = function() {
  const ctx = document.getElementById('chartAiVolume');
  if (!ctx) return;
  const labels = Array.from({length: 24}, (_, i) => `${String(i).padStart(2,'0')}h`);
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Vendas',   data:[2,1,0,0,1,3,8,22,35,42,38,45,40,52,48,55,61,58,45,38,30,22,14,8], borderColor:'#000',     backgroundColor:'rgba(0,0,0,0.04)',    fill:true, tension:0.4, pointRadius:2 },
        { label:'Suporte',  data:[1,0,1,0,0,2,5,14,20,28,24,32,28,38,34,40,44,42,36,28,20,16,10,5], borderColor:'#3b82f6',  backgroundColor:'rgba(59,130,246,0.06)',fill:true, tension:0.4, pointRadius:2 },
        { label:'Leads',    data:[0,0,0,0,0,1,3,8,12,15,14,18,16,20,19,24,26,22,18,14,10,8,4,2],    borderColor:'#10b981',  backgroundColor:'rgba(16,185,129,0.06)',fill:true, tension:0.4, pointRadius:2 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom', labels:{ font:{size:11}, usePointStyle:true, pointStyleWidth:8 } } },
      scales:{
        x:{ grid:{ display:false }, ticks:{ font:{size:10}, color:'#9ca3af', maxTicksLimit:12 } },
        y:{ grid:{ color:'#f3f4f6' }, ticks:{ font:{size:10}, color:'#9ca3af' } }
      }
    }
  });
};
