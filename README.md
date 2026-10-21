# Raon Dive

A Subnautica-style 100 × 100 × 100 m ocean in three.js. A submarine and a diver gather lunch:
3 fish, 1 sea lettuce and 1 salt crystal. **Raon drives everything**:

- **SYSTEM 2 (planner)** is called on events: mission start, subgoal reached, item grabbed, diver
  exits or enters, low air, blackout, stuck, new items spotted, and every 10 steps. It picks
  the next subgoal (a zone, item, the sub, or a waypoint), which body should act, and gives
  guidance.
- **SYSTEM 1 (motor control)** is called every step. It outputs one command for the active body:
  turn, throttle, vertical, duration, and `exit | enter | grab`.

Raon is text-only, so the simulator describes the world in words. Each prompt includes pose and
depth, air, a sonar fan, items in sight, the subgoal's relative bearing and distance, the last
step's outcome and the storage checklist.

## Why the diver has to go out
- The sub (radius 2.3 m) can't fit between kelp stalks or into the Crystal Crevice, and it can't grab anything.
- The diver is slow (2 m/s), has 90 s of air and carries at most 3 items. Items count only once the diver re-enters the sub.
- Running out of air causes a blackout: the diver loses whatever it carries.

## Run it
```bash
npm install
npm run serve                       # then open http://localhost:8765 and watch: it starts by itself
node harness.js --steps 150         # headless run with screenshots -> runs/<id>/
node harness.js --preview           # visual check only, no Raon calls
```
The live page has view (chase / free orbit / overview) and speed controls. The Raon key stays in
`.env` on the server and never reaches the browser.

## Review loop
Each run writes `runs/<id>/`:
- `shots/*.png`: full-page screenshots, including HUD, minimap, depth profile and Raon's plan and command.
- `log.jsonl`: every prompt, reply, reasoning trace, latency and step result.
- `summary.json`: outcome, steps, inventory and API stats.

Claude reviews the screenshots and log, writes `runs/<id>/review.md`, and distils the actionable
points into `feedback/lessons.md`. Both Raon systems get that file in their system prompt on the
next run.

## Files
| file | what |
|---|---|
| `server.js` | static server + Raon proxy + run logging |
| `harness.js` | Playwright runner (headless Chrome), screenshots |
| `web/world.js` | terrain, caustics, kelp, coral, abyss, fish, items, zones |
| `web/actors.js` | submarine and diver models |
| `web/sim.js` | physics, oxygen, grab/exit/enter, perception |
| `web/prompts.js` | SYSTEM 1 / SYSTEM 2 prompts and observation text |
| `web/agent.js` | the decision loop and replanning triggers |
| `web/hud.js` | HUD, minimap, depth profile, item labels |

---

# Godot port: Codex sees, Raon decides

`godot/` holds the same 1 km ocean rebuilt in Godot 4.7, using the Forward+ renderer with volumetric fog
(god rays), SSAO, glow, soft shadows, MultiMesh decor with visibility ranges and custom underwater shaders.
In this version **Raon gets no ground-truth item list.** Each look, Godot renders the active body's
front and down cameras, and **Codex** (the VLM) describes them. Raon decides from that description plus
exact body sensors (pose, depth, air, sonar, sub beacon, inventory, the diver's reach sensor). Targets
seen on camera become *sightings* (V1, V2…) with estimated positions.

```
Godot (window, physics, TCP bridge :9079)
   │  look → front.png + down.png        act ← motor command
   ▼                                      ▲
Codex exec (VLM, strict JSON) ──text──► Raon SYSTEM 2 (plans) / SYSTEM 1 (motor)
                                          ▲
                         body sensors ────┘
```

```bash
node harness-godot/run.js --steps 150 --speed 3        # opens the Godot window; watch it live
node harness-godot/run.js --vlm-every 3                # Codex looks at each plan + every 3 steps
node harness-godot/preview.js                          # visual check, no Raon/Codex
```
Each run writes `runs/<id>/` containing `log.jsonl`, `shots/` (main window plus HUD), `vlm/` (exactly what
Codex saw, plus its JSON) and `summary.json`. Godot-specific lessons go in `feedback/lessons-godot.md`.
The godot-mcp server is registered in `.mcp.json` (its tools load when Claude Code restarts here).
