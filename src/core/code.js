// 동기화 코드: 혼동 문자(0, O, 1, I, L)를 뺀 31자 집합에서 24자. 4자씩 6묶음으로 표시.
export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 24;
export const GROUP = 4;

function defaultRandom(n) {
  const out = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** 'K7QM-3XPA-...' 형태의 새 코드 */
export function generateCode(randomBytes = defaultRandom) {
  const chars = [];
  while (chars.length < CODE_LENGTH) {
    // 256 % 31 = 8 → 편향을 없애기 위해 248 이상은 버림
    const bytes = randomBytes(CODE_LENGTH);
    for (const b of bytes) {
      if (chars.length >= CODE_LENGTH) break;
      if (b < 248) chars.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return formatCode(chars.join(''));
}

/** 24자 원문 → 4자씩 하이픈 구분 */
export function formatCode(raw) {
  const groups = [];
  for (let i = 0; i < raw.length; i += GROUP) groups.push(raw.slice(i, i + GROUP));
  return groups.join('-');
}

/** 하이픈·공백·소문자 정리. 형식이 맞으면 표준 표기, 아니면 null */
export function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  const raw = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (raw.length !== CODE_LENGTH) return null;
  for (const c of raw) if (!ALPHABET.includes(c)) return null;
  return formatCode(raw);
}

/** 서버에 보낼 원문(하이픈 없음). 서버도 같은 정규화를 거쳐 해시함 */
export function rawCode(formatted) {
  return formatted.replace(/-/g, '');
}
