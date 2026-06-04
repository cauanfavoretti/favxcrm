// ======================================
// FAVX CRM — API Helper
// ======================================

function getToken() {
  return localStorage.getItem('favx_token') || sessionStorage.getItem('favx_token');
}

async function apiFetch(endpoint, options = {}) {
  const base  = window.API_URL;
  const token = getToken();

  const res = await fetch(`${base}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'login.html';
    return null;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Erro na requisição.');
  return data;
}

window.apiFetch = apiFetch;
