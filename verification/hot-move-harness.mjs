/**
 * Host-side harness for the hot-migration path of dsh-session-move.
 * Builds a throwaway persistence root + workspace registry, then exercises
 * moveSession() for: cold dry-run, live dry-run, cold move, live move, and the
 * "a turn is running" refusal. Nothing touches the user's real sessions.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const host = await import('file:///C:/Users/G1enn/Documents/deepseek-harness/default-workspace/session-toolkit/plugin/components/dsh-session-move/lib/host.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-session-move-test-'));
const root = path.join(tmp, 'sessions');
const wsA = path.join(tmp, 'ws-a');
const wsB = path.join(tmp, 'ws-b');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(wsA, { recursive: true });
fs.mkdirSync(wsB, { recursive: true });

// ---- replicate the backend layout helpers (private to the module) ----
function encodeSegment(raw) {
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (const ch of raw) {
    if (ch !== '~' && /^[A-Za-z0-9._-]$/u.test(ch)) out += ch;
    else out += `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}
function projectKey(cwd) {
  let readable = '';
  let sep = false;
  for (const ch of cwd) {
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!sep) readable += '-';
      sep = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/u.test(ch)) {
      readable += ch;
      sep = false;
    } else {
      readable += `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
      sep = false;
    }
  }
  return `--${(readable.replace(/^-+/u, '') || 'root').slice(0, 251)}--`;
}
function sessionDir(cwd, id) {
  return path.join(root, projectKey(cwd), encodeSegment(String(id)));
}

const SESSION_ID = 'session-test-1';
const checksum = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
function makeLog(cwd) {
  const header = JSON.stringify({ version: 4, id: SESSION_ID, cwd, time: Date.now() });
  const events = [
    { type: 'user/message', seq: 0, time: Date.now(), data: { text: 'hello' } },
    { type: 'assistant/message', seq: 1, time: Date.now(), data: { text: 'hi' } },
  ];
  const headerFrame = zlib.zstdCompressSync(Buffer.from(header + '\n', 'utf8'), checksum);
  const eventsFrame = zlib.zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8'), checksum);
  return Buffer.concat([headerFrame, eventsFrame]);
}
const logDirA = sessionDir(wsA, SESSION_ID);
fs.mkdirSync(logDirA, { recursive: true });
const logFileA = path.join(logDirA, 'session.v4.jsonl.zstd');
fs.writeFileSync(logFileA, makeLog(wsA));

// ---- fake host services ----
function makeWorkspace(id, title, dir, sessionIds = []) {
  return {
    id, title, path: dir,
    sessionIds: [...sessionIds],
    async status() { return 'ok'; },
    async detachSession(sessionId) {
      this.sessionIds = this.sessionIds.filter((x) => x !== sessionId);
    },
    async attachSession(sessionId) {
      if (!this.sessionIds.includes(sessionId)) this.sessionIds.push(sessionId);
    },
  };
}
const wsAEntity = makeWorkspace('ws-a', 'A', wsA, [SESSION_ID]);
const wsBEntity = makeWorkspace('ws-b', 'B', wsB, []);

const state = {
  activity: [],
  flushCalls: 0,
  wdSets: [],
  sessionHeader: { version: 4, id: SESSION_ID, cwd: wsA },
  writerHeader: { version: 4, id: SESSION_ID, cwd: wsA },
  live: false,
  writerLive: false,
};

const registry = {
  list: () => [wsAEntity, wsBEntity],
  get: (id) => (id === 'ws-a' ? wsAEntity : id === 'ws-b' ? wsBEntity : undefined),
  headers: new Map(),
  sessionPaths: new Map(),
};
const persistence = {
  root,
  tracker: { writers: new Map() },
  async stat(id) {
    if (id !== SESSION_ID) return undefined;
    return { header: { ...state.sessionHeader } };
  },
};
const sessionObj = { header: { version: 4, id: SESSION_ID, cwd: wsA } };
const writerHandle = { access: 'write', header: { version: 4, id: SESSION_ID, cwd: wsA } };
const sessions = {
  get: (id) => (state.live && id === SESSION_ID ? sessionObj : undefined),
  async flush() { state.flushCalls += 1; },
};
const agents = { get: (id) => (state.live && id === SESSION_ID ? { id: 'agent-1' } : undefined) };
const workingDirectory = { async set(agent, dir) { state.wdSets.push({ agent, dir }); } };

const ctx = {
  get(name) {
    switch (name) {
      case 'workspaceRegistry': return registry;
      case 'sessionPersistence': return persistence;
      case 'sessions': return sessions;
      case 'agents': return agents;
      case 'workingDirectory': return workingDirectory;
      default: return undefined;
    }
  },
  async waterfall(name, payload, fallback) {
    if (state.activity.length > 0) return state.activity;
    return fallback();
  },
  logger: { warn() {}, info() {} },
};

const options = {
  enabled: true,
  backupKeep: 3,
  retryIntervalMs: 20000,
  selfTest: false,
  dataDir: path.join(tmp, 'state'),
};

function report(label, value) {
  console.log(`${label}: ${JSON.stringify(value)}`);
}
function expect(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok - ${label}`);
}

// reset helper between scenarios
function reset() {
  fs.rmSync(logDirA, { recursive: true, force: true });
  fs.mkdirSync(logDirA, { recursive: true });
  fs.writeFileSync(logFileA, makeLog(wsA));
  fs.rmSync(sessionDir(wsB, SESSION_ID), { recursive: true, force: true });
  wsAEntity.sessionIds = [SESSION_ID];
  wsBEntity.sessionIds = [];
  state.activity = [];
  state.flushCalls = 0;
  state.wdSets = [];
  state.live = false;
  state.writerLive = false;
  state.sessionHeader = { version: 4, id: SESSION_ID, cwd: wsA };
  state.writerHeader = { version: 4, id: SESSION_ID, cwd: wsA };
  sessionObj.header = { version: 4, id: SESSION_ID, cwd: wsA };
  writerHandle.header = { version: 4, id: SESSION_ID, cwd: wsA };
  persistence.tracker.writers.clear();
}

// ---- 1. cold dry-run ----
reset();
let result = await host.moveSession(ctx, options, SESSION_ID, 'ws-b', true);
report('cold dryRun', result);
expect(result.dryRun === true && result.live === false, 'cold session reports live=false');

// ---- 2. live dry-run ----
reset();
state.live = true;
persistence.tracker.writers.set(SESSION_ID, writerHandle);
result = await host.moveSession(ctx, options, SESSION_ID, 'ws-b', true);
report('live dryRun', result);
expect(result.live === true && result.writerFound === true, 'live session reports live=true writerFound=true');

// ---- 3. cold move ----
reset();
result = await host.moveSession(ctx, options, SESSION_ID, 'ws-b', false);
report('cold move', { ok: result.ok, live: result.live, target: result.target.path });
const movedFile = path.join(sessionDir(wsB, SESSION_ID), 'session.v4.jsonl.zstd');
expect(fs.existsSync(movedFile), 'log relocated to target workspace');
expect(!fs.existsSync(path.join(logDirA, 'session.v4.jsonl.zstd')), 'old log removed');
expect(result.live === false, 'cold move keeps live=false');
expect(wsBEntity.sessionIds.includes(SESSION_ID) && !wsAEntity.sessionIds.includes(SESSION_ID), 'registry accounting moved');

// ---- 4. live move (the hot path) ----
reset();
state.live = true;
persistence.tracker.writers.set(SESSION_ID, writerHandle);
result = await host.moveSession(ctx, options, SESSION_ID, 'ws-b', false);
report('live move', { ok: result.ok, live: result.live, warning: result.warning });
expect(result.ok === true && result.live === true, 'live move succeeds and reports live=true');
expect(sessionObj.header.cwd === wsB, 'live session header repointed to target');
expect(writerHandle.header.cwd === wsB, 'live writer header repointed to target');
expect(state.wdSets.length === 1 && state.wdSets[0].dir === wsB, 'workingDirectory.set called with target');
expect(state.flushCalls >= 2, 'flushed before and after the move');

// ---- 5. running turn must be refused ----
reset();
state.live = true;
persistence.tracker.writers.set(SESSION_ID, writerHandle);
state.activity = [{ kind: 'turn' }];
let refused;
try {
  await host.moveSession(ctx, options, SESSION_ID, 'ws-b', false);
} catch (error) {
  refused = error;
}
report('active refusal', { code: refused?.code, message: refused?.message });
expect(refused?.code === 'active', 'a running turn refuses with code=active');
expect(sessionObj.header.cwd === wsA, 'headers untouched after the refusal');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nALL CHECKS PASSED');

