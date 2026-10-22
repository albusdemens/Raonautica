# Raon Dive

A submarine and a diver explore a 1 km Subnautica-style ocean, built in Godot 4, to gather lunch:
3 fish, 1 sea lettuce and 1 salt crystal. **No human or scripted AI plays.** Codex looks at the game
and Raon decides every move.

![demo](docs/demo.gif)

## How it works

```
 Godot game state
   │  (camera frames: front / left / right / back / down)
   ▼
 Codex (VLM) ── "Bubblefin, bearing +20°, ~12 m" ──┐
                                                   ▼
 body sensors (pose, air, sonar, sub beacon, ──► Raon SYSTEM 2 (planner): next subgoal + which body
 target lock, bag)                                 │
                                                   ▼
                                                 Raon SYSTEM 1 (motor): turn / throttle / vertical /
                                                   │                    exit · enter · grab
                                                   ▼
                                                 Godot executes the command → next step
```

1. **Game state:** Godot simulates the world and serves a TCP bridge. It renders the active body's cameras on request.
2. **VLM (Codex):** describes the frames as strict JSON. It detects targets, then confirms them on zoomed crops. Sightings (V1, V2…) are remembered with estimated positions.
3. **SYSTEM 2 (Raon):** the slow planner. It runs on events (start, grab, low air, stuck, new sightings) and picks the next subgoal and body.
4. **SYSTEM 1 (Raon):** the fast controller. Each step it outputs one motor command for the sub or the diver.

The sub is fast but can't grab anything, and it doesn't fit into the kelp forest or the crevice. The diver
is slow and has 90 s of air. Grabbed items go straight into the diver's bag.

Runs are reviewed afterwards from their screenshots and logs. The lessons from each review go into
`feedback/lessons-godot.md`, which is hot-reloaded into both Raon prompts.

## Run it

Requirements: Godot 4.x, Node 20+, the [Codex CLI](https://github.com/openai/codex), ffmpeg, and `RAON_API_KEY=...` in `.env`.

```bash
npm install
node harness-godot/run.js --steps 250 --speed 4            # opens the Godot window; just watch
node harness-godot/run.js --record                         # also saves gameplay frames to runs/<id>/frames
node harness-godot/preview.js                              # visual check, no Raon/Codex
node harness-godot/visual-qa.js                            # Codex critiques short clips of key scenes
```

Each run writes `runs/<id>/`: `log.jsonl` (every prompt, reply and result), `shots/`, `vlm/` (what Codex saw) and `summary.json`.

## Layout

| path | what |
|---|---|
| `godot/` | world, sub and diver, simulation, HUD, TCP bridge |
| `harness-godot/` | run loop, Codex VLM, Raon client, prompts |
| `feedback/` | lessons distilled from run reviews |
| `web/`, `server.js`, `harness.js` | the earlier three.js version (Raon sees a text description, no VLM): `npm run serve` |
