import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyCounts, level, heatmap, streaks, summary } from '../src/core/stats.js';

function local(y, m, d, hh = 9) {
  return new Date(y, m - 1, d, hh, 0).toISOString();
}
const e = (y, m, d, hh) => ({ created_at: local(y, m, d, hh) });

test('dailyCounts는 로컬 날짜별 개수', () => {
  const c = dailyCounts([e(2026, 9, 11, 10), e(2026, 9, 11, 23), e(2026, 9, 12, 0)]);
  assert.deepEqual(c, { '2026-09-11': 2, '2026-09-12': 1 });
});

test('level은 최대치 기준 4단계', () => {
  assert.equal(level(0, 8), 0);
  assert.equal(level(1, 8), 1);
  assert.equal(level(4, 8), 2);
  assert.equal(level(8, 8), 4);
  assert.equal(level(1, 1), 4);
  assert.equal(level(3, 3), 4);
});

test('heatmap은 주 단위 열, 오늘이 마지막 열에 포함', () => {
  const counts = { '2026-09-12': 3, '2026-09-14': 1 };
  const h = heatmap(counts, { weeks: 4, today: '2026-09-14' }); // 월요일
  assert.equal(h.weeks.length, 4);
  assert.equal(h.weeks[3][0].key, '2026-09-13'); // 마지막 열은 일요일 9/13부터
  assert.equal(h.weeks[3][1].key, '2026-09-14');
  assert.equal(h.weeks[3][1].count, 1);
  assert.equal(h.weeks[3][2].future, true);
  assert.equal(h.weeks[3][2].level, 0);
  assert.equal(h.max, 3);
  assert.equal(h.weeks[2][6].key, '2026-09-12');
  assert.equal(h.weeks[2][6].level, 4);
  assert.equal(h.weeks[3][1].level, 2); // ceil(1/3*4)=2
  assert.equal(h.from, '2026-08-23');
});

test('heatmap 월 라벨은 달이 바뀌는 열에', () => {
  const h = heatmap({}, { weeks: 6, today: '2026-09-14' });
  assert.deepEqual(h.months, [{ col: 0, label: '8월' }, { col: 4, label: '9월' }]);
});

test('heatmap 첫 열 라벨이 다음 달 라벨과 붙으면 생략', () => {
  // 2026-09-27(일)부터 시작하면 첫 열 9월, 둘째 열 10월 → 9월 생략
  const h = heatmap({}, { weeks: 3, today: '2026-10-13' });
  assert.equal(h.from, '2026-09-27');
  assert.deepEqual(h.months, [{ col: 1, label: '10월' }]);
});

test('streaks: 현재 연속은 오늘 안 썼으면 어제까지로 센다', () => {
  const counts = { '2026-09-10': 1, '2026-09-11': 2, '2026-09-12': 1, '2026-09-05': 1, '2026-09-06': 1 };
  assert.deepEqual(streaks(counts, '2026-09-12'), { current: 3, longest: 3, activeDays: 5 });
  assert.deepEqual(streaks(counts, '2026-09-13'), { current: 3, longest: 3, activeDays: 5 });
  assert.deepEqual(streaks(counts, '2026-09-14'), { current: 0, longest: 3, activeDays: 5 });
  assert.deepEqual(streaks({}, '2026-09-14'), { current: 0, longest: 0, activeDays: 0 });
});

test('summary: 최근 7일 합계와 총합', () => {
  const s = summary([e(2026, 9, 8), e(2026, 9, 8), e(2026, 9, 14), e(2026, 8, 1)], '2026-09-14');
  assert.equal(s.total, 4);
  assert.equal(s.thisWeek, 3); // 9/8~9/14
  assert.equal(s.activeDays, 3);
  assert.equal(s.current, 1);
});
