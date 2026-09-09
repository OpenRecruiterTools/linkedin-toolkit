/**
 * A jsdom stand-in for LinkedIn's "Following" manager.
 *
 * Modelled on the real page as captured 2026-09-09 (web client 1.13.46516):
 *
 *   - a header line, "You are following 30 people out of your network",
 *     which is the only place the *total* appears — the DOM never holds
 *     more than the pages that have been scrolled into it;
 *   - about 20 rows on first load, more appended when the page is scrolled
 *     to the bottom;
 *   - one toggle button per row whose accessible name is
 *     `Click to stop following <Full Name>`, which flips to
 *     `Click to follow <Full Name>` once the unfollow lands.
 *
 * Nothing here talks to LinkedIn. `window.scrollTo` is replaced with the
 * paging behaviour so the engine's real scroll path is what gets exercised.
 */

/** 30 invented people — two pages of the real page's ~20-row first load. */
export const FOLLOWING_NAMES = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Edsger Dijkstra',
  'Barbara Liskov',
  'Donald Knuth',
  'Margaret Hamilton',
  'Linus Torvalds',
  'Radia Perlman',
  'Ken Thompson',
  'Frances Allen',
  'Dennis Ritchie',
  'Jean Bartik',
  'Tim Berners-Lee',
  'Adele Goldberg',
  'Vint Cerf',
  'Karen Spärck Jones',
  'Bjarne Stroustrup',
  'Shafi Goldwasser',
  'Guido van Rossum',
  'Sophie Wilson',
  'James Gosling',
  'Anita Borg',
  'Rich Hickey',
  'Evelyn Boyd Granville',
  'John Carmack',
  'Mary Allen Wilkes',
  'Rasmus Lerdorf',
  'Erna Schneider Hoover',
];

const CHALLENGE_HTML = `
  <main>
    <h1>Let's do a quick security check</h1>
    <p>We noticed some unusual activity on your account. Please verify it's you.</p>
  </main>
`;

/**
 * Build the page into `document`.
 *
 * @param {{names?: string[], firstPage?: number, pageSize?: number,
 *          total?: number, challengeAfter?: number|null,
 *          headerTotal?: number|null}} [options]
 * @returns {{clicks: string[], loaded(): number, rows(): Element[],
 *            showChallenge(): void, scrolls: number}}
 */
export function mountFollowingPage(options = {}) {
  const names = options.names || FOLLOWING_NAMES;
  const total = options.total === undefined ? names.length : options.total;
  const firstPage = options.firstPage === undefined ? 20 : options.firstPage;
  const pageSize = options.pageSize === undefined ? 20 : options.pageSize;
  const challengeAfter =
    options.challengeAfter === undefined || options.challengeAfter === null
      ? null
      : options.challengeAfter;
  const headerTotal = options.headerTotal === undefined ? total : options.headerTotal;

  const state = { clicks: [], scrolls: 0, shown: 0 };

  document.body.textContent = '';
  const main = document.createElement('main');
  if (headerTotal !== null) {
    const header = document.createElement('h2');
    header.textContent = `You are following ${headerTotal.toLocaleString('en-GB')} people out of your network`;
    main.appendChild(header);
  }
  const list = document.createElement('ul');
  main.appendChild(list);
  document.body.appendChild(main);

  const showChallenge = () => {
    document.body.innerHTML = CHALLENGE_HTML;
  };

  const addRow = (name) => {
    const row = document.createElement('li');

    const link = document.createElement('a');
    link.setAttribute('href', `/in/${name.toLowerCase().replace(/[^a-z]+/g, '-')}/`);
    link.textContent = name;

    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', `Click to stop following ${name}`);
    button.textContent = 'Following';
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-label').startsWith('Click to follow')) return;
      state.clicks.push(name);
      // LinkedIn flips the same button rather than removing the row.
      button.setAttribute('aria-label', `Click to follow ${name}`);
      button.textContent = 'Follow';
      if (challengeAfter !== null && state.clicks.length >= challengeAfter) showChallenge();
    });

    row.appendChild(link);
    row.appendChild(button);
    list.appendChild(row);
  };

  const appendPage = (howMany) => {
    const upTo = Math.min(state.shown + howMany, total);
    for (let i = state.shown; i < upTo; i += 1) addRow(names[i % names.length]);
    const added = upTo - state.shown;
    state.shown = upTo;
    return added;
  };

  appendPage(firstPage);

  // The engine paginates by scrolling; this is the page answering it.
  window.scrollTo = () => {
    state.scrolls += 1;
    appendPage(pageSize);
  };

  return {
    clicks: state.clicks,
    get scrolls() {
      return state.scrolls;
    },
    loaded: () => state.shown,
    rows: () => Array.from(list.children),
    showChallenge,
  };
}
