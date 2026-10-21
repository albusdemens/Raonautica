# Kinematic simulation + body sensors (port of the three.js sim).
# Compass: 0 = North, 90 = East. Relative bearing: + = right. depth = -y.
# Positions are Vector3(E, y, N).
class_name Sim
extends RefCounted

const BODIES := {
	"sub":   {"r": 2.3, "speed": 12.0, "vspeed": 5.0, "turn": 60.0, "min_depth": 1.0, "max_dur": 6.0, "sonar": 45.0},
	"diver": {"r": 0.5, "speed": 2.0, "vspeed": 1.5, "turn": 120.0, "min_depth": 0.3, "max_dur": 4.0, "sonar": 20.0},
}
const O2_MAX := 90.0
const GRAB_R := 3.0      # hand net
const LOCK_R := 15.0     # short-range tracking sonar (camera estimates are often ~10 m off)
const ENTER_R := 5.0
const CARRY_MAX := 3
const NEEDS := {"fish": 3, "salad": 1, "mineral": 1}
const DT := 0.05
const CELL := 10.0

var world: World
var sub := {"pos": Vector3.ZERO, "heading": 0.0}
var diver := {"pos": Vector3.ZERO, "heading": 0.0}
var active := "sub"
var o2 := O2_MAX
var carry: Array = []
var stored: Array = []
var t := 0.0          # simulation time of the robot's actions (air, steps)
var world_t := 0.0    # the ocean's own clock: runs in real time even while Raon/Codex think
var step := 0
var blackouts := 0
var moving := false
var trail := {"sub": [], "diver": []}
var last_event := ""
var grid := {}

# action execution state (advanced by tick_action)
var _act: Dictionary = {}

func _init(w: World) -> void:
	world = w
	var s := w.start
	sub.pos = Vector3(s.E, -s.depth, s.N)
	sub.heading = s.heading
	diver.pos = sub.pos
	diver.heading = sub.heading
	for c in w.colliders:
		var pad: float = c.r + 3.0
		for i in range(int(floor((c.E - pad) / CELL)), int(floor((c.E + pad) / CELL)) + 1):
			for j in range(int(floor((c.N - pad) / CELL)), int(floor((c.N + pad) / CELL)) + 1):
				var k := Vector2i(i, j)
				if not grid.has(k):
					grid[k] = []
				grid[k].append(c)
	trail.sub.append(sub.pos)

func body() -> Dictionary: return sub if active == "sub" else diver
func spec() -> Dictionary: return BODIES[active]
func near(E: float, N: float) -> Array: return grid.get(Vector2i(int(floor(E / CELL)), int(floor(N / CELL))), [])

static func fwd(h: float) -> Vector2: return Vector2(sin(deg_to_rad(h)), cos(deg_to_rad(h)))
static func norm180(a: float) -> float: return fposmod(a + 180.0, 360.0) - 180.0
func bearing(p: Vector3, q: Vector3) -> float: return fposmod(rad_to_deg(atan2(q.x - p.x, q.z - p.z)), 360.0)
static func dist3(p: Vector3, q: Vector3) -> float: return p.distance_to(q)

func rel_info(p: Dictionary, q: Vector3) -> Dictionary:
	var hd := Vector2(q.x - p.pos.x, q.z - p.pos.z).length()
	var b := bearing(p.pos, q)
	return {"dist": snappedf(dist3(p.pos, q), 0.1), "horiz": snappedf(hd, 0.1), "rel": roundi(norm180(b - p.heading)),
		"compass": roundi(b), "dy": snappedf(q.y - p.pos.y, 0.1)}

func is_free(p: Vector3, r: float) -> bool:
	if world.floor_at(p.x, p.z) + r > p.y:
		return false
	for c in near(p.x, p.z):
		if c.type == "cyl":
			if p.y >= c.y0 - r and p.y <= c.y1 + r and Vector2(p.x - c.E, p.z - c.N).length() < c.r + r:
				return false
		elif Vector3(p.x - c.E, p.y - c.y, p.z - c.N).length() < c.r + r:
			return false
	return true

func collide(p: Vector3, r: float) -> Array:
	var hit := ""
	for c in near(p.x, p.z):
		if c.type == "cyl":
			if p.y < c.y0 - r or p.y > c.y1 + r: continue
			var d := Vector2(p.x - c.E, p.z - c.N)
			var m: float = c.r + r
			if d.length() < m and d.length() > 1e-6:
				d = d.normalized() * m
				p.x = c.E + d.x; p.z = c.N + d.y; hit = c.label
		else:
			var d3 := Vector3(p.x - c.E, p.y - c.y, p.z - c.N)
			var m3: float = c.r + r
			if d3.length() < m3 and d3.length() > 1e-6:
				d3 = d3.normalized() * m3
				p = Vector3(c.E + d3.x, c.y + d3.y, c.N + d3.z); hit = c.label
	var lim := World.HALF - 1.0
	if absf(p.x) > lim or absf(p.z) > lim and hit == "":
		hit = "edge of the dive area"
	p.x = clampf(p.x, -lim, lim); p.z = clampf(p.z, -lim, lim)
	return [p, hit]

# ---------------------------------------------------------------- actions

func begin(a: Dictionary) -> void:
	var b := body()
	_act = {"a": a, "who": active, "start": b.pos, "turn_left": float(a.turn_deg), "move_left": float(a.duration_s),
		"blocked": 0.0, "res": {"body": active, "planned_m": snappedf(spec().speed * a.throttle * a.duration_s, 0.1), "moved_m": 0.0, "blocked_by": "", "do": {}}}
	moving = true

func is_busy() -> bool: return not _act.is_empty()

# advance the current action by dt; returns the result dictionary when it finishes, else {}
func tick_action(dt: float) -> Dictionary:
	if _act.is_empty():
		return {}
	var a: Dictionary = _act.a
	var b := body()
	var sp := spec()
	if _act.who != active:
		_act.move_left = 0.0
	if absf(_act.turn_left) > 1e-3:
		var d: float = signf(_act.turn_left) * minf(absf(_act.turn_left), sp.turn * dt)
		b.heading = fposmod(b.heading + d, 360.0)
		_act.turn_left -= d
		_tick(dt)
		return {}
	if _act.move_left > 1e-6:
		var f := fwd(b.heading)
		var stepm: float = sp.speed * a.throttle * dt
		var want := Vector3(b.pos.x + f.x * stepm, b.pos.y + sp.vspeed * a.vertical * dt, b.pos.z + f.y * stepm)
		var hit := ""
		if world.floor_at(want.x, want.z) + sp.r > b.pos.y + 0.4 and stepm > 0.0:
			want.x = b.pos.x; want.z = b.pos.z; hit = "seabed / rock wall ahead"
		want.y = minf(-sp.min_depth, maxf(want.y, world.floor_at(want.x, want.z) + sp.r))
		var cr := collide(want, sp.r)
		want = cr[0]
		if cr[1] != "": hit = cr[1]
		want.y = minf(-sp.min_depth, maxf(want.y, world.floor_at(want.x, want.z) + sp.r))
		var moved := Vector2(want.x - b.pos.x, want.z - b.pos.z).length()
		if hit != "" and stepm > 0.0 and moved < stepm * 0.5:
			_act.blocked += dt
			_act.res.blocked_by = hit
		b.pos = want
		_act.move_left -= dt
		# grab-on-contact: with do=grab the diver grabs the moment something comes within reach
		if a.get("do", "none") == "grab" and active == "diver" and not _act.has("grabbed") and not reach_sensor().is_empty():
			_act["grabbed"] = perform("grab")
			_act.move_left = 0.0
		_tick(dt)
		return {}
	# finished
	var res: Dictionary = _act.res
	res.moved_m = snappedf(dist3(_act.start, b.pos), 0.1)
	if _act.blocked < 0.25 * float(a.duration_s): res.blocked_by = ""
	if _act.has("grabbed"):
		res["do"] = _act.grabbed
	elif active == _act.who and a.get("do", "none") != "none":
		res["do"] = perform(a.do)
	if last_event != "":
		res["event"] = last_event
		last_event = ""
	trail[active].append(body().pos)
	step += 1
	moving = false
	_act = {}
	res["action"] = a
	return res

func _tick(dt: float) -> void:
	t += dt
	world_t += dt
	if active == "sub":
		diver.pos = sub.pos
		return
	if -diver.pos.y < 0.8:
		o2 = O2_MAX
		return
	o2 -= dt
	if o2 <= 0.0:
		blackouts += 1
		for id in carry:
			_item(id).state = "world"
		last_event = "BLACKOUT: diver ran out of air, was hauled back into the sub and dropped %s (items returned to where they were found)" % (", ".join(carry) if carry.size() else "nothing")
		carry.clear()
		o2 = O2_MAX
		active = "sub"

func _item(id: String) -> Dictionary:
	for it in world.items:
		if it.id == id: return it
	return {}

func perform(what: String) -> Dictionary:
	match what:
		"exit":
			if active != "sub": return {"ok": false, "reason": "diver is already outside"}
			var p: Vector3 = sub.pos + Vector3(0, -3.2, 0)
			if p.y < world.floor_at(p.x, p.z) + 0.6:
				var f := fwd(sub.heading)
				p = sub.pos + Vector3(f.y * 3.2, 0, -f.x * 3.2)
			p = collide(p, BODIES.diver.r)[0]
			diver.pos = p; diver.heading = sub.heading
			active = "diver"; o2 = O2_MAX
			trail.diver.append(p)
			return {"ok": true, "info": "diver exited the sub (hatch is underneath)"}
		"enter":
			if active != "diver": return {"ok": false, "reason": "diver is already inside"}
			var d := dist3(diver.pos, sub.pos)
			if d > ENTER_R: return {"ok": false, "reason": "sub is %.1f m away (need <= %.0f m)" % [d, ENTER_R]}
			var kinds := []
			for id in carry:
				_item(id).state = "stored"
				stored.append(id)
				kinds.append(_item(id).kind)
			carry.clear()
			active = "sub"; o2 = O2_MAX
			return {"ok": true, "info": "diver boarded the sub; stored %s; air refilled" % (", ".join(kinds) if kinds.size() else "nothing")}
		"grab":
			if active != "diver": return {"ok": false, "reason": "the sub has no arm - only the diver can grab"}
			if carry.size() >= CARRY_MAX: return {"ok": false, "reason": "hands full - return to the sub to store items"}
			var best := {}; var bd := INF
			for it in world.items:
				if it.state != "world": continue
				var d2 := dist3(diver.pos, world.item_pos(it, world_t))
				if d2 < bd:
					bd = d2
					best = it
			if not best.is_empty() and bd <= GRAB_R:
				best.state = "carried"
				carry.append(best.id)
				return {"ok": true, "kind": best.kind, "info": "grabbed a %s (%s)" % [best.kind, best.name]}
			return {"ok": false, "reason": "nothing grabbable within %.1f m" % GRAB_R}
	return {"ok": false, "reason": "unknown action " + what}

# ---------------------------------------------------------------- body sensors (what Raon may know without vision)

func sonar() -> Array:
	var p: Vector3 = body().pos
	var r: float = spec().r
	var rng: float = spec().sonar
	var out := []
	for rel in range(-80, 81, 20):
		var f := fwd(body().heading + rel)
		var best := rng; var what := ""
		var s := 0.5
		while s < best:
			var q := Vector3(p.x + f.x * s, p.y, p.z + f.y * s)
			if absf(q.x) > World.HALF - 1.0 or absf(q.z) > World.HALF - 1.0:
				best = s; what = "edge of dive area"; break
			if world.floor_at(q.x, q.z) + r > p.y + 0.4:
				best = s; what = "seabed rising / wall"; break
			if not is_free(q, r):
				best = s; what = "obstacle"; break
			s += 1.5 if rng > 30.0 else 0.75
		out.append({"rel": rel, "dist": snappedf(best, 0.1) if what != "" else null, "what": what})
	return out

func inventory() -> Dictionary:
	var count := func(ids: Array, kind: String) -> int:
		var n := 0
		for id in ids:
			if _item(id).kind == kind: n += 1
		return n
	var st := {}; var ca := {}; var miss := {}
	var done := true
	for k in NEEDS:
		st[k] = count.call(stored, k)
		ca[k] = count.call(carry, k)
		miss[k] = maxi(0, NEEDS[k] - st[k])
		if miss[k] > 0: done = false
	return {"stored": st, "carried": ca, "missing": miss, "done": done}

# the diver's glove has a short-range touch sensor: is anything grabbable within reach?
func reach_sensor() -> Array:
	if active != "diver": return []
	var out := []
	for it in world.items:
		if it.state == "world" and dist3(diver.pos, world.item_pos(it, world_t)) <= GRAB_R:
			out.append(it.kind)
	return out

func state() -> Dictionary:
	var b := body()
	var p: Vector3 = b.pos
	var s := {
		"step": step, "t": snappedf(t, 0.1), "active": active,
		"spec": spec(),
		"pose": {"E": snappedf(p.x, 0.1), "N": snappedf(p.z, 0.1), "depth": snappedf(-p.y, 0.1), "heading": roundi(b.heading),
			"floor_below_m": snappedf(p.y - world.floor_at(p.x, p.z), 0.1)},
		"sub": {"E": snappedf(sub.pos.x, 0.1), "N": snappedf(sub.pos.z, 0.1), "depth": snappedf(-sub.pos.y, 0.1), "heading": roundi(sub.heading)},
		"air_s": roundi(o2), "air_max": O2_MAX, "carry_kinds": carry.map(func(id): return _item(id).kind),
		"inventory": inventory(), "sonar": sonar(), "blackouts": blackouts, "reach": reach_sensor(),
	}
	if active == "diver":
		s["sub_beacon"] = rel_info(diver, sub.pos)
		var best := {}
		var bd := INF
		var bp := Vector3.ZERO
		for it in world.items:
			if it.state != "world": continue
			var q: Vector3 = world.item_pos(it, world_t)
			var d := dist3(diver.pos, q)
			if d < bd:
				bd = d
				best = it
				bp = q
		if bd <= LOCK_R:
			# the harness only shows this to Raon if vision already confirmed a target of this kind here
			s["lock"] = {"kind": best.kind, "E": snappedf(bp.x, 0.1), "N": snappedf(bp.z, 0.1), "depth": snappedf(-bp.y, 0.1)}.merged(rel_info(diver, bp))
	return s
