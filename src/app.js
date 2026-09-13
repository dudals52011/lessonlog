// 화면 컨트롤러. 상태(state)는 model.js 연산으로만 바꾸고, 바꾼 뒤 save → render → sync.schedule 순서를 지킨다.
import { APP_VERSION, WIDE_BREAKPOINT, TOAST_MS } from './config.js';
import { loadState, saveState, clearState } from './store.js';
import { createSyncer, api } from './sync.js';
import { generateCode, normalizeCode } from './core/code.js';
import { noteToMarkdown } from './core/copy.js';
import { formatDayHeader, formatShortDay, formatTime, groupByDay } from './core/dates.js';
import {
  addNote, openNote, setTitle, deleteNote, addEntry, editEntry, deleteEntry, restoreEntry,
  liveNotes, liveEntries, notePeriod, homeNoteId, displayTitle, pendingCount, exportData,
} from './core/model.js';

const $ = (id) => document.getElementById(id);
const isWide = () => window.innerWidth >= WIDE_BREAKPOINT;
const nowIso = () => new Date().toISOString();

let state = loadState();
let currentNoteId = null;
let editingEntryId = null;
let selectedEntryId = null;
let issuedCode = null;
let codeVisible = false;

const els = {
  body: document.body,
  screens: {
    start: $('screen-start'), issue: $('screen-issue'), enter: $('screen-enter'),
    settings: $('screen-settings'), app: $('screen-app'),
  },
  noteList: $('note-list'),
  title: $('note-title'), titleInput: $('note-title-input'), titleDone: $('btn-title-done'),
  noteMenu: $('btn-note-menu'), statusLine: $('status-line'), banner: $('install-banner'),
  entries: $('entries'), composer: $('composer'), send: $('btn-send'), editBar: $('edit-bar'),
  popover: $('popover'), scrim: $('scrim'), dialog: $('dialog'),
  toast: $('toast'), toastText: $('toast-text'), toastAction: $('toast-action'),
};

// ---------- 저장 · 동기화

function save() {
  saveState(state);
}

const syncer = createSyncer({
  getState: () => state,
  save,
  onChange: () => {
    if (currentNoteId && (!state.notes[currentNoteId] || state.notes[currentNoteId].deleted_at)) {
      currentNoteId = homeNoteId(state);
    }
    if (!currentNoteId) ensureNote();
    renderAll();
  },
  onStatus: renderStatus,
});

function commit({ sync = true } = {}) {
  save();
  renderAll();
  if (sync) syncer.schedule();
}

// ---------- 화면 전환

function showScreen(name) {
  for (const [k, el] of Object.entries(els.screens)) el.hidden = k !== name;
  els.body.dataset.screen = name;
  closePopover();
}

function showPanel(panel) {
  els.body.dataset.panel = panel;
  if (panel === 'note' && !isWide()) queueMicrotask(() => els.composer.focus({ preventScroll: true }));
}

// ---------- 렌더링

function renderAll() {
  renderNoteList();
  renderNote();
  renderStatus(syncer.status);
}

function renderNoteList() {
  const notes = liveNotes(state);
  els.noteList.innerHTML = '';
  for (const n of notes) {
    const entries = liveEntries(state, n.id);
    const p = notePeriod(entries);
    const period = p ? (p.from === p.to ? formatShortDay(p.from) : `${formatShortDay(p.from)} ~ ${formatShortDay(p.to)}`) : formatShortDay(n.created_at);
    const li = document.createElement('li');
    if (n.id === currentNoteId) li.className = 'current';
    const btn = document.createElement('button');
    btn.type = 'button';
    const name = document.createElement('div');
    name.className = 'n' + (n.title ? '' : ' untitled');
    name.textContent = displayTitle(n);
    const meta = document.createElement('div');
    meta.className = 'm';
    meta.textContent = `${period} · 메모 ${entries.length}개${n.id === currentNoteId ? ' · 지금 열려 있음' : ''}`;
    btn.append(name, meta);
    btn.addEventListener('click', () => selectNote(n.id));
    li.append(btn);
    els.noteList.append(li);
  }
}

function renderNote() {
  const note = state.notes[currentNoteId];
  if (!note) return;
  const untitled = !note.title;
  els.title.textContent = displayTitle(note);
  els.title.classList.toggle('untitled', untitled);
  els.banner.hidden = state.bannerDismissed || isWide() || isStandalone();

  const entries = liveEntries(state, currentNoteId);
  const wasAtBottom = els.entries.scrollHeight - els.entries.scrollTop - els.entries.clientHeight < 40;
  els.entries.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'entries-inner';
  if (!entries.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.innerHTML = '아직 메모가 없어요<br><span class="small">위 제목을 탭하면 이름을 붙일 수 있고,<br>아래에 바로 적어도 돼요</span>';
    inner.append(hint);
  }
  for (const group of groupByDay(entries)) {
    const head = document.createElement('div');
    head.className = 'day-head';
    head.textContent = formatDayHeader(group.key);
    inner.append(head);
    for (const e of group.entries) inner.append(renderEntry(e));
  }
  els.entries.append(inner);
  if (wasAtBottom) els.entries.scrollTop = els.entries.scrollHeight;
}

function renderEntry(e) {
  const row = document.createElement('div');
  row.className = 'entry' + (e.id === selectedEntryId || e.id === editingEntryId ? ' selected' : '');
  row.dataset.id = e.id;
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = formatTime(e.created_at);
  const b = document.createElement('span');
  b.className = 'b';
  b.textContent = e.body;
  const more = document.createElement('button');
  more.className = 'icon-btn more';
  more.type = 'button';
  more.setAttribute('aria-label', '항목 메뉴');
  more.textContent = '⋯';
  more.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openEntryMenu(e.id, more);
  });
  row.append(t, b, more);

  // 좁은 화면: 길게 누르기. 넓은 화면: 우클릭도 지원
  let pressTimer = null;
  const start = (ev) => {
    if (isWide()) return;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (navigator.vibrate) navigator.vibrate(10);
      openEntryMenu(e.id, row, ev.touches?.[0]);
    }, 500);
  };
  const cancel = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };
  row.addEventListener('touchstart', start, { passive: true });
  row.addEventListener('touchmove', cancel, { passive: true });
  row.addEventListener('touchend', cancel);
  row.addEventListener('touchcancel', cancel);
  row.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    openEntryMenu(e.id, row, ev);
  });
  return row;
}

function renderStatus(status) {
  const offlinePending = !navigator.onLine && pendingCount(state) > 0;
  if (offlinePending || status === 'offline') els.statusLine.textContent = '동기화 대기 중';
  else if (status === 'error') els.statusLine.textContent = '동기화 실패 · 다시 시도 중';
  else els.statusLine.textContent = '';
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

// ---------- 노트 조작

function ensureNote() {
  if (!homeNoteId(state)) {
    const n = addNote(state, nowIso());
    currentNoteId = n.id;
    save();
  }
}

function selectNote(id) {
  if (!state.notes[id] || state.notes[id].deleted_at) return;
  currentNoteId = id;
  openNote(state, id, nowIso());
  cancelEdit();
  showPanel('note');
  commit();
  els.entries.scrollTop = els.entries.scrollHeight;
}

function newNote() {
  const n = addNote(state, nowIso());
  selectNote(n.id);
}

function startTitleEdit() {
  const note = state.notes[currentNoteId];
  els.titleInput.value = note.title || '';
  els.title.hidden = true;
  els.titleInput.hidden = false;
  els.noteMenu.hidden = true;
  els.titleDone.hidden = false;
  els.titleInput.focus();
  els.titleInput.select();
}

function finishTitleEdit(commitValue = true) {
  if (els.titleInput.hidden) return;
  if (commitValue) setTitle(state, currentNoteId, els.titleInput.value, nowIso());
  els.title.hidden = false;
  els.titleInput.hidden = true;
  els.noteMenu.hidden = false;
  els.titleDone.hidden = true;
  commit();
}

function openNoteMenu() {
  const entries = liveEntries(state, currentNoteId);
  openPopover(els.noteMenu, [
    { label: '노트 복사', disabled: entries.length === 0, onClick: copyNote },
    { label: '노트 삭제', danger: true, onClick: confirmDeleteNote },
  ]);
}

async function copyNote() {
  const note = state.notes[currentNoteId];
  const md = noteToMarkdown(note, liveEntries(state, currentNoteId));
  const ok = await writeClipboard(md);
  if (ok) {
    showToast('노트를 복사했어요', { label: '새 노트 만들기', onClick: newNote });
  } else {
    showDialog({
      title: '복사가 막혀 있어요',
      body: () => {
        const ta = document.createElement('textarea');
        ta.value = md;
        ta.readOnly = true;
        queueMicrotask(() => { ta.focus(); ta.select(); });
        return ta;
      },
      actions: [{ label: '닫기' }],
    });
  }
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function confirmDeleteNote() {
  const note = state.notes[currentNoteId];
  const count = liveEntries(state, currentNoteId).length;
  showDialog({
    title: `"${displayTitle(note)}"를 삭제할까요?`,
    body: `메모 ${count}개가 함께 삭제되고 되돌릴 수 없어요.`,
    actions: [
      { label: '삭제', danger: true, onClick: () => {
        deleteNote(state, currentNoteId, nowIso());
        currentNoteId = homeNoteId(state);
        ensureNote();
        cancelEdit();
        commit();
      } },
      { label: '취소' },
    ],
  });
}

// ---------- 항목 조작

function openEntryMenu(id, anchor, point) {
  selectedEntryId = id;
  renderNote();
  const el = els.entries.querySelector(`.entry[data-id="${id}"]`) || anchor;
  openPopover(el, [
    { label: '수정', onClick: () => startEdit(id) },
    { label: '삭제', danger: true, onClick: () => removeEntry(id) },
  ], point, () => {
    selectedEntryId = null;
    renderNote();
  });
}

function startEdit(id) {
  const e = state.entries[id];
  if (!e) return;
  editingEntryId = id;
  selectedEntryId = null;
  els.composer.value = e.body;
  els.editBar.hidden = false;
  autosize();
  renderNote();
  els.composer.focus();
  els.composer.setSelectionRange(els.composer.value.length, els.composer.value.length);
}

function cancelEdit() {
  if (!editingEntryId) return;
  editingEntryId = null;
  els.composer.value = '';
  els.editBar.hidden = true;
  autosize();
  renderNote();
}

function submitComposer() {
  const text = els.composer.value;
  if (!text.trim()) return;
  if (editingEntryId) {
    editEntry(state, editingEntryId, text, nowIso());
    editingEntryId = null;
    els.editBar.hidden = true;
  } else {
    addEntry(state, currentNoteId, text, nowIso());
  }
  els.composer.value = '';
  autosize();
  commit();
  els.entries.scrollTop = els.entries.scrollHeight;
  els.composer.focus();
}

function removeEntry(id) {
  if (editingEntryId === id) cancelEdit();
  deleteEntry(state, id, nowIso());
  commit();
  showToast('메모를 삭제했어요', {
    label: '실행 취소',
    onClick: () => {
      restoreEntry(state, id, nowIso());
      commit();
    },
  });
}

function autosize() {
  const ta = els.composer;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.4)}px`;
  els.send.disabled = !ta.value.trim();
}

// ---------- 공용 UI: 팝오버 / 다이얼로그 / 토스트

let popoverCleanup = null;

function openPopover(anchor, items, point, onClose) {
  closePopover();
  const pop = els.popover;
  pop.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    if (it.danger) b.classList.add('danger');
    if (it.disabled) b.disabled = true;
    b.addEventListener('click', () => {
      closePopover();
      it.onClick?.();
    });
    pop.append(b);
  }
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let x = point ? point.clientX : r.right - w;
  let y = point ? point.clientY : r.bottom + 4;
  x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 4);
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;

  const onDown = (ev) => {
    if (!pop.contains(ev.target)) closePopover();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') closePopover();
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
  }, 0);
  popoverCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
}

function closePopover() {
  if (els.popover.hidden) return;
  els.popover.hidden = true;
  const c = popoverCleanup;
  popoverCleanup = null;
  c?.();
}

function showDialog({ title, body, actions }) {
  $('dialog-title').textContent = title;
  const bodyEl = $('dialog-body');
  bodyEl.innerHTML = '';
  if (typeof body === 'function') bodyEl.append(body());
  else if (body) bodyEl.textContent = body;
  const act = $('dialog-actions');
  act.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (a.danger ? ' btn-danger' : a.primary ? ' btn-primary' : '');
    b.textContent = a.label;
    b.addEventListener('click', () => {
      hideDialog();
      a.onClick?.();
    });
    act.append(b);
  }
  els.scrim.hidden = false;
  els.dialog.hidden = false;
}

function hideDialog() {
  els.scrim.hidden = true;
  els.dialog.hidden = true;
}

let toastTimer = null;
function showToast(text, action) {
  clearTimeout(toastTimer);
  els.toastText.textContent = text;
  if (action) {
    els.toastAction.textContent = action.label;
    els.toastAction.hidden = false;
    els.toastAction.onclick = () => {
      hideToast();
      action.onClick?.();
    };
  } else {
    els.toastAction.hidden = true;
    els.toastAction.onclick = null;
  }
  els.toast.hidden = false;
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  els.toast.hidden = true;
}

// ---------- 첫 실행 · 연결

async function startNew() {
  if (!navigator.onLine) return showToast('처음 시작할 때는 인터넷 연결이 필요해요');
  const btn = $('btn-start-new');
  btn.disabled = true;
  try {
    issuedCode = generateCode();
    const created = await api.createWorkspace(issuedCode);
    if (!created) throw new Error('코드 충돌');
    $('issue-code').textContent = issuedCode;
    showScreen('issue');
  } catch (err) {
    showToast(err.offline ? '인터넷 연결을 확인해 주세요' : '시작에 실패했어요. 잠시 후 다시 시도해 주세요');
  } finally {
    btn.disabled = false;
  }
}

function finishIssue() {
  state.code = issuedCode;
  issuedCode = null;
  ensureNote();
  currentNoteId = homeNoteId(state);
  enterApp();
}

async function connectExisting() {
  const input = $('enter-input');
  const err = $('enter-error');
  const code = normalizeCode(input.value);
  err.hidden = true;
  input.classList.remove('invalid');
  if (!code) {
    err.textContent = '코드 형식이 맞지 않아요. 영문·숫자 24자예요.';
    err.hidden = false;
    input.classList.add('invalid');
    return;
  }
  const btn = $('btn-enter-connect');
  btn.disabled = true;
  btn.textContent = '연결 중...';
  try {
    const exists = await api.workspaceExists(code);
    if (!exists) throw new Error('not found');
    state.code = code;
    state.lastSync = null;
    save();
    await syncer.run();
    ensureNote();
    currentNoteId = homeNoteId(state);
    enterApp();
  } catch (e) {
    err.textContent = e.offline ? '인터넷 연결을 확인해 주세요.' : '코드를 찾을 수 없어요. 다시 확인해 주세요.';
    err.hidden = false;
    input.classList.add('invalid');
    if (!e.offline) state.code = null;
  } finally {
    btn.disabled = false;
    btn.textContent = '연결';
  }
}

function enterApp() {
  save();
  currentNoteId = currentNoteId || homeNoteId(state);
  openNote(state, currentNoteId, nowIso());
  save();
  showScreen('app');
  showPanel('note');
  renderAll();
  els.entries.scrollTop = els.entries.scrollHeight;
  syncer.run();
}

// ---------- 설정

function openSettings() {
  codeVisible = false;
  renderSettingsCode();
  $('settings-version').textContent = `버전 ${APP_VERSION}`;
  showScreen('settings');
}

function renderSettingsCode() {
  $('settings-code').textContent = codeVisible ? state.code : '●●●●-●●●●-●●●●-●●●●-●●●●-●●●●';
  $('btn-code-toggle').textContent = codeVisible ? '가리기' : '보기';
}

function exportJson() {
  const data = exportData(state);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `lessonlog-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function confirmDisconnect() {
  const n = pendingCount(state);
  showDialog({
    title: '이 기기 연결을 해제할까요?',
    body: n
      ? `아직 동기화되지 않은 메모 ${n}개가 사라져요. 온라인 상태에서 다시 시도하는 걸 권해요.`
      : '이 기기의 메모가 지워지고 시작 화면으로 돌아가요. 서버의 데이터는 그대로 남아요.',
    actions: [
      { label: '연결 해제', danger: true, onClick: () => {
        clearState();
        location.reload();
      } },
      { label: '취소' },
    ],
  });
}

// ---------- 이벤트 바인딩

function bind() {
  $('btn-start-new').addEventListener('click', startNew);
  $('btn-start-connect').addEventListener('click', () => {
    $('enter-input').value = '';
    $('enter-error').hidden = true;
    showScreen('enter');
    $('enter-input').focus();
  });
  $('btn-issue-back').addEventListener('click', () => showScreen('start'));
  $('btn-issue-copy').addEventListener('click', async () => {
    showToast((await writeClipboard(issuedCode)) ? '코드를 복사했어요' : '복사가 막혀 있어요. 코드를 직접 적어 두세요');
  });
  $('btn-issue-start').addEventListener('click', finishIssue);
  $('btn-enter-back').addEventListener('click', () => showScreen('start'));
  $('btn-enter-connect').addEventListener('click', connectExisting);
  $('enter-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectExisting();
  });
  $('enter-input').addEventListener('input', (e) => {
    const n = normalizeCode(e.target.value);
    if (n) e.target.value = n;
  });

  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-back').addEventListener('click', () => {
    showScreen('app');
    renderAll();
  });
  $('btn-code-toggle').addEventListener('click', () => {
    codeVisible = !codeVisible;
    renderSettingsCode();
  });
  $('btn-code-copy').addEventListener('click', async () => {
    showToast((await writeClipboard(state.code)) ? '코드를 복사했어요' : '복사가 막혀 있어요');
  });
  $('btn-export').addEventListener('click', exportJson);
  $('btn-disconnect').addEventListener('click', confirmDisconnect);

  $('btn-list-open').addEventListener('click', () => {
    finishTitleEdit();
    showPanel('list');
    renderNoteList();
  });
  $('btn-list-close').addEventListener('click', () => showPanel('note'));
  $('btn-new-note').addEventListener('click', newNote);

  els.title.addEventListener('click', startTitleEdit);
  els.titleDone.addEventListener('click', () => finishTitleEdit());
  els.titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishTitleEdit(); }
    if (e.key === 'Escape') finishTitleEdit(false);
  });
  els.titleInput.addEventListener('blur', () => setTimeout(() => finishTitleEdit(), 0));
  els.noteMenu.addEventListener('click', openNoteMenu);
  $('btn-banner-close').addEventListener('click', () => {
    state.bannerDismissed = true;
    save();
    els.banner.hidden = true;
  });

  els.composer.addEventListener('input', autosize);
  els.composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && isWide()) {
      e.preventDefault();
      submitComposer();
    }
    if (e.key === 'Escape' && editingEntryId) cancelEdit();
  });
  els.send.addEventListener('click', submitComposer);
  $('btn-edit-cancel').addEventListener('click', cancelEdit);

  els.scrim.addEventListener('click', hideDialog);
  window.addEventListener('online', () => { renderStatus(syncer.status); syncer.run(); });
  window.addEventListener('offline', () => renderStatus(syncer.status));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.code) syncer.run();
  });
  window.addEventListener('resize', () => {
    if (isWide()) showPanel('note');
    renderNote();
  });
  setInterval(() => {
    if (state.code && document.visibilityState === 'visible') syncer.run();
  }, 60_000);
}

// ---------- 시작

function boot() {
  bind();
  autosize();
  if (state.code) {
    ensureNote();
    currentNoteId = homeNoteId(state);
    enterApp();
  } else {
    showScreen('start');
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 등록 실패', e));
  }
}

boot();
