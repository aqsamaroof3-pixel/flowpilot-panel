'use strict';
// DEMO seed data — clearly marked demo content so the panel is explorable on first run.
const { db, getOrCreateConversation, addMessage, log } = require('./db');

function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
  if (count > 0) return false;

  const insC = db.prepare('INSERT INTO customers (name, phone, email, label, source) VALUES (?,?,?,?,?)');
  const people = [
    ['Ahmed Raza', '923001112233', 'ahmed@example.com', 'New Lead', 'demo'],
    ['Sara Khan', '923214445566', 'sara@example.com', 'Interested', 'demo'],
    ['Bilal Hussain', '923337778899', '', 'Follow Up', 'demo'],
    ['Fatima Noor', '923009998877', '', 'Customer', 'demo'],
    ['Usman Tariq', '923216665544', '', 'New Lead', 'demo'],
  ];
  const ids = people.map((p) => Number(insC.run(...p).lastInsertRowid));

  const g = db.prepare('INSERT INTO groups_tbl (name, description) VALUES (?,?)')
    .run('Demo — Interested Customers', 'DEMO group seeded for exploration');
  const gid = Number(g.lastInsertRowid);
  const insM = db.prepare('INSERT INTO group_members (group_id, customer_id) VALUES (?,?)');
  ids.slice(0, 4).forEach((id) => insM.run(gid, id));
  db.prepare('INSERT INTO groups_tbl (name, description) VALUES (?,?)').run('Demo — All Contacts', 'DEMO group');

  const insT = db.prepare('INSERT INTO templates (name, language, category, status, body, source) VALUES (?,?,?,?,?,?)');
  insT.run('hello_world', 'en_US', 'UTILITY', 'APPROVED', 'Hello {{1}}, welcome to FlowPilot!', 'demo');
  insT.run('offer_promo', 'en_US', 'MARKETING', 'APPROVED', 'Hi {{1}}! We have a special offer for you today. Reply YES to know more.', 'demo');

  const insQ = db.prepare('INSERT INTO qa_rules (keyword, answer) VALUES (?,?)');
  insQ.run('price', 'Our plans start from $99/month. Would you like a free demo?');
  insQ.run('timing', 'We are available 24/7 — this assistant replies instantly at any hour.');
  insQ.run('location', 'We are based in Okara, Pakistan and serve customers worldwide online.');

  db.prepare('INSERT INTO quick_replies (title, body) VALUES (?,?)').run('Greeting', 'Hello! Thanks for contacting us. How can I help you today?');
  db.prepare('INSERT INTO quick_replies (title, body) VALUES (?,?)').run('Closing', 'Thank you for your time. If you need anything else, just message us here.');
  db.prepare('INSERT INTO flows (trigger, action, reply_text) VALUES (?,?,?)').run('demo', 'reply', 'Sure! We can set up a free demo for you. What time suits you best?');
  db.prepare('INSERT INTO products (name, price, image_url, description) VALUES (?,?,?,?)')
    .run('FlowPilot Starter', 99, '', 'AI WhatsApp + voice agent — starter plan (DEMO product)');
  db.prepare('INSERT INTO products (name, price, image_url, description) VALUES (?,?,?,?)')
    .run('FlowPilot Growth', 249, '', 'Higher volume + campaigns (DEMO product)');

  db.prepare('INSERT OR REPLACE INTO welcome (id, enabled, message, steps) VALUES (1,1,?,?)')
    .run('Welcome to FlowPilot!👋How can we help you today?', JSON.stringify(['Ask name', 'Ask need', 'Share catalog']));

  // Sample conversations
  const c1 = getOrCreateConversation(ids[0]);
  addMessage(c1.id, 'in', 'Hi! Do you support WhatsApp, Facebook and Instagram from a single inbox?');
  addMessage(c1.id, 'out', 'Yes! FlowPilot lets you manage WhatsApp, Facebook and Instagram conversations from one unified inbox.');
  addMessage(c1.id, 'in', 'Great. What is the price?');
  addMessage(c1.id, 'out', 'Our plans start from $99/month. Would you like a free demo?', { origin: 'rule' });
  db.prepare('UPDATE conversations SET unread=1 WHERE id=?').run(c1.id);

  const c2 = getOrCreateConversation(ids[1]);
  addMessage(c2.id, 'in', 'Can you share your product catalog?');
  addMessage(c2.id, 'out', 'Absolutely! Sharing our catalog now — FlowPilot Starter $99, Growth $249.');

  // Sample campaign (already simulated-complete so counts render)
  const tpl = db.prepare("SELECT id FROM templates WHERE name='offer_promo'").get();
  const camp = db.prepare('INSERT INTO campaigns (name, group_id, template_id, status, mode) VALUES (?,?,?,?,?)')
    .run('DEMO — Welcome Offer', gid, tpl.id, 'simulated-completed', 'simulate');
  const campId = Number(camp.lastInsertRowid);
  const insR = db.prepare('INSERT INTO campaign_recipients (campaign_id, customer_id, phone, status, wa_id) VALUES (?,?,?,?,?)');
  const statuses = ['read', 'read', 'delivered', 'sent'];
  ids.slice(0, 4).forEach((id, i) => insR.run(campId, id, people[i][1], statuses[i], 'wamid.DEMO' + i));

  log('seed', 'DEMO data seeded');
  return true;
}

if (require.main === module) {
  console.log(seed() ? 'Seeded DEMO data.' : 'Already seeded — skipped.');
}

module.exports = { seed };
