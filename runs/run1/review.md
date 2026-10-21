# Run 1 review (stopped at step 24)

**Result:** 2/3 fish stored (F2, F1) by step 20, then stalled. Stopped manually at step 24
because SYSTEM 2 was chasing an item that doesn't exist.

## What went well
- The opening plan was sensible: drive the sub to the nearest fish (F2), stop, send the diver.
- The diver's in-command "approach + grab" worked first try twice (steps 12, 18), and so did enter.
- The air budget was never at risk: dives were short and the sub was parked right next to the fish.

## Problems
1. **Hesitation before exit (steps 3–9, harness + S1).** The sub was 1.7 m from F2 with a subgoal
   "for body diver", but SYSTEM 1 kept nudging and asking to replan instead of `do:"exit"`. Its
   reasoning showed it never linked "subgoal body = diver" with "I must exit".
   Harness fix: explicit `BODY SWITCH NEEDED` and `ACTIONS AVAILABLE NOW` lines.
2. **No batching (S2).** After grabbing F2, F1 was ~20 m away and in sight (21.7 m), but the
   diver went back to the sub with one item. That cost a full exit/enter cycle.
3. **Re-selected a finished zone (S2, step 20–21).** With both Bubblefins aboard, S2 sent the
   sub back to the Coral Garden (where it already was) "to locate the remaining fish".
4. **Hallucinated targets (S2, steps 23–24).** It chose `F3` (never seen) at the Coral Garden's
   coordinates, then an invented id `F_last`. The PDA says Kelp Peepers live in the Kelp
   Forest, and the kelp trip also gives the salad.
   Harness fix: invalid subgoals are now rejected back to SYSTEM 2 with the reason.

## Visual review
- The camera ends up inside or behind the sub's hull when the diver exits (shots 009, 024).
  Fix: the camera now treats the sub as solid.
- The diver reads well against the coral. Labels and the minimap trail make decisions easy to audit.

## Latency
S1 ≈ 2–9 s per call (reasoning ~300–600 tokens), S2 ≈ 1.5–12 s. One live step is ~5 s of thinking.
