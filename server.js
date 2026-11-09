'use strict';
const path = require('path');
const express = require('express');
const { cfg } = require('./src/config');
const { db, log, getOrCreateConversation, addMessage } = require('./src/db');
const { router } = require('./src/routes');
const { generateReply } = require('./src/ai');
const meta = require('./src/meta');
const { seed } = require('./src/seed');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ================= Meta Webhook ================= */
// GET: verification handshake
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === cfg.verifyToken) {
    log('webhook.verify', 'OK');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* ================= Incoming ================= */
// POST: incoming messages + delivery statuses
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // ack immediately; process async
  try {
    const entries = (req.body && req.body.entry) || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        // --- incoming messages ---
        for (const msg of value.messages || []) {
          const from = msg.from;
          const body = msg.type === 'text' ? (msg.text && msg.text.body) || '' : `[${msg.type} message]`;
          let customer = db.prepare('SELECT * FROM customers WHERE phone=?').get(from);
          if (!customer) {
            const contact = (value.contacts || []).find((c) => c.wa_id === from);
            const name = contact && contact.profile ? contact.profile.name : 'WhatsApp ' + from;
            const info = db.prepare('INSERT INTO customers (name, phone, source) VALUES (?,?,?)').run(name, from, 'whatsapp');
            customer = { id: Number(info.lastInsertRowid), name, phone: from };
            log('customer.auto', `${name} (${from}) from webhook`);
          }
          const isNew = !db.prepare('SELECT id FROM conversations WHERE customer_id=?').get(customer.id);
          const conv = getOrCreateConversation(customer.id);
          addMessage(conv.id, 'in', body, { waId: msg.id || '', origin: 'human' });
          log('webhook.in', `${from}: ${body.slice(0, 60)}`);
          // Welcome sequence for brand-new conversations
          if (isNew) {
            const w = db.prepare('SELECT * FROM welcome WHERE id=1').get();
            if (w && w.enabled && w.message) await deliver(conv, customer, w.message, 'welcome');
          }
          // Auto-reply
          const fresh = db.prepare('SELECT * FROM conversations WHERE id=?').get(conv.id);
          if (fresh.auto_reply) {
            const reply = await generateReply(body);
            await deliver(conv, customer, reply.text, reply.origin);
          }
        }
      }
    }
    // --- delivery statuses ---
    for (const st of value.statuses || []) {
      if (!st.id) continue;
      db.prepare("UPDATE messages SET status=? WHERE wa_id=?").run(st.status, st.id);
      db.prepare("UPDATE campaign_recipients SET status=?, updated_at=datetime('now') WHERE wa_id=?").run(st.status, st.id);
      log('webhook.status', `${st.id} -> ${st.status}`);
    }
  } catch (e) {
    log('webhook.error', e.message);
  }
});

async function deliver(conv, customer, text, origin) {
  let status = 'pending', waId = '';
  if (cfg.metaConnected) {
    try {
      const out = await meta.sendText(customer.phone, text);
      status = 'sent';
      waId = out.messages && out.messages[0] ? out.messages[0].id : '';
    } catch (e) {
      status = 'failed';
      log('meta.send.error', e.message);
    }
  }
  addMessage(conv.id, 'out', text, { status, waId, origin });
}

/* ================= API ================= */
app.use('/api', router);
app.get('/health', (req, res) => res.json({ ok: true, metaConnected: cfg.metaConnected }));

if (require.main === module) {
  if (seed()) console.log('Seeded DEMO data on first run.');
  app.listen(cfg.port, () => {
    console.log(`FlowPilot Panel running at http://localhost:${cfg.port}`);
    console.log(cfg.metaConnected ? 'Meta Cloud API: CONNECTED' : 'Meta Cloud API: NOT CONNECTED (test/simulate mode)');
    log('server.start', `port ${cfg.port}`);
  });
}

module.exports = app;
