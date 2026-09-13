// Supabase RPC 호출과 동기화 루프
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { mergeRemote, pendingPayload, clearPending, pendingCount } from './core/model.js';
import { rawCode } from './core/code.js';

export class SyncError extends Error {
  constructor(message, { offline = false, notFound = false } = {}) {
    super(message);
    this.offline = offline;
    this.notFound = notFound;
  }
}

async function rpc(fn, params) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
  } catch (err) {
    throw new SyncError('네트워크 오류', { offline: true });
  }
  if (!res.ok) {
    let msg = `서버 오류 (${res.status})`;
    let notFound = false;
    try {
      const j = await res.json();
      if (j?.message) msg = j.message;
      notFound = /workspace not found/i.test(msg);
    } catch {
      /* ignore */
    }
    throw new SyncError(msg, { notFound });
  }
  return res.json();
}

export const api = {
  createWorkspace: (code) => rpc('ws_create', { p_code: rawCode(code) }),
  workspaceExists: (code) => rpc('ws_exists', { p_code: rawCode(code) }),
  push: (code, payload) => rpc('sync_push', { p_code: rawCode(code), p_notes: payload.notes, p_entries: payload.entries }),
  pull: (code, since) => rpc('sync_pull', { p_code: rawCode(code), p_since: since }),
};

/**
 * 동기화 루프. push(보류 행) → pull(since 이후) 순서.
 * onChange(state, { pulled }) 는 로컬 상태가 바뀌었을 때, onStatus(status) 는 상태 표시용.
 * status: 'idle' | 'syncing' | 'offline' | 'error'
 */
export function createSyncer({ getState, save, onChange, onStatus, isOnline = () => navigator.onLine }) {
  let running = false;
  let queued = false;
  let timer = null;
  let status = 'idle';

  function setStatus(s) {
    if (status !== s) {
      status = s;
      onStatus?.(s);
    }
  }

  async function runOnce() {
    const state = getState();
    if (!state.code) return;
    if (!isOnline()) {
      setStatus(pendingCount(state) ? 'offline' : 'idle');
      return;
    }
    setStatus('syncing');
    try {
      const sent = pendingPayload(state);
      if (sent.notes.length || sent.entries.length) {
        await api.push(state.code, sent);
        clearPending(state, sent);
        save();
      }
      const result = await api.pull(state.code, state.lastSync);
      const changed = mergeRemote(state, result);
      state.lastSync = result.server_time;
      save();
      setStatus('idle');
      if (changed) onChange?.(state, { pulled: changed });
    } catch (err) {
      console.warn('sync failed', err);
      setStatus(err.offline ? 'offline' : 'error');
    }
  }

  async function run() {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await runOnce();
      while (queued) {
        queued = false;
        await runOnce();
      }
    } finally {
      running = false;
    }
  }

  /** 잦은 입력을 묶어서 보냄 */
  function schedule(delay = 800) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  return {
    run,
    schedule,
    get status() {
      return status;
    },
  };
}
