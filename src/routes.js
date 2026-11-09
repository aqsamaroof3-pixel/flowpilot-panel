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
