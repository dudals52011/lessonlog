// 로컬 저장소. 상태 전체를 JSON 한 덩어리로 localStorage에 둔다.
import { emptyState } from './core/model.js';

const KEY = 'lessonlog:v1';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    const base = emptyState();
    return {
      ...base,
      ...parsed,
      notes: parsed.notes || {},
      entries: parsed.entries || {},
      pending: { notes: parsed.pending?.notes || [], entries: parsed.pending?.entries || [] },
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('저장 실패', err);
    return false;
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
