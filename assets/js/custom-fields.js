// ======================================
// FAVX CRM — Campos Personalizados (helpers compartilhados)
// ======================================

const _cfCache = {};

async function fetchCustomFieldDefs(entity, { force = false } = {}) {
  if (!force && _cfCache[entity]) return _cfCache[entity];
  try {
    const defs = await apiFetch(`/api/custom-fields?entity=${entity}`);
    _cfCache[entity] = defs || [];
  } catch {
    _cfCache[entity] = [];
  }
  return _cfCache[entity];
}

function invalidateCustomFieldDefs(entity) {
  if (entity) delete _cfCache[entity];
  else Object.keys(_cfCache).forEach(k => delete _cfCache[k]);
}

function _cfInputHtml(def, value) {
  const id  = `cf_${def.id}`;
  const req = def.required ? 'required' : '';
  const base = 'width:100%;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;background:var(--color-surface)';

  if (def.type === 'select') {
    const opts = Array.isArray(def.options) ? def.options : [];
    return `<select id="${id}" data-cf-name="${def.name}" data-cf-type="select" style="${base}">
      <option value="">Selecione...</option>
      ${opts.map(o => `<option value="${o}" ${value === o ? 'selected' : ''}>${o}</option>`).join('')}
    </select>`;
  }
  if (def.type === 'textarea') {
    return `<textarea id="${id}" data-cf-name="${def.name}" data-cf-type="textarea" rows="2" ${req}
      style="${base};resize:vertical">${value != null ? value : ''}</textarea>`;
  }
  if (def.type === 'checkbox') {
    return `<label style="display:flex;align-items:center;gap:8px;padding:9px 0">
      <input type="checkbox" id="${id}" data-cf-name="${def.name}" data-cf-type="checkbox" ${value ? 'checked' : ''} />
      <span style="font-size:12px;color:var(--color-text-3)">Marcado</span>
    </label>`;
  }
  if (def.type === 'number') {
    return `<input type="number" id="${id}" data-cf-name="${def.name}" data-cf-type="number" ${req}
      value="${value != null ? value : ''}" style="${base}" />`;
  }
  if (def.type === 'date') {
    return `<input type="date" id="${id}" data-cf-name="${def.name}" data-cf-type="date" ${req}
      value="${value != null ? value : ''}" style="${base}" />`;
  }
  return `<input type="text" id="${id}" data-cf-name="${def.name}" data-cf-type="text" ${req}
    value="${value != null ? value : ''}" style="${base}" />`;
}

// Renderiza a seção de campos personalizados dinâmicos para um formulário.
// `values` é o objeto custom_fields já salvo (opcional).
function renderCustomFieldsSection(defs, values = {}, { title = 'CAMPOS PERSONALIZADOS', wrapId = '' } = {}) {
  if (!defs || !defs.length) {
    return `
    <div ${wrapId ? `id="${wrapId}"` : ''} style="border-top:1px solid var(--color-border);padding-top:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em">${title}</span>
        <span style="font-size:11px;color:var(--color-text-3)">Configure em Configurações</span>
      </div>
      <p style="font-size:12px;color:var(--color-text-3);padding:10px 0">Nenhum campo personalizado configurado ainda.</p>
    </div>`;
  }

  return `
  <div ${wrapId ? `id="${wrapId}"` : ''} style="border-top:1px solid var(--color-border);padding-top:14px">
    <div style="margin-bottom:10px">
      <span style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em">${title}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${defs.map(def => `
        <div ${def.type === 'textarea' ? 'style="grid-column:1/-1"' : ''}>
          <label style="font-size:11px;font-weight:700;color:var(--color-text-3);letter-spacing:.05em;display:block;margin-bottom:6px">
            ${def.label.toUpperCase()}${def.required ? ' *' : ''}
          </label>
          ${_cfInputHtml(def, values ? values[def.name] : undefined)}
        </div>
      `).join('')}
    </div>
  </div>`;
}

// Coleta os valores preenchidos de uma seção renderizada por renderCustomFieldsSection.
function collectCustomFieldsValues(defs) {
  const out = {};
  (defs || []).forEach(def => {
    const el = document.getElementById(`cf_${def.id}`);
    if (!el) return;
    if (def.type === 'checkbox') {
      out[def.name] = el.checked;
    } else if (el.value !== '') {
      out[def.name] = el.value;
    }
  });
  return out;
}

window.fetchCustomFieldDefs        = fetchCustomFieldDefs;
window.invalidateCustomFieldDefs   = invalidateCustomFieldDefs;
window.renderCustomFieldsSection   = renderCustomFieldsSection;
window.collectCustomFieldsValues   = collectCustomFieldsValues;
