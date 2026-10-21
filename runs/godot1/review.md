# Godot run 1 review (stopped at step 18)

**Pipeline worked:** Codex looked at every plan and every 3rd step. Its first sighting (bubblefin, V1) was
within ~3 m of the real F1. The sub went straight to it and the diver exited at step 3, with no hesitation.

## Problems
1. **VLM false positives (harness/VLM):** in the shallows Codex reported a sea_lettuce (conf 0.55) and a
   kelp_peeper (0.48). Neither exists there, so they became ghost sightings V2 and V3.
2. **Ghosts never expired (harness):** the diver spent steps 8–17 circling V3. Each step it turned ~180°
   and moved 1.2 m around an estimated point ~1 m away, with nothing there.
3. **Wrong depth (Raon S1):** the real Bubblefin was *above* the diver ("front -25°, 16 m, above", step 8),
   but the diver stayed at 17 m near the floor.
4. One grab at step 7 failed (nothing within 2.5 m). It is fine to try, but it shows the estimate was off.

## Fixes for run 2
- Codex now gets the location context (zone and which targets live there) and a stricter calibration rubric.
- A sighting needs confidence ≥ 0.6. A sighting within 7 m that two fresh looks don't confirm is dropped,
  and System 2 is told.
- New lessons: fish are mid-water, no turning around at < 2 m, abandon unconfirmed sightings.
