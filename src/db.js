'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'panel.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS customers (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
phone TEXT NOT NULL UNIQUE,
email TEXT DEFAULT '',
label TEXT DEFAULT '',
source TEXT DEFAULT 'manual',
created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS groups_tbl (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
description TEXT DEFAULT '',
created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS group_members (
group_id INTEGER NOT NULL,
customer_id INTEGER NOT NULL,
PRIMARY KEY (group_id, customer_id)
);
CREATE TABLE IF NOT EXISTS conversations (
id INTEGER PRIMARY KEY AUTOINCREMENT,
customer_id INTEGER NOT NULL,
auto_reply INTEGER DEFAULT 1,
solved INTEGER DEFAULT 0,
label TEXT DEFAULT '',
assigned_to TEXT DEFAULT 'Abdul',
unread INTEGER DEFAULT 0,
last_message TEXT DEFAULT '',
last_at TEXT DEFAULT (datetime('now')),
created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
id INTEGER PRIMARY KEY AUTOINCREMENT,
conversation_id INTEGER NOT NULL,
direction TEXT NOT NULL CHECK(direction IN ('in','out')),
body TEXT DEFAULT '',
type TEXT DEFAULT 'text',
wa_id TEXT DEFAULT '',
status TEXT DEFAULT 'sent',         -- sent|delivered|read|failed|pending
origin TEXT DEFAULT 'human',        -- human|ai|rule|campaign|welcome
created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS templates (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL UNIQUE,
language TEXT DEFAULT 'en_US',
category TEXT DEFAULT 'MARKETING',
status TEXT DEFAULT 'APPROVED',
body TEXT DEFAULT '',
source TEXT DEFAULT 'local',        -- local|meta
created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quick_replies (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT NOT NULL,
body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS qa_rules (
id INTEGER PRIMARY KEY AUTOINCREMENT,
keyword TEXT NOT NULL,
answer TEXT NOT NULL,
active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS flows (
id INTEGER PRIMARY KEY AUTOINCREMENT,
trigger TEXT NOT NULL,
action TEXT DEFAULT 'reply',        -- reply|label|assign
reply_text TEXT DEFAULT '',
active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS welcome (
id INTEGER PRIMARY KEY CHECK(id=1),
enabled INTEGER DEFAULT 1,
message TEXT DEFAULT '',
steps TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS products (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
price REAL DEFAULT 0,
image_url TEXT DEFAULT '',
description TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS campaigns (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
group_id INTEGER,
template_id INTEGER,
status TEXT DEFAULT 'draft',        -- draft|running|scheduled|completed|simulated-completed
scheduled_at TEXT DEFAULT '',
mode TEXT DEFAULT 'live',           -- live|simulate
created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
id INTEGER PRIMARY KEY AUTOINCREMENT,
campaign_id INTEGER NOT NULL,
customer_id INTEGER NOT NULL,
phone TEXT NOT NULL,
status TEXT DEFAULT 'queued',       -- queued|sent|delivered|read|failed
wa_id TEXT DEFAULT '',
updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS logs (
id INTEGER PRIMARY KEY AUTOINCREMENT,
event TEXT NOT NULL,
detail TEXT DEFAULT '',
created_at TEXT DEFAULT (datetime('now'))
);
`);

function log(event, detail = '') {
  try { db.prepare('INSERT INTO logs (event, detail) VALUES (?,?)').run(event, detail); } catch (e) { /* ignore */ }
}

function getOrCreateConversation(customerId) {
  let conv = db.prepare('SELECT * FROM conversations WHERE customer_id=?').get(customerId);
  if (!conv) {
    db.prepare('INSERT INTO conversations (customer_id) VALUES (?)').run(customerId);
    conv = db.prepare('SELECT * FROM conversations WHERE customer_id=?').get(customerId);
  }
  return conv;
}

function addMessage(conversationId, direction, body, opts = {}) {
  const { type = 'text', waId = '', status = 'sent', origin = 'human' } = opts;
  const info = db.prepare(
    'INSERT INTO messages (conversation_id, direction, body, type, wa_id, status, origin) VALUES (?,?,?,?,?,?,?)'
  ).run(conversationId, direction, body, type, waId, status, origin);
  const preview = body.slice(0, 90);
  if (direction === 'in') {
    db.prepare("UPDATE conversations SET last_message=?, last_at=datetime('now'), unread=unread+1 WHERE id=?")
      .run(preview, conversationId);
  } else {
    db.prepare("UPDATE conversations SET last_message=?, last_at=datetime('now') WHERE id=?")
      .run(preview, conversationId);
  }
  return Number(info.lastInsertRowid);
}

module.exports = { db, log, getOrCreateConversation, addMessage, DATA_DIR };
