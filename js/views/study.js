// Study mode: flashcards over the JLPT levels, with a light spaced schedule.
//
// Three directions, because recognising a kanji is three separate skills:
//   meaning   kanji -> pick the meaning
//   reading   pick the kana the character takes in a real word
//   recall    meaning -> pick the kanji

import { el, shuffle, pick, toast } from '../util.js';
import { data, progress, LEVEL_LABEL, LEVELS } from '../store.js';

const MODES = [
  { id: 'meaning', label: 'Meaning' },
  { id: 'reading', label: 'Reading' },
  { id: 'recall', label: 'Recall' },
];

const SESSION = 12;

export async function render(segs, mount) {
  await data.loadIndex();

  // The route hash is already decoded by the router.
  const focus = segs[0] || null;

  const state = {
    levels: new Set(LEVELS),
    mode: 'meaning',
    words: new Map(),   // card -> the word it is being asked about
    queue: [],
    at: 0,
    right: 0,
    wrong: 0,
    answered: false,
    results: [],          // per card, so misses can be re-queued
  };

  await data.loadAllLevels();
  const all = data.allKanji();

  /* ---- setup screen ---- */

  const head = el('div', { className: 'view-head' },
    el('h1', null, 'Study'),
    el('p', null, 'Short daily sessions. Cards you get right come back later; cards you miss come back immediately.'));

  const stats = el('div', { className: 'stat-row' });
  function refreshStats() {
    const s = progress.stats();
    stats.replaceChildren(
      el('span', null, el('b', null, String(s.known)), ' known'),
      el('span', null, el('b', null, String(s.learning)), ' learning'),
      el('span', null, el('b', null, String(s.total)), ' seen'));
  }
  refreshStats();

  const modeSeg = el('div', { className: 'seg' },
    MODES.map((m) => el('button', {
      type: 'button',
      'aria-pressed': String(state.mode === m.id),
      onclick: (e) => {
        state.mode = m.id;
        for (const b of modeSeg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      },
    }, m.label)));

  const levelSeg = el('div', { className: 'seg' },
    LEVELS.map((lv) => {
      const btn = el('button', {
        type: 'button',
        'aria-pressed': String(state.levels.has(lv)),
        onclick: (e) => {
          if (state.levels.has(lv)) state.levels.delete(lv); else state.levels.add(lv);
          if (!state.levels.size) state.levels.add(lv);
          e.currentTarget.setAttribute('aria-pressed', String(state.levels.has(lv)));
        },
      }, LEVEL_LABEL[lv]);
      return btn;
    }));

  const dueOnly = el('input', { type: 'checkbox' });

  mount.append(head, stats,
    el('div', { className: 'card', style: { padding: '18px', marginTop: '16px' } },
      el('div', { className: 'row', style: { marginBottom: '12px' } },
        el('span', { style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-faint)', fontWeight: '700' } }, 'Mode'),
        modeSeg),
      el('div', { className: 'row' },
        el('span', { style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-faint)', fontWeight: '700' } }, 'Levels'),
        levelSeg),
      el('div', { className: 'row', style: { marginTop: '14px' } },
        el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--ink-soft)' } },
          dueOnly, 'Only cards due for review'),
        el('span', { style: { flex: '1' } }),
        el('button', { className: 'btn primary', type: 'button', onclick: start }, 'Start session'),
        el('button', {
          className: 'btn', type: 'button',
          onclick: () => { progress.reset(); refreshStats(); toast('Progress cleared'); },
        }, 'Reset progress'))));

  return {};

  /* ---- session ---- */

  function start() {
    // "Quiz me on this" drills the one character; otherwise the pool is whatever
    // the level and due filters leave.
    const inScope = focus
      ? all.filter((k) => k.c === focus)
      : all.filter((k) => state.levels.has(k.lv));
    const pool = dueOnly.checked ? inScope.filter((k) => progress.isDue(k.c)) : inScope;

    const source = pool.length ? pool : inScope;
    if (!source.length) {
      toast(focus ? `No study data for ${focus}` : 'No kanji in the selected levels');
      return;
    }

    // Anything with a usable example word is required for the reading drill.
    const usable = state.mode === 'reading' ? source.filter((k) => k.w && k.w.length) : source;
    state.words.clear();
    state.queue = shuffle(usable).slice(0, SESSION);
    state.at = 0;
    state.right = 0;
    state.wrong = 0;
    state.results = [];
    renderCard();
  }

  function current() {
    return state.queue[state.at];
  }

  function renderCard() {
    const card = current();
    mount.replaceChildren();

    if (!card) return renderSummary();

    const body = el('div', { className: 'card quiz-card' });
    body.appendChild(questionFor(card));

    const choices = el('div', { className: 'choice-grid' });
    body.appendChild(choices);

    const nextBtn = el('button', { className: 'btn primary', type: 'button', style: { marginTop: '18px', display: 'none' }, onclick: advance },
      'Next');
    body.appendChild(nextBtn);

    const bar = el('div', { className: 'progress-line' },
      el('span', { style: { fontSize: '13px', color: 'var(--ink-soft)' } }, `${state.at + 1} / ${state.queue.length}`),
      el('span', { className: 'progress-track' }, el('span', { style: { width: `${(state.at / state.queue.length) * 100}%` } })),
      el('span', { style: { fontSize: '13px', color: 'var(--ink-soft)' } }, `${state.right}✓ ${state.wrong}✗`));

    const back = el('a', { className: 'back-link', href: '#/study' }, '← End session');
    mount.append(back, body, bar);

    for (const option of choicesFor(card)) {
      choices.appendChild(el('button', {
        className: 'choice',
        type: 'button',
        onclick: (e) => answer(card, option, e.currentTarget, choices, nextBtn),
      }, option.text));
    }
  }

  /**
   * The word a card is being asked about. Chosen once and remembered: the
   * question, the choices and the later grading must all agree on it, and
   * pick() is random.
   */
  function wordFor(card) {
    if (!card.w || !card.w.length) return null;
    if (!state.words.has(card)) state.words.set(card, pick(card.w));
    return state.words.get(card);
  }

  function questionFor(card) {
    if (state.mode === 'meaning') {
      return el('div', null,
        el('div', { className: 'quiz-prompt' }, `What does this mean? · ${LEVEL_LABEL[card.lv]}`),
        el('div', { className: 'quiz-kanji' }, card.c));
    }
    if (state.mode === 'recall') {
      return el('div', null,
        el('div', { className: 'quiz-prompt' }, 'Which kanji is this? · ' + LEVEL_LABEL[card.lv]),
        el('div', { className: 'quiz-kanji sm' }, (card.mn || []).slice(0, 3).join(', ') || '—'));
    }
    // reading
    const word = wordFor(card);
    return el('div', null,
      el('div', { className: 'quiz-prompt' }, `How is this kanji read in this word? · ${LEVEL_LABEL[card.lv]}`),
      el('div', { className: 'quiz-kanji sm' }, word[0].split('').map((ch, i) =>
        ch === card.c ? el('span', { style: { color: 'var(--accent)' } }, ch) : ch)),
      el('div', { className: 'quiz-prompt', style: { marginTop: '8px' } }, word[3]));
  }

  function choicesFor(card) {
    const distractors = shuffle(all.filter((k) => k.c !== card.c)).slice(0, 8);

    if (state.mode === 'meaning') {
      const right = (card.mn || []).slice(0, 2).join(', ') || '—';
      return shuffle([
        { text: right, correct: true },
        ...distractors.map((d) => ({ text: (d.mn || []).slice(0, 2).join(', ') || '—' })),
      ]).slice(0, 4);
    }

    if (state.mode === 'recall') {
      return shuffle([
        { text: card.c, correct: true },
        ...distractors.map((d) => ({ text: d.c })),
      ]).slice(0, 4);
    }

    // reading: the kana this character actually takes in that word, against
    // kanas it takes in other words and other kanji's kanas.
    const word = wordFor(card);
    const answer = word[2].trim().split(/\s+/)[word[4]];
    // Readings this same kanji takes in other words, plus readings other kanji
    // take, de-duplicated: two identical buttons would make the drill unfair.
    const seen = new Set([answer]);
    const others = [];
    for (const w of shuffle(all.flatMap((k) => k.w || []))) {
      const i = [...w[0]].indexOf(card.c);
      if (i < 0) continue;
      const rd = w[2].trim().split(/\s+/)[i];
      if (!rd || seen.has(rd)) continue;
      seen.add(rd);
      others.push(rd);
      if (others.length >= 3) break;
    }

    return shuffle([{ text: answer, correct: true }, ...others.map((t) => ({ text: t }))]).slice(0, 4);
  }

  function answer(card, option, button, choices, nextBtn) {
    if (state.answered) return;
    state.answered = true;

    const ok = !!option.correct;
    if (ok) state.right++; else state.wrong++;
    state.results[state.at] = ok;
    progress.mark(card.c, ok);

    for (const b of choices.children) {
      b.disabled = true;
      if (b === button) b.classList.add(ok ? 'correct' : 'wrong');
      else if (b.textContent === correctAnswerText(card)) b.classList.add('correct');
    }
    if (!ok) reveal(card);

    nextBtn.style.display = '';
    nextBtn.focus();
  }

  function correctAnswerText(card) {
    if (state.mode === 'recall') return card.c;
    if (state.mode === 'meaning') return (card.mn || []).slice(0, 2).join(', ') || '—';
    const word = wordFor(card);
    return word[2].trim().split(/\s+/)[word[4]];
  }

  /** Show the answer after a miss. */
  function reveal(card) {
    const parts = [`${card.c} · ${(card.mn || []).slice(0, 4).join(', ')}`];
    const on = (card.on || []).slice(0, 3).join(' ');
    const kun = (card.kun || []).slice(0, 4).join(' ');
    if (on) parts.push(`on: ${on}`);
    if (kun) parts.push(`kun: ${kun}`);
    mount.querySelector('.quiz-card').appendChild(
      el('div', { className: 'quiz-answer' },
        el('div', { style: { fontFamily: 'var(--japanese)', fontSize: '54px' } }, card.c),
        el('div', { style: { color: 'var(--ink-soft)', fontSize: '14.5px', marginTop: '6px' } }, parts.join('  ·  '))));
  }

  function advance() {
    state.answered = false;
    // A missed card comes back once more before the session ends.
    if (state.results[state.at] === false) {
      state.queue.push(state.queue[state.at]);
      state.results.push(undefined);
    }
    state.at++;
    renderCard();
  }

  function renderSummary() {
    const total = state.right + state.wrong;
    const pct = total ? Math.round((state.right / total) * 100) : 0;
    refreshStats();
    mount.replaceChildren(
      el('div', { className: 'view-head' },
        el('h1', null, 'Session complete'),
        el('p', null, `${state.right} right, ${state.wrong} to review.`)),
      el('div', { className: 'card quiz-card' },
        el('div', { className: 'quiz-kanji sm' }, `${pct}%`),
        el('div', { className: 'stat-row', style: { justifyContent: 'center', marginTop: '10px' } },
          el('span', null, el('b', null, String(state.right)), ' correct'),
          el('span', null, el('b', null, String(state.wrong)), ' missed')),
        el('div', { className: 'row', style: { justifyContent: 'center', marginTop: '20px' } },
          el('button', { className: 'btn primary', type: 'button', onclick: () => { location.hash = '#/study'; } }, 'Back to setup'),
          el('button', { className: 'btn', type: 'button', onclick: start }, 'Another session'))));
  }
}