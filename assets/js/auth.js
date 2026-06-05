// ======================================
// FAVX CRM — Auth Controller
// ======================================

// ---- Recuperar senha (toggle) ----

function showForgot(e, back = false) {
  if (e) e.preventDefault();
  document.getElementById('formLogin').hidden = !back;
  document.getElementById('formForgot').hidden = back;
  setError('loginError', null);
  setError('forgotError', null);
  document.getElementById('forgotSuccess').hidden = true;
}

// ---- Toggle senha visível ----

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.style.opacity = input.type === 'text' ? '1' : '0.5';
}

// ---- Helpers ----

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.querySelector('.btn-text').hidden = loading;
  btn.querySelector('.btn-spinner').hidden = !loading;
}

function setError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
}

// ---- Login ----

async function handleLogin(e) {
  e.preventDefault();
  setError('loginError', null);

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const remember = document.getElementById('rememberMe').checked;

  if (!email || !password) {
    return setError('loginError', 'Preencha e-mail e senha.');
  }

  setLoading('btnLogin', true);

  try {
    const apiUrl = window.API_URL || 'http://localhost:3001';

    const res = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Credenciais inválidas.');
    }

    // Persiste token e dados do usuário
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem('favx_token', data.token);
    storage.setItem('favx_refresh_token', data.refreshToken);
    storage.setItem('favx_user', JSON.stringify(data.user));

    window.location.href = 'index.html';

  } catch (err) {
    setError('loginError', err.message);
  } finally {
    setLoading('btnLogin', false);
  }
}

// ---- Recuperar senha ----

async function handleForgot() {
  setError('forgotError', null);
  document.getElementById('forgotSuccess').hidden = true;

  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) {
    return setError('forgotError', 'Informe o e-mail cadastrado.');
  }

  const apiUrl = window.API_URL || 'http://localhost:3001';

  try {
    const res = await fetch(`${apiUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Erro ao enviar e-mail.');
    }

    document.getElementById('forgotSuccess').hidden = false;

  } catch (err) {
    setError('forgotError', err.message);
  }
}
