// 활동 대시보드용 통계. 순수 함수만 (DOM 없음). 날짜는 모두 기기 로컬 기준 'YYYY-MM-DD' 키.
import { dayKey } from './dates.js';

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

/** 살아 있는 항목들 → { 'YYYY-MM-DD': 개수 } */
export function dailyCounts(entries) {
  const counts = {};
  for (const e of entries) {
    const k = dayKey(e.created_at);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

/** 개수 → 0~4 단계. 최대치 기준 4등분 (깃허브 잔디와 같은 방식) */
export function level(count, max) {
  if (!count) return 0;
  if (max <= 1) return 4;
  return Math.max(1, Math.min(4, Math.ceil((count / max) * 4)));
}

/**
 * 잔디 격자. 오늘이 맨 오른쪽 열의 어딘가에 오도록 weeks주치를 만든다.
 * 열 = 주(일요일 시작), 행 = 요일(0 일 ~ 6 토). 오늘 이후 칸은 future: true.
 * 반환: { weeks: [[{ key, count, level, future }×7]…], max, months: [{ col, label }] }
 */
export function heatmap(counts, { weeks = 20, today = dayKey(new Date()) } = {}) {
  const [ty, tm, td] = today.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const lastSunday = addDays(today, -todayDate.getDay());
  const firstSunday = addDays(lastSunday, -(weeks - 1) * 7);
  let max = 0;
  const grid = [];
  const months = [];
  let lastMonth = null;
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const key = addDays(firstSunday, w * 7 + d);
      const count = counts[key] || 0;
      const future = key > today;
      if (!future && count > max) max = count;
      col.push({ key, count, future });
      const month = Number(key.slice(5, 7));
      if (d === 0 && month !== lastMonth) {
        // 바로 앞 라벨과 2열 미만으로 붙으면 앞 라벨을 버린다 (글자가 겹치니까)
        const prev = months[months.length - 1];
        if (prev && w - prev.col < 2) months.pop();
        months.push({ col: w, label: `${month}월` });
        lastMonth = month;
      }
    }
    grid.push(col);
  }
  for (const col of grid) for (const cell of col) cell.level = cell.future ? 0 : level(cell.count, max);
  return { weeks: grid, max, months, from: firstSunday, to: addDays(lastSunday, 6) };
}

/** 연속 기록. current: 오늘(또는 오늘 아직 안 썼으면 어제)까지 이어진 일수. longest: 역대 최장 */
export function streaks(counts, today = dayKey(new Date())) {
  const days = Object.keys(counts).filter((k) => counts[k] > 0).sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const k of days) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = k;
  }
  let current = 0;
  let cursor = counts[today] > 0 ? today : addDays(today, -1);
  while (counts[cursor] > 0) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest, activeDays: days.length };
}

/** 요약 수치 */
export function summary(entries, today = dayKey(new Date())) {
  const counts = dailyCounts(entries);
  const { current, longest, activeDays } = streaks(counts, today);
  const weekStart = addDays(today, -6);
  let thisWeek = 0;
  for (let i = 0; i < 7; i++) thisWeek += counts[addDays(weekStart, i)] || 0;
  return { total: entries.length, activeDays, current, longest, thisWeek, counts };
}
