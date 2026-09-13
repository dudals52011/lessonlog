// 노트 복사 형식 (마크다운)
import { formatCopyDay, formatTime, groupByDay } from './dates.js';
import { UNTITLED, notePeriod } from './model.js';

/**
 * # 제목 (또는 # 제목 없음 (YYYY-MM-DD ~ YYYY-MM-DD))
 *
 * ## 2026-09-11 (목)
 * - 10:42 첫 줄
 *   이어지는 줄은 공백 2칸 들여쓰기
 */
export function noteToMarkdown(note, entries) {
  const lines = [];
  const title = note?.title?.trim();
  if (title) {
    lines.push(`# ${title}`);
  } else {
    const p = notePeriod(entries);
    lines.push(p ? `# ${UNTITLED} (${p.from} ~ ${p.to})` : `# ${UNTITLED}`);
  }
  for (const group of groupByDay(entries)) {
    lines.push('');
    lines.push(`## ${formatCopyDay(group.key)}`);
    for (const e of group.entries) {
      const [first, ...rest] = e.body.split(/\r?\n/);
      lines.push(`- ${formatTime(e.created_at)} ${first}`);
      for (const r of rest) lines.push(`  ${r}`);
    }
  }
  return lines.join('\n');
}
