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

// ======================================
// INTRO — roda na login.html dentro do
// gesto de clique, garantindo autoplay
// ======================================

const _TRACKS = ['/assets/audio/riser-1.mp3', '/assets/audio/riser-2.mp3'];
let _introAudio   = null;
let _introRafId   = null;
let _introRunning = false;
let _introDoneCb  = null;
const _FALLBACK   = 9;   // segundos caso áudio seja bloqueado

function _pickTrack() {
  let last = -1;
  try { last = parseInt(localStorage.getItem('favx_last_track')); } catch(e) {}
  const pool = _TRACKS.length > 1 ? _TRACKS.map((_,i)=>i).filter(i=>i!==last) : [0];
  const idx  = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem('favx_last_track', idx); } catch(e) {}
  return _TRACKS[idx];
}

function _introRender(p) {
  const clamp  = (v,a,b) => Math.max(a, Math.min(b, v));
  const smooth = t => t*t*(3-2*t);
  const band   = (p,s,e) => clamp((p-s)/(e-s), 0, 1);

  const lightEl = document.getElementById('i-light');
  const logoEl  = document.getElementById('i-logo');
  const bloomEl = document.getElementById('i-bloom');
  const whiteEl = document.getElementById('i-whiteout');
  if (!lightEl) return;

  const li = smooth(clamp(p*1.05, 0, 1));
  lightEl.style.setProperty('--li', (0.15 + li*0.95).toFixed(3));
  lightEl.style.setProperty('--ls', (0.35 + smooth(p)*0.95).toFixed(3));

  if (logoEl) {
    let g = smooth(band(p, 0.12, 0.82));
    if (p > 0.80) g = Math.max(g, 0.7 + smooth(band(p, 0.80, 0.95))*0.3);
    logoEl.style.setProperty('--g', g.toFixed(3));
  }

  const b    = band(p, 0.80, 0.96);
  const fade = band(p, 0.90, 1.0);
  if (bloomEl) {
    bloomEl.style.opacity   = (smooth(b)*(1-smooth(fade)*0.82)).toFixed(3);
    bloomEl.style.transform = 'translate(-50%,-50%) scale('+(0.6+smooth(b)*0.9).toFixed(3)+')';
  }
  if (whiteEl) whiteEl.style.opacity = smooth(band(p, 0.90, 1.0)).toFixed(3);
}

function _introFinish() {
  if (!_introRunning) return;
  _introRunning = false;
  cancelAnimationFrame(_introRafId);
  _introRender(1);

  const wrap = document.getElementById('intro-wrap');
  if (wrap) {
    wrap.style.transition = 'opacity 0.65s ease';
    wrap.style.opacity = '0';
    setTimeout(() => {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (_introDoneCb) _introDoneCb();
    }, 700);
  } else {
    if (_introDoneCb) _introDoneCb();
  }
}

function _startIntro(onDone) {
  const wrap = document.getElementById('intro-wrap');
  if (!wrap) { onDone(); return; }

  _introDoneCb  = onDone;
  _introRunning = true;

  // Reset visuais
  const lightEl = document.getElementById('i-light');
  const logoEl  = document.getElementById('i-logo');
  const bloomEl = document.getElementById('i-bloom');
  const whiteEl = document.getElementById('i-whiteout');
  if (lightEl) { lightEl.style.setProperty('--li', 0); lightEl.style.setProperty('--ls', 0.35); }
  if (logoEl)  logoEl.style.setProperty('--g', 0);
  if (bloomEl) { bloomEl.style.opacity = 0; bloomEl.style.transform = 'translate(-50%,-50%) scale(0.6)'; }
  if (whiteEl) whiteEl.style.opacity = 0;

  wrap.style.display = 'block';

  // Áudio — play síncrono dentro do gesto de clique
  _introAudio = new Audio(_pickTrack());
  _introAudio.preload = 'auto';

  let useTime       = true;
  let fallbackStart = performance.now();

  const pp = _introAudio.play();
  if (pp && pp.then) {
    pp.catch(() => {
      // Autoplay bloqueado mesmo assim — anima por tempo
      useTime       = false;
      fallbackStart = performance.now();
    });
  }

  _introAudio.onended = _introFinish;

  function loop() {
    if (!_introRunning) return;
    let p;
    if (useTime && isFinite(_introAudio.duration) && _introAudio.duration > 0) {
      p = Math.max(0, Math.min(1, _introAudio.currentTime / _introAudio.duration));
    } else {
      p = Math.max(0, Math.min(1, (performance.now() - fallbackStart) / 1000 / _FALLBACK));
    }
    _introRender(p);
    if (p >= 1 && !useTime) { _introFinish(); return; }
    _introRafId = requestAnimationFrame(loop);
  }
  loop();
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

  // Dispara a intro AGORA, enquanto ainda estamos dentro do gesto de clique.
  // Isso garante que audio.play() seja autorizado pelo browser.
  let loginOk   = false;
  let loginData = null;
  let loginErr  = null;

  _startIntro(() => {
    // Chamado quando a animação termina
    if (loginOk) {
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem('favx_token',         loginData.token);
      storage.setItem('favx_refresh_token', loginData.refreshToken);
      storage.setItem('favx_user',          JSON.stringify(loginData.user));
      window.location.href = 'index.html';
    }
    // Se loginErr, o erro já foi exibido e a intro parou antes de chegar aqui
  });

  try {
    const apiUrl = window.API_URL || 'http://localhost:3001';

    const res  = await fetch(`${apiUrl}/api/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Credenciais inválidas.');

    loginOk   = true;
    loginData = data;
    // A intro ainda pode estar rodando; o redirect ocorre no callback _introDoneCb acima.
    // Se a intro já terminou (API muito lenta), redireciona agora.
    if (!_introRunning) {
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem('favx_token',         data.token);
      storage.setItem('favx_refresh_token', data.refreshToken);
      storage.setItem('favx_user',          JSON.stringify(data.user));
      window.location.href = 'index.html';
    }

  } catch (err) {
    loginErr = err;
    // Para a intro e mostra o erro
    _introRunning = false;
    cancelAnimationFrame(_introRafId);
    if (_introAudio) { _introAudio.pause(); _introAudio = null; }
    const wrap = document.getElementById('intro-wrap');
    if (wrap) wrap.style.display = 'none';
    setError('loginError', err.message);
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
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro ao enviar e-mail.');

    document.getElementById('forgotSuccess').hidden = false;

  } catch (err) {
    setError('forgotError', err.message);
  }
}
