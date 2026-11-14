/** Canonical hub pages, in default order. */
export const HUB_PAGE_NAMES: string[] = [
  'Today', 'Music', 'Focus', 'Shelf', 'Reminders', 'Water', 'Devices',
];

/**
 * Display titles for hub pages (1.1.0 design, matching the reference
 * screens). Canonical names stay stable because they are persisted in
 * the user's saved hub order/visibility; only the label changes.
 */
export const HUB_PAGE_TITLES: Record<string, string> = {
  Focus: 'Pomodoro',
  Reminders: 'TodoList',
};

export function pageTitle(name: string): string {
  return HUB_PAGE_TITLES[name] ?? name;
}

/**
 * Hub page order and visibility. `all` is the canonical page list.
 * The user's saved order wins where it names a known page, unknown or
 * missing names fall back to canonical order, hidden pages drop out.
 * At least one page always survives, so the hub can never be empty.
 */
export function orderPages(all: string[], order: string[], hidden: string[]): string[] {
  const hiddenSet = new Set(hidden);
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const name of [...order, ...all]) {
    if (!all.includes(name) || seen.has(name)) continue;
    seen.add(name);
    if (!hiddenSet.has(name)) picked.push(name);
  }
  return picked.length > 0 ? picked : [...all];
}

/** Move a page one step in the saved order. Returns a new list. */
export function movePage(order: string[], all: string[], name: string, delta: -1 | 1): string[] {
  // Work on the full ordered list (ignoring visibility) for reordering.
  const full: string[] = [];
  const seen = new Set<string>();
  for (const n of [...order, ...all]) {
    if (all.includes(n) && !seen.has(n)) { seen.add(n); full.push(n); }
  }
  const i = full.indexOf(name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= full.length) return full;
  const a = full[i]!;
  full[i] = full[j]!;
  full[j] = a;
  return full;
}
