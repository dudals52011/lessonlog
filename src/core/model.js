// 데이터 모델과 순수 상태 연산. DOM·저장소·네트워크에 의존하지 않는다.
import { dayKey } from './dates.js';

export const UNTITLED = '제목 없음';

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function emptyState() {
  return {
    version: 1,
    code: null,
    notes: {},
    entries: {},
    pending: { notes: [], entries: [] },
    lastSync: null,
    bannerDismissed: false,
  };
}

export function createNote(now = new Date().toISOString()) {
  return {
    id: newId(),
    title: null,
    created_at: now,
    updated_at: now,
    last_opened_at: now,
    deleted_at: null,
  };
}

export function createEntry(noteId, body, now = new Date().toISOString()) {
  return {
    id: newId(),
    note_id: noteId,
    body,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

export function displayTitle(note) {
  return note?.title?.trim() ? note.title.trim() : UNTITLED;
}

/** 살아 있는 노트, 마지막 연 순서 */
export function liveNotes(state) {
  return Object.values(state.notes)
    .filter((n) => !n.deleted_at)
    .sort((a, b) => (a.last_opened_at < b.last_opened_at ? 1 : -1));
}

/** 살아 있는 항목(노트가 살아 있어야 함), 적은 시각 순 */
export function liveEntries(state, noteId) {
  const note = state.notes[noteId];
  if (!note || note.deleted_at) return [];
  return Object.values(state.entries)
    .filter((e) => e.note_id === noteId && !e.deleted_at)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/** 첫·마지막 메모 날짜. 메모가 없으면 null */
export function notePeriod(entries) {
  if (!entries.length) return null;
  const keys = entries.map((e) => dayKey(e.created_at)).sort();
  return { from: keys[0], to: keys[keys.length - 1] };
}

export function homeNoteId(state) {
  const notes = liveNotes(state);
  return notes.length ? notes[0].id : null;
}

function markPending(state, kind, id) {
  const list = state.pending[kind];
  if (!list.includes(id)) list.push(id);
}

// ---- 변경 연산: 모두 새 state를 반환하지 않고 제자리에서 바꾼다(단순성). 호출자가 save 한다.

export function addNote(state, now) {
  const note = createNote(now);
  state.notes[note.id] = note;
  markPending(state, 'notes', note.id);
  return note;
}

export function openNote(state, noteId, now = new Date().toISOString()) {
  const note = state.notes[noteId];
  if (!note) return;
  note.last_opened_at = now;
  note.updated_at = now;
  markPending(state, 'notes', noteId);
}

export function setTitle(state, noteId, title, now = new Date().toISOString()) {
  const note = state.notes[noteId];
  if (!note) return;
  const t = title?.trim() ? title.trim() : null;
  if (t === note.title) return;
  note.title = t;
  note.updated_at = now;
  markPending(state, 'notes', noteId);
}

export function deleteNote(state, noteId, now = new Date().toISOString()) {
  const note = state.notes[noteId];
  if (!note) return;
  note.deleted_at = now;
  note.updated_at = now;
  markPending(state, 'notes', noteId);
  for (const e of Object.values(state.entries)) {
    if (e.note_id === noteId && !e.deleted_at) {
      e.deleted_at = now;
      e.updated_at = now;
      markPending(state, 'entries', e.id);
    }
  }
}

export function addEntry(state, noteId, body, now = new Date().toISOString()) {
  const text = body?.trim();
  if (!text) return null;
  const entry = createEntry(noteId, text, now);
  state.entries[entry.id] = entry;
  markPending(state, 'entries', entry.id);
  return entry;
}

export function editEntry(state, entryId, body, now = new Date().toISOString()) {
  const entry = state.entries[entryId];
  const text = body?.trim();
  if (!entry || !text || text === entry.body) return false;
  entry.body = text;
  entry.updated_at = now;
  markPending(state, 'entries', entryId);
  return true;
}

export function deleteEntry(state, entryId, now = new Date().toISOString()) {
  const entry = state.entries[entryId];
  if (!entry) return;
  entry.deleted_at = now;
  entry.updated_at = now;
  markPending(state, 'entries', entryId);
}

export function restoreEntry(state, entryId, now = new Date().toISOString()) {
  const entry = state.entries[entryId];
  if (!entry) return;
  entry.deleted_at = null;
  entry.updated_at = now;
  markPending(state, 'entries', entryId);
}

// ---- 동기화 병합: 항목 단위 LWW(updated_at이 늦은 쪽이 이김)

const NOTE_FIELDS = ['id', 'title', 'created_at', 'updated_at', 'last_opened_at', 'deleted_at'];
const ENTRY_FIELDS = ['id', 'note_id', 'body', 'created_at', 'updated_at', 'deleted_at'];

const TIME_FIELDS = new Set(['created_at', 'updated_at', 'last_opened_at', 'deleted_at']);

/** 서버는 '+00:00', 클라이언트는 'Z' 형식을 쓰므로 저장 전에 ISO(Z)로 통일한다 */
export function normalizeTime(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function pick(row, fields) {
  const out = {};
  for (const f of fields) out[f] = TIME_FIELDS.has(f) ? normalizeTime(row[f]) : row[f] ?? null;
  return out;
}

function newer(a, b) {
  return Date.parse(a) > Date.parse(b);
}

/** 원격 행들을 로컬에 병합. 로컬에 보류 중(pending)인 행은 로컬이 더 최신일 때만 유지 */
export function mergeRemote(state, { notes = [], entries = [] }) {
  let changed = 0;
  for (const r of notes) {
    const row = pick(r, NOTE_FIELDS);
    const local = state.notes[row.id];
    if (!local || newer(row.updated_at, local.updated_at)) {
      state.notes[row.id] = row;
      changed++;
    }
  }
  for (const r of entries) {
    const row = pick(r, ENTRY_FIELDS);
    const local = state.entries[row.id];
    if (!local || newer(row.updated_at, local.updated_at)) {
      state.entries[row.id] = row;
      changed++;
    }
  }
  return changed;
}

/** 서버로 보낼 보류 행 묶음 */
export function pendingPayload(state) {
  return {
    notes: state.pending.notes.map((id) => state.notes[id]).filter(Boolean).map((n) => pick(n, NOTE_FIELDS)),
    entries: state.pending.entries.map((id) => state.entries[id]).filter(Boolean).map((e) => pick(e, ENTRY_FIELDS)),
  };
}

/** 푸시 성공 후: 보낸 시점의 id만 보류 목록에서 제거 (푸시 중 새로 생긴 변경은 유지) */
export function clearPending(state, sent) {
  const sentNotes = new Set(sent.notes.map((n) => n.id));
  const sentEntries = new Set(sent.entries.map((e) => e.id));
  state.pending.notes = state.pending.notes.filter((id) => !sentNotes.has(id));
  state.pending.entries = state.pending.entries.filter((id) => !sentEntries.has(id));
}

export function pendingCount(state) {
  return state.pending.notes.length + state.pending.entries.length;
}

/** 전체 내보내기용 순수 데이터 */
export function exportData(state) {
  return {
    exported_at: new Date().toISOString(),
    notes: Object.values(state.notes),
    entries: Object.values(state.entries),
  };
}
