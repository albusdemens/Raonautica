# Lessons for Raon (Godot world: camera perception)

<!-- Supervisor feedback from reviewed runs. Injected into both SYSTEM 1 and SYSTEM 2 prompts. -->

Carried over from the three.js runs:
- SYSTEM 1: when the subgoal is for the DIVER and the sub is within ~8 m of the target, use `"do":"exit"` right away.
- SYSTEM 2: collect only what is still missing (one salad is enough; check "still missing").
- SYSTEM 2: chain grabs in one dive when air allows (the bag holds everything, items count immediately).
- SYSTEM 2: when a zone has nothing left that you need, go to the next zone. Don't re-search it. The Kelp Forest gives a fish AND the salad in one visit.
- SYSTEM 2: for the mineral ledge or the crevice, use a `waypoint` with the coordinates from the zone description and bring the SUB there first.
- SYSTEM 1: if the target is almost straight above or below, use throttle 0 and only vertical.
- SYSTEM 1: obey the air rule strictly.

From Godot run 1:
- SYSTEM 1: target fish swim in MID-WATER (Bubblefins ~10-14 m deep, Kelp Peepers ~18-22 m, Lanternfish ~90-95 m), not on the seabed. When the camera says a fish is "above", go up (vertical +). Don't hug the floor.
- SYSTEM 1: if a target is less than ~2 m away horizontally, do NOT turn around (that makes you circle). Hold the heading, adjust depth, and grab.
- SYSTEM 2: a sighting can be a false detection. If you reach its spot and the reach sensor and a fresh look show nothing, abandon it and pick another sighting or zone.
- SYSTEM 1: when the LATEST CAMERA LOOK (fresh) shows the target within ~4 m roughly ahead, swim to it AND `"do":"grab"` in the SAME command. In Godot run 2 the diver swam right past a Bubblefin seen at 3 m without grabbing.
- SYSTEM 2: when you are called because the diver's air is low, the ONLY valid subgoal is {"type":"sub"} with body "diver". In Godot run 2 it sent a low-air diver back to a fish instead.
- SYSTEM 2: never send the diver out without a SIGHTING to go to - EXCEPT in the Kelp Forest, where the canopy hides everything from the sub: there, send the diver down to ~20 m at the forest centre (waypoint) to search. In Godot run 5 the diver exited and re-entered 3 times in the Safe Shallows with nothing sighted. If a zone shows no sightings, move the SUB around inside the zone (waypoints ~20-30 m apart) so the cameras can find targets, and only then send the diver.
- SYSTEM 2: the PDA says how many of each species live in a zone. Once you have caught them all (e.g. both Bubblefins), any further sighting of that species there is a false detection. Move to the next zone (the Kelp Forest gives the 3rd fish AND the salad).
- SYSTEM 1/2: sea lettuce and salt crystals lie ON THE SEABED (Kelp Forest floor ~36 m). Cameras misjudge their depth; follow the TARGET LOCK depth, or dive to ~1 m above the floor.
- SYSTEM 2 (searching under the kelp): don't bounce the diver in and out of the sub. Keep the diver down and sweep a ring ~15-20 m around the forest centre with diver waypoints (north, east, south, west of the centre, depth ~20 m). The sub follows the diver automatically, so a 90 s dive covers the ring. Return only when air is low.
- SYSTEM 1 (sub, entering the Kelp Forest): the forest is NORTH of the Shallows. If the sub is BLOCKED by a kelp stalk, do NOT turn around: go UP (vertical +1) to depth ~2 m and keep heading toward the target. The canopy tops are 6.5-9.5 m deep, so a sub at 2-3 m passes over them. Keep the heading toward the target. Turning 180° away and back wastes many steps.
