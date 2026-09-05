const KEY = "gnomemepad.watchlist.v1";

export function loadWatchlist() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function watchKey(id, pkg = "") {
  return `${pkg || ""}::${id || ""}`;
}

export function isWatched(list, id, pkg = "") {
  const k = watchKey(id, pkg);
  return list.some((x) => watchKey(x.id, x.pkg) === k);
}

export function toggleWatch(list, item) {
  const k = watchKey(item.id, item.pkg);
  const exists = list.some((x) => watchKey(x.id, x.pkg) === k);
  const next = exists
    ? list.filter((x) => watchKey(x.id, x.pkg) !== k)
    : [
        ...list,
        {
          id: item.id,
          pkg: item.pkg || "",
          name: item.name || "",
          symbol: item.symbol || "",
          addedAt: Date.now(),
        },
      ];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}
