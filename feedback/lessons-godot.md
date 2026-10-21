# Lessons for Raon (Godot world: camera perception)

<!-- Supervisor feedback from reviewed runs. Injected into both SYSTEM 1 and SYSTEM 2 prompts. -->

Carried over from the three.js runs:
- SYSTEM 1: when the subgoal is for the DIVER and the sub is within ~8 m of the target, use `"do":"exit"` right away.
- SYSTEM 2: collect only what is still missing (one salad is enough; check "still missing").
- SYSTEM 2: batch nearby needed items in one dive when air allows.
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
- SYSTEM 2: never send the diver out without a SIGHTING to go to. In Godot run 5 the diver exited and re-entered 3 times in the Safe Shallows with nothing sighted. If a zone shows no sightings, move the SUB around inside the zone (waypoints ~20-30 m apart) so the cameras can find targets, and only then send the diver.
