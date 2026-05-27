window.loadAutomations = async function() {
  return await apiFetch('/api/automations');
};

window.pageAutomations = function(data) {
  const automations = Array.isArray(data) ? data : [];

  return `
  <div class="page-header">
    <div>
      <h1 class="page-title">Automações</h1>
      <p class="page-subtitle">${automations.length} automação${automations.length !== 1 ? 'ões' : ''} cadastrada${automations.length !== 1 ? 's' : ''}</p>
    </div>
    <button class="btn btn-primary btn-sm"><i data-lucide="plus" style="width:14px;height:14px"></i> Nova Automação</button>
  </div>

  ${automations.length === 0 ? `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:12px;color:var(--color-text-3)">
      <i data-lucide="zap" style="width:40px;height:40px;opacity:0.3"></i>
      <p style="font-size:13px">Nenhuma automação cadastrada ainda.</p>
    </div>
  ` : `
  <div class="card" style="padding:0">
    <div class="table-wrapper" style="border:none;border-radius:var(--radius-lg)">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Gatilho</th>
            <th>Tipo</th>
            <th>Execuções</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${automations.map(a => `
          <tr>
            <td style="font-weight:600">${a.name}</td>
            <td><span class="badge badge-blue">${a.trigger_type}</span></td>
            <td style="color:var(--color-text-3);font-size:12px">${a.trigger_type}</td>
            <td style="font-weight:600">${(a.run_count || 0).toLocaleString('pt-BR')}</td>
            <td>
              <label class="toggle">
                <input type="checkbox" ${a.is_active ? 'checked' : ''} class="automation-toggle" data-id="${a.id}">
                <span class="toggle-slider"></span>
              </label>
            </td>
            <td>
              <div style="display:flex;gap:4px">
                <button class="btn btn-ghost btn-sm" style="padding:4px 8px"><i data-lucide="edit-2" style="width:13px;height:13px"></i></button>
              </div>
            </td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
  `}
  `;
};

window.initAutomations = function() {
  document.querySelectorAll('.automation-toggle').forEach(input => {
    input.addEventListener('change', async function() {
      const id = this.dataset.id;
      try {
        await apiFetch(`/api/automations/${id}/toggle`, { method: 'PUT' });
      } catch (err) {
        this.checked = !this.checked;
        console.error('[automation toggle]', err.message);
      }
    });
  });
};
