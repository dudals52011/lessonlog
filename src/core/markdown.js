// 메모 본문용 작은 마크다운 파서. DOM에 의존하지 않고 트리만 만든다 (렌더링은 app.js).
// 지원: 제목(#), 목록(- * 1.), 체크박스(- [ ] / - [x]), 인용(>), 코드 블록(```), 굵게, 기울임, 취소선, 인라인 코드, 링크, URL 자동 링크.
// 한 줄 메모가 대부분이라 문단 안의 줄바꿈은 그대로 <br>로 살린다.

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK_RE = /^\[( |x|X)\]\s+(.*)$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/;

/** 텍스트 → 블록 배열 */
export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // 닫는 ``` (없어도 끝까지 코드로)
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    const h = line.match(HEADING_RE);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, children: parseInline(h[2]) });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', children: parseInline(buf.join('\n')) });
      continue;
    }

    const li = line.match(LIST_RE);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        let body = m[3];
        let checked = null;
        const t = body.match(TASK_RE);
        if (t) {
          checked = t[1] !== ' ';
          body = t[2];
        }
        items.push({ checked, children: parseInline(body) });
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // 문단: 빈 줄이나 다른 블록이 나올 때까지
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) buf.push(lines[i++]);
    blocks.push({ type: 'paragraph', children: parseInline(buf.join('\n')) });
  }
  return blocks;
}

function isBlockStart(line) {
  return /^```/.test(line) || HEADING_RE.test(line) || /^>\s?/.test(line) || LIST_RE.test(line);
}

/** 인라인 텍스트 → 노드 배열. 노드: {type:'text',text} | {type:'code',text} | {type:'strong'|'em'|'del',children} | {type:'link',href,children} | {type:'br'} */
export function parseInline(text) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  const s = text;
  while (i < s.length) {
    const ch = s[i];

    if (ch === '\\' && i + 1 < s.length && /[\\`*_~\[\]()#>-]/.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }

    if (ch === '\n') {
      flush();
      out.push({ type: 'br' });
      i++;
      continue;
    }

    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const m = s.slice(i).match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
      if (m) {
        flush();
        out.push({ type: 'link', href: safeHref(m[2]), children: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }

    if (ch === 'h' && s.startsWith('http', i) && (i === 0 || !/[\w/]/.test(s[i - 1]))) {
      const m = s.slice(i).match(URL_RE);
      if (m && m.index === 0) {
        flush();
        out.push({ type: 'link', href: m[0], children: [{ type: 'text', text: m[0] }] });
        i += m[0].length;
        continue;
      }
    }

    const wrapped = matchDelimited(s, i);
    if (wrapped) {
      flush();
      out.push({ type: wrapped.type, children: parseInline(wrapped.inner) });
      i = wrapped.end;
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

// **굵게** __굵게__ *기울임* _기울임_ ~~취소~~. 여는 기호 뒤·닫는 기호 앞은 공백이 아니어야 한다.
const DELIMS = [
  ['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em'],
];
function matchDelimited(s, i) {
  for (const [d, type] of DELIMS) {
    if (!s.startsWith(d, i)) continue;
    const start = i + d.length;
    if (start >= s.length || /\s/.test(s[start])) continue;
    // _기울임_은 단어 안에서는 적용하지 않는다 (snake_case 보호)
    if (d === '_' && i > 0 && /\w/.test(s[i - 1])) continue;
    let end = s.indexOf(d, start);
    while (end !== -1 && (/\s/.test(s[end - 1]) || (d === '_' && end + 1 < s.length && /\w/.test(s[end + 1])))) {
      end = s.indexOf(d, end + 1);
    }
    if (end === -1 || end === start) continue;
    const inner = s.slice(start, end);
    if (inner.includes('\n')) continue;
    return { type, inner, end: end + d.length };
  }
  return null;
}

function safeHref(href) {
  return /^(https?:|mailto:)/i.test(href) ? href : `https://${href.replace(/^\/+/, '')}`;
}

/** 목록 줄이면 다음 줄에 이어 쓸 마커를 돌려준다. 마커만 있는 빈 항목이면 { clear: true } (마커 제거). */
export function continueListMarker(line) {
  const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
  if (!m) return null;
  const [, indent, marker, task, rest] = m;
  if (rest.trim() === '') return { clear: true, length: line.length };
  let next = marker;
  const n = marker.match(/^(\d+)([.)])$/);
  if (n) next = `${Number(n[1]) + 1}${n[2]}`;
  return { marker: `${indent}${next} ${task ? '[ ] ' : ''}` };
}

/** 서식이 하나라도 있으면 true (미리보기를 띄울지 판단) */
export function hasFormatting(blocks) {
  const inlineHas = (nodes) => nodes.some((n) => n.type !== 'text' && n.type !== 'br');
  return blocks.some((b) => b.type !== 'paragraph' || inlineHas(b.children));
}

/** 렌더링 없이 평문만 필요할 때 (목록 미리보기 등) */
export function plainText(blocks) {
  const inline = (nodes) => nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.text : n.type === 'br' ? '\n' : inline(n.children || []))).join('');
  return blocks
    .map((b) => (b.type === 'code' ? b.text : b.type === 'list' ? b.items.map((it) => inline(it.children)).join('\n') : inline(b.children)))
    .join('\n');
}
