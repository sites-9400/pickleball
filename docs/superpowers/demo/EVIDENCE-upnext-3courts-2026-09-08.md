# Up Next at 3 courts — measured cost, 2026-09-08

`showUpNext()` lowered from `courtDefs.length >= 4` to `>= 3`, so Numbering/Balanced now
show the fixed next match on a 3-court night. `view.html` mirrors the rule.

Measured against the real `app.html` in a browser, 3 courts, 5-hour night (~61 games),
**12 seeds averaged**, Numbering doubles. "on" reserves one match the way
`rebuildMatchQueue` does; the reserved match is then seated via the real
`matchQueue.shift()` flow from `generateMatchForCourt`.

| players | | opp pairs 3+ | max faced same opp | partner pairs 2+ | max same partner |
|---|---|---|---|---|---|
| 16 | off | 36.75 | 4.58 | 27.75 | 3.17 |
| 16 | **on** | 24.00 | **11.17** | 24.00 | **5.83** |
| 18 | off | 20.33 | 4.00 | 20.17 | 2.58 |
| 18 | on | 27.50 | 4.25 | 26.00 | 3.17 |
| 20 | off | 9.25 | 3.50 | 12.92 | 2.17 |
| 20 | on | 15.08 | 3.75 | 15.75 | 2.67 |
| 24 | off | 2.17 | 2.92 | 5.25 | 2.00 |
| 24 | on | **2.08** | **2.83** | 5.33 | 2.08 |
| 28 | off | 0.25 | 2.25 | 2.17 | 2.00 |
| 28 | on | 0.33 | 2.33 | 2.75 | 2.00 |

**Free at 24+. Mild at 18-20. Degenerate at 16** — 3 courts seat 12 and the reserved match
takes 4, consuming all 16, so the "choice" is forced and one pair partnered 5.8x on average.

## Anti-repeat tuning was tested and REJECTED

Swept alpha (opponent penalty), beta (partner penalty), K, decay and blockWindow across 8
combinations, up to ~20x current values, at 18/20/24 players with Up Next on:

| setting | 18p opp pairs 3+ | 20p | 24p |
|---|---|---|---|
| current a8 b12 K4 bw3 | 49.38 | 35.75 | 8.50 |
| a40 b40 K4 bw5 | 47.75 | 36.88 | 11.00 |
| a80 b80 K3 bw6 | 49.75 | 34.88 | 9.13 |
| a150 b150 K4 bw8 | 48.88 | 36.50 | 10.75 |

Flat within noise. The penalties are **saturated**: `pen = 1/(1 + alpha*so + beta*sp)`
scales every thin-pool candidate down together, so the relative ordering barely moves.
The limit is combinatorial, not weighting. **No matchmaking weights were changed** — the
standing rule is not to touch them without a demonstrated benefit, and there is none here.

## Correction to an earlier measurement in this session

A first probe reported Up Next "roughly tripling" repeats (20p: opp3 9.6 -> 34.8). That
probe **discarded** the reserved match and drew a fresh one, so the pool shrank without
the reserved match ever being played. The app seats the reserved match
(`matchQueue.shift()`, app.html:2818). Corrected numbers are the table above.

## Screenshot

`numbering-upnext-3courts-24players.png` — 3 courts, 24 players, Numbering. "Up Next 1"
card renders under the courts with 8 players still in the queue.
