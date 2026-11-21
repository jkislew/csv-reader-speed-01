# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/jkislew/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/jkislew/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: `solve.js` answers every
CSV input exactly as the reference reader does — same columns, same rows,
same broken-row errors in the same order — while spending far less CPU.
Where the reference builds each field one character at a time, this reader
scans by index and cuts each field out of the source text with a single
slice, and a quoted field jumps from quote to quote with `indexOf` instead
of visiting every character. The rare repairs (a stray CR in an unquoted
field, a CR inside quotes, an unterminated quote re-read as unquoted) fall
back to segment assembly, so the answers — and the error order — stay
identical on broken input. `main.ts` is the harness driver: it reads the
cases, answers each one with `run`, and writes the answers out.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

Reads `cases.json` (a JSON array of `{id, input}`) from the input
directory, answers each case on its own with `solve.js`'s `run(input)`,
and writes `answers.json` — one answer per case, in order — to the output
directory. With no environment variables set, the directories are `/input`
and `/output`, as the harness mounts them. Node 22, no dependencies.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tpc75c2v&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
