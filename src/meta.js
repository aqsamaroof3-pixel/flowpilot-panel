'use strict';
// Meta WhatsApp Cloud API client — Graph API v21.0.
// Credentials come from src/config.js: process env vars first, then the
// UI-saved data/meta-config.json (Settings -> Connect Meta). Read from `cfg`
// on every call so panel saves take effect without a server restart.
const { cfg } = require('./config');
const BASE = 'https://graph.facebook.com/v21.0';

async function graph(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `Graph API ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function sendText(to, body) {
  if (!cfg.metaConnected) throw new Error('Meta API not connected (missing token / phone_number_id)');
  return graph(`/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
}

async function sendTemplate(to, templateName, language = 'en_US') {
  if (!cfg.metaConnected) throw new Error('Meta API not connected (missing token / phone_number_id)');
  return graph(`/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: templateName, language: { code: language } },
    }),
  });
}

async function listTemplates() {
  if (!cfg.wabaId || !cfg.token) throw new Error('WA_BUSINESS_ACCOUNT_ID / META_ACCESS_TOKEN missing');
  const data = await graph(`/${cfg.wabaId}/message_templates?limit=100`);
  return data.data || [];
}

module.exports = { sendText, sendTemplate, listTemplates };
