'use strict';
/* Lister — tasks, calendar, focus timer, tracker, habits and notes.
   Everything is saved in this browser (localStorage) under STORE_KEY. */

/* ================= helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');

const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const shiftDay = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); };
const today = () => dayStr();
const niceDay = s => parseDay(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const niceTime = t => { const d = new Date(); d.setHours(...t.split(':').map(Number), 0, 0); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const fmtMins = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
const weekStart = s => { const d = parseDay(s); const wd = (d.getDay() + 6) % 7; return shiftDay(s, -wd); }; // Monday

function relTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60e3) return 'just now';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} min ago`;
  const d = new Date(ms);
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (dayStr(d) === today()) return `today ${t}`;
  if (dayStr(d) === shiftDay(today(), -1)) return `yesterday ${t}`;
  return niceDay(dayStr(d));
}

/* ================= state ================= */
const STORE_KEY = 'lister.data.v1';
const DEFAULT_SETTINGS = { theme: 'dark', themeV: 2, sound: true, tickSound: 'classic', tickVol: 50, autoPip: false, pipV: 2, work: 25, short: 5, long: 15, rounds: 4, lastBackup: 0 };

function newTask(p = {}) {
  return {
    id: uid(), title: '', notes: '', list: '', due: '', start: '', end: '', remind: '', repeat: '', priority: 0,
    subtasks: [], done: false, doneAt: 0, created: Date.now(), remindedFor: '', ...p,
  };
}
function newHabit(p = {}) {
  return { id: uid(), name: '', days: [0, 1, 2, 3, 4, 5, 6], remindTime: '', checks: {}, created: Date.now(), remindedOn: '', ...p };
}
function normalize(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    tasks: (Array.isArray(s.tasks) ? s.tasks : []).map(t => ({ ...newTask(), ...t, subtasks: Array.isArray(t.subtasks) ? t.subtasks : [] })),
    habits: (Array.isArray(s.habits) ? s.habits : []).map(h => ({ ...newHabit(), ...h, checks: h.checks || {} })),
    notes: Array.isArray(s.notes) ? s.notes : [],
    log: Array.isArray(s.log) ? s.log : [],
    focus: { sessions: Array.isArray(s.focus?.sessions) ? s.focus.sessions : [], timer: s.focus?.timer || null },
    settings: {
      ...DEFAULT_SETTINGS, ...(s.settings || {}),
      // older versions had a plain on/off tick
      ...(s.settings && !('tickSound' in s.settings) && s.settings.tick === false ? { tickSound: 'off' } : {}),
    },
  };
}
function loadState() {
  let s;
  try { s = normalize(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { s = normalize(null); }
  if (s.settings.themeV !== 2) { s.settings.theme = 'dark'; s.settings.themeV = 2; } // dark is the new default
  // the corner desktop timer replaced the automatic browser pop-out, so two timers never show at once
  if (s.settings.pipV !== 2) { s.settings.autoPip = false; s.settings.pipV = 2; }
  return s;
}
let state = loadState();
let saveWarned = false;
function save() {
  if (state.log.length > 5000) state.log = state.log.slice(-5000);
  syncTimer();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); saveWarned = false; }
  catch (e) { if (!saveWarned) toast("Couldn't save your changes. Browser storage may be full or blocked."); saveWarned = true; }
}

/* ---- desktop timer link: the local server stores the timer so widget.ps1 can show it
   in the corner of the screen even after Lister is closed ---- */
// inside the Windows app the corner timer is built in and talks through window.listerDesktop
const desktopApp = window.listerDesktop || null;
const canSync = !desktopApp && location.protocol.startsWith('http');
let desktopTimer = !!desktopApp, lastTimerKey = '', syncReady = false;
const timerKey = t => JSON.stringify([t.mode, t.running, t.endsAt, t.remaining, t.length, t.round, t.taskId, state.settings.theme]);
const asciiJSON = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
function syncTimer() {
  const t = state.focus.timer;
  if (!t || !(canSync || desktopApp) || !syncReady) return;
  const key = timerKey(t);
  if (key === lastTimerKey) return;
  lastTimerKey = key;
  t.updated = Date.now();
  const task = state.tasks.find(x => x.id === t.taskId);
  const st = state.settings;
  if (desktopApp) { desktopApp.sendTimer({ ...t, taskTitle: task ? task.title : '', theme: st.theme }); return; }
  fetch('/api/timer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: asciiJSON({ ...t, taskTitle: task ? task.title : '', rounds: st.rounds,
      lengths: { work: st.work * 60000, short: st.short * 60000, long: st.long * 60000 }, completed: [] }) }).catch(() => {});
}
async function pullTimer() {
  if (!canSync) return;
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 1500);
    const res = await fetch('/api/timer', { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return;
    desktopTimer = true;
    const r = await res.json();
    // focus sessions that finished on the desktop timer while Lister was closed
    const before = state.focus.sessions.length;
    for (const s of Array.isArray(r.completed) ? r.completed : []) {
      if (s && s.id && s.at) logSession({ id: String(s.id), at: Number(s.at), minutes: Number(s.minutes) || 0, taskId: s.taskId || '' });
    }
    const imported = state.focus.sessions.length > before;
    const t = timer();
    if (r.mode && r.updated > (t.updated || 0)) {
      // the desktop timer paused, resumed or moved on more recently than this window did
      Object.assign(t, { mode: r.mode, running: !!r.running, endsAt: Number(r.endsAt), remaining: Number(r.remaining), length: Number(r.length), round: Number(r.round) || 1, updated: r.updated });
      lastTimerKey = timerKey(t);
    } else if (!imported) return;
    save(); render();
    if (imported) toast(`Added ${state.focus.sessions.length - before} focus session${state.focus.sessions.length - before === 1 ? '' : 's'} from the desktop timer to your Tracker.`);
  } catch (e) {}
}
function pingDesktopTimer() {
  if (desktopTimer && document.visibilityState === 'visible') fetch('/api/ping', { method: 'POST', keepalive: true }).catch(() => {});
}
function commit() { save(); render(); }

const ui = {
  page: 'tasks', view: 'today', list: '', search: '',
  cal: { mode: 'week', anchor: today() },
  trackDays: 7, noteId: null, noteSearch: '',
};

/* ================= tasks: model ================= */
const REPEAT = { daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month' };
const PRIO = ['', 'Low', 'Medium', 'High'];
const findTask = id => state.tasks.find(t => t.id === id);
const allLists = () => [...new Set(state.tasks.map(t => t.list).filter(Boolean))].sort();

function stepRepeat(s, repeat) {
  const d = parseDay(s);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') {
    const want = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(want, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return dayStr(d);
}
function nextDue(due, repeat) {
  let next = stepRepeat(due || today(), repeat);
  for (let i = 0; next <= today() && i < 1000; i++) next = stepRepeat(next, repeat);
  return next;
}
function timeText(t) {
  if (!t.start) return '';
  return t.end ? `${niceTime(t.start)} – ${niceTime(t.end)}` : niceTime(t.start);
}
function dueLabel(t) {
  if (!t.due) return null;
  const td = today(), time = timeText(t);
  const withTime = s => time ? `${s} · ${time}` : s;
  if (t.due < td) return { text: withTime('Overdue · ' + niceDay(t.due)), cls: 'late' };
  if (t.due === td) return { text: withTime('Today'), cls: 'today' };
  if (t.due === shiftDay(td, 1)) return { text: withTime('Tomorrow'), cls: '' };
  return { text: withTime(niceDay(t.due)), cls: '' };
}

/* Quick-add parsing: pulls dates ("today", "tomorrow", "friday", "28 oct")
   and times ("2pm to 5pm", "14:00-17:00", "at 9am") out of the typed text. */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function to24(h, m, mer) {
  h = Number(h); m = Number(m || 0);
  if (h > 23 || m > 59) return null;
  if (mer) { mer = mer.toLowerCase(); if (h > 12) return null; if (mer === 'pm' && h < 12) h += 12; if (mer === 'am' && h === 12) h = 0; }
  return h * 60 + m;
}
function parseQuick(text) {
  let s = ` ${text} `;
  const out = {};
  const cut = m => { s = s.replace(m[0], ' '); };
  const T = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
  const range = new RegExp(`\\s(from\\s+|between\\s+)?${T}\\s*(?:-|–|to|and|until|till)\\s*${T}(?=[\\s,.!])`, 'i');
  let m = s.match(range);
  if (m) {
    const [, kw, h1, m1, r1, h2, m2, r2] = m;
    const mer1 = r1 && r1.replace(/\./g, ''), mer2 = r2 && r2.replace(/\./g, '');
    // bare numbers count only with a word between them ("2 to 5"), so "2-3 apples" stays text
    const worded = /\s(to|until|till)\s/i.test(m[0]);
    if (worded && !kw && !mer1 && !mer2 && !m1 && !m2) {
      const hint = h => Number(h) <= 7 ? 'pm' : null;
      const a = to24(h1, 0, hint(h1)), b = to24(h2, 0, hint(h2));
      if (a != null && b != null && b > a) { out.start = fromMin(a); out.end = fromMin(b); cut(m); }
    } else if (kw || mer1 || mer2 || m1 || m2) {
      let b = to24(h2, m2, mer2 || (kw && !m2 && Number(h2) < 8 ? 'pm' : null));
      let a = to24(h1, m1, mer1 || mer2 || (kw && !m1 && Number(h1) < 8 ? 'pm' : null));
      if (a != null && b != null && !mer1 && mer2 && a > b) a = to24(h1, m1, 'am');
      if (a != null && b != null && b > a) { out.start = fromMin(a); out.end = fromMin(b); cut(m); }
    }
  }
  if (!out.start) {
    // a single time needs "at", am/pm or a colon, so "chapter 3" stays in the title
    const singles = [
      new RegExp(`\\s(?:at\\s+|@\\s*)${T}(?=[\\s,.!])`, 'i'),
      /\s(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=[\s,.!])/i,
      /\s(\d{1,2}):(\d{2})()(?=[\s,.!])/,
    ];
    for (const rx of singles) {
      m = s.match(rx); if (!m) continue;
      const a = to24(m[1], m[2], m[3] && m[3].replace(/\./g, ''));
      if (a != null) { out.start = fromMin(a); cut(m); break; }
    }
  }
  const td = today();
  if ((m = s.match(/\s(today|tonight)(?=[\s,.!])/i))) { out.due = td; cut(m); }
  else if ((m = s.match(/\s(tomorrow|tmrw|tmr)(?=[\s,.!])/i))) { out.due = shiftDay(td, 1); cut(m); }
  else if ((m = s.match(/\s(?:on\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?=[\s,.!])/i)
    || s.match(/\s(?:on|next)\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?=[\s,.!])/i))) {
    const want = WEEKDAYS.indexOf(m[1].slice(0, 3).toLowerCase());
    let d = shiftDay(td, 1);
    while (parseDay(d).getDay() !== want) d = shiftDay(d, 1);
    out.due = d; cut(m);
  } else if ((m = s.match(/\s(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?=[\s,.!])/i))) {
    const mon = MONTHS.indexOf(m[2].toLowerCase()), day = Number(m[1]);
    const now = new Date(); let d = new Date(now.getFullYear(), mon, day);
    if (d.getMonth() === mon) { if (dayStr(d) < td) d = new Date(now.getFullYear() + 1, mon, day); out.due = dayStr(d); cut(m); }
  }
  if (out.start && !out.due) out.due = td;
  out.title = s.replace(/\s+(at|on|from|between)\s*$/i, ' ').replace(/\s{2,}/g, ' ').trim();
  return out;
}

function inView(t, v) {
  const td = today();
  if (v === 'done') return t.done;
  if (t.done) return false;
  if (v === 'today') return !!t.due && t.due <= td;
  if (v === 'upcoming') return !!t.due && t.due > td;
  return true;
}
function matches(t) {
  if (ui.list && t.list !== ui.list) return false;
  if (!ui.search) return true;
  const hay = [t.title, t.notes, t.list, ...t.subtasks.map(s => s.title)].join(' ').toLowerCase();
  return hay.includes(ui.search.toLowerCase());
}
function sortTasks(a, b) {
  if (ui.view === 'done') return (b.doneAt || 0) - (a.doneAt || 0);
  const ak = (a.due || '9999-12-31') + (a.start || '99:99'), bk = (b.due || '9999-12-31') + (b.start || '99:99');
  if (ak !== bk) return ak < bk ? -1 : 1;
  if (b.priority !== a.priority) return b.priority - a.priority;
  return a.created - b.created;
}

function toggleTask(id) {
  const t = findTask(id); if (!t) return;
  if (!t.done && t.repeat) {
    state.log.push({ type: 'task', taskId: t.id, title: t.title, due: t.due, at: Date.now() });
    t.due = nextDue(t.due, t.repeat);
    t.subtasks.forEach(s => { s.done = false; });
    t.remindedFor = '';
    commit();
    toast(`Done. The next one is ${niceDay(t.due)}.`);
    return;
  }
  if (t.done) {
    state.log = state.log.filter(l => !(l.taskId === t.id && l.at === t.doneAt));
    t.done = false; t.doneAt = 0;
  } else {
    t.done = true; t.doneAt = Date.now();
    state.log.push({ type: 'task', taskId: t.id, title: t.title, due: t.due, at: t.doneAt });
  }
  commit();
}
function removeTask(id) {
  const i = state.tasks.findIndex(t => t.id === id); if (i < 0) return;
  const [t] = state.tasks.splice(i, 1);
  commit();
  toast('Task deleted', () => { state.tasks.splice(i, 0, t); commit(); });
}

/* ================= tasks: page ================= */
const VIEWS = [['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All open'], ['done', 'Completed']];
const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5l2.3 2.3L9.5 3.5"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>';

function taskRow(t) {
  const meta = [];
  const due = !t.done && dueLabel(t);
  if (due) meta.push(`<span class="${due.cls}">${esc(due.text)}</span>`);
  const clashes = !t.done ? findClashes(t) : [];
  if (clashes.length) meta.push(`<span class="clash">⚠ Clashes with ${esc(clashes.map(o => o.title).join(', '))}</span>`);
  if (t.done && t.doneAt) meta.push(`<span>Done ${esc(niceDay(dayStr(new Date(t.doneAt))))}</span>`);
  if (t.repeat) meta.push(`<span>↻ ${REPEAT[t.repeat]}</span>`);
  if (t.subtasks.length) meta.push(`<span>${t.subtasks.filter(s => s.done).length}/${t.subtasks.length} steps</span>`);
  if (t.remind !== '' && !t.done) meta.push('<span>Reminder on</span>');
  if (t.priority) meta.push(`<span>${PRIO[t.priority]} priority</span>`);
  if (t.list) meta.push(`<span>#${esc(t.list)}</span>`);
  return `<li class="row p${t.priority}${t.done ? ' is-done' : ''}">
    <button type="button" class="check" data-action="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${CHECK_SVG}</button>
    <button type="button" class="row-main" data-action="task-open" data-id="${t.id}"><span class="title">${esc(t.title)}</span>${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}</button>
    ${t.done ? '<span></span>' : `<button type="button" class="icon-btn" data-action="task-focus" data-id="${t.id}" title="Focus on this task" aria-label="Focus on ${esc(t.title)}">${CLOCK_SVG}</button>`}
  </li>`;
}

function renderTasks() {
  const td = today(), tasks = state.tasks;
  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#tallyOpen').textContent = tasks.filter(t => !t.done).length;
  $('#tallyDone').textContent = state.log.filter(l => l.type === 'task' && dayStr(new Date(l.at)) === td).length;
  $('#taskTabs').innerHTML = VIEWS.map(([id, label]) =>
    `<button type="button" data-action="task-view" data-view="${id}" aria-pressed="${ui.view === id}">${label}<span class="n">${tasks.filter(t => inView(t, id) && matches(t)).length}</span></button>`).join('');
  const lists = allLists();
  if (ui.list && !lists.includes(ui.list)) ui.list = '';
  $('#taskChips').hidden = !lists.length;
  $('#taskChips').innerHTML = ['', ...lists].map(n =>
    `<button type="button" data-action="task-list" data-list="${esc(n)}" aria-pressed="${n === ui.list}">${n ? esc(n) : 'All lists'}</button>`).join('');
  $('#listNames').innerHTML = [...new Set(['Personal', 'Work', 'Study', 'Shopping', ...lists])].map(n => `<option value="${esc(n)}"></option>`).join('');

  const rows = tasks.filter(t => inView(t, ui.view) && matches(t)).sort(sortTasks);
  $('#taskRows').innerHTML = rows.map(taskRow).join('');
  const empty = $('#taskEmpty');
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    const msgs = {
      today: ['Nothing due today', 'Tasks due today, and anything overdue, show up here.'],
      upcoming: ['Nothing scheduled ahead', 'Give a task a future date to see it here.'],
      all: ['All clear', 'Every task you haven\'t finished shows up here.'],
      done: ['Nothing completed yet', 'Tick a task\'s circle to mark it done.'],
    };
    const none = tasks.length === 0;
    const [h, p] = ui.search ? ['No matches', 'No tasks match your search.'] : none ? ['Your list is empty', 'Type a task above and press Enter.'] : msgs[ui.view];
    empty.innerHTML = `<strong>${h}</strong>${p}${none && !ui.search ? '<br><button type="button" class="ghost" data-action="task-examples">Add a few example tasks</button>' : ''}`;
  }
  $('#clearDone').hidden = !(ui.view === 'done' && rows.length);
}

function updateQuickHint() {
  const v = $('#quickTitle').value.trim();
  const hint = $('#quickHint');
  if (!v) { hint.innerHTML = 'Add a date or a time range and it goes on your calendar too.'; return; }
  const p = parseQuick(v);
  const bits = [];
  if (p.due) bits.push(niceDay(p.due));
  if (p.start) bits.push(p.end ? `${niceTime(p.start)} – ${niceTime(p.end)}` : niceTime(p.start));
  else if (!p.due && ui.view === 'today') bits.push('Today');
  hint.innerHTML = bits.length
    ? `Will add <b>${esc(p.title || v)}</b> · ${esc(bits.join(' · '))} · ${p.start ? 'shows as a block on your calendar' : 'shows in the calendar\'s all-day row'}`
    : `Will add <b>${esc(v)}</b> with no date, so it won't be on the calendar. Add "today", "tomorrow" or a time like "2pm to 5pm".`;
}

function addExamples() {
  const td = today();
  state.tasks.push(
    newTask({ title: 'Example: Study for exam', due: td, start: '14:00', end: '17:00', remind: '10', priority: 3, list: 'Study',
      subtasks: [{ id: uid(), title: 'Revise chapter 3', done: false }, { id: uid(), title: 'Practice questions', done: false }] }),
    newTask({ title: 'Example: Buy groceries', due: td, list: 'Shopping' }),
    newTask({ title: 'Example: Team meeting', due: shiftDay(td, 1), start: '10:00', end: '11:00', priority: 2, list: 'Work' }),
    newTask({ title: 'Example: Morning walk', due: shiftDay(td, 1), start: '07:00', end: '07:30', repeat: 'daily', list: 'Personal' }),
    newTask({ title: 'Example: Plan weekend trip', priority: 1, list: 'Personal' }),
  );
  commit();
}

/* ================= task dialog ================= */
let draft = null;
function openTask(id, preset = {}) {
  const t = id ? findTask(id) : null;
  openDraft(t ? structuredClone(t) : newTask(preset), !t);
}
function openDraft(d, isNew) {
  draft = d;
  draft._new = isNew;
  $('#tdHeading').textContent = isNew ? 'New task' : 'Edit task';
  $('#tdTitle').value = draft.title;
  $('#tdDue').value = draft.due;
  $('#tdStart').value = draft.start;
  $('#tdEnd').value = draft.end;
  $('#tdRemind').value = draft.remind;
  $('#tdRepeat').value = draft.repeat;
  $('#tdPrio').value = String(draft.priority);
  $('#tdList').value = draft.list;
  $('#tdNotes').value = draft.notes;
  $('#tdSubNew').value = '';
  $('#tdHint').textContent = '';
  $('#tdDelete').hidden = isNew;
  renderSubs();
  $('#taskDialog').showModal();
  $('#tdTitle').focus();
}
function renderSubs() {
  $('#tdSubs').innerHTML = draft.subtasks.map((s, i) => `<li class="${s.done ? 'done-step' : ''}">
    <input type="checkbox" data-sub-check="${i}" ${s.done ? 'checked' : ''} aria-label="Step done">
    <input type="text" data-sub-title="${i}" value="${esc(s.title)}" maxlength="120" aria-label="Step">
    <button type="button" data-action="sub-remove" data-i="${i}" aria-label="Remove step">×</button></li>`).join('');
}
function saveTaskDialog() {
  const title = $('#tdTitle').value.trim();
  if (!title) { $('#tdHint').textContent = 'Give the task a name.'; $('#tdTitle').focus(); return; }
  const start = $('#tdStart').value, end = $('#tdEnd').value;
  if (start && end && toMin(end) <= toMin(start)) { $('#tdHint').textContent = 'The end time needs to be after the start time.'; return; }
  if (end && !start) { $('#tdHint').textContent = 'Add a start time too, or clear the end time.'; return; }
  const pendingStep = $('#tdSubNew').value.trim();
  if (pendingStep) draft.subtasks.push({ id: uid(), title: pendingStep, done: false });
  const before = findTask(draft.id);
  Object.assign(draft, {
    title, start, end,
    due: $('#tdDue').value || ((start || $('#tdRemind').value !== '' || $('#tdRepeat').value) ? today() : ''),
    remind: $('#tdRemind').value, repeat: $('#tdRepeat').value, priority: Number($('#tdPrio').value),
    list: $('#tdList').value.trim(), notes: $('#tdNotes').value,
  });
  draft.subtasks = draft.subtasks.filter(s => s.title.trim());
  if (before && (before.due !== draft.due || before.start !== draft.start || before.remind !== draft.remind)) draft.remindedFor = '';
  const isNew = draft._new; delete draft._new;
  if (isNew) { $('#quickTitle').value = ''; updateQuickHint(); }
  $('#taskDialog').close();
  const timeChanged = isNew || !before || before.due !== draft.due || before.start !== draft.start || before.end !== draft.end;
  const clashes = timeChanged ? findClashes(draft) : [];
  if (clashes.length) { askClash(draft, isNew, clashes); return; }
  finishTask(draft, isNew);
}
function finishTask(task, isNew, movedNote) {
  if (isNew) state.tasks.push(task);
  else state.tasks[state.tasks.findIndex(t => t.id === task.id)] = task;
  if (isNew && ui.page === 'tasks' && !inView(task, ui.view)) ui.view = task.due ? (task.due <= today() ? 'today' : 'upcoming') : 'all';
  commit();
  if (movedNote) showInCalendarToast(task, movedNote);
  else if (isNew && task.due && ui.page !== 'calendar') showInCalendarToast(task);
}

/* ================= clash check ================= */
// a task's time as [start, end] in minutes; no end time counts as one hour
const span = t => { const s = toMin(t.start); return [s, t.end ? toMin(t.end) : s + 60]; };
function busyOn(date, ignoreId) {
  return state.tasks.filter(o => o.id !== ignoreId && !o.done && o.start && occurrences(o, date, date).length);
}
function findClashes(t) {
  if (!t.start || !t.due || t.done) return [];
  const [a, b] = span(t);
  return busyOn(t.due, t.id).filter(o => { const [c, d] = span(o); return a < d && c < b; });
}
function nextFreeSlot(t) {
  // try the asked-for time, then straight after each busy block; then the following days from 8:00
  const [a, b] = span(t), len = b - a;
  for (let day = 0; day < 14; day++) {
    const date = shiftDay(t.due, day), from = day === 0 ? a : 8 * 60;
    const busy = busyOn(date, t.id).map(span);
    const starts = [...new Set([from, ...busy.map(x => x[1]).filter(e => e > from)])].sort((x, y) => x - y);
    for (const s of starts) {
      if (s + len > 23 * 60 + 59) break;
      if (!busy.some(([c, d]) => s < d && c < s + len)) return { due: date, start: fromMin(s), end: fromMin(s + len) };
    }
  }
  return null;
}
let clash = null;
function slotText(task, slot) {
  return `${slot.due !== task.due ? niceDay(slot.due) + ', ' : ''}${niceTime(slot.start)} – ${niceTime(slot.end)}`;
}
function askClash(task, isNew, clashes) {
  clash = { task, isNew, slot: nextFreeSlot(task) };
  $('#cdText').textContent = `"${task.title}" on ${niceDay(task.due)}, ${timeText(task) || niceTime(task.start)}, overlaps with:`;
  $('#cdList').innerHTML = clashes.map(o =>
    `<li><b>${esc(o.title)}</b><span>${esc(timeText(o) || niceTime(o.start))}${o.repeat ? ' · ' + REPEAT[o.repeat].toLowerCase() : ''}</span></li>`).join('');
  const slot = clash.slot;
  $('#cdMove').hidden = !slot;
  if (slot) $('#cdMove').textContent = `Move to ${slotText(task, slot)}`;
  const pick = slot || { due: task.due, start: task.start, end: task.end || fromMin(span(task)[1]) };
  $('#cdDue').value = pick.due; $('#cdStart').value = pick.start; $('#cdEnd').value = pick.end;
  updateClashHint();
  if (!$('#clashDialog').open) $('#clashDialog').showModal();
}
function readClashPick() {
  return { due: $('#cdDue').value, start: $('#cdStart').value, end: $('#cdEnd').value };
}
function updateClashHint() {
  const p = readClashPick(), hint = $('#cdHint');
  if (!p.due || !p.start || !p.end) { hint.textContent = 'Pick a date, start and end time.'; hint.className = 'hint'; return; }
  if (toMin(p.end) <= toMin(p.start)) { hint.textContent = 'The end time needs to be after the start time.'; hint.className = 'hint bad'; return; }
  const c = findClashes({ ...clash.task, ...p });
  hint.textContent = c.length ? `Still clashes with ${c.map(o => o.title).join(', ')}.` : 'This time is free.';
  hint.className = c.length ? 'hint bad' : 'hint good';
}
function resolveClash(kind) {
  const { task, isNew, slot } = clash;
  if (kind === 'move') {
    Object.assign(task, slot, { remindedFor: '' });
  } else if (kind === 'custom') {
    const p = readClashPick();
    if (!p.due || !p.start || !p.end || toMin(p.end) <= toMin(p.start)) { updateClashHint(); return; }
    Object.assign(task, p, { remindedFor: '' });
    const still = findClashes(task);
    if (still.length) { askClash(task, isNew, still); return; }
  } else if (kind === 'back') {
    clash = null;
    $('#clashDialog').close();
    openDraft(task, isNew);
    return;
  }
  clash = null;
  $('#clashDialog').close();
  finishTask(task, isNew, kind === 'keep' ? null : `Moved to ${niceDay(task.due)}, ${timeText(task)} so it doesn't clash.`);
}

/* ================= calendar ================= */
const HOUR_PX = 48;
function occurrences(t, from, to) {
  if (!t.due) return [];
  if (!t.repeat || t.done) return t.due >= from && t.due <= to ? [{ date: t.due, ghost: false }] : [];
  const out = []; let d = t.due;
  for (let i = 0; d <= to && i < 500; i++) { if (d >= from) out.push({ date: d, ghost: d !== t.due }); d = stepRepeat(d, t.repeat); }
  return out;
}
function calItems(from, to) {
  const items = [];
  for (const t of state.tasks) for (const o of occurrences(t, from, to)) items.push({ t, ...o });
  // finished repeats are only in the log; show them on the day they were due
  for (const l of state.log) {
    if (l.type !== 'task' || !l.due || l.due < from || l.due > to) continue;
    const t = findTask(l.taskId);
    if (t && t.repeat) items.push({ t, date: l.due, ghost: false, doneOcc: true });
  }
  return items;
}
function calTitle() {
  const a = parseDay(ui.cal.anchor);
  if (ui.cal.mode === 'month') return a.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const s = parseDay(ui.cal.anchor), e = parseDay(shiftDay(ui.cal.anchor, 6));
  const sameMonth = s.getMonth() === e.getMonth();
  return `${s.toLocaleDateString(undefined, { day: 'numeric', month: sameMonth ? undefined : 'short' })} – ${e.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
function renderCalendar() {
  $('#calTitle').textContent = calTitle();
  $$('#calModes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === ui.cal.mode));
  $('#calBody').innerHTML = ui.cal.mode === 'week' ? weekView() : monthView();
}
function evClass(it) {
  const done = it.t.done || it.doneOcc;
  return `p${it.t.priority}${done ? ' is-done' : ''}${it.ghost ? ' ghosted' : ''}`;
}
function weekView() {
  // a rolling 7 days starting at the anchor, so "today" opens with the days ahead in view
  const ws = ui.cal.anchor, td = today();
  const days = [...Array(7)].map((_, i) => shiftDay(ws, i));
  const items = calItems(days[0], days[6]);
  const timed = items.filter(i => i.t.start), untimed = items.filter(i => !i.t.start);
  let h0 = 7, h1 = 22;
  for (const i of timed) { h0 = Math.min(h0, Math.floor(toMin(i.t.start) / 60)); h1 = Math.max(h1, Math.ceil(toMin(i.t.end || fromMin(toMin(i.t.start) + 60)) / 60)); }
  h1 = Math.min(24, h1);
  const height = (h1 - h0) * HOUR_PX;
  const head = days.map(d => { const dt = parseDay(d);
    return `<div class="${d === td ? 'is-today' : ''}">${dt.toLocaleDateString(undefined, { weekday: 'short' })}<b>${dt.getDate()}</b></div>`; }).join('');
  const allday = days.map(d => `<div>${untimed.filter(i => i.date === d).map(i =>
    `<button type="button" class="chip-ev ${evClass(i)}" data-action="task-open" data-id="${i.t.id}" title="${esc(i.t.title)}">${esc(i.t.title)}</button>`).join('')}</div>`).join('');
  const hours = [...Array(h1 - h0)].map((_, i) => `<div style="height:${HOUR_PX}px">${i === 0 ? '' : esc(niceTime(fromMin((h0 + i) * 60)))}</div>`).join('');
  const lines = [...Array(h1 - h0)].map((_, i) => `<div class="hour-line" style="top:${i * HOUR_PX}px"></div><div class="hour-line halfhour" style="top:${i * HOUR_PX + HOUR_PX / 2}px"></div>`).join('');
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const cols = days.map(d => {
    const evs = timed.filter(i => i.date === d).map(i => {
      const s = toMin(i.t.start), e = i.t.end ? toMin(i.t.end) : s + 60;
      return { i, s, e };
    }).sort((a, b) => a.s - b.s || b.e - a.e);
    // place overlapping events side by side
    const lanes = [];
    evs.forEach(ev => { let l = lanes.findIndex(end => end <= ev.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = ev.e; ev.lane = l; });
    const n = Math.max(1, lanes.length);
    evs.forEach(ev => { ev.clash = evs.some(o => o !== ev && ev.s < o.e && o.s < ev.e); });
    const blocks = evs.map(ev => {
      const top = (ev.s - h0 * 60) / 60 * HOUR_PX, h = Math.max(22, (ev.e - ev.s) / 60 * HOUR_PX - 2);
      const w = 100 / n;
      return `<button type="button" class="event ${evClass(ev.i)}${ev.clash ? ' clash' : ''}" data-action="task-open" data-id="${ev.i.t.id}"
        style="top:${top}px;height:${h}px;left:calc(${ev.lane * w}% + 2px);width:calc(${w}% - 4px)" title="${esc(ev.i.t.title)}">
        <b>${esc(ev.i.t.title)}</b><span>${esc(timeText(ev.i.t))}</span></button>`;
    }).join('');
    const nowLine = d === td && nowMin >= h0 * 60 && nowMin <= h1 * 60 ? `<div class="now-line" style="top:${(nowMin - h0 * 60) / 60 * HOUR_PX}px"></div>` : '';
    return `<div class="day-col${d === td ? ' is-today' : ''}" data-day="${d}" data-h0="${h0}" style="height:${height}px">${lines}${blocks}${nowLine}</div>`;
  }).join('');
  return `<div class="week">
    <div class="week-head"><div></div>${head}</div>
    <div class="week-allday"><div>All day</div>${allday}</div>
    <div class="week-grid"><div class="hours">${hours}</div>${cols}</div>
  </div>`;
}
function monthView() {
  const a = parseDay(ui.cal.anchor);
  const first = dayStr(new Date(a.getFullYear(), a.getMonth(), 1));
  const start = weekStart(first), end = shiftDay(start, 41), td = today();
  const items = calItems(start, end);
  const names = [...Array(7)].map((_, i) => parseDay(shiftDay(start, i)).toLocaleDateString(undefined, { weekday: 'short' }));
  const cells = [...Array(42)].map((_, i) => {
    const d = shiftDay(start, i), dt = parseDay(d);
    const its = items.filter(x => x.date === d).sort((x, y) => (x.t.start || '99').localeCompare(y.t.start || '99'));
    const shown = its.slice(0, 3).map(x => `<button type="button" class="chip-ev ${evClass(x)}" data-action="task-open" data-id="${x.t.id}" title="${esc(x.t.title)}">${x.t.start ? esc(niceTime(x.t.start)) + ' ' : ''}${esc(x.t.title)}</button>`).join('');
    const more = its.length > 3 ? `<button type="button" class="more" data-action="cal-goto" data-day="${d}">+${its.length - 3} more</button>` : '';
    return `<div class="mcell${dt.getMonth() !== a.getMonth() ? ' other' : ''}${d === td ? ' is-today' : ''}" data-day="${d}">
      <button type="button" class="mnum" data-action="cal-goto" data-day="${d}" aria-label="Open week of ${esc(niceDay(d))}">${dt.getDate()}</button>${shown}${more}</div>`;
  }).join('');
  return `<div class="month"><div class="month-head">${names.map(n => `<div>${n}</div>`).join('')}</div><div class="month-grid">${cells}</div></div>`;
}
function calClick(e) {
  if (e.target.closest('[data-action]')) return;
  const col = e.target.closest('.day-col');
  if (col) {
    const rect = col.getBoundingClientRect();
    const mins = Number(col.dataset.h0) * 60 + Math.floor((e.clientY - rect.top) / HOUR_PX * 2) * 30;
    openTask(null, { due: col.dataset.day, start: fromMin(mins), end: fromMin(Math.min(mins + 60, 23 * 60 + 59)) });
    return;
  }
  const cell = e.target.closest('.mcell');
  if (cell) openTask(null, { due: cell.dataset.day });
}

/* ================= focus timer ================= */
function modeLen(m) { return state.settings[m === 'work' ? 'work' : m] * 60000; }
function timer() {
  if (!state.focus.timer) state.focus.timer = { mode: 'work', running: false, endsAt: 0, length: modeLen('work'), remaining: modeLen('work'), taskId: '', round: 1 };
  return state.focus.timer;
}
const remainingMs = t => t.running ? Math.max(0, t.endsAt - Date.now()) : t.remaining;
function setMode(m) { const t = timer(); t.mode = m; t.running = false; t.length = modeLen(m); t.remaining = t.length; }
function startPause(fromMain = true) {
  const t = timer();
  const starting = !t.running;
  if (t.running) { t.remaining = remainingMs(t); t.running = false; }
  else { if (t.remaining <= 0) t.remaining = t.length; t.endsAt = Date.now() + t.remaining; t.running = true; wakeAudio(); }
  commit();
  // must run inside the click, before any await, or the browser refuses the window
  // with the desktop timer running, the in-browser pop-out isn't needed
  if (starting && fromMain && state.settings.autoPip && !pip && !desktopTimer) openPip();
}
function logSession(s) {
  if (!state.focus.sessions.some(x => x.id === s.id)) state.focus.sessions.push(s);
}
function finishTimer(skipped) {
  const t = timer(); let next;
  if (t.mode === 'work') {
    if (!skipped) {
      // same id the desktop timer uses for this session, so it is only counted once
      logSession({ id: 'w' + t.endsAt, at: Math.min(Date.now(), t.endsAt), minutes: Math.round(t.length / 60000), taskId: t.taskId });
      const task = findTask(t.taskId);
      notify('Focus session done', `${task ? task.title + ' · ' : ''}Time for a break.`, 'focus');
    }
    next = t.round >= state.settings.rounds ? 'long' : 'short';
  } else {
    if (!skipped) notify('Break is over', 'Ready for the next focus session?', 'focus');
    t.round = t.mode === 'long' ? 1 : t.round + 1;
    next = 'work';
  }
  setMode(next);
  commit();
}

/* flip digits: each card has a static top (new value), static bottom (old value),
   and two animated leaves that fold the old top down and the new bottom into place */
function setDigit(el, v) {
  if (el.dataset.v === v) return;
  const old = el.dataset.v ?? v;
  el.dataset.v = v;
  const half = (cls, val) => `<div class="half ${cls}"><span>${val}</span></div>`;
  el.innerHTML = old === v
    ? half('top', v) + half('bottom', v)
    : half('top', v) + half('bottom', old) + half('top leaf-top', old) + half('bottom leaf-bottom', v);
}
let lastShownSec = -1;
function updateTimerDisplay() {
  const t = timer(), ms = remainingMs(t), sec = Math.ceil(ms / 1000);
  const mm = pad(Math.min(99, Math.floor(sec / 60))), ss = pad(sec % 60);
  if (ui.page === 'focus') {
    [mm[0], mm[1], ss[0], ss[1]].forEach((c, i) => setDigit($('#d' + i), c));
    $('#flipClock').setAttribute('aria-label', `${Number(mm)} minutes ${Number(ss)} seconds left`);
  }
  const mini = $('#miniTimer');
  const active = t.running || t.remaining < t.length;
  const label = t.mode === 'work' ? (t.running ? 'Focusing' : (active ? 'Paused' : 'Focus')) : (t.mode === 'long' ? 'Long break' : 'Short break');
  mini.hidden = !active || ui.page === 'focus';
  if (active) mini.innerHTML = `<small>${label}</small>${mm}:${ss}`;
  document.title = t.running ? `${mm}:${ss} · ${t.mode === 'work' ? 'Focus' : 'Break'} · Lister` : 'Lister';
  if (pip) {
    const d = pip.document;
    [mm[0], mm[1], ss[0], ss[1]].forEach((c, i) => setDigit(d.getElementById('p' + i), c));
    d.getElementById('pipMode').textContent = label;
    const task = findTask(t.taskId);
    d.getElementById('pipTask').textContent = task ? task.title : '';
    d.getElementById('pipStart').textContent = t.running ? 'Pause' : (active ? 'Resume' : 'Start');
    d.getElementById('pipRoot').classList.toggle('is-break', t.mode !== 'work');
    d.title = t.running ? `${mm}:${ss} · Lister` : 'Lister timer';
  }
  if (t.running && sec !== lastShownSec && sec > 0) tick(sec);
  lastShownSec = sec;
}

/* Floating timer: a small always-on-top window (Document Picture-in-Picture, Edge/Chrome).
   It stays visible while Lister is minimized; closing Lister closes it too. */
let pip = null;
async function openPip() {
  if (pip) return;
  if (!('documentPictureInPicture' in window)) { toast("This browser can't pop out a timer. Open Lister in Microsoft Edge or Chrome."); return; }
  try { pip = await documentPictureInPicture.requestWindow({ width: 290, height: 175 }); }
  catch (e) { console.warn('Floating timer refused:', e); toast("Couldn't open the small timer. Click Pop out timer to try again."); return; }
  const doc = pip.document;
  doc.title = 'Lister timer';
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
    const c = doc.createElement('link'); c.rel = 'stylesheet'; c.href = l.href; doc.head.append(c);
  }
  doc.documentElement.dataset.theme = state.settings.theme;
  doc.body.innerHTML = `<div class="pip" id="pipRoot">
    <div class="pip-top"><span id="pipMode"></span><span class="pip-task" id="pipTask"></span></div>
    <div class="flip-clock"><div class="digit" id="p0"></div><div class="digit" id="p1"></div><div class="colon"><i></i><i></i></div><div class="digit" id="p2"></div><div class="digit" id="p3"></div></div>
    <div class="pip-btns"><button type="button" class="primary" data-pip="start" id="pipStart">Start</button><button type="button" class="ghost" data-pip="skip">Skip</button></div>
  </div>`;
  doc.addEventListener('click', e => {
    const b = e.target.closest('[data-pip]'); if (!b) return;
    if (b.dataset.pip === 'start') startPause(false); else finishTimer(true);
  });
  doc.addEventListener('pointerdown', wakeAudio);
  // the small window stays visible, so its own timer keeps running at full speed while Lister is minimized
  pip.setInterval(clockTick, 1000);
  pip.addEventListener('pagehide', () => { pip = null; });
  updateTimerDisplay();
}
function renderFocus() {
  const t = timer();
  $$('#focusModes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === t.mode));
  $('#focusStart').textContent = t.running ? 'Pause' : (t.remaining < t.length ? 'Resume' : 'Start');
  $('#focusRound').textContent = t.mode === 'work' ? `Session ${t.round} of ${state.settings.rounds}` : (t.mode === 'long' ? 'Long break' : 'Short break');
  $('#tickSound').innerHTML = Object.entries(TICK_SOUNDS).map(([k, n]) => `<option value="${k}" ${k === state.settings.tickSound ? 'selected' : ''}>${n}</option>`).join('');
  $('#tickVol').value = state.settings.tickVol;
  $('#tickVol').disabled = $('#tickPreview').disabled = state.settings.tickSound === 'off';
  $('#autoPip').checked = state.settings.autoPip;
  const open = state.tasks.filter(x => !x.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  if (t.taskId && !open.some(x => x.id === t.taskId)) t.taskId = '';
  $('#focusTask').innerHTML = '<option value="">Nothing in particular</option>' +
    open.map(x => `<option value="${x.id}" ${x.id === t.taskId ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
  const td = today(), ws = shiftDay(td, -6);
  const sToday = state.focus.sessions.filter(s => dayStr(new Date(s.at)) === td);
  const sWeek = state.focus.sessions.filter(s => dayStr(new Date(s.at)) >= ws);
  $('#focusTodayMin').textContent = fmtMins(sToday.reduce((a, s) => a + s.minutes, 0));
  $('#focusTodayCount').textContent = `${sToday.length} session${sToday.length === 1 ? '' : 's'}`;
  $('#focusWeekMin').textContent = fmtMins(sWeek.reduce((a, s) => a + s.minutes, 0));
  $('#focusWeekCount').textContent = `${sWeek.length} sessions in the last 7 days`;
  const recent = state.focus.sessions.slice(-8).reverse();
  $('#sessionList').innerHTML = recent.length ? recent.map(s => {
    const task = findTask(s.taskId);
    return `<li><span class="when">${esc(relTime(s.at))}</span><span class="what">${esc(task ? task.title : 'General focus')}</span><span class="mins">${s.minutes} min</span></li>`;
  }).join('') : '<li class="sub">Finished sessions show up here.</li>';
  lastShownSec = -1;
  updateTimerDisplay();
}

/* ================= sound ================= */
let audio = null;
function wakeAudio() { try { audio = audio || new AudioContext(); if (audio.state === 'suspended') audio.resume(); } catch (e) {} }
function tone(freq, start, dur, vol, type = 'sine') {
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(audio.destination); o.start(start); o.stop(start + dur + 0.02);
}
const TICK_SOUNDS = {
  off: 'Off',
  classic: 'Classic clock',
  wood: 'Wooden tick-tock',
  grandfather: 'Grandfather clock',
  soft: 'Soft click',
  metronome: 'Metronome',
  digital: 'Digital watch',
  drip: 'Water drop',
};
let noiseBuf = null;
function noise(start, dur, vol, freq, q) {
  if (!noiseBuf) {
    noiseBuf = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.3), audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, start); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(audio.destination); src.start(start); src.stop(start + dur + 0.02);
}
function playTick(kind, odd, v) {
  const n = audio.currentTime;
  if (kind === 'classic') noise(n, 0.03, 1.2 * v, odd ? 3200 : 2600, 4);
  else if (kind === 'wood') { noise(n, 0.06, 1.4 * v, odd ? 1400 : 900, 6); tone(odd ? 1400 : 900, n, 0.05, 0.12 * v); }
  else if (kind === 'grandfather') { noise(n, 0.14, 1.1 * v, odd ? 700 : 520, 3); tone(odd ? 260 : 200, n, 0.3, 0.25 * v); }
  else if (kind === 'soft') tone(1100, n, 0.025, 0.12 * v);
  else if (kind === 'metronome') tone(odd ? 1600 : 1000, n, 0.06, 0.3 * v);
  else if (kind === 'digital') tone(4000, n, 0.018, 0.08 * v, 'square');
  else if (kind === 'drip') {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.setValueAtTime(1500, n); o.frequency.exponentialRampToValueAtTime(450, n + 0.09);
    g.gain.setValueAtTime(0.0001, n); g.gain.exponentialRampToValueAtTime(0.3 * v, n + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.13);
    o.connect(g).connect(audio.destination); o.start(n); o.stop(n + 0.15);
  }
}
function tick(sec) {
  const kind = state.settings.tickSound;
  if (kind === 'off' || !audio || audio.state !== 'running') return;
  try { playTick(kind, sec % 2 === 1, state.settings.tickVol / 100); } catch (e) {}
}
function previewTick() {
  wakeAudio();
  [0, 1, 2, 3].forEach(i => setTimeout(() => tick(i + 1), i * 1000));
}
function chime() {
  if (!state.settings.sound) return;
  try { wakeAudio(); const n = audio.currentTime; tone(880, n, 0.5, 0.25); tone(1320, n + 0.18, 0.6, 0.22); tone(1760, n + 0.36, 0.8, 0.18); } catch (e) {}
}

/* ================= reminders ================= */
async function notify(title, body, tag) {
  chime();
  if (document.visibilityState === 'visible') toast(`${title} — ${body}`);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (e) {}
}
function taskRemindAt(t) {
  if (t.done || !t.due || t.remind === '') return 0;
  const d = parseDay(t.due); const [h, m] = (t.start || '09:00').split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime() - Number(t.remind) * 60000;
}
function checkReminders() {
  const now = Date.now(), td = today(), wd = new Date().getDay(); let changed = false;
  for (const t of state.tasks) {
    const at = taskRemindAt(t), key = `${t.due}T${t.start}`;
    if (!at || now < at || t.remindedFor === key) continue;
    t.remindedFor = key; changed = true;
    if (now - at < 6 * 3600e3) notify(t.title, dueLabel(t).text, 'task-' + t.id);
  }
  for (const h of state.habits) {
    if (!h.remindTime || h.checks[td] || !h.days.includes(wd) || h.remindedOn === td) continue;
    const at = new Date(); at.setHours(...h.remindTime.split(':').map(Number), 0, 0);
    if (now < at.getTime()) continue;
    h.remindedOn = td; changed = true;
    if (now - at.getTime() < 6 * 3600e3) notify(`Habit: ${h.name}`, "You haven't ticked this off today.", 'habit-' + h.id);
  }
  if (changed) save();
}

/* ================= tracker ================= */
function completion(from, to) {
  let total = 0, done = 0;
  for (const t of state.tasks) {
    if (t.repeat) { if (!t.done && t.due >= from && t.due <= to && t.due < today()) total++; continue; }
    if (t.due && t.due >= from && t.due <= to) { total++; if (t.done) done++; }
  }
  for (const l of state.log) {
    const t = findTask(l.taskId);
    if (l.type === 'task' && t && t.repeat && l.due && l.due >= from && l.due <= to) { total++; done++; }
  }
  return { total, done, rate: total ? Math.round(done / total * 100) : null };
}
function focusStreak() {
  const days = new Set(state.focus.sessions.map(s => dayStr(new Date(s.at))));
  let d = today(), n = 0;
  if (!days.has(d)) d = shiftDay(d, -1);
  while (days.has(d)) { n++; d = shiftDay(d, -1); }
  return n;
}
function barChart(data, cls, fmt) {
  const max = Math.max(1, ...data.map(d => d.v));
  const every = data.length > 14 ? 5 : 1;
  return `<div class="bars">${data.map((d, i) => `<div class="bar-col" title="${esc(niceDay(d.d))}: ${esc(fmt(d.v))}">
    <span class="bar-v">${d.v && data.length <= 14 ? esc(fmt(d.v)) : ''}</span>
    <div class="bar-track"><div class="bar ${cls}${d.d === today() ? ' is-today' : ''}" style="height:${d.v / max * 100}%"></div></div>
    <span class="bar-l">${i % every === 0 || i === data.length - 1 ? esc(data.length > 14 ? String(parseDay(d.d).getDate()) : parseDay(d.d).toLocaleDateString(undefined, { weekday: 'short' })) : '&nbsp;'}</span></div>`).join('')}</div>`;
}
function renderTracker() {
  $$('#trackRange button').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.days) === ui.trackDays));
  const n = ui.trackDays, td = today(), from = shiftDay(td, -(n - 1));
  const prevFrom = shiftDay(from, -n), prevTo = shiftDay(from, -1);
  const days = [...Array(n)].map((_, i) => shiftDay(from, i));
  const doneOn = d => state.log.filter(l => l.type === 'task' && dayStr(new Date(l.at)) === d).length;
  const focusOn = d => state.focus.sessions.filter(s => dayStr(new Date(s.at)) === d).reduce((a, s) => a + s.minutes, 0);
  const tasksDone = days.reduce((a, d) => a + doneOn(d), 0);
  const prevDone = [...Array(n)].map((_, i) => doneOn(shiftDay(prevFrom, i))).reduce((a, b) => a + b, 0);
  const focusMin = days.reduce((a, d) => a + focusOn(d), 0);
  const sessions = state.focus.sessions.filter(s => dayStr(new Date(s.at)) >= from).length;
  const c = completion(from, td), cp = completion(prevFrom, prevTo);
  const C = 2 * Math.PI * 22;
  const ring = `<svg viewBox="0 0 54 54" aria-hidden="true"><circle class="bg" cx="27" cy="27" r="22"/><circle class="fg" cx="27" cy="27" r="22" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - (c.rate || 0) / 100)}"/></svg>`;
  const diff = (a, b, unit) => { if (!b && !a) return 'No activity before this'; const d = a - b; return d === 0 ? `Same as the ${n} days before` : `${d > 0 ? '+' : '−'}${Math.abs(d)}${unit} vs the ${n} days before`; };

  const byTask = {};
  state.focus.sessions.filter(s => dayStr(new Date(s.at)) >= from).forEach(s => { byTask[s.taskId || ''] = (byTask[s.taskId || ''] || 0) + s.minutes; });
  const taskRows = Object.entries(byTask).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topMax = Math.max(1, ...taskRows.map(r => r[1]));
  const byList = {};
  state.tasks.filter(t => t.list && t.due && t.due >= from && t.due <= td && !t.repeat).forEach(t => { const o = byList[t.list] ||= { done: 0, total: 0 }; o.total++; if (t.done) o.done++; });

  $('#trackBody').innerHTML = `
    <div class="tiles">
      <div class="tile"><span class="k">Completion rate</span><div class="rate-ring">${ring}<b>${c.rate == null ? '—' : c.rate + '%'}</b></div>
        <span class="sub">${c.total ? `${c.done} of ${c.total} tasks due were done` : 'No tasks were due yet'}${cp.rate != null && c.rate != null ? ` · was ${cp.rate}%` : ''}</span></div>
      <div class="tile"><span class="k">Tasks done</span><b>${tasksDone}</b><span class="sub">${esc(diff(tasksDone, prevDone, ''))}</span></div>
      <div class="tile"><span class="k">Focus time</span><b>${fmtMins(focusMin)}</b><span class="sub">${sessions} session${sessions === 1 ? '' : 's'}</span></div>
      <div class="tile"><span class="k">Focus streak</span><b>${focusStreak()} day${focusStreak() === 1 ? '' : 's'}</b><span class="sub">Days in a row with a focus session</span></div>
    </div>
    <div class="two-col">
      <div class="panel"><h2>Tasks done per day</h2>${barChart(days.map(d => ({ d, v: doneOn(d) })), '', v => String(v))}</div>
      <div class="panel"><h2>Focus minutes per day</h2>${barChart(days.map(d => ({ d, v: focusOn(d) })), 'focus', v => `${v}m`)}</div>
    </div>
    <div class="two-col">
      <div class="panel"><h2>Where your focus went</h2>${taskRows.length ? `<ul class="hbars">${taskRows.map(([id, m]) => {
        const t = findTask(id); return `<li><span class="nm" title="${esc(t ? t.title : 'General focus')}">${esc(t ? t.title : (id ? 'Deleted task' : 'General focus'))}</span><span class="tr"><i style="width:${m / topMax * 100}%"></i></span><span class="vl">${fmtMins(m)}</span></li>`;
      }).join('')}</ul>` : '<p class="sub">Run a focus session to see this.</p>'}</div>
      <div class="panel"><h2>Completion by list</h2>${Object.keys(byList).length ? `<ul class="hbars">${Object.entries(byList).map(([name, o]) =>
        `<li><span class="nm">${esc(name)}</span><span class="tr"><i style="width:${o.done / o.total * 100}%"></i></span><span class="vl">${o.done}/${o.total}</span></li>`).join('')}</ul>` : '<p class="sub">Give tasks a list and a date to compare lists.</p>'}</div>
    </div>
    <div class="panel"><h2>Habits</h2>${state.habits.length ? `<div class="table-wrap"><table class="htable"><thead><tr><th>Habit</th><th>Current streak</th><th>Best</th><th>Last 30 days</th></tr></thead><tbody>${state.habits.map(h => {
      const r = rate30(h); return `<tr><td>${esc(h.name)}</td><td>${habitStreak(h)} days</td><td>${bestStreak(h)} days</td><td>${r == null ? '—' : r + '%'}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="sub">Add habits on the Habits page to track them here.</p>'}</div>`;
}

/* ================= habits ================= */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const findHabit = id => state.habits.find(h => h.id === id);
const habitStart = h => dayStr(new Date(h.created));
function habitStreak(h) {
  let d = today(), n = 0;
  if (!h.checks[d]) d = shiftDay(d, -1);
  for (let i = 0; i < 1000 && d >= habitStart(h); i++) {
    if (h.days.includes(parseDay(d).getDay())) { if (h.checks[d]) n++; else break; }
    d = shiftDay(d, -1);
  }
  return n;
}
function bestStreak(h) {
  let best = 0, cur = 0, d = habitStart(h);
  const firstCheck = Object.keys(h.checks).sort()[0];
  if (firstCheck && firstCheck < d) d = firstCheck;
  for (let i = 0; d <= today() && i < 3000; i++) {
    if (h.days.includes(parseDay(d).getDay())) {
      if (h.checks[d]) best = Math.max(best, ++cur);
      else if (d < today()) cur = 0;
    }
    d = shiftDay(d, 1);
  }
  return best;
}
function rate30(h) {
  let planned = 0, done = 0;
  for (let i = 0; i < 30; i++) {
    const d = shiftDay(today(), -i);
    if (d < habitStart(h) && !h.checks[d]) break;
    if (!h.days.includes(parseDay(d).getDay())) continue;
    if (d === today() && !h.checks[d]) continue;
    planned++; if (h.checks[d]) done++;
  }
  return planned ? Math.round(done / planned * 100) : null;
}
function scheduleText(h) {
  const k = [...h.days].sort().join('');
  if (k === '0123456') return 'Every day';
  if (k === '12345') return 'Weekdays';
  if (k === '06') return 'Weekends';
  return h.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DAY_NAMES[d]).join(', ');
}
function renderHabits() {
  const td = today();
  $('#habitEmpty').hidden = state.habits.length > 0;
  $('#habitEmpty').innerHTML = '<strong>No habits yet</strong>Add something you want to do regularly, like "Read 10 pages" or "Walk 20 minutes".';
  const days = [...Array(7)].map((_, i) => shiftDay(td, i - 6));
  $('#habitList').innerHTML = state.habits.map(h => {
    const cells = days.map(d => {
      const dt = parseDay(d), on = !!h.checks[d], planned = h.days.includes(dt.getDay());
      return `<button type="button" class="hday${on ? ' on' : ''}${planned ? '' : ' off'}${d === td ? ' is-today' : ''}" data-action="habit-check" data-id="${h.id}" data-day="${d}" aria-pressed="${on}" aria-label="${esc(h.name)}, ${esc(niceDay(d))}">
        <span class="dw">${dt.toLocaleDateString(undefined, { weekday: 'short' })}</span><span class="dn">${dt.getDate()}</span></button>`;
    }).join('');
    const r = rate30(h);
    return `<article class="habit">
      <div class="habit-head"><div><h3>${esc(h.name)}</h3><p class="meta">${esc(scheduleText(h))}${h.remindTime ? ' · reminder ' + esc(niceTime(h.remindTime)) : ''}</p></div>
        <div class="streak"><b>${habitStreak(h)}</b><span>day streak</span></div></div>
      <div class="week-strip">${cells}</div>
      <div class="habit-foot"><span class="meta">Best streak ${bestStreak(h)} · ${r == null ? 'no planned days yet' : r + '% of planned days in the last 30'}</span>
        <button type="button" class="link" data-action="habit-edit" data-id="${h.id}">Edit</button></div>
    </article>`;
  }).join('');
}
let habitDraft = null;
function openHabit(id) {
  habitDraft = findHabit(id); if (!habitDraft) return;
  $('#hdName').value = habitDraft.name;
  $('#hdRemind').value = habitDraft.remindTime;
  $('#hdDays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d =>
    `<label><input type="checkbox" value="${d}" ${habitDraft.days.includes(d) ? 'checked' : ''}><span>${DAY_NAMES[d]}</span></label>`).join('');
  $('#habitDialog').showModal();
}

/* ================= notes ================= */
const findNote = id => state.notes.find(n => n.id === id);
function renderNotes() {
  const q = ui.noteSearch.toLowerCase();
  const notes = [...state.notes].sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated))
    .filter(n => !q || (n.title + ' ' + n.body).toLowerCase().includes(q));
  if (ui.noteId && !findNote(ui.noteId)) ui.noteId = null;
  $('#noteList').innerHTML = notes.map(n => `<li><button type="button" class="note-item${n.id === ui.noteId ? ' active' : ''}" data-action="note-open" data-id="${n.id}">
    <span class="nt">${n.pinned ? '<span class="pin">Pinned</span>' : ''}${esc(n.title || 'Untitled')}</span>
    <span class="np">${esc(n.body.slice(0, 100) || 'No text yet')}</span><span class="nd">${esc(relTime(n.updated))}</span></button></li>`).join('')
    || `<li class="sub">${q ? 'No notes match.' : 'No notes yet.'}</li>`;
  const n = findNote(ui.noteId);
  $('#noteForm').hidden = !n; $('#noteEmpty').hidden = !!n;
  if (n) {
    if ($('#noteTitle').dataset.id !== n.id) { $('#noteTitle').value = n.title; $('#noteBody').value = n.body; $('#noteTitle').dataset.id = n.id; }
    $('#notePin').textContent = n.pinned ? 'Unpin' : 'Pin';
    $('#noteSaved').textContent = 'Saved ' + relTime(n.updated);
  } else $('#noteTitle').dataset.id = '';
}
let noteTimer = 0;
function noteInput() {
  const n = findNote(ui.noteId); if (!n) return;
  n.title = $('#noteTitle').value; n.body = $('#noteBody').value; n.updated = Date.now();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { save(); renderNotes(); }, 400);
}

/* ================= settings ================= */
const THEMES = [
  ['dark', 'Dark', 'Deep navy with soft violet', ['#0c0f15', '#141922', '#8c96ff']],
  ['clean', 'Clean', 'Light grey with blue', ['#eef1f5', '#ffffff', '#2f5bd3']],
  ['colorful', 'Colorful', 'Lavender, pink and yellow', ['#f3eeff', '#e0457b', '#ffd23f']],
  ['minimal', 'Minimal', 'Plain black and white', ['#ffffff', '#e6e6e6', '#111111']],
  ['auto', 'Auto', 'Light or dark, following Windows', ['#eef1f5', '#2f5bd3', '#0c0f15']],
];
function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  $('#themeQuick').value = state.settings.theme;
  if (pip) pip.document.documentElement.dataset.theme = state.settings.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff';
}
function renderSettings() {
  $('#themeList').innerHTML = THEMES.map(([id, name, desc, sw]) => `<button type="button" class="theme-card" data-action="theme" data-theme="${id}" aria-pressed="${state.settings.theme === id}">
    <span class="sw">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</span><b>${name}</b><small>${desc}</small></button>`).join('');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#notifyStatus').textContent = {
    granted: 'Notifications are on. Lister will pop up a Windows notification when a reminder is due.',
    denied: 'Notifications are blocked for Lister. To allow them, click the lock icon in the address bar, then Permissions, then allow Notifications.',
    default: 'Notifications are off. Turn them on to get reminders as Windows pop-ups.',
    unsupported: "This browser can't show notifications. Reminders will still show inside Lister.",
  }[perm];
  $('#notifyOn').hidden = perm !== 'default';
  $('#setSound').checked = state.settings.sound;
  $('#setWork').value = state.settings.work; $('#setShort').value = state.settings.short;
  $('#setLong').value = state.settings.long; $('#setRounds').value = state.settings.rounds;
  const lb = state.settings.lastBackup;
  $('#backupStatus').textContent = (lb ? `Last backup: ${relTime(lb)}. ` : 'No backup saved yet. ') +
    'Your data lives only in this browser on this laptop, so save a backup now and then.';
}
function exportData() {
  state.settings.lastBackup = Date.now(); save();
  const blob = new Blob([JSON.stringify({ app: 'Lister', exported: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `lister-backup-${today()}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  render();
  toast('Backup saved to your Downloads folder.');
}
async function importData(file) {
  try {
    const obj = JSON.parse(await file.text());
    const data = obj && obj.data ? obj.data : obj;
    if (!data || !Array.isArray(data.tasks)) throw new Error('not a backup');
    if (!confirm(`Replace everything in Lister with this backup?\n\nIt has ${data.tasks.length} tasks, ${(data.habits || []).length} habits and ${(data.notes || []).length} notes.`)) return;
    state = normalize(data);
    commit();
    toast('Backup restored.');
  } catch (e) { toast("That file isn't a Lister backup. Pick a file named like lister-backup-2026-10-25.json."); }
}

/* ================= toast ================= */
let toastTimer = 0, toastUndo = null;
function toast(msg, undo, label = 'Undo') {
  $('#toastMsg').textContent = msg;
  $('#toastBtn').textContent = label;
  $('#toastBtn').hidden = !undo;
  toastUndo = undo || null;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; toastUndo = null; }, undo ? 7000 : 5000);
}

function showInCalendarToast(t, msg) {
  toast(msg || `Added to your calendar: ${niceDay(t.due)}${t.start ? ' · ' + timeText(t) : ''}`, () => {
    ui.cal.mode = 'week';
    ui.cal.anchor = t.due >= today() && t.due <= shiftDay(today(), 6) ? today() : t.due;
    go('calendar');
  }, 'Show');
}

/* ================= routing & render ================= */
const PAGES = { tasks: renderTasks, calendar: renderCalendar, focus: renderFocus, tracker: renderTracker, habits: renderHabits, notes: renderNotes, settings: renderSettings };
function go(page) {
  if (!PAGES[page]) page = 'tasks';
  ui.page = page;
  if (page === 'calendar') ui.cal.scrolled = false;
  history.replaceState(null, '', '#' + page);
  render();
  window.scrollTo(0, 0);
}
function render() {
  applyTheme();
  $$('.nav-btn').forEach(b => b.setAttribute('aria-current', b.dataset.page === ui.page ? 'page' : 'false'));
  $$('.page').forEach(p => { p.hidden = p.dataset.page !== ui.page; });
  PAGES[ui.page]();
  updateTimerDisplay();
}

/* ================= events ================= */
const actions = {
  'nav': el => go(el.dataset.page),
  'task-view': el => { ui.view = el.dataset.view; render(); },
  'task-list': el => { ui.list = el.dataset.list; render(); },
  'task-toggle': el => toggleTask(el.dataset.id),
  'task-open': el => openTask(el.dataset.id),
  'task-new': () => { const p = parseQuick($('#quickTitle').value.trim()); openTask(null, { ...p, title: p.title || '', due: p.due || (ui.view === 'today' ? today() : '') }); },
  'task-focus': el => { const t = timer(); if (!t.running) setMode('work'); t.taskId = el.dataset.id; save(); go('focus'); },
  'task-delete': () => { $('#taskDialog').close(); removeTask(draft.id); },
  'task-examples': addExamples,
  'clear-done': () => {
    const keep = state.tasks.filter(t => !(t.done && (!ui.list || t.list === ui.list)));
    const removed = state.tasks.length - keep.length, prev = state.tasks;
    if (!removed) return;
    state.tasks = keep; commit();
    toast(`${removed} completed task${removed === 1 ? '' : 's'} cleared`, () => { state.tasks = prev; commit(); });
  },
  'sub-remove': el => { draft.subtasks.splice(Number(el.dataset.i), 1); renderSubs(); },
  'dialog-close': el => el.closest('dialog').close(),
  'cal-mode': el => { ui.cal.mode = el.dataset.mode; ui.cal.scrolled = false; render(); },
  'cal-move': el => {
    const dir = Number(el.dataset.dir), a = parseDay(ui.cal.anchor);
    if (ui.cal.mode === 'week') ui.cal.anchor = shiftDay(ui.cal.anchor, 7 * dir);
    else ui.cal.anchor = dayStr(new Date(a.getFullYear(), a.getMonth() + dir, 1));
    ui.cal.scrolled = false; render();
  },
  'cal-today': () => { ui.cal.anchor = today(); ui.cal.scrolled = false; render(); },
  'cal-goto': el => { ui.cal.anchor = el.dataset.day; ui.cal.mode = 'week'; ui.cal.scrolled = false; render(); },
  'focus-mode': el => { setMode(el.dataset.mode); commit(); },
  'focus-start': startPause,
  'focus-reset': () => { setMode(timer().mode); commit(); },
  'focus-skip': () => finishTimer(true),
  'clash-move': () => resolveClash('move'),
  'clash-custom': () => resolveClash('custom'),
  'clash-keep': () => resolveClash('keep'),
  'clash-back': () => resolveClash('back'),
  'pip-open': () => openPip(),
  'tick-preview': previewTick,
  'track-range': el => { ui.trackDays = Number(el.dataset.days); render(); },
  'habit-check': el => {
    const h = findHabit(el.dataset.id), d = el.dataset.day;
    if (h.checks[d]) delete h.checks[d]; else h.checks[d] = true;
    commit();
  },
  'habit-edit': el => openHabit(el.dataset.id),
  'habit-delete': () => {
    const i = state.habits.indexOf(habitDraft); if (i < 0) return;
    const [h] = state.habits.splice(i, 1);
    $('#habitDialog').close(); commit();
    toast('Habit deleted', () => { state.habits.splice(i, 0, h); commit(); });
  },
  'note-new': () => {
    const n = { id: uid(), title: '', body: '', pinned: false, created: Date.now(), updated: Date.now() };
    state.notes.push(n); ui.noteId = n.id; ui.noteSearch = ''; $('#noteSearch').value = '';
    commit(); $('#noteTitle').focus();
  },
  'note-open': el => { ui.noteId = el.dataset.id; render(); },
  'note-pin': () => { const n = findNote(ui.noteId); if (n) { n.pinned = !n.pinned; commit(); } },
  'note-delete': () => {
    const i = state.notes.findIndex(n => n.id === ui.noteId); if (i < 0) return;
    const [n] = state.notes.splice(i, 1); ui.noteId = null; commit();
    toast('Note deleted', () => { state.notes.splice(i, 0, n); ui.noteId = n.id; commit(); });
  },
  'theme': el => { state.settings.theme = el.dataset.theme; commit(); },
  'notify-on': async () => {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    render();
    if (p === 'granted') notify('Reminders are on', 'Lister will alert you here when tasks and habits are due.', 'test');
  },
  'notify-test': () => notify('Test reminder', 'This is how a Lister reminder looks.', 'test'),
  'export': exportData,
  'import': () => $('#importFile').click(),
  'wipe': () => {
    if (!confirm('Delete all tasks, habits, notes and focus history from Lister? This cannot be undone.')) return;
    const theme = state.settings.theme;
    state = normalize(null); state.settings.theme = theme; ui.noteId = null; commit();
    toast('All data deleted.');
  },
  'toast-undo': () => { const f = toastUndo; $('#toast').hidden = true; toastUndo = null; if (f) f(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) { actions[el.dataset.action](el, e); return; }
  if (e.target.closest('#calBody')) calClick(e);
});
document.addEventListener('pointerdown', wakeAudio, { once: true });

$('#quickAdd').addEventListener('submit', e => {
  e.preventDefault();
  const raw = $('#quickTitle').value.trim(); if (!raw) return;
  const p = parseQuick(raw);
  const t = newTask({ title: p.title || raw, due: p.due || (ui.view === 'today' ? today() : ''), start: p.start || '', end: p.end || '' });
  $('#quickTitle').value = ''; updateQuickHint();
  const clashes = findClashes(t);
  if (clashes.length) { askClash(t, true, clashes); return; }
  if (!inView(t, ui.view)) ui.view = t.due ? (t.due <= today() ? 'today' : 'upcoming') : 'all';
  finishTask(t, true);
  $('#quickTitle').focus();
});
$('#quickTitle').addEventListener('input', updateQuickHint);
['#cdDue', '#cdStart', '#cdEnd'].forEach(sel => $(sel).addEventListener('input', () => { if (clash) updateClashHint(); }));
$('#clashForm').addEventListener('submit', e => { e.preventDefault(); resolveClash('custom'); });
// Esc never throws the task away: it goes back to the editor
$('#clashDialog').addEventListener('cancel', e => { e.preventDefault(); if (clash) resolveClash('back'); });
$('#taskSearch').addEventListener('input', e => { ui.search = e.target.value.trim(); renderTasks(); });
$('#taskForm').addEventListener('submit', e => { e.preventDefault(); saveTaskDialog(); });
$('#tdSubNew').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const v = e.target.value.trim(); if (!v) return;
  draft.subtasks.push({ id: uid(), title: v, done: false }); e.target.value = ''; renderSubs();
});
$('#tdSubs').addEventListener('input', e => {
  const i = e.target.dataset.subTitle; if (i != null) draft.subtasks[i].title = e.target.value;
});
$('#tdSubs').addEventListener('change', e => {
  const i = e.target.dataset.subCheck; if (i == null) return;
  draft.subtasks[i].done = e.target.checked; e.target.closest('li').classList.toggle('done-step', e.target.checked);
});
$('#tdStart').addEventListener('change', e => {
  // keep a one-hour block by default when the start time is picked first
  const s = e.target.value, end = $('#tdEnd');
  if (s && (!end.value || toMin(end.value) <= toMin(s))) end.value = fromMin(Math.min(toMin(s) + 60, 23 * 60 + 59));
});
$('#habitAdd').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#habitName').value.trim(); if (!name) return;
  state.habits.push(newHabit({ name })); $('#habitName').value = ''; commit();
});
$('#habitForm').addEventListener('submit', e => {
  e.preventDefault();
  const days = $$('#hdDays input:checked').map(i => Number(i.value));
  if (!$('#hdName').value.trim() || !days.length) return;
  habitDraft.name = $('#hdName').value.trim(); habitDraft.days = days;
  if (habitDraft.remindTime !== $('#hdRemind').value) habitDraft.remindedOn = '';
  habitDraft.remindTime = $('#hdRemind').value;
  $('#habitDialog').close(); commit();
});
$('#noteTitle').addEventListener('input', noteInput);
$('#noteBody').addEventListener('input', noteInput);
$('#noteSearch').addEventListener('input', e => { ui.noteSearch = e.target.value.trim(); renderNotes(); });
$('#focusTask').addEventListener('change', e => { timer().taskId = e.target.value; save(); });
$('#tickSound').addEventListener('change', e => { state.settings.tickSound = e.target.value; save(); renderFocus(); if (e.target.value !== 'off') previewTick(); });
$('#tickVol').addEventListener('change', e => { state.settings.tickVol = Number(e.target.value); save(); previewTick(); });
$('#autoPip').addEventListener('change', e => { state.settings.autoPip = e.target.checked; save(); });
$('#themeQuick').addEventListener('change', e => { state.settings.theme = e.target.value; commit(); });
$('#setSound').addEventListener('change', e => { state.settings.sound = e.target.checked; save(); });
[['#setWork', 'work', 99], ['#setShort', 'short', 99], ['#setLong', 'long', 99], ['#setRounds', 'rounds', 12]].forEach(([sel, key, max]) => {
  $(sel).addEventListener('change', e => {
    const v = Math.max(1, Math.min(max, Math.round(Number(e.target.value)) || DEFAULT_SETTINGS[key]));
    state.settings[key] = v; e.target.value = v;
    const t = timer(); if (!t.running && t.remaining === t.length) setMode(t.mode);
    save();
  });
});
$('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; });
window.addEventListener('storage', e => { if (e.key === STORE_KEY) { state = loadState(); render(); } });
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ================= clock loop ================= */
let lastDay = today(), loops = 0, lastLoop = 0;
function clockTick() {
  // runs from both the main window and the floating timer; skip if the other just ran
  if (Date.now() - lastLoop < 500) return;
  lastLoop = Date.now();
  const t = timer();
  if (t.running && remainingMs(t) <= 0) finishTimer(false);
  updateTimerDisplay();
  if (loops % 2 === 0) pingDesktopTimer();
  if (loops % 3 === 0) pullTimer();
  if (++loops % 15 === 0) {
    checkReminders();
    if (today() !== lastDay) { lastDay = today(); render(); }
    else if (ui.page === 'calendar' && ui.cal.mode === 'week' && loops % 60 === 0) renderCalendar();
  }
}

/* ================= start ================= */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});
go(location.hash.slice(1) || 'tasks');
(async () => {
  // take the desktop timer's newer state (e.g. paused while Lister was closed) before the clock runs
  await pullTimer();
  lastTimerKey = desktopApp ? '' : timerKey(timer()); // the Windows app's corner timer needs the first state
  syncReady = true;
  if (desktopApp) {
    desktopApp.onAction(a => { if (a === 'start') startPause(false); else if (a === 'skip') finishTimer(true); });
    document.documentElement.classList.add('in-desktop-app');
  }
  checkReminders();
  setInterval(clockTick, 1000);
  syncTimer();
})();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { pullTimer(); pingDesktopTimer(); } });
