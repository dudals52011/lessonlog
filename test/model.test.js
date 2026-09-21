import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, addNote, openNote, setTitle, deleteNote, addEntry, editEntry, deleteEntry, restoreEntry,
  liveNotes, liveEntries, notePeriod, homeNoteId, displayTitle, mergeRemote, pendingPayload, clearPending,
  pendingCount, UNTITLED,
} from '../src/core/model.js';

const T = (n) => new Date(Date.UTC(2026, 8, 10, 0, 0, n)).toISOString(); // 초 단위로 증가하는 시각

test('새 노트는 제목 없음, 홈이 된다', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  assert.equal(displayTitle(n), UNTITLED);
  assert.equal(homeNoteId(s), n.id);
  assert.deepEqual(s.pending.notes, [n.id]);
});

test('노트 목록은 만든 순서(최신 위)이고, 열어도 순서가 바뀌지 않는다', () => {
  const s = emptyState();
  const a = addNote(s, T(1));
  const b = addNote(s, T(2));
  assert.deepEqual(liveNotes(s).map((n) => n.id), [b.id, a.id]);
  openNote(s, a.id, T(3));
  assert.deepEqual(liveNotes(s).map((n) => n.id), [b.id, a.id]);
  assert.equal(homeNoteId(s), a.id); // 홈은 마지막으로 연 노트
});

test('제목: 공백만 있으면 null로, 같은 값이면 변경 없음', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  setTitle(s, n.id, '  9월 2주차 ', T(2));
  assert.equal(n.title, '9월 2주차');
  assert.equal(n.updated_at, T(2));
  setTitle(s, n.id, '9월 2주차', T(3));
  assert.equal(n.updated_at, T(2), '같은 제목이면 updated_at 유지');
  setTitle(s, n.id, '   ', T(4));
  assert.equal(n.title, null);
  assert.equal(displayTitle(n), UNTITLED);
});

test('빈 메모는 추가되지 않고, 본문은 trim된다', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  assert.equal(addEntry(s, n.id, '   ', T(2)), null);
  const e = addEntry(s, n.id, '  첫 메모\n둘째 줄  ', T(2));
  assert.equal(e.body, '첫 메모\n둘째 줄');
  assert.equal(liveEntries(s, n.id).length, 1);
});

test('항목 순서는 적은 시각 순, 수정해도 created_at 불변', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  const e1 = addEntry(s, n.id, 'a', T(2));
  const e2 = addEntry(s, n.id, 'b', T(3));
  editEntry(s, e1.id, 'a2', T(9));
  assert.equal(e1.created_at, T(2));
  assert.equal(e1.updated_at, T(9));
  assert.deepEqual(liveEntries(s, n.id).map((e) => e.id), [e1.id, e2.id]);
});

test('editEntry: 빈 내용·같은 내용은 무시', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  const e = addEntry(s, n.id, 'a', T(2));
  assert.equal(editEntry(s, e.id, '  ', T(3)), false);
  assert.equal(editEntry(s, e.id, 'a', T(3)), false);
  assert.equal(e.updated_at, T(2));
});

test('항목 삭제와 실행 취소', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  const e = addEntry(s, n.id, 'a', T(2));
  deleteEntry(s, e.id, T(3));
  assert.equal(liveEntries(s, n.id).length, 0);
  restoreEntry(s, e.id, T(4));
  assert.equal(liveEntries(s, n.id).length, 1);
});

test('노트 삭제는 항목도 함께 삭제 처리하고, 홈은 다음 노트로', () => {
  const s = emptyState();
  const a = addNote(s, T(1));
  const b = addNote(s, T(2));
  addEntry(s, b.id, 'x', T(3));
  deleteNote(s, b.id, T(4));
  assert.equal(liveEntries(s, b.id).length, 0);
  assert.ok(Object.values(s.entries).every((e) => e.deleted_at));
  assert.equal(homeNoteId(s), a.id);
});

test('노트 기간은 첫·마지막 메모 날짜', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  assert.equal(notePeriod(liveEntries(s, n.id)), null);
  addEntry(s, n.id, 'a', new Date(2026, 8, 8, 10).toISOString());
  addEntry(s, n.id, 'b', new Date(2026, 8, 12, 10).toISOString());
  assert.deepEqual(notePeriod(liveEntries(s, n.id)), { from: '2026-09-08', to: '2026-09-12' });
});

test('mergeRemote: 원격이 더 늦으면 덮어쓰고, 로컬이 더 늦으면 유지', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  const e = addEntry(s, n.id, 'local', T(5));
  const changed = mergeRemote(s, {
    notes: [{ ...n, title: '원격 제목', updated_at: T(9) }],
    entries: [{ ...e, body: 'remote-old', updated_at: T(4) }],
  });
  assert.equal(changed, 1);
  assert.equal(s.notes[n.id].title, '원격 제목');
  assert.equal(s.entries[e.id].body, 'local');
});

test('mergeRemote: 모르는 행은 추가, 알 수 없는 필드는 버림', () => {
  const s = emptyState();
  mergeRemote(s, { notes: [{ id: 'n1', title: null, created_at: T(1), updated_at: T(1), last_opened_at: T(1), deleted_at: null, junk: 1 }] });
  assert.equal(liveNotes(s).length, 1);
  assert.equal('junk' in s.notes.n1, false);
});

test('pendingPayload / clearPending: 푸시 중 생긴 변경은 보류에 남는다', () => {
  const s = emptyState();
  const n = addNote(s, T(1));
  const e1 = addEntry(s, n.id, 'a', T(2));
  const sent = pendingPayload(s);
  assert.equal(sent.notes.length, 1);
  assert.equal(sent.entries.length, 1);
  const e2 = addEntry(s, n.id, 'b', T(3)); // 푸시 도중 새 메모
  clearPending(s, sent);
  assert.deepEqual(s.pending.entries, [e2.id]);
  assert.equal(pendingCount(s), 1);
  assert.ok(!s.pending.entries.includes(e1.id));
});

test('mergeRemote: 서버의 +00:00 형식과 클라이언트의 Z 형식을 같은 시각으로 취급한다', () => {
  const s = emptyState();
  const n = addNote(s, '2026-09-13T00:00:01.000Z');
  // 같은 시각을 +00:00으로 받으면 덮어쓰지 않음
  assert.equal(mergeRemote(s, { notes: [{ ...n, title: 'X', updated_at: '2026-09-13T00:00:01+00:00' }] }), 0);
  // 1초 늦은 시각은 덮어씀 + Z 형식으로 정규화되어 저장
  assert.equal(mergeRemote(s, { notes: [{ ...n, title: 'Y', updated_at: '2026-09-13T00:00:02+00:00' }] }), 1);
  assert.equal(s.notes[n.id].title, 'Y');
  assert.equal(s.notes[n.id].updated_at, '2026-09-13T00:00:02.000Z');
  assert.equal(s.notes[n.id].deleted_at, null);
});
