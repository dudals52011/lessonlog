import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, continueListMarker, plainText, hasFormatting } from '../src/core/markdown.js';

test('평문은 문단 하나', () => {
  const b = parseMarkdown('그냥 한 줄');
  assert.deepEqual(b, [{ type: 'paragraph', children: [{ type: 'text', text: '그냥 한 줄' }] }]);
});

test('문단 안 줄바꿈은 br로 살린다', () => {
  const b = parseMarkdown('첫 줄\n둘째 줄');
  assert.deepEqual(b[0].children.map((n) => n.type), ['text', 'br', 'text']);
});

test('굵게·기울임·취소·코드', () => {
  assert.deepEqual(parseInline('**굵게** *기울임* ~~취소~~ `코드`').filter((n) => n.type !== 'text').map((n) => n.type), ['strong', 'em', 'del', 'code']);
  assert.deepEqual(parseInline('**굵게**')[0], { type: 'strong', children: [{ type: 'text', text: '굵게' }] });
});

test('snake_case와 곱셈 기호는 서식으로 보지 않는다', () => {
  assert.deepEqual(parseInline('user_id와 max_len'), [{ type: 'text', text: 'user_id와 max_len' }]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ type: 'text', text: '2 * 3 * 4' }]);
  assert.deepEqual(parseInline('a ** b'), [{ type: 'text', text: 'a ** b' }]);
});

test('링크와 URL 자동 링크', () => {
  const l = parseInline('[문서](https://example.com/a) 참고');
  assert.equal(l[0].type, 'link');
  assert.equal(l[0].href, 'https://example.com/a');
  const u = parseInline('참고: https://example.com/path?q=1. 끝');
  assert.equal(u[1].type, 'link');
  assert.equal(u[1].href, 'https://example.com/path?q=1');
  assert.equal(u[2].text, '. 끝');
  assert.match(parseInline('[x](javascript:alert(1))')[0].href, /^https:\/\//);
});

test('역슬래시로 서식 기호를 그대로 쓴다', () => {
  assert.deepEqual(parseInline('\\*별표\\*'), [{ type: 'text', text: '*별표*' }]);
});

test('목록·체크박스·번호 목록', () => {
  const b = parseMarkdown('- 하나\n- [ ] 할 일\n- [x] 끝난 일\n\n1. 첫째\n2. 둘째');
  assert.equal(b.length, 2);
  assert.equal(b[0].type, 'list');
  assert.equal(b[0].ordered, false);
  assert.deepEqual(b[0].items.map((i) => i.checked), [null, false, true]);
  assert.equal(b[1].ordered, true);
  assert.equal(b[1].items.length, 2);
});

test('제목·인용·코드 블록', () => {
  const b = parseMarkdown('## 제목\n> 인용\n> 둘째\n```\ncode **x**\n```');
  assert.equal(b[0].type, 'heading');
  assert.equal(b[0].level, 2);
  assert.equal(b[1].type, 'quote');
  assert.equal(b[2].type, 'code');
  assert.equal(b[2].text, 'code **x**');
});

test('문단 바로 뒤에 목록이 오면 나뉜다', () => {
  const b = parseMarkdown('설명\n- 항목');
  assert.deepEqual(b.map((x) => x.type), ['paragraph', 'list']);
});

test('목록 마커 이어 쓰기', () => {
  assert.deepEqual(continueListMarker('- 하나'), { marker: '- ' });
  assert.deepEqual(continueListMarker('  * 들여쓴 것'), { marker: '  * ' });
  assert.deepEqual(continueListMarker('3. 셋'), { marker: '4. ' });
  assert.deepEqual(continueListMarker('- [x] 끝'), { marker: '- [ ] ' });
  assert.deepEqual(continueListMarker('- '), { clear: true, length: 2 });
  assert.deepEqual(continueListMarker('- [ ] '), { clear: true, length: 6 });
  assert.equal(continueListMarker('평문'), null);
});

test('plainText는 서식을 벗긴다', () => {
  assert.equal(plainText(parseMarkdown('**a** `b`\n- c')), 'a b\nc');
});

test('hasFormatting은 평문·줄바꿈만 있으면 false', () => {
  assert.equal(hasFormatting(parseMarkdown('그냥 글\n둘째 줄')), false);
  assert.equal(hasFormatting(parseMarkdown('**굵게**')), true);
  assert.equal(hasFormatting(parseMarkdown('- 목록')), true);
  assert.equal(hasFormatting(parseMarkdown('https://a.b')), true);
});
