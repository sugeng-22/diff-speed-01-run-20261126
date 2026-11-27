// diff-speed-01-run-20261126: a faster drop-in for makefun-diff 1.0.0.
//
// run(input) returns makefun-diff 1.0.0's patch of input { old, new }, byte for byte, by the same rule the
// reference states: lines cut after every "\n" (a "\r" is part of its line; a last line without one is a line
// too, and lines are equal only as whole code units, newline included); the common prefix of lines kept, then
// the common suffix of the rest; between them Myers's greedy search from the first lines, furthest into the
// old text wins on each diagonal and the deletion wins a tie, no move past either text's end, no edge pruning,
// every run of equal lines followed as far as it goes; the patch with its header line, hunks of up to 3 kept
// lines of context (runs at most 6 kept lines apart share a hunk), each change run's deletions before its
// insertions, and a "%" line after any line written that ends its text with no newline.
//
// Where the speed comes from (same algorithm, cheaper machinery):
// - Lines are interned to integer ids once per case (content id shifted, plus a bit for "no trailing newline"),
//   so every equality test in the search is an integer compare on Int32Arrays, never a string compare, and no
//   per-line string is built beyond the split the texts arrive by.
// - The search keeps no path objects and no linked lists: it stores each level's furthest-x array in one flat
//   Int32Array (level d occupies [d*d, (d+1)*(d+1)), diagonal k at d*d + k + d) and reconstructs the script by
//   walking the levels back with the very same candidate comparison the forward pass makes, so the script it
//   returns is the reference's own, tie-breaks included.

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

/** A text's parts (split on "\n") and its lines as interned integer ids. Line i's text is parts[i], with a
 *  trailing "\n" exactly when i < parts.length - 1; the id's low bit marks a last line that has none. */
function tokenize(text, intern) {
  const parts = text.split('\n');
  const L = parts.length;
  const n = L - 1 + (parts[L - 1] !== '' ? 1 : 0);
  const ids = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const s = parts[i];
    let id = intern.get(s);
    if (id === undefined) {
      id = intern.size;
      intern.set(s, id);
    }
    ids[i] = (id << 1) | (i < L - 1 ? 0 : 1);
  }
  return { parts, L, n, ids };
}

/** The middle's edit runs, appended to `runs` as { kind, count } with no two neighbours alike in kind.
 *  A and B are the middle slices as id arrays (views are fine). Mirrors the reference's search exactly. */
function editRuns(A, B, runs) {
  const N = A.length;
  const M = B.length;
  if (N === 0) {
    if (M > 0) runs.push({ kind: INSERT, count: M });
    return;
  }
  if (M === 0) {
    runs.push({ kind: DELETE, count: N });
    return;
  }

  // Level 0: the path of no edits, extended along the opening run of equal lines.
  let x0 = 0;
  while (x0 < N && x0 < M && A[x0] === B[x0]) x0++;

  // Flat history of furthest-x per diagonal: level d at [d*d, (d+1)*(d+1)), diagonal k at d*d + k + d.
  // Values are stored as x + 1 so a zeroed array reads as "no path reaches here" (decoded by the -1 below);
  // the slots a level's edge reads land on are ones no level ever writes, so they read as unreached too.
  // Grown by doubling the level capacity; indices do not depend on it.
  let capD = 4096;
  let hist = new Int32Array((capD + 1) * (capD + 1));
  hist[0] = x0 + 1;

  let D = x0 === N && x0 === M ? 0 : -1;
  for (let d = 1; D < 0; d++) {
    if (d > capD) {
      const grown = new Int32Array((capD * 2 + 1) * (capD * 2 + 1));
      grown.set(hist);
      hist = grown;
      capD *= 2;
    }
    const base = d * d - d; // level d-1: diagonal k-1 at base + k - 1, k+1 at base + k + 1
    let wi = d * d; // level d: diagonal k at d*d + k + d, stepped by 2 from k = -d
    let rawRm = hist[base - d - 1]; // diagonal -d-1 of level d-1: a slot no level writes, reads 0
    for (let k = -d; k <= d; k += 2) {
      const rawAd = hist[base + k + 1];
      const rm = rawRm - 1;
      const ad = rawAd - 1;
      const canR = rm >= 0 && rm < N;
      const canA = ad >= 0 && ad - k <= M;
      let x;
      if (canR && (!canA || rm >= ad - 1)) x = rm + 1; // deletion: furthest into the old text, ties included
      else if (canA) x = ad; // insertion
      else {
        hist[wi] = 0;
        wi += 2;
        rawRm = rawAd; // diagonal k+1 of level d-1 is diagonal (k+2)-1: the next cell's deletion candidate
        continue;
      }
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x++;
        y++;
      }
      hist[wi] = x + 1;
      if (x === N && y === M) {
        D = d;
        break;
      }
      wi += 2;
      rawRm = rawAd;
    }
  }

  if (D === 0) {
    if (x0 > 0) runs.push({ kind: KEEP, count: x0 });
    return;
  }

  // Walk the levels back from (N, M), re-making the forward pass's own choice at each level (the candidates
  // and their comparison are the same numbers), collecting the script's segments in reverse and merging
  // neighbours of a kind, exactly as the reference's path components merge.
  const segs = [];
  const pushSeg = (kind, count) => {
    if (count <= 0) return;
    const last = segs[segs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else segs.push({ kind, count });
  };
  let cx = N;
  let cy = M;
  for (let d = D; d >= 1; d--) {
    const k = cx - cy;
    const base = d * d - d;
    const rm = hist[base + k - 1] - 1;
    const ad = hist[base + k + 1] - 1;
    const canR = rm >= 0 && rm < N;
    const canA = ad >= 0 && ad - k <= M;
    if (canR && (!canA || rm >= ad - 1)) {
      const xs = rm + 1;
      const ys = xs - k;
      pushSeg(KEEP, cx - xs);
      pushSeg(DELETE, 1);
      cx = xs - 1;
      cy = ys;
    } else {
      const xs = ad;
      const ys = xs - k;
      pushSeg(KEEP, cx - xs);
      pushSeg(INSERT, 1);
      cx = xs;
      cy = ys - 1;
    }
  }
  pushSeg(KEEP, cx); // the opening run of level 0 (cx === cy on diagonal 0)
  for (let i = segs.length - 1; i >= 0; i--) runs.push(segs[i]);
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on its own line when it had none. */
function written(out, op, parts, L, i) {
  if (i < L - 1) out.push(op, parts[i], '\n');
  else out.push(op, parts[i], '\n%\n');
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const intern = new Map();
  const a = tokenize(input.old, intern);
  const b = tokenize(input.new, intern);
  const n = a.n;
  const m = b.n;
  const aIds = a.ids;
  const bIds = b.ids;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  editRuns(aIds.subarray(prefix, n - suffix), bIds.subarray(prefix, m - suffix), runs);
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const aParts = a.parts;
  const aL = a.L;
  const bParts = b.parts;
  const bL = b.L;
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) written(out, KEEP, aParts, aL, at);
      for (let i = 0; i < c.dels; i++) written(out, DELETE, aParts, aL, c.o + i);
      for (let i = 0; i < c.ins; i++) written(out, INSERT, bParts, bL, c.p + i);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) written(out, KEEP, aParts, aL, at);
  }
  return out.join('');
}
