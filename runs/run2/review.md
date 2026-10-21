# Run 2 review (small world, 150 steps, out of steps)

**Result:** fish 3/3, salad 2/1 (one wasted), mineral 0/1. One blackout.

## Improvements over run 1 (lessons worked)
- No exit hesitation. The diver left the sub as soon as it was parked.
- **Batching:** F1 and F2 came back in one dive, and F3 + S2 + S1 in another.
- Zero hallucinated targets. The validator never had to reject a plan.
- It went Coral Garden → Kelp Forest → Crevice: the right order.

## Root cause of the failure: harness bug (mine)
The Crystal Crevice was **impossible**. Ten pillars of radius 1.75 m on a 6.2 m ring leave no gap,
even for the diver. Raon kept reporting "BLOCKED by crevice pillar" (steps 68–70, 113–115, 126–128,
136–138), which was accurate. Fixed: 7 pillars, radius 1.4 m, 7 m ring, 3.3 m gaps.

## Raon's own mistakes
1. **Extra salad (S2):** grabbed S1 after S2 although only 1 salad is needed. It cost steps and carry space.
2. **Wrong target for the ledge (S2, steps 71–87):** it sent the diver to the *trench zone centre* at
   55 m instead of the ledge coordinates given in the zone description. It burned 50 s of air swimming
   up and down, then never found the ledge.
3. **Oscillation (S1, steps 75–81):** it turned 180° back and forth each step (heading 170 ↔ 350)
   while "ascending toward Z3", because the subgoal sat almost directly above or below it. It should
   have used pure vertical movement with throttle 0.
4. **Blackout (step 99):** it only turned back with 9 s of air left at ~20 m from the sub.
   The air rule says turn back at (distance / 2) + 12 s.
5. One unparseable reply (step 82).

## Visual notes
Shots taken with the old renderer. The renderer has since been replaced (big world, PBR, post-processing).
