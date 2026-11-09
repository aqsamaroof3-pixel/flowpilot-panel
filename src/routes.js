'use strict';
const express = require('express');
const { db, log, getOrCreateConversation, addMessage } = require('./db');
const { cfg, envStatus, metaConfigStatus, readMetaFile, writeMetaFile, refreshMetaConfig, META_KEYS } = require('./config');
const meta = require('./meta');
const router = express.Router();

const j = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); } };
const ja = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); } };

/* ---------- Dashboard / settings / logs ---------- */
router.get('/stats', j((req, res) => {
  const one = (sql) => db.prepare(sql).get().c;
  const byDay = db.prepare(
    `SELECT substr(created_at,1,10) d, COUNT(*) c FROM messages WHERE created_at >= datetime('now','-6 days') GROUP BY d ORDER BY d`
  ).all();
  res.json({
    messages: one('SELECT COUNT(*) c FROM messages'),
    chats: one('SELECT COUNT(*) c FROM conversations'),
    contacts: one('SELECT COUNT(*) c FROM customers'),
    campaigns: one('SELECT COUNT(*) c FROM campaigns'),
    groups: one('SELECT COUNT(*) c FROM groups_tbl'),
    unread: one('SELECT COALESCE(SUM(unread),0) c FROM conversations'),
    metaConnected: cfg.metaConnected,
    plan: cfg.metaConnected ? 'Connected — Cloud API' : 'Test Mode — Meta test number',
    byDay,
  });
}));
router.get('/settings', j((req, res) => {
  res.json({ env: envStatus(), meta: metaConfigStatus(), metaConnected: cfg.metaConnected, groqConnected: Boolean(cfg.groqKey), port: cfg.port });
}));
// Connect Meta — the user pastes credentials in the Settings UI; they are saved
// server-side to data/meta-config.json. Values are NEVER returned by any endpoint.
router.post('/settings/meta', j((req, res) => {
  const body = req.body || {};
  const next = { ...readMetaFile() };
  for (const key of META_KEYS) {
    if (!(key in body)) continue; // field not submitted -> leave as-is
    const v = typeof body[key] === 'string' ? body[key].trim() : '';
    if (v) next[key] = v; else delete next[key]; // empty string clears the key
  }
  writeMetaFile(next);
  refreshMetaConfig();
  log('settings.meta', 'Meta credentials updated via panel (values not logged)');
  res.json({ ok: true, meta: metaConfigStatus(), metaConnected: cfg.metaConnected });
}));
router.get('/logs', j((req, res) => {
  res.json(db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 100').all());
}));

/* ---------- Customers ---------- */
router.get('/customers', j((req, res) => res.json(db.prepare('SELECT * FROM customers ORDER BY id DESC').all())));
router.post('/customers', j((req, res) => {
  const { name, phone, email = '', label = '' } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const info = db.prepare('INSERT INTO customers (name, phone, email, label) VALUES (?,?,?,?)').run(name, String(phone).replace(/\D/g, ''), email, label);
  log('customer.add', `${name} (${phone})`);
  res.json({ id: Number(info.lastInsertRowid) });
}));
router.delete('/customers/:id', j((req, res) => {
  db.prepare('DELETE FROM group_members WHERE customer_id=?').run(req.params.id);
  db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));
router.post('/customers/import', j((req, res) => {
  const csv = (req.body && req.body.csv) || '';
  let added = 0, skipped = 0;
  for (const line of csv.split(/\r?\n/).slice(0, 5000)) {
    const parts = line.split(',').map((s) => s.trim());
    if (!parts[0] || !parts[1] || /name/i.test(parts[0])) { if (line.trim()) skipped++; continue; }
    try {
      db.prepare('INSERT INTO customers (name, phone, email, source) VALUES (?,?,?,?)')
        .run(parts[0], parts[1].replace(/\D/g, ''), parts[2] || '', 'csv');
      added++;
    } catch (e) { skipped++; }
  }
  log('customer.import', `${added} added, ${skipped} skipped`);
  res.json({ added, skipped });
}));

/* ---------- Groups ---------- */
router.get('/groups', j((req, res) => {
  const rows = db.prepare('SELECT g.*, (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id) members FROM groups_tbl g ORDER BY g.id DESC').all();
  res.json(rows);
}));
router.post('/groups', j((req, res) => {
  const { name, description = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO groups_tbl (name, description) VALUES (?,?)').run(name, description);
  log('group.add', name);
  res.json({ id: Number(info.lastInsertRowid) });
}));
router.delete('/groups/:id', j((req, res) => {
  db.prepare('DELETE FROM group_members WHERE group_id=?').run(req.params.id);
  db.prepare('DELETE FROM groups_tbl WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));
router.get('/groups/:id/members', j((req, res) => {
  res.json(db.prepare('SELECT c.* FROM customers c JOIN group_members gm ON gm.customer_id=c.id WHERE gm.group_id=?').all(req.params.id));
}));
router.put('/groups/:id/members', j((req, res) => {
  const ids = (req.body && req.body.customerIds) || [];
  db.prepare('DELETE FROM group_members WHERE group_id=?').run(req.params.id);
  const ins = db.prepare('INSERT INTO group_members (group_id, customer_id) VALUES (?,?)');
  ids.forEach((id) => ins.run(req.params.id, id));
  res.json({ ok: true, members: ids.length });
}));

/* ---------- Conversations / Inbox ---------- */
router.get('/conversations', j((req, res) => {
  res.json(db.prepare(
    `SELECT conv.*, c.name, c.phone FROM conversations conv JOIN customers c ON c.id=conv.customer_id ORDER BY conv.last_at DESC`
  ).all());
}));
router.get('/conversations/:id/messages', j((req, res) => {
  db.prepare('UPDATE conversations SET unread=0 WHERE id=?').run(req.params.id);
  res.json(db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id ASC').all(req.params.id));
}));
router.patch('/conversations/:id', j((req, res) => {
  const { auto_reply, solved, label, assigned_to } = req.body || {};
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE conversations SET auto_reply=?, solved=?, label=?, assigned_to=? WHERE id=?')
    .run(auto_reply !== undefined ? (auto_reply ? 1 : 0) : conv.auto_reply,
      solved !== undefined ? (solved ? 1 : 0) : conv.solved,
      label !== undefined ? label : conv.label,
      assigned_to !== undefined ? assigned_to : conv.assigned_to,
      req.params.id);
  res.json({ ok: true });
}));
router.post('/conversations/:id/send', ja(async (req, res) => {
  const body = (req.body && req.body.body) || '';
  if (!body) return res.status(400).json({ error: 'body required' });
  const conv = db.prepare('SELECT conv.*, c.phone FROM conversations conv JOIN customers c ON c.id=conv.customer_id WHERE conv.id=?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'conversation not found' });
  let status = 'pending', waId = '';
  if (cfg.metaConnected) {
    const out = await meta.sendText(conv.phone, body);
    status = 'sent'; waId = out.messages && out.messages[0] ? out.messages[0].id : '';
  }
  const id = addMessage(conv.id, 'out', body, { status, waId, origin: 'human' });
  log('message.send', `conv ${conv.id} (${status})`);
  res.json({ id, status });
}));

/* ---------- Templates ---------- */
router.get('/templates', j((req, res) => res.json(db.prepare('SELECT * FROM templates ORDER BY id DESC').all())));
router.post('/templates', j((req, res) => {
  const { name, language = 'en_US', category = 'MARKETING', body = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO templates (name, language, category, body) VALUES (?,?,?,?)').run(name, language, category, body);
  res.json({ id: Number(info.lastInsertRowid) });
}));
router.delete('/templates/:id', j((req, res) => { db.prepare('DELETE FROM templates WHERE id=?').run(req.params.id); res.json({ ok: true }); }));
router.post('/templates/sync', ja(async (req, res) => {
  const list = await meta.listTemplates();
  const ins = db.prepare(`INSERT INTO templates (name, language, category, status, body, source) VALUES (?,?,?,?,?, 'meta')
ON CONFLICT(name) DO UPDATE SET status=excluded.status, language=excluded.language, category=excluded.category, source='meta'`);
  let n = 0;
  for (const t of list) {
    const bodyComp = (t.components || []).find((c) => c.type === 'BODY');
    ins.run(t.name, t.language || 'en_US', t.category || '', t.status || '', bodyComp ? bodyComp.text || '' : '');
    n++;
  }
  log('template.sync', `${n} templates from Meta`);
  res.json({ synced: n });
}));

/* ---------- Quick replies / QA / Flows / Welcome / Products ---------- */
const crud = (route, table, fields) => {
  router.get(route, j((req, res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all())));
  router.post(route, j((req, res) => {
    const vals = fields.map((f) => (req.body || {})[f] ?? '');
    const info = db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...vals);
    res.json({ id: Number(info.lastInsertRowid) });
  }));
  router.delete(route + '/:id', j((req, res) => { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id); res.json({ ok: true }); }));
};
crud('/quick-replies', 'quick_replies', ['title', 'body']);
crud('/qa-rules', 'qa_rules', ['keyword', 'answer']);
crud('/flows', 'flows', ['trigger', 'action', 'reply_text']);
crud('/products', 'products', ['name', 'price', 'image_url', 'description']);
router.get('/welcome', j((req, res) => {
  const w = db.prepare('SELECT * FROM welcome WHERE id=1').get() || { enabled: 1, message: '', steps: '[]' };
  res.json({ ...w, steps: JSON.parse(w.steps || '[]') });
}));
router.put('/welcome', j((req, res) => {
  const { enabled = true, message = '', steps = [] } = req.body || {};
  db.prepare('INSERT OR REPLACE INTO welcome (id, enabled, message, steps) VALUES (1,?,?,?)')
    .run(enabled ? 1 : 0, message, JSON.stringify(steps));
  log('welcome.update', message.slice(0, 60));
  res.json({ ok: true });
}));

/* ---------- Campaigns ---------- */
function campaignCounts(id) {
  const rows = db.prepare('SELECT status, COUNT(*) c FROM campaign_recipients WHERE campaign_id=? GROUP BY status').all(id);
  const counts = { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 };
  for (const r of rows) { counts.total += r.c; if (counts[r.status] !== undefined) counts[r.status] = r.c; }
  counts.delivered += counts.read; counts.sent += counts.delivered; // cumulative like BotLinkd cards
  return counts;
}

router.get('/campaigns', j((req, res) => {
  const rows = db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all();
  res.json(rows.map((c) => ({ ...c, counts: campaignCounts(c.id) })));
}));
router.post('/campaigns', j((req, res) => {
  const { name, group_id, template_id, scheduled_at = '', mode } = req.body || {};
  if (!name || !group_id || !template_id) return res.status(400).json({ error: 'name, group_id, template_id required' });
  const m = mode || (cfg.metaConnected ? 'live' : 'simulate');
  const status = scheduled_at ? 'scheduled' : 'draft';
  const info = db.prepare('INSERT INTO campaigns (name, group_id, template_id, status, scheduled_at, mode) VALUES (?,?,?,?,?,?)')
    .run(name, group_id, template_id, status, scheduled_at, m);
  log('campaign.create', `${name} (${m})`);
  res.json({ id: Number(info.lastInsertRowid) });
}));
router.get('/campaigns/:id', j((req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const recipients = db.prepare(
    `SELECT cr.*, cu.name FROM campaign_recipients cr LEFT JOIN customers cu ON cu.id=cr.customer_id WHERE cr.campaign_id=? ORDER BY cr.id`
  ).all(c.id);
  res.json({ ...c, counts: campaignCounts(c.id), recipients });
}));

async function executeCampaign(camp) {
  const members = db.prepare('SELECT c.* FROM customers c JOIN group_members gm ON gm.customer_id=c.id WHERE gm.group_id=?').all(camp.group_id);
  const tpl = db.prepare('SELECT * FROM templates WHERE id=?').get(camp.template_id);
  db.prepare('DELETE FROM campaign_recipients WHERE campaign_id=?').run(camp.id);
  const ins = db.prepare('INSERT INTO campaign_recipients (campaign_id, customer_id, phone, status) VALUES (?,?,?,?)');
  const recs = members.map((m) => ({ id: Number(ins.run(camp.id, m.id, m.phone, 'queued').lastInsertRowid), phone: m.phone }));
  const simulate = camp.mode === 'simulate' || !cfg.metaConnected;
  db.prepare("UPDATE campaigns SET status='running' WHERE id=?").run(camp.id);
  log('campaign.run', `${camp.name} -> ${recs.length} recipients (${simulate ? 'SIMULATE' : 'LIVE'})`);
  if (simulate) {
    // Walk statuses locally so the UI demonstrates delivery flow without Meta credentials.
    recs.forEach((r, i) => {
      const fail = i % 7 === 6;
      setTimeout(() => db.prepare("UPDATE campaign_recipients SET status='sent', updated_at=datetime('now') WHERE id=?").run(r.id), 300 + i * 250);
      setTimeout(() => { if (!fail) db.prepare("UPDATE campaign_recipients SET status='delivered', updated_at=datetime('now') WHERE id=?").run(r.id); }, 900 + i * 250);
      setTimeout(() => {
        db.prepare("UPDATE campaign_recipients SET status=?, updated_at=datetime('now') WHERE id=?").run(fail ? 'failed' : 'read', r.id);
        if (i === recs.length - 1) {
          db.prepare("UPDATE campaigns SET status='simulated-completed' WHERE id=?").run(camp.id);
          log('campaign.done', `${camp.name} simulated complete`);
        }
      }, 1500 + i * 250);
    });
    if (!recs.length) db.prepare("UPDATE campaigns SET status='simulated-completed' WHERE id=?").run(camp.id);
    return { mode: 'simulate', recipients: recs.length };
  }
  let sent = 0, failed = 0;
  for (const r of recs) {
    try {
      const out = await meta.sendTemplate(r.phone, tpl.name, tpl.language);
      const waId = out.messages && out.messages[0] ? out.messages[0].id : '';
      db.prepare("UPDATE campaign_recipients SET status='sent', wa_id=?, updated_at=datetime('now') WHERE id=?").run(waId, r.id);
      sent++;
    } catch (e) {
      db.prepare("UPDATE campaign_recipients SET status='failed', updated_at=datetime('now') WHERE id=?").run(r.id);
      failed++;
    }
  }
  db.prepare("UPDATE campaigns SET status='completed' WHERE id=?").run(camp.id);
  log('campaign.done', `${camp.name}: ${sent} sent, ${failed} failed`);
  return { mode: 'live', sent, failed };
}
router.post('/campaigns/:id/run', ja(async (req, res) => {
  const camp = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
  if (!camp) return res.status(404).json({ error: 'not found' });
  const result = await executeCampaign(camp);
  res.json({ ok: true, ...result });
}));

module.exports = { router, executeCampaign };
