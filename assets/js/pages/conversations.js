let activeConvId     = null;
let _pollMsgInterval = null;
let _pollListInterval = null;
let _lastMsgSentAt   = null;

function _convStopPolling() {
  clearInterval(_pollMsgInterval);
  clearInterval(_pollListInterval);
  _pollMsgInterval  = null;
  _pollListInterval = null;
}

window.loadConversations = async function() {
  return await apiFetch('/api/conversations');
};

window.pageConversations = function(data) {
  const convs = Array.isArray(data) ? data : [];
  if (convs.length > 0 && !activeConvId) activeConvId = convs[0].id;

  return `
  <div class="page-header" style="margin-bottom:16px">
    <div>
      <h1 class="page-title">Conversas</h1>
      <p class="page-subtitle">${convs.length} conversa${convs.length !== 1 ? 's' : ''}</p>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-primary btn-sm"><i data-lucide="edit" style="width:14px;height:14px"></i> Nova Conversa</button>
    </div>
  </div>

  <div class="conversations-layout">
    <!-- SIDEBAR -->
    <div class="conv-sidebar">
      <div class="conv-sidebar-header">
        <div class="search-wrapper">
          <i data-lucide="search"></i>
          <input type="text" placeholder="Buscar conversa..." />
        </div>
      </div>
      <div class="conv-tabs">
        <button class="conv-tab active">Todas</button>
        <button class="conv-tab">Abertas</button>
      </div>
      <div class="conv-list" id="convList">
        ${convs.length === 0 ? `
          <div style="padding:24px;text-align:center;color:var(--color-text-3);font-size:13px">
            Nenhuma conversa ainda.
          </div>
        ` : convs.map(c => `
        <div class="conv-item ${c.id === activeConvId ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}" data-conv-id="${c.id}">
          <div class="conv-avatar" style="position:relative">
            ${(c.contact_name || '?')[0].toUpperCase()}
            ${c.channel === 'whatsapp' ? `<div style="position:absolute;bottom:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:#25D366;border:2px solid var(--color-surface);display:flex;align-items:center;justify-content:center"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="8" height="8" fill="#fff"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg></div>` : ''}
          </div>
          <div class="conv-info">
            <div class="conv-name">${c.contact_name || 'Desconhecido'}</div>
            <div class="conv-preview">${c.contact_phone || c.channel || '—'}</div>
          </div>
          <div class="conv-meta">
            <div class="conv-time">${c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'}</div>
            ${c.unread_count > 0 ? `<div class="conv-unread-count">${c.unread_count}</div>` : ''}
          </div>
        </div>
        `).join('')}
      </div>
    </div>

    <!-- CHAT AREA -->
    <div class="chat-area" id="chatArea">
      ${activeConvId ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-3);font-size:13px">Selecione uma conversa</div>' : renderEmptyChat()}
    </div>
  </div>
  `;
};

function renderEmptyChat() {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--color-text-3)">
      <i data-lucide="message-circle" style="width:40px;height:40px;opacity:0.3"></i>
      <p style="font-size:13px">Selecione uma conversa para começar</p>
    </div>
  `;
}

async function loadAndRenderChat(convId, conv) {
  _convStopPolling();
  _lastMsgSentAt = null;

  const chatArea = document.getElementById('chatArea');
  if (!chatArea) return;

  chatArea.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%"><div style="width:24px;height:24px;border:2px solid #e5e7eb;border-top-color:var(--color-accent);border-radius:50%;animation:spin 0.7s linear infinite"></div></div>`;

  const messages = await apiFetch(`/api/conversations/${convId}/messages`).catch(() => []);
  const msgs = Array.isArray(messages) ? messages : [];

  // Track last message time for delta polling
  if (msgs.length) _lastMsgSentAt = msgs[msgs.length - 1].sent_at;

  // Reset unread badge on open
  apiFetch(`/api/conversations/${convId}/read`, { method: 'POST' }).catch(() => {});

  chatArea.innerHTML = `
    <div class="chat-header">
      <div class="conv-avatar" style="width:38px;height:38px;font-size:13px">${(conv?.contact_name||'?')[0].toUpperCase()}</div>
      <div class="chat-header-info">
        <div class="chat-header-name">${conv?.contact_name || 'Desconhecido'}</div>
        <div class="chat-header-status">${conv?.contact_phone || conv?.channel || '—'}</div>
      </div>
      <div style="display:flex;gap:6px;margin-left:auto">
        <button class="btn btn-ghost btn-sm"><i data-lucide="more-vertical" style="width:14px;height:14px"></i></button>
      </div>
    </div>
    <div class="chat-messages" id="chatMessages">
      ${msgs.length === 0 ? `
        <div style="text-align:center;color:var(--color-text-3);font-size:13px;padding:24px">Nenhuma mensagem ainda.</div>
      ` : msgs.map(m => `
      <div class="msg-row ${m.direction === 'inbound' ? 'incoming' : 'outgoing'}">
        ${m.direction === 'inbound' ? `<div class="conv-avatar" style="width:28px;height:28px;font-size:11px">${(conv?.contact_name||'?')[0].toUpperCase()}</div>` : ''}
        <div style="display:flex;flex-direction:column;gap:3px;align-items:${m.direction==='outbound'?'flex-end':'flex-start'}">
          <div class="msg-bubble">${m.content || ''}</div>
          <div class="msg-time">${new Date(m.sent_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
      </div>
      `).join('')}
    </div>
    <div class="chat-input-area">
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" style="padding:6px"><i data-lucide="paperclip" style="width:16px;height:16px"></i></button>
      </div>
      <textarea class="chat-input" id="chatInput" rows="1" placeholder="Digite uma mensagem..."></textarea>
      <button class="chat-send-btn" id="chatSendBtn"><i data-lucide="send" style="width:16px;height:16px"></i></button>
    </div>
  `;

  lucide.createIcons();
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

  // Poll for new messages every 3s
  _pollMsgInterval = setInterval(async () => {
    if (activeConvId !== convId) return;
    try {
      const since = _lastMsgSentAt ? `?since=${encodeURIComponent(_lastMsgSentAt)}` : '';
      const newMsgs = await apiFetch(`/api/conversations/${convId}/messages${since}`);
      if (!Array.isArray(newMsgs) || !newMsgs.length) return;

      _lastMsgSentAt = newMsgs[newMsgs.length - 1].sent_at;
      const container = document.getElementById('chatMessages');
      if (!container) return;

      const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
      newMsgs.forEach(m => {
        const row = document.createElement('div');
        row.className = `msg-row ${m.direction === 'inbound' ? 'incoming' : 'outgoing'}`;
        const avatar = m.direction === 'inbound'
          ? `<div class="conv-avatar" style="width:28px;height:28px;font-size:11px">${(conv?.contact_name||'?')[0].toUpperCase()}</div>`
          : '';
        row.innerHTML = `${avatar}
          <div style="display:flex;flex-direction:column;gap:3px;align-items:${m.direction==='outbound'?'flex-end':'flex-start'}">
            <div class="msg-bubble">${m.content || ''}</div>
            <div class="msg-time">${new Date(m.sent_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
          </div>`;
        container.appendChild(row);
      });
      if (wasAtBottom) container.scrollTop = container.scrollHeight;

      // Update sidebar unread for this conv
      const sideItem = document.querySelector(`.conv-item[data-conv-id="${convId}"] .conv-time`);
      if (sideItem) sideItem.textContent = new Date(_lastMsgSentAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    } catch {}
  }, 3000);

  // Poll sidebar conv list every 8s for new conversations from other contacts
  _pollListInterval = setInterval(async () => {
    try {
      const fresh = await apiFetch('/api/conversations');
      if (!Array.isArray(fresh)) return;
      const list = document.getElementById('convList');
      if (!list) return;
      fresh.forEach(c => {
        const item = list.querySelector(`.conv-item[data-conv-id="${c.id}"]`);
        if (!item) return;
        const badge = item.querySelector('.conv-unread-count');
        const timeEl = item.querySelector('.conv-time');
        if (c.id !== activeConvId && c.unread_count > 0) {
          item.classList.add('unread');
          if (badge) badge.textContent = c.unread_count;
          else {
            const meta = item.querySelector('.conv-meta');
            if (meta) meta.insertAdjacentHTML('beforeend', `<div class="conv-unread-count">${c.unread_count}</div>`);
          }
        }
        if (timeEl && c.last_message_at) {
          timeEl.textContent = new Date(c.last_message_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        }
      });
    } catch {}
  }, 8000);

  // Enviar mensagem
  const sendBtn   = document.getElementById('chatSendBtn');
  const chatInput = document.getElementById('chatInput');

  async function sendMessage() {
    const content = chatInput.value.trim();
    if (!content) return;
    chatInput.value = '';
    try {
      await apiFetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      await loadAndRenderChat(convId, conv);
    } catch (err) {
      console.error('[send message]', err.message);
    }
  }

  sendBtn?.addEventListener('click', sendMessage);
  chatInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}

window.unloadConversations = function() { _convStopPolling(); };

window.initConversations = function(data) {
  const convs = Array.isArray(data) ? data : [];

  document.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', async () => {
      document.querySelectorAll('.conv-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      activeConvId = el.dataset.convId;
      const conv = convs.find(c => c.id === activeConvId);
      await loadAndRenderChat(activeConvId, conv);
    });
  });

  // Contato vindo da aba Contatos
  const pending = window.__convContact;
  if (pending) {
    window.__convContact = null;
    const existing = convs.find(c => c.contact_id === pending.id);
    if (existing) {
      // Conversa já existe — abre diretamente
      activeConvId = existing.id;
      document.querySelectorAll('.conv-item').forEach(el => {
        el.classList.toggle('active', el.dataset.convId === existing.id);
      });
      loadAndRenderChat(existing.id, existing);
    } else {
      // Sem conversa — exibe estado vazio com botão de iniciar
      const chatArea = document.getElementById('chatArea');
      if (chatArea) {
        chatArea.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;color:var(--color-text-3)">
            <div style="width:56px;height:56px;border-radius:50%;background:var(--color-bg-2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:var(--color-text-1)">
              ${pending.name[0].toUpperCase()}
            </div>
            <div style="text-align:center">
              <div style="font-size:15px;font-weight:600;color:var(--color-text-1);margin-bottom:4px">${pending.name}</div>
              ${pending.phone ? `<div style="font-size:13px;color:var(--color-text-3)">${pending.phone}</div>` : ''}
            </div>
            <p style="font-size:13px;color:var(--color-text-3)">Você ainda não iniciou uma conversa com este contato.</p>
            <button class="btn btn-primary btn-sm" id="btnStartConv" style="gap:6px">
              <i data-lucide="message-circle-plus" style="width:15px;height:15px"></i>
              Iniciar conversa
            </button>
          </div>
        `;
        lucide.createIcons();

        document.getElementById('btnStartConv')?.addEventListener('click', async () => {
          document.getElementById('btnStartConv').disabled = true;
          document.getElementById('btnStartConv').textContent = 'Criando...';
          try {
            const conv = await apiFetch('/api/conversations', {
              method: 'POST',
              body: JSON.stringify({ contact_id: pending.id }),
            });
            // Recarrega a lista de conversas e abre o chat
            const newData = await window.loadConversations();
            const content = document.getElementById('pageContent');
            activeConvId = conv.id;
            content.innerHTML = window.pageConversations(newData);
            lucide.createIcons();
            window.initConversations(newData);
            loadAndRenderChat(conv.id, conv);
            document.querySelectorAll('.conv-item').forEach(el => {
              el.classList.toggle('active', el.dataset.convId === conv.id);
            });
          } catch (err) {
            alert(err.message);
          }
        });
      }
    }
    return;
  }

  // Carrega a primeira conversa automaticamente
  if (activeConvId && convs.length > 0) {
    const conv = convs.find(c => c.id === activeConvId) || convs[0];
    loadAndRenderChat(activeConvId, conv);
  }
};
