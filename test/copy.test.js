import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteToMarkdown } from '../src/core/copy.js';

const at = (d, hh, mm) => new Date(2026, 8, d, hh, mm).toISOString();

test('제목 + 날짜 헤더 + 시각 불릿', () => {
  const md = noteToMarkdown({ title: '9월 2주차' }, [
    { body: '스프린트 회고에서 액션아이템에 담당자 안 붙이면 아무도 안 함', created_at: at(11, 10, 42) },
    { body: '디자이너한테 먼저 제약조건부터 말하니까 왕복이 줄었음', created_at: at(11, 15, 20) },
    { body: '정책 문서에 예외 케이스 표 넣기', created_at: at(12, 9, 5) },
  ]);
  assert.equal(md, [
    '# 9월 2주차',
    '',
    '## 2026-09-11 (금)',
    '- 10:42 스프린트 회고에서 액션아이템에 담당자 안 붙이면 아무도 안 함',
    '- 15:20 디자이너한테 먼저 제약조건부터 말하니까 왕복이 줄었음',
    '',
    '## 2026-09-12 (토)',
    '- 09:05 정책 문서에 예외 케이스 표 넣기',
  ].join('\n'));
});

test('제목 없으면 기간을 붙인다', () => {
  const md = noteToMarkdown({ title: null }, [
    { body: 'a', created_at: at(8, 9, 0) },
    { body: 'b', created_at: at(12, 9, 0) },
  ]);
  assert.ok(md.startsWith('# 제목 없음 (2026-09-08 ~ 2026-09-12)'));
});

test('여러 줄 메모는 공백 2칸 들여쓰기로 이어 붙인다', () => {
  const md = noteToMarkdown({ title: 't' }, [
    { body: '첫 줄\n둘째 줄\n셋째 줄', created_at: at(11, 10, 0) },
  ]);
  assert.equal(md.split('\n').slice(-3).join('\n'), '- 10:00 첫 줄\n  둘째 줄\n  셋째 줄');
});

test('메모 0개면 제목만', () => {
  assert.equal(noteToMarkdown({ title: null }, []), '# 제목 없음');
});
