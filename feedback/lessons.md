# Lessons for Raon

<!-- Supervisor feedback from reviewed runs. Injected into both SYSTEM 1 and SYSTEM 2 prompts. -->

From runs 1-2:
- SYSTEM 1: when the subgoal is for the DIVER and the sub is already within ~8 m of the target, use `"do":"exit"` right away. Don't nudge the sub.
- SYSTEM 2: batch. After a grab, if another NEEDED item is known and close (diver has air for it plus the way back), grab it before returning (max 3 carried).
- SYSTEM 2: collect only what is still missing. Check "still missing" before choosing an item: a second salad, or a 4th fish, wastes steps.
- SYSTEM 2: only target ids listed under KNOWN ITEMS. Never invent ids or coordinates. To find new items, move the SUB to the zone where they live. The sub's scanner reveals items ~45 m around it.
- SYSTEM 2: when a zone description gives exact coordinates for something (e.g. a mineral ledge), use a `waypoint` subgoal with those E, N and depth for the SUB. Do not send the diver to a zone centre to search, because the diver is slow and the air runs out.
- SYSTEM 2: the diver should only swim short distances (< 25 m). Move the sub close first. The sub is fast.
- SYSTEM 1: if the target is almost straight above or below you (horizontal distance < 3 m), do not turn around. Use throttle 0 and only vertical.
- SYSTEM 1: respect the air rule strictly. Turn back when air_s < swim-back time + 12. In run 2 the diver blacked out after turning back with only 9 s left.
