// 날짜·시각 표기. 모두 기기 로컬 시간 기준.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(v);
}

/** ISO 문자열 → 로컬 날짜 키 'YYYY-MM-DD' */
export function dayKey(iso) {
  const d = toDate(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function weekday(v) {
  return WEEKDAYS[toDate(v).getDay()];
}

/** 화면용 날짜 헤더: '9월 11일 (목)' */
export function formatDayHeader(key) {
  const d = toDate(key);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday(d)})`;
}

/** 복사본용 날짜 헤더: '2026-09-11 (목)' */
export function formatCopyDay(key) {
  return `${dayKey(key)} (${weekday(key)})`;
}

/** 목록용 짧은 날짜: '9/11' */
export function formatShortDay(key) {
  const d = toDate(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 'HH:MM' */
export function formatTime(iso) {
  const d = toDate(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 시간순 항목 배열 → [{ key, entries }] (날짜별 묶음, 입력 순서 유지) */
export function groupByDay(entries) {
  const groups = [];
  let current = null;
  for (const e of entries) {
    const key = dayKey(e.created_at);
    if (!current || current.key !== key) {
      current = { key, entries: [] };
      groups.push(current);
    }
    current.entries.push(e);
  }
  return groups;
}
