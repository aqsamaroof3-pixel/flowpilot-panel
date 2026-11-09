'use strict';
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dependency). Real process.env always wins.
(function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

// ---- UI-saved Meta credentials (Settings -> Connect Meta) ----
// Stored server-side in data/meta-config.json. NEVER rendered into any page;
// only set/not-set status is exposed. Precedence: process env var > this file.
const META_CONFIG_PATH = path.join(__dirname, '..', 'data', 'meta-config.json');
const META_KEYS = ['META_ACCESS_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_BUSINESS_ACCOUNT_ID'];

function readMetaFile() {
  try {
    const raw = fs.readFileSync(META_CONFIG_PATH, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function writeMetaFile(obj) {
  fs.mkdirSync(path.dirname(META_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(META_CONFIG_PATH, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
}

// A key counts as "from env" only if it is set to a non-empty value there.
function envVal(name) {
  const v = process.env[name];
  return v !== undefined && String(v).trim() !== '' ? String(v) : '';
}

const cfg = {
  port: parseInt(process.env.PORT || '3200', 10),
  token: '',
  phoneNumberId: '',
  wabaId: '',
  verifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'flowpilot-verify-me',
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  metaConnected: false,
};

// (Re)load Meta credentials: env vars first, data/meta-config.json as fallback.
// Called at startup and after every UI save so changes apply without a restart.
function refreshMetaConfig() {
  const file = readMetaFile();
  const pick = (name) => envVal(name) || (typeof file[name] === 'string' ? file[name] : '');
  cfg.token = pick('META_ACCESS_TOKEN');
  cfg.phoneNumberId = pick('WA_PHONE_NUMBER_ID');
  cfg.wabaId = pick('WA_BUSINESS_ACCOUNT_ID');
  cfg.metaConnected = Boolean(cfg.token && cfg.phoneNumberId);
  return cfg;
}

refreshMetaConfig();

// Per-key set/not-set status (values are NEVER included).
function metaConfigStatus() {
  const file = readMetaFile();
  return META_KEYS.map((name) => {
    if (envVal(name)) return { name, present: true, source: 'env' };
    if (typeof file[name] === 'string' && file[name] !== '') return { name, present: true, source: 'panel' };
    return { name, present: false, source: null };
  });
}

function envStatus() {
  const names = ['META_ACCESS_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_BUSINESS_ACCOUNT_ID', 'WEBHOOK_VERIFY_TOKEN', 'GROQ_API_KEY', 'PORT'];
  const meta = Object.fromEntries(metaConfigStatus().map((s) => [s.name, s.present]));
  return names.map((n) => ({ name: n, present: n in meta ? meta[n] : Boolean(process.env[n]) }));
}

module.exports = { cfg, envStatus, metaConfigStatus, readMetaFile, writeMetaFile, refreshMetaConfig, META_KEYS, META_CONFIG_PATH };
