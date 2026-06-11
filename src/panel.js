/**
 * NightFury Host — Spaceify / Pterodactyl Panel API
 */
const axios = require('axios');
const { getSetting } = require('./db');

const getClient = () => {
  const base = getSetting('panel_url') || process.env.PANEL_URL || 'https://panel.spaceify.eu';
  const key  = getSetting('panel_key')  || process.env.PANEL_KEY  || '';
  return axios.create({
    baseURL: base,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
    },
    timeout: 15000,
  });
};

const getServerId = () =>
  getSetting('panel_server_id') || process.env.PANEL_SERVER_ID || '36a73d5f';

// ─── SERVER STATUS ─────────────────────────────────────────────────────────────

async function getServerStatus() {
  const client = getClient();
  const { data } = await client.get(`/api/client/servers/${getServerId()}/resources`);
  return data.attributes;
}

// ─── POWER ACTIONS ─────────────────────────────────────────────────────────────

async function powerAction(action) {
  // action: start | stop | restart | kill
  const client = getClient();
  await client.post(`/api/client/servers/${getServerId()}/power`, { signal: action });
  return true;
}

// ─── ENVIRONMENT VARIABLES ────────────────────────────────────────────────────

async function getEnvVars() {
  const client = getClient();
  const { data } = await client.get(`/api/client/servers/${getServerId()}/startup`);
  return data;
}

async function setEnvVar(key, value) {
  const client = getClient();
  await client.put(`/api/client/servers/${getServerId()}/startup/variable`, {
    key,
    value: String(value),
  });
  return true;
}

// ─── FILE OPERATIONS ───────────────────────────────────────────────────────────

async function listFiles(directory = '/') {
  const client = getClient();
  const { data } = await client.get(`/api/client/servers/${getServerId()}/files/list`, {
    params: { directory },
  });
  return data.data || [];
}

async function writeFile(filePath, content) {
  const client = getClient();
  await client.post(`/api/client/servers/${getServerId()}/files/write`, content, {
    params: { file: filePath },
    headers: { 'Content-Type': 'text/plain' },
  });
  return true;
}

async function deleteFiles(files) {
  const client = getClient();
  await client.post(`/api/client/servers/${getServerId()}/files/delete`, {
    root: '/',
    files,
  });
  return true;
}

// ─── CONSOLE / LOGS ───────────────────────────────────────────────────────────

async function getConsoleLogs() {
  // Via WebSocket token — return the token so frontend can connect
  const client = getClient();
  const { data } = await client.get(`/api/client/servers/${getServerId()}/websocket`);
  return data.data;
}

// ─── DEPLOY BOT ────────────────────────────────────────────────────────────────
// Sets SESSION_ID env var then starts the server

async function deployBot(sessionId) {
  await setEnvVar('SESSION_ID', sessionId);
  await powerAction('start');
  return true;
}

async function stopBot() {
  await powerAction('stop');
  return true;
}

async function restartBot() {
  await powerAction('restart');
  return true;
}

module.exports = {
  getServerStatus,
  powerAction,
  getEnvVars,
  setEnvVar,
  listFiles,
  writeFile,
  deleteFiles,
  getConsoleLogs,
  deployBot,
  stopBot,
  restartBot,
};
