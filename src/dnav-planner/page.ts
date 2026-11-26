// The Solo Dnav Planner page (#/dnav-planner): pick a crew size and move times, and see the fastest lines one
// pirate can play to clear each Woodhallow werewolf wave, with what the werewolf bar reads after every move.
import { BOOCH_BOARD, START_BOARD, TIME_FIELDS, TRIPLE_BOARD, lineName, mostWithin, plan, wave, type Line, type TimeId, type Times } from './plan';

const CREWS = Array.from({ length: 12 }, (_, i) => i + 1);
const KEY = 'puzzle-practice:dnav-planner:';

/** How much time a line leaves: orange under 30 seconds, green over 2 minutes, blue in between. */
const leftClass = (left: number) => (left < 30 ? 'close' : left > 120 ? 'roomy' : 'ok');

const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(KEY + key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(KEY + key, value); } catch { /* nothing persists */ }
  },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

/** m:ss, whole seconds rounded down, so a clock never shows more time than there is. */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const points = (p: number) => Math.round(p).toLocaleString('en-GB');

function numberInput(id: string, value: string, min: number, max: number, placeholder = ''): HTMLInputElement {
  const input = el('input');
  Object.assign(input, { id, type: 'number', min: String(min), max: String(max), step: '1', value, placeholder });
  return input;
}

export function showDnavPlanner(app: HTMLElement): void {
  document.title = 'Solo Dnav Planner · Puzzle Practice';
  const saved = Number.parseInt(store.get('crew') ?? '', 10);
  let crew = CREWS.includes(saved) ? saved : 4;

  const crewButtons = CREWS.map((n) => {
    const b = el('button', '', String(n));
    b.type = 'button';
    b.addEventListener('click', () => { crew = n; store.set('crew', String(n)); render(); });
    return b;
  });
  const crewGroup = el('div', 'dp-crew', ...crewButtons);
  crewGroup.setAttribute('role', 'group');
  crewGroup.setAttribute('aria-labelledby', 'dp-crew-label');

  // Deaths so far this run. Not saved: it's reset at the start of each run.
  let deaths = 0;
  const deathCount = el('output', 'dp-deaths-count', '0');
  deathCount.setAttribute('aria-live', 'polite');
  const stepButton = (label: string, aria: string, change: () => number) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', () => { deaths = change(); render(); });
    return b;
  };
  const fewer = stepButton('\u2212', 'One fewer death', () => deaths - 1);
  const more = stepButton('+', 'One more death', () => deaths + 1);
  const reset = el('button', '', 'Reset');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Reset deaths to 0');
  // Ctrl-click (or Cmd-click) also brings back the frays marked done, for a new run.
  reset.addEventListener('click', (event) => {
    deaths = 0;
    if (event.ctrlKey || event.metaKey) done.clear();
    render();
  });
  const deathsGroup = el('div', 'dp-crew dp-deaths', fewer, deathCount, more, reset);
  deathsGroup.setAttribute('role', 'group');
  deathsGroup.setAttribute('aria-labelledby', 'dp-deaths-label');
  const deathsLabel = el('span', 'dp-label', 'Deaths');
  deathsLabel.id = 'dp-deaths-label';

  // Frays already played, hidden so the next one is near the top. Not saved, like deaths.
  const done = new Set<number>();
  const frayName = (fray: number) => (fray === 6 ? 'Lair' : String(fray));
  const doneButtons = [2, 3, 4, 5, 6].map((fray) => {
    const b = el('button', '', frayName(fray));
    b.type = 'button';
    b.setAttribute('aria-label', fray === 6 ? 'Before the lair' : `Before fray ${fray}`);
    b.addEventListener('click', () => {
      if (done.has(fray)) done.delete(fray);
      else done.add(fray);
      render();
    });
    return b;
  });
  const doneGroup = el('div', 'dp-crew', ...doneButtons);
  doneGroup.setAttribute('role', 'group');
  doneGroup.setAttribute('aria-labelledby', 'dp-done-label');
  const doneLabel = el('span', 'dp-label', 'Frays done');
  doneLabel.id = 'dp-done-label';

  const timeInputs = new Map<TimeId, HTMLInputElement>();
  const timeFields = TIME_FIELDS.map(({ id, label, def }) => {
    const input = numberInput(`dp-${id}`, store.get(`time-${id}`) ?? String(def), 1, 300, 'off');
    input.addEventListener('input', () => { store.set(`time-${id}`, input.value); render(); });
    timeInputs.set(id, input);
    const name = el('label', '', `${label} (s)`);
    name.htmlFor = input.id;
    return el('div', 'dp-field', name, input);
  });

  const compact = el('input');
  compact.type = 'checkbox';
  compact.id = 'dp-compact';
  compact.checked = store.get('compact') === '1';
  compact.addEventListener('change', () => { store.set('compact', compact.checked ? '1' : '0'); render(); });
  const within = numberInput('dp-within', store.get('within') ?? '5', 0, 60);
  within.setAttribute('aria-label', 'Seconds slower than the fastest line');
  within.addEventListener('input', () => { store.set('within', within.value); render(); });
  const compactLabel = el('label', 'dp-check', compact, 'Compact: hide the steps, and lines more than ');
  compactLabel.htmlFor = compact.id;

  const crewLabel = el('span', 'dp-label', 'Crew size');
  crewLabel.id = 'dp-crew-label';
  const controls = el(
    'section',
    'dp-controls',
    el('div', 'dp-field', crewLabel, crewGroup),
    el('div', 'dp-row', ...timeFields),
    el('p', 'dp-hint', 'Leave a time blank to plan without that move. Donkey and Vegas times start after the Booch that sets them up; the planner adds your Booch time on top.'),
    el('div', 'dp-check', compactLabel, within, ' s slower than the fastest'),
    // Last, so it's nearest the frays when a player scrolls back up mid-run.
    el('div', 'dp-row', el('div', 'dp-field', deathsLabel, deathsGroup), el('div', 'dp-field', doneLabel, doneGroup)),
  );
  controls.setAttribute('aria-label', 'Settings');

  const frays = el('div', 'dp-frays');
  const back = el('a', 'back', '← All puzzles');
  back.href = '#/';

  app.replaceChildren(
    el('header', 'bar', back, el('h1', '', 'Solo Dnav Planner')),
    el(
      'main',
      'dp',
      el('p', 'dp-lede', 'Find the quickest way to clear each Dennav solo using the time it takes you to clear constellations.'),
      controls,
      rules(),
      frays,
    ),
    el('footer', 'about', el('p', 'credits', 'Based on Puzzle Pirates, created by Three Rings Design and now operated by Grey Havens.')),
  );

  function render(): void {
    if (!frays.isConnected) return;
    crewButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(CREWS[i] === crew)));
    // At least one pirate is left standing to navigate.
    deaths = Math.min(Math.max(0, deaths), crew - 1);
    deathCount.textContent = String(deaths);
    fewer.disabled = deaths === 0;
    reset.disabled = deaths === 0 && done.size === 0;
    more.disabled = deaths >= crew - 1;
    doneButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(done.has(i + 2))));
    const times = {} as Times;
    for (const [id, input] of timeInputs) {
      const value = Number.parseInt(input.value, 10);
      times[id] = value > 0 ? value : -1;
    }
    const slack = Math.max(0, Number(within.value) || 0);
    frays.classList.toggle('compact', compact.checked);
    const cards: HTMLElement[] = [];
    for (let fray = 2; fray <= 6; fray++) {
      const w = wave(crew, fray, deaths);
      const lines = plan(w.need, times);
      const head = el(
        'div',
        'dp-fray-head',
        el('h2', '', fray === 6 ? 'Before the lair' : `Before fray ${fray}`),
        meta(`${w.wolves.toFixed(2)}`, ` werewolves of Dnav (you fight ${w.shown.join(' or ')})`),
        meta(points(w.need), ` of ${points(w.total)} points to clear`, true),
        meta(mmss(w.time), ' Dnav time'),
      );
      const options = el('div', 'dp-lines');
      const fastest = lines[0]?.t ?? 0;
      if (!lines.length || fastest > w.time) {
        const most = mostWithin(w.time, times);
        options.append(most
          ? shortCard(most, w.total, w.need, w.time)
          : el('p', 'dp-note', TIME_FIELDS.some(({ id }) => id !== 'booch' && times[id] > 0)
            ? 'None of the moves you\u2019ve timed fit in the time.'
            : 'Enter how long your moves take above to see the fastest lines.'));
      } else {
        lines.forEach((line, i) => {
          if (line.t > w.time) return;
          const card = lineCard(line, i === 0, fastest, w.total, w.time);
          card.hidden = compact.checked && line.t > fastest + slack;
          options.append(card);
        });
      }
      const card = el('section', 'dp-fray', head, options);
      card.hidden = done.has(fray);
      cards.push(card);
    }
    frays.replaceChildren(...cards);
  }
  render();
}

function meta(value: string, rest: string, extra = false): HTMLElement {
  return el('span', `dp-meta${extra ? ' extra' : ''}`, el('b', '', value), rest);
}

function lineCard(line: Line, best: boolean, fastest: number, total: number, time: number): HTMLElement {
  const tag = best
    ? el('span', 'dp-tag fast', `Fastest, ${mmss(line.t)}`)
    : el('span', 'dp-tag', `${mmss(line.t)}, ${line.t - fastest} s slower`);
  return el(
    'div',
    `dp-line${best ? ' best' : ''}${line.special ? ' special' : ''}`,
    el('div', 'dp-line-top', el('span', 'dp-line-name', lineName(line)), tag),
    stepsTable(line, total),
    el('div', `dp-spare ${leftClass(time - line.t)}`, `Done at ${mmss(line.t)} with ${mmss(time - line.t)} left of ${mmss(time)}`),
  );
}

/** A wave that can't be cleared in time: the most points one pirate can score before the Dnav ends. */
function shortCard(line: Line, total: number, need: number, time: number): HTMLElement {
  const left = Math.max(0, total - line.pts);
  const wolvesLeft = Math.floor(left / 200 + 0.5);
  return el(
    'div',
    'dp-line short',
    el('div', 'dp-line-top', el('span', 'dp-line-name', lineName(line)), el('span', 'dp-tag late', `Can’t clear in ${mmss(time)}`)),
    stepsTable(line, total),
    el('div', 'dp-spare short', `Most in ${mmss(time)}: ${points(line.pts)} points, ${points(need - line.pts)} short. The bar ends at ${(100 * left / total).toFixed(0)}% with ${wolvesLeft} ${wolvesLeft === 1 ? 'werewolf' : 'werewolves'} left.`),
  );
}

function stepsTable(line: Line, total: number): HTMLElement {
  const rows = line.steps.map((step) => {
    const left = Math.max(0, total - step.pts);
    return el(
      'tr',
      '',
      el('td', '', step.what),
      el('td', '', mmss(step.t)),
      el('td', '', points(step.pts)),
      el('td', '', `${(100 * left / total).toFixed(0)}%`),
      el('td', '', String(Math.floor(left / 200 + 0.5))),
    );
  });
  const head = el('tr', '', ...['Move', 'At', 'Points', 'Bar', 'Wolves'].map((h) => el('th', '', h)));
  return el('div', 'dp-steps-wrap', el('table', 'dp-steps', el('thead', '', head), el('tbody', '', ...rows)));
}

function rules(): HTMLElement {
  const code = (text: string) => el('code', '', text);
  const p = (...parts: (Node | string)[]) => el('p', '', ...parts);
  const boards = [START_BOARD, BOOCH_BOARD, TRIPLE_BOARD];
  const boardName = (board: number) => (board === START_BOARD ? '1-2-1' : board === BOOCH_BOARD ? '3-2-1' : '4-2-1');
  const rows: [string, (board: number) => string, number][] = [
    ['Booch', () => '0', BOOCH_BOARD],
    ['Single', (b) => points(b), BOOCH_BOARD],
    ['Double', (b) => points(2 * b), BOOCH_BOARD],
    ['Triple', (b) => points(3 * b), TRIPLE_BOARD],
    ['Bingo', (b) => points(4 * b), TRIPLE_BOARD],
    ['Donkey', (b) => points(5 * b), TRIPLE_BOARD],
    ['Vegas', (b) => points(6 * b), TRIPLE_BOARD],
  ];
  const table = el(
    'table',
    'dp-steps dp-values',
    el('thead', '', el('tr', '', ...['Clear', ...boards.map((b) => `On ${boardName(b)}`), 'Leaves'].map((h) => el('th', '', h)))),
    el('tbody', '', ...rows.map(([name, score, leaves]) =>
      el('tr', '', el('td', '', name), ...boards.map((b) => el('td', '', score(b))), el('td', '', boardName(leaves))))),
  );
  return el(
    'details',
    'dp-rules',
    el('summary', '', 'How scoring works'),
    p('Every Dnav starts on a 1-2-1 board. Each clear leaves a 3-2-1 or a 4-2-1 board, and what the next clear scores depends on which board it’s played on.'),
    el('div', 'dp-steps-wrap', table),
    p('A Booch scores nothing but swaps a 1-2-1 board for a 3-2-1 one, so it’s only worth opening with. The planner always plays a Donkey or Vegas straight after a Booch, as a Booch-donkey or Booch-Vegas, so it scores what the table shows on a 3-2-1 board and can go anywhere, as often as you like.'),
    p('A cascade single is slower, because you set up the board to keep playing, but can go anywhere. A finishing single is quick but only ever ends a line.'),
    p('Each werewolf is worth ', code('200'), ' points. The werewolves left are rounded to the nearest whole werewolf, so you never need to clear the last half of one: once less than ', code('100'), ' points are left, the count rounds to 0 and the wave is cleared.'),
    p('Wave size is 200 × pack × werewolf share, unrounded, where pack = max(crew, 4) × 1.3', el('sup', '', 'fray − 1'), ' and share = 0.4 + 0.1 × fray. The game rounds the pack, partly at random, to decide how many werewolves you fight, so that number can be one off. The Dnav you need always uses the unrounded size.'),
    p('The Dnav lasts 2:00 before fray 2. After that it lasts 2:00 + 3:00 \u00d7 survivors \u00f7 crew, so 5:00 if nobody has died. Set Deaths at the top to plan with less time.'),
    p('Each fray shows up to three of the fastest different ways to clear it, or the most you can score if you can\u2019t clear it in time.'),
  );
}
