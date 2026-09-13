import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALPHABET, generateCode, normalizeCode, rawCode, formatCode } from '../src/core/code.js';

test('알파벳은 혼동 문자(0 O 1 I L)가 없는 31자', () => {
  assert.equal(ALPHABET.length, 31);
  for (const c of '0O1IL') assert.ok(!ALPHABET.includes(c), `${c} 포함됨`);
});

test('생성된 코드는 XXXX-XXXX-XXXX-XXXX-XXXX-XXXX 형식', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateCode();
    assert.match(code, /^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    for (const c of rawCode(code)) assert.ok(ALPHABET.includes(c));
  }
});

test('생성은 편향 제거 후에도 24자를 채운다 (거절 바이트만 주는 난수)', () => {
  let calls = 0;
  const rng = (n) => {
    calls++;
    // 첫 호출은 전부 거절(255), 두 번째부터 정상
    return new Uint8Array(n).fill(calls === 1 ? 255 : 7);
  };
  const code = generateCode(rng);
  assert.equal(rawCode(code).length, 24);
  assert.equal(rawCode(code), 'H'.repeat(24));
});

test('정규화: 소문자·공백·하이픈 무시, 표준 표기로', () => {
  const code = generateCode();
  const messy = rawCode(code).toLowerCase().split('').join(' ');
  assert.equal(normalizeCode(messy), code);
  assert.equal(normalizeCode(rawCode(code)), code);
});

test('정규화: 길이·문자 집합이 틀리면 null', () => {
  assert.equal(normalizeCode('ABCD'), null);
  assert.equal(normalizeCode('0'.repeat(24)), null); // 0은 알파벳 밖
  assert.equal(normalizeCode(null), null);
});

test('formatCode는 4자씩 묶음', () => {
  assert.equal(formatCode('ABCDEFGHJKMNPQRSTUVWXYZ2'), 'ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2');
});
