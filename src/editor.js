// 라이브 서식 입력창. contenteditable 위에 원문(마크다운)을 그대로 두고 조각별로 클래스만 입힌다.
// 모델은 문자열 value 하나. 브라우저가 DOM을 바꾸면(input) 텍스트를 다시 읽어 value로 삼고 새로 그린 뒤 커서를 복원한다.
// 한글 IME 조합 중(isComposing)에는 다시 그리지 않는다 — 조합이 끝나는 순간 한 번에 반영.
import { tokenizeMarkdown, continueListMarker } from './core/markdown.js';

export function createEditor(el, { onInput, onSubmit, submitOnEnter } = {}) {
  let value = '';
  let composing = false;
  const undo = [];
  const redo = [];
  let lastSnapshotAt = 0;

  el.contentEditable = 'true';
  el.spellcheck = false;
  el.classList.add('editor');

  // ---------- 커서 (문자 오프셋 기준)

  function selection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return { start: value.length, end: value.length };
    const r = sel.getRangeAt(0);
    const toOffset = (node, offset) => {
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(node, offset);
      return serialize(pre.cloneContents()).length;
    };
    const start = toOffset(r.startContainer, r.startOffset);
    const end = r.collapsed ? start : toOffset(r.endContainer, r.endOffset);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function setSelection(start, end = start) {
    // 줄마다 <div class="ln">이고 줄 사이가 '\n' 한 글자. 빈 줄은 <br>만 있어 div 자체에 커서를 둔다.
    const find = (target) => {
      const lines = [...el.children];
      if (!lines.length) return { node: el, offset: 0 };
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) acc += 1;
        const div = lines[i];
        const texts = [];
        const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) texts.push(n);
        const len = texts.reduce((sum, t) => sum + t.nodeValue.length, 0);
        if (target <= acc + len) {
          let off = target - acc;
          for (const t of texts) {
            if (off <= t.nodeValue.length) return { node: t, offset: off };
            off -= t.nodeValue.length;
          }
          return { node: div, offset: 0 };
        }
        acc += len;
      }
      const lastDiv = lines[lines.length - 1];
      const lastText = [...lastDiv.childNodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE) || null;
      return lastText ? { node: lastText, offset: lastText.nodeValue.length } : { node: lastDiv, offset: 0 };
    };
    const a = find(Math.max(0, Math.min(start, value.length)));
    const b = find(Math.max(0, Math.min(end, value.length)));
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- DOM ↔ 문자열

  // 줄은 <div class="ln">, 줄 사이는 '\n'. div 안의 마지막 <br>은 빈 줄을 그리기 위한 것이라 글자로 세지 않는다.
  // 브라우저가 끼워 넣는 다른 <br>/<div>도 줄바꿈으로 읽는다.
  function serialize(root) {
    let out = '';
    let lineIndex = 0;
    const inline = (node) => {
      const kids = [...node.childNodes];
      kids.forEach((child, i) => {
        if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue;
        else if (child.nodeName === 'BR') { if (i < kids.length - 1) out += '\n'; }
        else if (/^(DIV|P)$/.test(child.nodeName)) block(child);
        else inline(child);
      });
    };
    const block = (div) => {
      if (lineIndex > 0) out += '\n';
      lineIndex++;
      inline(div);
    };
    for (const child of root.childNodes) {
      if (/^(DIV|P)$/.test(child.nodeName)) block(child);
      else if (child.nodeType === Node.TEXT_NODE) { if (lineIndex === 0) lineIndex = 1; out += child.nodeValue; }
      else if (child.nodeName === 'BR') out += '\n';
      else { if (lineIndex === 0) lineIndex = 1; inline(child); }
    }
    return out;
  }

  function render() {
    const frag = document.createDocumentFragment();
    if (value !== '') {
      for (const line of tokenizeMarkdown(value)) {
        const div = document.createElement('div');
        div.className = line.cls ? `ln ${line.cls}` : 'ln';
        const hasText = line.tokens.some((t) => t.text.length);
        if (hasText) for (const t of line.tokens) div.append(tokenNode(t));
        else div.append(document.createElement('br'));
        frag.append(div);
      }
    }
    el.replaceChildren(frag);
    el.classList.toggle('is-empty', value === '');
  }

  function tokenNode(t) {
    if (!t.classes.length) return document.createTextNode(t.text);
    const s = document.createElement('span');
    s.className = t.classes.join(' ');
    s.textContent = t.text;
    return s;
  }

  // ---------- 값 변경

  function snapshot(sel, force = false) {
    const now = Date.now();
    if (force || now - lastSnapshotAt > 600 || !undo.length) undo.push({ value, sel });
    if (undo.length > 200) undo.shift();
    lastSnapshotAt = force ? 0 : now;
    redo.length = 0;
  }

  function set(next, sel, { silent = false, record = true } = {}) {
    if (record && next !== value) snapshot(selection(), true);
    value = next;
    render();
    if (sel) setSelection(sel.start, sel.end);
    if (!silent) onInput?.(value);
  }

  function replaceRange(start, end, text, caret = 'end') {
    const next = value.slice(0, start) + text + value.slice(end);
    const pos = caret === 'select' ? { start, end: start + text.length } : { start: start + text.length, end: start + text.length };
    set(next, pos);
  }

  function insertNewline() {
    const { start, end } = selection();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const line = value.slice(lineStart, start);
    const c = continueListMarker(line);
    if (c?.clear) return replaceRange(lineStart, end, '');
    replaceRange(start, end, `\n${c?.marker ?? ''}`);
  }

  // ---------- 이벤트

  el.addEventListener('compositionstart', () => {
    composing = true;
    el.classList.remove('is-empty'); // 조합 중에는 다시 그리지 않으므로 플레이스홀더만 먼저 걷어낸다
  });
  el.addEventListener('compositionend', () => {
    composing = false;
    syncFromDom();
  });

  function syncFromDom() {
    const next = serialize(el);
    const sel = selection();
    if (next === value) {
      // 브라우저가 구조만 바꾼 경우(예: <br> 삽입)도 있으니 다시 그린다
      render();
      setSelection(sel.start, sel.end);
      return;
    }
    snapshot(sel);
    value = next;
    render();
    setSelection(sel.start, sel.end);
    onInput?.(value);
  }

  el.addEventListener('beforeinput', (e) => {
    if (e.isComposing) return;
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      e.preventDefault();
      insertNewline();
    } else if (e.inputType === 'historyUndo') {
      e.preventDefault();
      doUndo();
    } else if (e.inputType === 'historyRedo') {
      e.preventDefault();
      doRedo();
    }
  });

  el.addEventListener('input', (e) => {
    if (composing || e.isComposing) {
      el.classList.toggle('is-empty', serialize(el) === '');
      return;
    }
    syncFromDom();
  });

  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    const { start, end } = selection();
    replaceRange(start, end, text.replace(/\r\n?/g, '\n'));
  });

  el.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !e.shiftKey && submitOnEnter?.()) {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo(); return; }
      const wrap = { b: '**', i: '_', e: '`' }[k];
      if (wrap) {
        e.preventDefault();
        toggleWrap(wrap);
      }
    }
  });

  function toggleWrap(mark) {
    const { start, end } = selection();
    const inner = value.slice(start, end);
    const before = value.slice(Math.max(0, start - mark.length), start);
    const after = value.slice(end, end + mark.length);
    if (before === mark && after === mark) {
      const next = value.slice(0, start - mark.length) + inner + value.slice(end + mark.length);
      set(next, { start: start - mark.length, end: end - mark.length });
    } else {
      const next = value.slice(0, start) + mark + inner + mark + value.slice(end);
      set(next, { start: start + mark.length, end: end + mark.length });
    }
  }

  function doUndo() {
    if (!undo.length) return;
    redo.push({ value, sel: selection() });
    const prev = undo.pop();
    set(prev.value, prev.sel, { record: false });
  }

  function doRedo() {
    if (!redo.length) return;
    undo.push({ value, sel: selection() });
    const next = redo.pop();
    set(next.value, next.sel, { record: false });
  }

  render();

  return {
    get value() { return value; },
    set value(v) { set(String(v ?? ''), null, { silent: true, record: false }); undo.length = 0; redo.length = 0; },
    focus(opts) { el.focus(opts); },
    blur() { el.blur(); },
    selection,
    setSelection,
    replaceRange,
    element: el,
  };
}
