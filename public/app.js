'use strict';
const $ = (s, el) => (el || document).querySelector(s);
const view = $('#view');
let currentView = 'dashboard';
let activeConv = null;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });
const put = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body || {}) });
const patch = (p, body) => api(p, { method: 'PATCH', body: JSON.stringify(body || {}) });
const del = (p) => api(p, { method: 'DELETE' });
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function pill(status) {
  const map = { read: 'blue', delivered: 'green', sent: 'green', failed: 'red', queued: 'gray', pending: 'amber', running: 'amber', scheduled: 'amber', completed: 'green', draft: 'gray' };
  return `<span class="pill ${map[status] || 'gray'}">${esc(status)}</span>`;
}
const TITLES = { dashboard: 'Dashboard', chats: 'Chats — Unified Inbox', campaigns: 'Campaigns', templates: 'Templates', quick: 'Quick Replies', qa: 'QA Reply', flows: 'Chat Flows', welcome: 'Welcome Sequence', autoreplies: 'Auto Replies', customers: 'Customers', groups: 'Groups', profile: 'Business Profile', products: 'Catalog & Products', settings: 'Settings', logs: 'Activity Logs' };
document.getElementById('nav').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-view]'); if (!a) return;
  document.querySelectorAll('#nav a').forEach((x) => x.classList.remove('active'));
  a.classList.add('active');
  currentView = a.dataset.view;
  $('#pageTitle').textContent = TITLES[currentView];
  render();
});

/* ================= DASHBOARD ================= */
async function vDashboard() {
  const s = await api('/stats');
  view.innerHTML = `
<div class="cards">
<div class="card"><div class="lbl">💬Messages</div><div class="num">${s.messages}</div></div>
<div class="card"><div class="lbl">📨Chats</div><div class="num">${s.chats}</div></div>
<div class="card"><div class="lbl">👥Contacts</div><div class="num">${s.contacts}</div></div>
<div class="card"><div class="lbl">📣Campaigns</div><div class="num">${s.campaigns}</div></div>
<div class="card"><div class="lbl">👨‍👩‍👧Groups</div><div class="num">${s.groups}</div></div>
<div class="card"><div class="lbl">🔔Unread</div><div class="num">${s.unread}</div></div>
</div>
<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
<div class="panel"><h3>Messages — last 7 days</h3><canvas id="chart" height="150"></canvas></div>
<div class="panel"><h3>Active Plan</h3>
<p style="font-size:15px;font-weight:700">${esc(s.plan)}</p>
<p class="muted" style="margin-top:6px">${s.metaConnected ? 'Production Cloud API credentials found in .env — panel runs in LIVE mode.' : 'No production credentials in .env — panel runs in test / simulate mode. The Meta TEST number can be connected any time from Settings.'}</p>
</div>
</div>`;
  $('#unreadBadge').textContent = s.unread; $('#unreadBadge').classList.toggle('hidden', !s.unread);
  $('#connStatus').textContent = s.metaConnected ? '✅ Meta Cloud API connected' : '⚠️ Test mode — Meta not connected';
  $('#connStatus').classList.toggle('ok', s.metaConnected);
  const cv = $('#chart'); if (!cv) return;
  const ctx = cv.getContext('2d'); const W = cv.width = cv.offsetWidth; const H = cv.height = 150;
  const days = s.byDay; const max = Math.max(1, ...days.map((d) => d.c));
  ctx.strokeStyle = '#12b76a'; ctx.lineWidth = 2; ctx.beginPath();
  days.forEach((d, i) => { const x = days.length < 2 ? W / 2 : (i / (days.length - 1)) * (W - 30) + 15; const y = H - 18 - (d.c / max) * (H - 40); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke(); ctx.fillStyle = '#7a8da1'; ctx.font = '10px sans-serif';
  days.forEach((d, i) => { const x = days.length < 2 ? W / 2 : (i / (days.length - 1)) * (W - 30) + 15; ctx.fillText(d.d.slice(5), x - 12, H - 4); ctx.fillText(d.c, x - 3, H - 26 - (d.c / max) * (H - 40)); });
}

/* ================= CHATS ================= */
async function vChats() {
  const convs = await api('/conversations');
  if (!activeConv && convs.length) activeConv = convs[0].id;
  view.innerHTML = `<div class="inbox">
<div class="conv-list">${convs.map((c) => `
<div class="conv ${c.id === activeConv ? 'active' : ''}" data-conv="${c.id}">
<div class="row1"><span>${esc(c.name)}</span>${c.unread ? `<span class="unread">${c.unread}</span>` : ''}</div>
<div class="preview">${esc(c.last_message || '')}</div>
<div class="preview">+${esc(c.phone)} ${c.label ? '• ' + esc(c.label) : ''} ${c.solved ? '• ✅ solved' : ''}</div>
</div>`).join('') || '<p class="muted" style="padding:12px">No conversations yet.</p>'}
</div>
<div class="chat" id="chatPane"><p class="muted" style="padding:16px">Select a conversation.</p></div>
</div>`;
  view.querySelectorAll('[data-conv]').forEach((el) => el.addEventListener('click', () => { activeConv = Number(el.dataset.conv); vChats(); }));
  if (activeConv) loadChat(activeConv, convs.find((c) => c.id === activeConv));
}
async function loadChat(id, conv) {
  const msgs = await api(`/conversations/${id}/messages`);
  const quick = await api('/quick-replies');
  const pane = $('#chatPane'); if (!pane || !conv) return;
  pane.innerHTML = `
<div class="chat-head">
<div><b>${esc(conv.name)}</b><span class="muted">+${esc(conv.phone)}</span>${conv.label ? `<span class="pill blue">${esc(conv.label)}</span>` : ''}</div>
<div class="inline">
<label class="muted">Auto Reply</label><input type="checkbox" class="switch" id="arToggle" ${conv.auto_reply ? 'checked' : ''}>
<select id="labelSel" style="width:130px"><option value="">No label</option>${['New Lead', 'Interested', 'Follow Up', 'Customer'].map((l) => `<option ${conv.label === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
<button class="sec small" id="solveBtn">${conv.solved ? 'Reopen' : 'Mark Solved'}</button>
</div>
</div>
<div class="chat-body" id="chatBody">${msgs.map((m) => `
<div class="msg ${m.direction}">${esc(m.body)}<div class="meta">${m.origin !== 'human' ? esc(m.origin) + ' • ' : ''}${esc(m.status)} • ${esc(m.created_at || '').slice(11, 16)}</div></div>`).join('')}
</div>
<div class="chat-input">
<select id="quickSel" style="width:170px"><option value="">Quick replies…</option>${quick.map((q) => `<option value="${esc(q.body)}">${esc(q.title)}</option>`).join('')}</select>
<input id="replyBox" placeholder="Type a message… press Enter to send">
<button id="sendBtn">Send</button>
</div>`;
  const body = $('#chatBody'); body.scrollTop = body.scrollHeight;
  $('#arToggle').addEventListener('change', async (e) => { await patch(`/conversations/${id}`, { auto_reply: e.target.checked }); toast('Auto Reply ' + (e.target.checked ? 'ON' : 'OFF')); });
  $('#labelSel').addEventListener('change', async (e) => { await patch(`/conversations/${id}`, { label: e.target.value }); toast('Label updated'); });
  $('#solveBtn').addEventListener('click', async () => { await patch(`/conversations/${id}`, { solved: !conv.solved }); loadChat(id, conv); });
  $('#quickSel').addEventListener('change', (e) => { if (e.target.value) $('#replyBox').value = e.target.value; });
  const send = async () => {
    const text = $('#replyBox').value.trim(); if (!text) return;
    const r = await post(`/conversations/${id}/send`, { body: text });
    toast(r.status === 'sent' ? 'Sent via Cloud API' : 'Queued — API not connected');
    loadChat(id, conv);
  };
  $('#sendBtn').addEventListener('click', send);
  $('#replyBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}
