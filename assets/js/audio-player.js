// ======================================
// FAVX CRM — Player de áudio das mensagens
// ======================================
// O <audio controls> nativo desenha a barra cinza do navegador: ignora o tema,
// muda de forma entre Chrome e Safari e destoa dentro do balão colorido. Aqui
// o player é do CRM — botão, barra e velocidade.

function _audEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _audFmt(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

const _AUD_PLAY  = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg>`;
const _AUD_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="4.5" width="4" height="15" rx="1.4"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.4"/></svg>`;
const _AUD_RATES = [1, 1.5, 2];

window.favxAudioHtml = function(src) {
  return `<div class="aud">
    <button type="button" class="aud-play" aria-label="Reproduzir">${_AUD_PLAY}</button>
    <div class="aud-mid">
      <input type="range" class="aud-seek" min="0" max="1000" step="1" value="0"
             style="--p:0%" aria-label="Posição do áudio" />
      <div class="aud-foot">
        <span class="aud-time">0:00</span>
        <button type="button" class="aud-rate" aria-label="Velocidade">1×</button>
      </div>
    </div>
    <audio class="aud-el" preload="metadata"${src ? ` src="${_audEsc(src)}"` : ''}></audio>
  </div>`;
};

const _audBoxOf = el => el.closest('.aud');
const _audElOf  = box => box.querySelector('.aud-el');

let _audDrag = false;
document.addEventListener('pointerdown', e => { if (e.target.closest?.('.aud-seek')) _audDrag = true; });
document.addEventListener('pointerup',   () => { _audDrag = false; });
document.addEventListener('pointercancel', () => { _audDrag = false; });

function _audProgress(box) {
  const a = _audElOf(box);
  if (!a) return;
  const dur = isFinite(a.duration) ? a.duration : 0;
  const pos = a.currentTime || 0;
  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;

  const seek = box.querySelector('.aud-seek');
  // Enquanto a barra está sendo arrastada quem manda é o dedo: reescrever o
  // valor a cada timeupdate faria o cursor pular para trás.
  if (!_audDrag) {
    seek.value = Math.round(pct * 10);
    seek.style.setProperty('--p', `${pct}%`);
  }

  // Parado no começo mostra quanto dura; tocando, mostra quanto já passou —
  // é o número que interessa em cada momento.
  box.querySelector('.aud-time').textContent =
    a.paused && !pos ? (dur ? _audFmt(dur) : '--:--') : _audFmt(pos);
}

function _audIcon(box) {
  const a   = _audElOf(box);
  const btn = box.querySelector('.aud-play');
  const tocando = a && !a.paused;
  box.classList.toggle('playing', !!tocando);
  btn.innerHTML = tocando ? _AUD_PAUSE : _AUD_PLAY;
  btn.setAttribute('aria-label', tocando ? 'Pausar' : 'Reproduzir');
}

// O MediaRecorder grava webm sem a duração no cabeçalho, e o Chrome informa
// Infinity até o arquivo ser percorrido. Pular para o fim força o cálculo.
function _audFixDuration(a) {
  if (a.duration !== Infinity || a.dataset.audFix) return;
  a.dataset.audFix = '1';
  const pronto = () => {
    if (!isFinite(a.duration)) return;
    a.removeEventListener('durationchange', pronto);
    a.currentTime = 0;
    _audProgress(_audBoxOf(a));
  };
  a.addEventListener('durationchange', pronto);
  a.currentTime = 1e6;
}

document.addEventListener('click', e => {
  const play = e.target.closest?.('.aud-play');
  if (play) {
    const a = _audElOf(_audBoxOf(play));
    a.paused ? a.play().catch(() => {}) : a.pause();
    return;
  }
  const rate = e.target.closest?.('.aud-rate');
  if (rate) {
    const a = _audElOf(_audBoxOf(rate));
    const prox = _AUD_RATES[(_AUD_RATES.indexOf(a.playbackRate) + 1) % _AUD_RATES.length] ?? 1;
    a.playbackRate = prox;
    rate.textContent = `${prox}×`;
  }
});

document.addEventListener('input', e => {
  const seek = e.target.closest?.('.aud-seek');
  if (!seek) return;
  const a = _audElOf(_audBoxOf(seek));
  if (isFinite(a.duration)) a.currentTime = (seek.value / 1000) * a.duration;
  seek.style.setProperty('--p', `${seek.value / 10}%`);
});

// Eventos de mídia não sobem na árvore, mas passam pela fase de captura — daí
// o `true`. Assim um só par de ouvintes atende todos os áudios, inclusive os
// que aparecem depois, sem religar nada a cada troca de conversa.
const _audOn = (ev, fn) => document.addEventListener(ev, e => {
  if (e.target.classList?.contains('aud-el')) fn(e.target);
}, true);

_audOn('loadedmetadata', a => { _audFixDuration(a); _audProgress(_audBoxOf(a)); });
_audOn('durationchange', a => _audProgress(_audBoxOf(a)));
_audOn('timeupdate',     a => _audProgress(_audBoxOf(a)));
_audOn('play', a => {
  // Dois áudios tocando ao mesmo tempo não se entende nenhum.
  document.querySelectorAll('.aud-el').forEach(o => { if (o !== a) o.pause(); });
  _audIcon(_audBoxOf(a));
});
_audOn('pause', a => _audIcon(_audBoxOf(a)));
_audOn('ended', a => {
  a.currentTime = 0;               // volta ao início e mostra a duração de novo
  _audIcon(_audBoxOf(a));
  _audProgress(_audBoxOf(a));
});
