// ======================================
// FAVX CRM — Componentes de UI compartilhados
// ======================================

// Modal de confirmação genérico (ex: exclusões). `onConfirm` pode ser async;
// se lançar erro, a mensagem é exibida no próprio modal em vez de fechá-lo.
function showConfirmModal({ title = 'Confirmar ação', message = '', confirmLabel = 'Sim', cancelLabel = 'Não', onConfirm }) {
  document.getElementById('confirmModalOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirmModalOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML = `
    <div style="background:var(--color-surface);border-radius:16px;width:380px;max-width:100%;padding:32px 28px 24px;display:flex;flex-direction:column;align-items:center;box-shadow:0 32px 64px rgba(0,0,0,.25)">
      <div style="width:56px;height:56px;border-radius:50%;background:var(--color-red-lite);display:flex;align-items:center;justify-content:center;margin-bottom:16px">
        <i data-lucide="alert-triangle" style="width:24px;height:24px;color:var(--color-red)"></i>
      </div>
      <div style="font-size:15px;font-weight:700;color:var(--color-text-1);margin-bottom:8px;text-align:center">${title}</div>
      <p id="confirmModalMsg" style="font-size:13px;color:var(--color-text-3);text-align:center;line-height:1.6;margin-bottom:24px">${message}</p>
      <div style="display:flex;gap:10px;width:100%">
        <button class="btn btn-secondary" id="btnConfirmNo" style="flex:1;justify-content:center;padding:11px">${cancelLabel}</button>
        <button class="btn btn-sm" id="btnConfirmYes"
          style="flex:1;justify-content:center;padding:11px;background:var(--color-red);color:#fff;border-radius:var(--radius-md);font-weight:600;font-size:13px">${confirmLabel}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  lucide.createIcons();

  overlay.querySelector('#btnConfirmNo').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#btnConfirmYes').addEventListener('click', async () => {
    const yesBtn = overlay.querySelector('#btnConfirmYes');
    yesBtn.disabled = true;
    yesBtn.textContent = 'Excluindo...';
    try {
      await onConfirm();
      overlay.remove();
    } catch (err) {
      yesBtn.disabled = false;
      yesBtn.textContent = confirmLabel;
      const msg = overlay.querySelector('#confirmModalMsg');
      if (msg) msg.innerHTML += `<br><span style="color:var(--color-red);font-size:12px">${err.message}</span>`;
    }
  });
}

window.showConfirmModal = showConfirmModal;
