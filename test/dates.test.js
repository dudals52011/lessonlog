import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, formatDayHeader, formatCopyDay, formatShortDay, formatTime, groupByDay } from '../src/core/dates.js';

// 로컬 시간 기준 ISO 문자열을 만든다 (테스트가 타임존에 흔들리지 않게)
function local(y, m, d, hh = 0, mm = 0) {
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

test('dayKey는 로컬 날짜 기준', () => {
  assert.equal(dayKey(local(2026, 9, 11, 0, 5)), '2026-09-11');
  assert.equal(dayKey(local(2026, 9, 11, 23, 59)), '2026-09-11');
});

test('날짜 표기 세 가지', () => {
  assert.equal(formatDayHeader('2026-09-11'), '9월 11일 (금)');
  assert.equal(formatCopyDay('2026-09-11'), '2026-09-11 (금)');
  assert.equal(formatShortDay('2026-09-11'), '9/11');
});

test('시각은 두 자리 HH:MM', () => {
  assert.equal(formatTime(local(2026, 9, 12, 9, 5)), '09:05');
  assert.equal(formatTime(local(2026, 9, 12, 17, 48)), '17:48');
});

test('groupByDay는 날짜가 바뀔 때만 새 묶음', () => {
  const entries = [
    { created_at: local(2026, 9, 11, 10, 42) },
    { created_at: local(2026, 9, 11, 15, 20) },
    { created_at: local(2026, 9, 12, 9, 5) },
  ];
  const groups = groupByDay(entries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, '2026-09-11');
  assert.equal(groups[0].entries.length, 2);
  assert.equal(groups[1].key, '2026-09-12');
});

test('자정 넘긴 메모는 새 날짜로', () => {
  const groups = groupByDay([
    { created_at: local(2026, 9, 11, 23, 59) },
    { created_at: local(2026, 9, 12, 0, 1) },
  ]);
  assert.deepEqual(groups.map((g) => g.key), ['2026-09-11', '2026-09-12']);
});
