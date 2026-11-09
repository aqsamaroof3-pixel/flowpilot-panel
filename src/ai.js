'use strict';
// Auto-reply brain. Precedence: QA rules -> Chat Flows -> Groq AI -> polite default.
const { db } = require('./db');
const { cfg } = require('./config');

const DEFAULT_REPLY = 'Thank you for your message! We have received it and will get back to you shortly. — FlowPilot';

function matchRule(text) {
  const t = (text || '').toLowerCase();
  const rules = db.prepare('SELECT * FROM qa_rules WHERE active=1').all();
  for (const r of rules) {
    if (r.keyword && t.includes(r.keyword.toLowerCase())) return { text: r.answer, origin: 'rule' };
  }
  const flows = db.prepare("SELECT * FROM flows WHERE active=1 AND action='reply'").all();
  for (const f of flows) {
    if (f.trigger && t.includes(f.trigger.toLowerCase()) && f.reply_text) return { text: f.reply_text, origin: 'rule' };
  }
  return null;
}

async function groqReply(userText) {
  const products = db.prepare('SELECT name, price, description FROM products').all();
  const catalog = products.length
    ? products.map((p) => `- ${p.name}: $${p.price}${p.description ? ' — ' + p.description : ''}`).join("\n")
    : '(catalog is empty)';
  const history = db.prepare(
    `SELECT m.direction, m.body FROM messages m ORDER BY m.id DESC LIMIT 8`
  ).all().reverse();
  const messages = [
    {
      role: 'system',
      content:
        'You are FlowPilot, a helpful WhatsApp sales assistant for a small business. ' +
        'Answer briefly and politely, help the customer, and when relevant share products from this catalog:\n' + catalog +
        '\nIf you cannot help, say a human will follow up shortly. Never invent prices not in the catalog.',
    },
    ...history.map((h) => ({ role: h.direction === 'in' ? 'user' : 'assistant', content: h.body })),
    { role: 'user', content: userText },
  ];
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.groqModel, messages, temperature: 0.4, max_tokens: 300 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Groq error');
  return data.choices[0].message.content.trim();
}

async function generateReply(userText) {
  const rule = matchRule(userText);
  if (rule) return rule;
  if (cfg.groqKey) {
    try { return { text: await groqReply(userText), origin: 'ai' }; }
    catch (e) { /* fall through to default */ }
  }
  return { text: DEFAULT_REPLY, origin: 'ai' };
}

module.exports = { generateReply, matchRule, DEFAULT_REPLY };
