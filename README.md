# diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/sugeng-22/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/sugeng-22/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for makefun-diff 1.0.0: `solve.js` exports `run(input)`, which returns make.fun's own patch of
the case's `{ old, new }` texts — byte for byte the reference's answer, Myers greedy search, deletion-wins-ties
and 3-line-context hunks included — and `main.ts` is the harness driver that answers every case in
`/input/cases.json` into `/output/answers.json`. The speed comes from cheaper machinery for the same algorithm:
lines interned to integer ids so the search compares integers on typed arrays instead of strings, and the
search's per-level furthest-x frontiers kept in one flat Int32Array (no path objects, no linked lists), with
the edit script reconstructed by walking the levels back under the forward pass's own tie-break rule.

## Run it

```sh
node main.ts # reads /input/cases.json, writes /output/answers.json (MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR override the directories)
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=sunny-tapir-53-6177&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
