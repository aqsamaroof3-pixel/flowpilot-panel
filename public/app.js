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

/* ================= CAMPAIGNS ================= */
let activeCampaign = null;
async function vCampaigns() {
  if (activeCampaign) return vCampaignDetail(activeCampaign);
  const [camps, groups, templates] = await Promise.all([api('/campaigns'), api('/groups'), api('/templates')]);
  view.innerHTML = `
<div class="panel"><h3>New Campaign</h3>
<div class="form-grid">
<input id="cName" placeholder="Campaign name">
<select id="cGroup">${groups.map((g) => `<option value="${g.id}">${esc(g.name)} (${g.members})</option>`).join('')}</select>
<select id="cTpl">${templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
<select id="cMode"><option value="">Auto (live if connected)</option><option value="simulate">SIMULATE (demo)</option><option value="live">LIVE</option></select>
<input id="cSched" type="datetime-local">
</div>
<button id="cCreate">Create Campaign</button>
<span class="muted">Without Meta credentials every campaign runs in clearly-labeled SIMULATE mode.</span>
</div>
<div class="panel"><h3>All Campaigns</h3><table><tr><th>Name</th><th>Status</th><th>Mode</th><th>Total</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Failed</th><th></th></tr>
${camps.map((c) => `<tr><td>${esc(c.name)}</td><td>${pill(c.status)}</td><td>${esc(c.mode)}</td><td>${c.counts.total}</td><td>${c.counts.sent}</td><td>${c.counts.delivered}</td><td>${c.counts.read}</td><td>${c.counts.failed}</td><td><button class="sec small" data-open="${c.id}">Open</button><button class="small" data-run="${c.id}">Run</button></td></tr>`).join('')}
</table></div>`;
  $('#cCreate').addEventListener('click', async () => {
    const sched = $('#cSched').value ? $('#cSched').value.replace('T', ' ') : '';
    await post('/campaigns', { name: $('#cName').value, group_id: Number($('#cGroup').value), template_id: Number($('#cTpl').value), scheduled_at: sched, mode: $('#cMode').value || undefined });
    toast('Campaign created'); vCampaigns();
  });
  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { activeCampaign = Number(b.dataset.open); vCampaigns(); }));
  view.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', async () => { const r = await post(`/campaigns/${b.dataset.run}/run`); toast('Running in ' + r.mode + ' mode'); vCampaigns(); }));
}
async function vCampaignDetail(id) {
  const c = await api('/campaigns/' + id);
  view.innerHTML = `
<button class="sec" id="backBtn">← All Campaigns</button>
<div class="cards" style="margin-top:12px">
<div class="card"><div class="lbl">Total</div><div class="num">${c.counts.total}</div></div>
<div class="card"><div class="lbl">Sent</div><div class="num">${c.counts.sent}</div></div>
<div class="card"><div class="lbl">Delivered</div><div class="num">${c.counts.delivered}</div></div>
<div class="card"><div class="lbl">Read</div><div class="num">${c.counts.read}</div></div>
<div class="card"><div class="lbl">Failed</div><div class="num">${c.counts.failed}</div></div>
</div>
<div class="panel"><h3>${esc(c.name)} ${pill(c.status)} <span class="pill gray">${esc(c.mode)}</span></h3>
<table><tr><th>Phone</th><th>Customer</th><th>Status</th><th>Updated</th></tr>
${c.recipients.map((r) => `<tr><td>${esc(r.phone)}</td><td>${esc(r.name || '')}</td><td>${pill(r.status)}</td><td>${esc(r.updated_at || '')}</td></tr>`).join('')}
</table></div>`;
  $('#backBtn').addEventListener('click', () => { activeCampaign = null; vCampaigns(); });
}

/* ================= GENERIC CRUD VIEWS ================= */
function crudView({ title, listPath, fields, cols, createLabel }) {
  return async () => {
    const rows = await api(listPath);
    view.innerHTML = `
<div class="panel"><h3>${createLabel}</h3>
<div class="form-grid">${fields.map((f) => `<input id="f_${f.key}" placeholder="${f.label}">`).join('')}</div>
<button id="addBtn">Add</button>
</div>
<div class="panel"><h3>${title}</h3><table><tr>${cols.map((c) => `<th>${c.label}</th>`).join('')}<th></th></tr>
${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c.key])}</td>`).join('')}<td><button class="danger small" data-del="${r.id}">Delete</button></td></tr>`).join('')}
</table></div>`;
    $('#addBtn').addEventListener('click', async () => {
      const body = {}; fields.forEach((f) => { body[f.key] = $('#f_' + f.key).value; });
      await post(listPath, body); toast('Added'); render();
    });
    view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await del(listPath + '/' + b.dataset.del); render(); }));
  };
}

/* ================= CUSTOMERS / GROUPS ================= */
async function vCustomers() {
  const rows = await api('/customers');
  view.innerHTML = `
<div class="panel"><h3>Add Customer</h3><div class="form-grid">
<input id="cuName" placeholder="Name"><input id="cuPhone" placeholder="Phone (92...)"><input id="cuEmail" placeholder="Email"><input id="cuLabel" placeholder="Label">
</div><button id="cuAdd">Add Customer</button></div>
<div class="panel"><h3>Import CSV (name,phone,email per line)</h3>
<textarea id="csvBox" placeholder="Ahmed Raza,923001112233,ahmed@example.com"></textarea>
<button class="sec" id="csvBtn" style="margin-top:8px">Import</button></div>
<div class="panel"><h3>Customers (${rows.length})</h3><table><tr><th>Name</th><th>Phone</th><th>Email</th><th>Label</th><th>Source</th><th></th></tr>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.email)}</td><td>${esc(r.label)}</td><td>${esc(r.source)}</td><td><button class="danger small" data-del="${r.id}">Delete</button></td></tr>`).join('')}
</table></div>`;
  $('#cuAdd').addEventListener('click', async () => { await post('/customers', { name: $('#cuName').value, phone: $('#cuPhone').value, email: $('#cuEmail').value, label: $('#cuLabel').value }); toast('Customer added'); render(); });
  $('#csvBtn').addEventListener('click', async () => { const r = await post('/customers/import', { csv: $('#csvBox').value }); toast(`Imported ${r.added}, skipped ${r.skipped}`); render(); });
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await del('/customers/' + b.dataset.del); render(); }));
}
async function vGroups() {
  const [groups, customers] = await Promise.all([api('/groups'), api('/customers')]);
  view.innerHTML = `
<div class="panel"><h3>New Group</h3><div class="form-grid"><input id="gName" placeholder="Group name"><input id="gDesc" placeholder="Description"></div>
<button id="gAdd">Create Group</button></div>
${groups.map((g) => `<div class="panel"><h3>${esc(g.name)} <span class="muted">(${g.members} members)</span> <button class="danger small" data-del="${g.id}" style="float:right">Delete group</button></h3>
<p class="muted">${esc(g.description)}</p>
<div style="max-height:150px;overflow:auto;margin:8px 0">${customers.map((c) => `<label style="display:block;font-size:13.5px"><input type="checkbox" style="width:auto" data-mem="${g.id}" value="${c.id}" ${g.memberIds && g.memberIds.includes(c.id) ? 'checked' : ''}> ${esc(c.name)} (${esc(c.phone)})</label>`).join('')}</div>
<button class="small" data-save="${g.id}">Save ticked as members</button><button class="danger small" data-del="${g.id}">Delete group</button></div>`).join('')}
`;
  $('#gAdd').addEventListener('click', async () => { await post('/groups', { name: $('#gName').value, description: $('#gDesc').value }); render(); });
  view.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
    const ids = [...view.querySelectorAll(`[data-mem="${b.dataset.save}"]:checked`)].map((x) => Number(x.value));
    await put(`/groups/${b.dataset.save}/members`, { customerIds: ids }); toast('Members saved'); render();
  }));
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await del('/groups/' + b.dataset.del); render(); }));
}

/* ================= OTHER VIEWS ================= */
async function vTemplates() {
  const rows = await api('/templates');
  view.innerHTML = `
<div class="panel"><h3>Add Template (local)</h3><div class="form-grid">
<input id="tName" placeholder="template_name"><input id="tLang" placeholder="en_US" value="en_US">
<select id="tCat"><option>MARKETING</option><option>UTILITY</option><option>AUTHENTICATION</option></select>
<input id="tBody" placeholder="Body text with {{1}} placeholders"></div>
<button id="tAdd">Add</button><button class="sec" id="tSync">Sync from Meta</button>
<span class="muted">Sync needs WA_BUSINESS_ACCOUNT_ID + token in .env.</span></div>
<div class="panel"><h3>Templates</h3><table><tr><th>Name</th><th>Lang</th><th>Category</th><th>Status</th><th>Body</th><th>Source</th><th></th></tr>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.language)}</td><td>${esc(r.category)}</td><td>${pill(r.status === 'APPROVED' ? 'delivered' : 'gray')}${''}<span class="muted">${esc(r.status)}</span></td><td>${esc(r.body)}</td><td>${esc(r.source)}</td><td><button class="danger small" data-del="${r.id}">Delete</button></td></tr>`).join('')}
</table></div>`;
  $('#tAdd').addEventListener('click', async () => { await post('/templates', { name: $('#tName').value, language: $('#tLang').value, category: $('#tCat').value, body: $('#tBody').value }); render(); });
  $('#tSync').addEventListener('click', async () => { try { const r = await post('/templates/sync'); toast('Synced ' + r.synced + ' templates'); render(); } catch (e) { toast(e.message); } });
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await del('/templates/' + b.dataset.del); render(); }));
}
