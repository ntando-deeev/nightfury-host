/**
 * NightFury Host - Multi-Bot Panel Manager
 *
 * One Spaceify server runs a bot-manager process.
 * Manager reads /bots.json, spawns one NightFury child per active entry.
 * We push bots.json via Files API on every deploy/stop, then restart server.
 */

const axios = require('axios');
const { getSetting } = require('./db');

const getClient = () => {
  const base = getSetting('panel_url') || process.env.PANEL_URL || 'https://panel.spaceify.eu';
  const key  = getSetting('panel_key')  || process.env.PANEL_KEY  || '';
  return axios.create({
    baseURL: base,
    headers: {
      Authorization:  `Bearer ${key}`,
      Accept:         'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });
};

const getServerId = () =>
  getSetting('panel_server_id') || process.env.PANEL_SERVER_ID || '36a73d5f';

async function getServerStatus() {
  const { data } = await getClient().get(`/api/client/servers/${getServerId()}/resources`);
  return data.attributes;
}

async function powerAction(signal) {
  await getClient().post(`/api/client/servers/${getServerId()}/power`, { signal });
  return true;
}

async function readBotsConfig() {
  try {
    const { data } = await getClient().get(
      `/api/client/servers/${getServerId()}/files/contents`,
      { params: { file: '/bots.json' } }
    );
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeBotsConfig(bots) {
  const content = JSON.stringify(bots, null, 2);
  await getClient().post(
    `/api/client/servers/${getServerId()}/files/write`,
    content,
    { params: { file: '/bots.json' }, headers: { 'Content-Type': 'text/plain' } }
  );
  return true;
}

const MANAGER_CODE = `
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const CONFIG = path.join(__dirname, 'bots.json');
const procs = {};

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
  catch { return []; }
}

function start(bot) {
  if (procs[bot.userId]) return;
  console.log('[Manager] Starting bot for:', bot.username || bot.userId);
  const env = { ...process.env, SESSION_ID: bot.sessionId, SESSION_NAME: 'sess_' + bot.userId };
  const child = fork(path.join(__dirname, 'launcher.js'), [], { env, cwd: __dirname });
  child.on('exit', code => { console.log('[Manager] Bot', bot.userId, 'exited:', code); delete procs[bot.userId]; });
  procs[bot.userId] = child;
}

function stop(uid) {
  if (procs[uid]) { procs[uid].kill('SIGTERM'); delete procs[uid]; }
}

function sync() {
  const bots = load();
  const activeIds = new Set(bots.filter(b => b.active).map(b => b.userId));
  Object.keys(procs).forEach(uid => { if (!activeIds.has(uid)) { console.log('[Manager] Stopping:', uid); stop(uid); } });
  bots.filter(b => b.active && !procs[b.userId]).forEach(start);
  console.log('[Manager] Running bots:', Object.keys(procs).length);
}

sync();
fs.watch(CONFIG, () => { console.log('[Manager] Config changed, syncing'); setTimeout(sync, 500); });
process.on('SIGTERM', () => { Object.keys(procs).forEach(stop); process.exit(0); });
`;

async function ensureManagerScript() {
  try {
    const files = await getClient().get(
      `/api/client/servers/${getServerId()}/files/list`,
      { params: { directory: '/' } }
    );
    const names = (files.data.data || []).map(f => f.attributes.name);
    if (!names.includes('manager.js')) {
      await getClient().post(
        `/api/client/servers/${getServerId()}/files/write`,
        MANAGER_CODE,
        { params: { file: '/manager.js' }, headers: { 'Content-Type': 'text/plain' } }
      );
    }
  } catch (e) {
    console.error('[Panel] ensureManager error:', e.message);
  }
}

async function deployBot(userId, sessionId, username) {
  let bots = await readBotsConfig();
  const idx = bots.findIndex(b => b.userId === String(userId));
  const entry = { userId: String(userId), username: username || String(userId), sessionId, active: true, deployedAt: Date.now() };
  if (idx >= 0) bots[idx] = entry;
  else bots.push(entry);
  await writeBotsConfig(bots);
  await ensureManagerScript();
  const status = await getServerStatus().catch(() => ({ current_state: 'offline' }));
  await powerAction(status.current_state === 'running' ? 'restart' : 'start');
  return true;
}

async function stopBot(userId) {
  let bots = await readBotsConfig();
  const idx = bots.findIndex(b => b.userId === String(userId));
  if (idx >= 0) { bots[idx].active = false; bots[idx].stoppedAt = Date.now(); }
  await writeBotsConfig(bots);
  const status = await getServerStatus().catch(() => ({ current_state: 'offline' }));
  if (status.current_state === 'running') await powerAction('restart');
  return true;
}

async function removeBot(userId) {
  let bots = await readBotsConfig();
  bots = bots.filter(b => b.userId !== String(userId));
  await writeBotsConfig(bots);
  return true;
}

async function listDeployedBots() {
  return readBotsConfig();
}

async function restartServer() {
  await powerAction('restart');
  return true;
}

module.exports = {
  getServerStatus, powerAction,
  deployBot, stopBot, removeBot,
  listDeployedBots, restartServer,
  readBotsConfig, writeBotsConfig, ensureManagerScript,
};
