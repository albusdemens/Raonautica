# Raon Dive (Godot): builds the world, renders it, and exposes a TCP bridge (newline-delimited JSON)
# that the Node harness uses to read body sensors, render VLM camera frames, and execute Raon's commands.
#   {"id":1,"cmd":"state"}                              -> body sensors
#   {"id":2,"cmd":"look","dir":"/abs/dir","name":"s12"} -> renders front/down VLM frames to PNG
#   {"id":3,"cmd":"act","action":{...},"speed":3}       -> executes one motor command (reply when done)
#   {"id":4,"cmd":"shot","path":"/abs/x.png"}           -> screenshot of the main window (with HUD)
#   {"id":5,"cmd":"hud", ...}                           -> update the on-screen panels
#   {"id":6,"cmd":"teleport","who":"sub","E":..,"N":..,"depth":..,"heading":..}  (preview/debug)
#   {"id":7,"cmd":"view","mode":"chase|overview|focus", "item":"F1" | "E","N","depth", "dist":8, "yaw":90}
#   {"id":8,"cmd":"record","dir":"/abs","name":"clip","frames":16,"interval":0.15}  -> frame sequence of the main window
extends Node3D

const PORT_DEFAULT := 9077

var world: World
var sim: Sim
var sub_node: Node3D
var diver_node: Node3D
var cam: Camera3D
var env: Environment
var sun: DirectionalLight3D
var vlm: Dictionary
var hud: Dictionary = {}
var server := TCPServer.new()
var peers: Array = []            # [{peer, buf}]
var pending_act: Dictionary = {} # {peer, id}
var speed := 3.0
var view_mode := "chase"
var focus := {}   # {item} or {E, N, depth}, plus dist / yaw for the 'focus' camera
var cam_pos := Vector3.ZERO
var cam_look := Vector3.ZERO
var snow: GPUParticles3D

func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	_setup_environment()
	world = World.new()
	world.name = "World"
	add_child(world)
	world.build()
	sim = Sim.new(world)
	sub_node = Actors.make_sub()
	diver_node = Actors.make_diver()
	add_child(sub_node)
	add_child(diver_node)
	cam = Camera3D.new()
	cam.fov = 62.0
	cam.far = 600.0
	add_child(cam)
	cam.current = true
	vlm = Actors.make_vlm_rig(self)
	_setup_snow()
	_setup_hud()
	var port := PORT_DEFAULT
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--port="):
			port = int(a.substr(7))
	var err := server.listen(port, "127.0.0.1")
	print("[raobot] world built in %d ms; bridge %s on port %d" % [Time.get_ticks_msec() - t0, "listening" if err == OK else "FAILED", port])
	_update_actors(0.0)
	_update_camera(true)

# ---------------------------------------------------------------- look & feel

func _setup_environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("#8fc9d4")
	env.ambient_light_energy = 0.45
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 0.95
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_bloom = 0.0
	env.glow_hdr_threshold = 1.2
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.ssao_enabled = true
	env.ssao_radius = 1.5
	env.ssao_intensity = 2.0
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_density = 0.02
	env.fog_sky_affect = 1.0
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.0035
	env.volumetric_fog_albedo = Color("#4fc3d6")
	env.volumetric_fog_emission = Color("#06303c")
	env.volumetric_fog_emission_energy = 0.12
	env.volumetric_fog_anisotropy = 0.7
	env.volumetric_fog_length = 120.0
	env.volumetric_fog_detail_spread = 2.0
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.3
	env.adjustment_contrast = 1.12
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.light_color = Color("#fff4dc")
	sun.light_energy = 2.2
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 90.0
	sun.light_volumetric_fog_energy = 2.5
	sun.look_at_from_position(Vector3.ZERO, Vector3(0.25, -1.0, -0.15), Vector3.FORWARD)
	add_child(sun)

func _setup_snow() -> void:
	snow = GPUParticles3D.new()
	snow.amount = 4000
	snow.lifetime = 12.0
	snow.preprocess = 12.0
	snow.visibility_aabb = AABB(Vector3(-60, -60, -60), Vector3(120, 120, 120))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(40, 25, 40)
	pm.gravity = Vector3(0, -0.12, 0)
	pm.initial_velocity_min = 0.0
	pm.initial_velocity_max = 0.2
	pm.direction = Vector3(1, 0, 0)
	pm.spread = 180.0
	snow.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.06, 0.06)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_color = Color(0.85, 0.95, 1.0, 0.7)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	q.material = m
	snow.draw_pass_1 = q
	snow.local_coords = false
	add_child(snow)

func _setup_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.02, 0.11, 0.19, 0.66)
	style.border_color = Color(0.47, 0.9, 1.0, 0.3)
	style.set_border_width_all(1)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(8)
	var mk := func(pos: Vector2, size: Vector2) -> RichTextLabel:
		var p := PanelContainer.new()
		p.add_theme_stylebox_override("panel", style)
		p.position = pos
		p.custom_minimum_size = size
		var l := RichTextLabel.new()
		l.bbcode_enabled = true
		l.fit_content = true
		l.custom_minimum_size = Vector2(size.x - 16, 0)
		l.add_theme_font_size_override("normal_font_size", 13)
		l.add_theme_font_size_override("bold_font_size", 13)
		p.add_child(l)
		layer.add_child(p)
		return l
	hud.status = mk.call(Vector2(10, 10), Vector2(360, 0))
	hud.vlm = mk.call(Vector2(10, 150), Vector2(360, 0))
	hud.s2 = mk.call(Vector2(10, 560), Vector2(600, 0))
	hud.s1 = mk.call(Vector2(670, 590), Vector2(600, 0))
	hud.map = TextureRect.new()
	hud.map.position = Vector2(1060, 10)
	hud.map.custom_minimum_size = Vector2(210, 210)
	layer.add_child(hud.map)
	hud.map_base = _render_map_base()
	_update_hud({})

func _render_map_base() -> Image:
	var n := 140
	var img := Image.create(n, n, false, Image.FORMAT_RGB8)
	for j in n:
		for i in n:
			var E := -World.HALF + (i + 0.5) * (2.0 * World.HALF / n)
			var N := World.HALF - (j + 0.5) * (2.0 * World.HALF / n)
			var d := -world.floor_at(E, N)
			var c := Color("#7fe0d0").lerp(Color("#2a7fa8"), clampf(d / 60.0, 0, 1)).lerp(Color("#0b1838"), clampf((d - 60.0) / 120.0, 0, 1))
			img.set_pixel(i, j, c * (0.85 + 0.15 * sin(d * 0.35)))
	return img

var hud_data := {}
func _update_hud(d: Dictionary) -> void:
	for k in d:
		hud_data[k] = d[k]
	var s: Dictionary = sim.state()
	var inv: Dictionary = s.inventory
	var lunch := ""
	for k in Sim.NEEDS:
		lunch += "%s %s %d/%d   " % ["✅" if inv.stored[k] >= Sim.NEEDS[k] else "⬜", k, inv.stored[k], Sim.NEEDS[k]]
	hud.status.text = "[b][color=#7ff0ff]RAON DIVE · Godot[/color][/b]  step %d · t %ds\nActive: [b]%s[/b] · depth [b]%.1f m[/b] · hdg %d°\nE %.0f · N %.0f · seabed −%.1f m\nO₂ %d s%s\n%s\n[color=#9ab]%s[/color]" % [
		s.step, int(s.t), "SUB" if s.active == "sub" else "DIVER", s.pose.depth, s.pose.heading, s.pose.E, s.pose.N, s.pose.floor_below_m,
		s.air_s, "" if s.active == "sub" else "  · carrying " + ", ".join(s.carry_kinds), lunch, hud_data.get("phase", "")]
	hud.vlm.text = "[b][color=#c9a8ff]CODEX VISION[/color][/b]\n" + str(hud_data.get("vlm", "(no look yet)"))
	hud.s2.text = "[b][color=#ffcf6b]SYSTEM 2 · plan[/color][/b]\n" + str(hud_data.get("s2", "no plan yet"))
	hud.s1.text = "[b][color=#7ff0ff]SYSTEM 1 · motor[/color][/b]\n" + str(hud_data.get("s1", "idle"))
	var img: Image = hud.map_base.duplicate()
	var to_px := func(E: float, N: float) -> Vector2i:
		return Vector2i(clampi(int((E + World.HALF) / (2.0 * World.HALF) * 140.0), 0, 139), clampi(int((World.HALF - N) / (2.0 * World.HALF) * 140.0), 0, 139))
	for pt in sim.trail.sub:
		var px: Vector2i = to_px.call(pt.x, pt.z)
		img.set_pixelv(px, Color("#ff9a3c"))
	for sight in hud_data.get("sightings", []):
		var px2: Vector2i = to_px.call(float(sight.E), float(sight.N))
		img.fill_rect(Rect2i(px2 - Vector2i(1, 1), Vector2i(3, 3)), Color("#ffe14a"))
	var me: Vector2i = to_px.call(sim.body().pos.x, sim.body().pos.z)
	img.fill_rect(Rect2i(me - Vector2i(2, 2), Vector2i(5, 5)), Color.WHITE)
	hud.map.texture = ImageTexture.create_from_image(img)
	hud.map.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	hud.map.size = Vector2(210, 210)

# ---------------------------------------------------------------- per-frame

func _process(delta: float) -> void:
	_poll_bridge()
	if sim.is_busy():
		var n := maxi(1, roundi(delta * speed / Sim.DT))
		for i in n:
			var r := sim.tick_action(Sim.DT)
			if not r.is_empty():
				_reply(pending_act.peer, pending_act.id, {"ok": true, "result": r, "state": sim.state()})
				pending_act = {}
				_update_hud({})
				break
	_update_actors(Time.get_ticks_msec() / 1000.0)
	_update_camera(false)
	if not sim.is_busy():
		sim.world_t += delta   # fish keep swimming while the robot is thinking
	world.update_visuals(sim.world_t)

func _update_actors(time: float) -> void:
	sub_node.position = World.xz(sim.sub.pos.x, sim.sub.pos.y, sim.sub.pos.z)
	sub_node.rotation = Vector3(sin(time * 0.8) * 0.015, -deg_to_rad(sim.sub.heading), sin(time * 0.6) * 0.03)
	var sd: float = -sim.sub.pos.y
	var on := 1.0 if sd > 25.0 else (clampf((sd - 12.0) / 13.0, 0.0, 1.0))
	for c in sub_node.get_children():
		if c is SpotLight3D: c.light_energy = on * 6.0
	diver_node.visible = sim.active == "diver"
	diver_node.position = World.xz(sim.diver.pos.x, sim.diver.pos.y, sim.diver.pos.z)
	diver_node.rotation.y = -deg_to_rad(sim.diver.heading)
	var body := diver_node.get_node("Body")
	body.rotation.x = -0.15 + sin(time * 1.2) * 0.04
	var kick := 0.45 if sim.moving else 0.12
	body.get_node("Leg0").rotation.x = sin(time * 6.0) * kick
	body.get_node("Leg1").rotation.x = -sin(time * 6.0) * kick
	body.get_node("Torch").light_energy = 4.0 if -sim.diver.pos.y > 20.0 else 0.0
	# depth-dependent water: colour, light, fog
	var d := maxf(0.0, -cam.position.y) if cam else 0.0
	var shallow := Color("#2fb3c9"); var mid := Color("#13729a"); var deep := Color("#04192e")
	var fc := shallow.lerp(mid, World.sstep(0.0, 60.0, d)).lerp(deep, World.sstep(40.0, 160.0, d))
	env.background_color = fc
	env.fog_light_color = fc
	env.fog_density = lerpf(0.0055, 0.026, World.sstep(5.0, 120.0, d))
	env.volumetric_fog_albedo = Color("#7fb8c2").lerp(Color("#0b3550"), World.sstep(20.0, 140.0, d))
	env.ambient_light_energy = lerpf(0.45, 0.1, World.sstep(10.0, 150.0, d))
	sun.light_energy = lerpf(1.35, 0.05, World.sstep(10.0, 130.0, d))
	if snow:
		snow.global_position = cam.global_position

func _chase_target(b: Dictionary, is_sub: bool) -> Array:
	var h := deg_to_rad(b.heading)
	var f := Vector2(sin(h), cos(h))
	var back := 11.0 if is_sub else 4.8
	var up := 3.8 if is_sub else 1.6
	var k := 0.15
	while k <= 1.0001:
		var c := Vector3(b.pos.x - f.x * back * k, b.pos.y + up * k, b.pos.z - f.y * back * k)
		var inside_sub := not is_sub and c.distance_to(sim.sub.pos) < 3.4
		if not sim.is_free(c, 0.35) or inside_sub:
			k -= 0.05
			break
		k += 0.05
	k = clampf(k, 0.15, 1.0)
	var pos := Vector3(b.pos.x - f.x * back * k, b.pos.y + up * k, b.pos.z - f.y * back * k)
	pos.y = minf(-0.4, maxf(pos.y, world.floor_at(pos.x, pos.z) + 0.6))
	var look := Vector3(b.pos.x + f.x * 5.0, b.pos.y + 0.3, b.pos.z + f.y * 5.0)
	return [World.xz(pos.x, pos.y, pos.z), World.xz(look.x, look.y, look.z)]

func _update_camera(snap: bool) -> void:
	if view_mode == "focus":
		var tgt := Vector3(float(focus.get("E", 0)), -float(focus.get("depth", 10)), float(focus.get("N", 0)))
		if focus.has("item"):
			for it in world.items:
				if it.id == focus.item: tgt = world.item_pos(it, sim.world_t)
		var yaw := deg_to_rad(float(focus.get("yaw", 90)))
		var dist := float(focus.get("dist", 8))
		var at_ := World.xz(tgt.x, tgt.y, tgt.z)
		cam.far = 600.0
		cam.position = at_ + Vector3(sin(yaw) * dist, dist * 0.25, cos(yaw) * dist)
		cam.look_at(at_)
		return
	if view_mode == "overview":
		cam.position = Vector3(-World.HALF * 1.2, 520, World.HALF * 1.3)
		cam.look_at(Vector3(40, -90, -40))
		cam.far = 3000.0
		return
	cam.far = 600.0
	var t := _chase_target(sim.body(), sim.active == "sub")
	if snap:
		cam_pos = t[0]; cam_look = t[1]
	else:
		cam_pos = cam_pos.lerp(t[0], 0.08); cam_look = cam_look.lerp(t[1], 0.12)
	cam.position = cam_pos
	cam.look_at(cam_look)

func _place_vlm_cameras() -> void:
	var b := sim.body()
	var is_sub := sim.active == "sub"
	var h := deg_to_rad(b.heading)
	var f := Vector3(sin(h), 0, -cos(h))
	var eye := World.xz(b.pos.x, b.pos.y, b.pos.z) + f * (2.6 if is_sub else 0.9) + Vector3(0, 0.3 if is_sub else 0.1, 0)
	var front: Camera3D = vlm.front.cam
	front.global_position = eye
	front.look_at(eye + f * 10.0 + Vector3(0, -1.2, 0))
	var down: Camera3D = vlm.down.cam
	down.global_position = eye + Vector3(0, -0.3, 0)
	down.look_at(eye + f * 4.0 + Vector3(0, -9.0, 0))
	# side cameras: 90 degrees left / right of the heading
	var r := Vector3(cos(h), 0, sin(h))   # body's right-hand direction in Godot space
	for side in [["left", -1.0], ["right", 1.0]]:
		var c: Camera3D = vlm[side[0]].cam
		var e: Vector3 = World.xz(b.pos.x, b.pos.y, b.pos.z) + r * side[1] * (1.8 if is_sub else 0.5) + Vector3(0, 0.2, 0)
		c.global_position = e
		c.look_at(e + r * side[1] * 10.0 + Vector3(0, -1.2, 0))

# ---------------------------------------------------------------- bridge

func _poll_bridge() -> void:
	while server.is_connection_available():
		var p := server.take_connection()
		peers.append({"peer": p, "buf": ""})
		print("[raobot] harness connected")
	for entry in peers:
		var p: StreamPeerTCP = entry.peer
		p.poll()
		if p.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			continue
		var n := p.get_available_bytes()
		if n > 0:
			entry.buf += p.get_utf8_string(n)
			while entry.buf.find("\n") >= 0:
				var i: int = entry.buf.find("\n")
				var line: String = entry.buf.substr(0, i)
				entry.buf = entry.buf.substr(i + 1)
				if line.strip_edges() != "":
					_handle(p, line)
	peers = peers.filter(func(e): return e.peer.get_status() == StreamPeerTCP.STATUS_CONNECTED)

func _reply(p: StreamPeerTCP, id, data: Dictionary) -> void:
	data["id"] = id
	p.put_data((JSON.stringify(data) + "\n").to_utf8_buffer())

func _handle(p: StreamPeerTCP, line: String) -> void:
	var req = JSON.parse_string(line)
	if typeof(req) != TYPE_DICTIONARY:
		return
	var id = req.get("id", 0)
	match str(req.get("cmd", "")):
		"ping":
			_reply(p, id, {"ok": true})
		"state":
			_reply(p, id, {"ok": true, "state": sim.state(), "zones": world.zones})
		"act":
			if sim.is_busy():
				_reply(p, id, {"ok": false, "error": "busy"})
				return
			speed = float(req.get("speed", speed))
			sim.begin(req.action)
			pending_act = {"peer": p, "id": id}
			_update_hud({"phase": "executing"})
		"look":
			_look(p, id, str(req.dir), str(req.get("name", "look")))
		"shot":
			_shot(p, id, str(req.path))
		"hud":
			_update_hud(req)
			_reply(p, id, {"ok": true})
		"teleport":
			var who := str(req.get("who", "sub"))
			var pos := Vector3(float(req.E), -float(req.depth), float(req.N))
			if req.has("above_floor"):
				pos.y = world.floor_at(pos.x, pos.z) + float(req.above_floor)
			var bd: Dictionary = sim.get(who)
			bd.pos = pos
			bd.heading = float(req.get("heading", 0))
			sim.active = who
			if who == "diver":
				sim.sub.pos = pos + Vector3(-8, 4, 0)
			_update_camera(true)
			_update_hud({})
			_reply(p, id, {"ok": true, "state": sim.state()})
		"view":
			view_mode = str(req.get("mode", "chase"))
			focus = req
			_update_camera(true)
			_reply(p, id, {"ok": true})
		"record":
			_record(p, id, str(req.dir), str(req.get("name", "clip")), int(req.get("frames", 16)), float(req.get("interval", 0.15)))
		"quit":
			_reply(p, id, {"ok": true})
			get_tree().quit()
		_:
			_reply(p, id, {"ok": false, "error": "unknown cmd"})

func _look(p: StreamPeerTCP, id, dir: String, name: String) -> void:
	_place_vlm_cameras()
	DirAccess.make_dir_recursive_absolute(dir)
	var paths := {}
	for k in vlm:
		vlm[k].vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	# a couple of frames so volumetric fog/temporal effects settle in the small viewports
	for i in 3:
		await RenderingServer.frame_post_draw
		for k in vlm:
			vlm[k].vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	await RenderingServer.frame_post_draw
	for k in vlm:
		var img: Image = vlm[k].vp.get_texture().get_image()
		var path := "%s/%s_%s.png" % [dir, name, k]
		img.save_png(path)
		paths[k] = path
	_reply(p, id, {"ok": true, "paths": paths, "state": sim.state()})

func _record(p: StreamPeerTCP, id, dir: String, name: String, frames: int, interval: float) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	var paths := []
	for i in frames:
		await get_tree().create_timer(interval).timeout
		await RenderingServer.frame_post_draw
		var path := "%s/%s_%03d.png" % [dir, name, i]
		get_viewport().get_texture().get_image().save_png(path)
		paths.append(path)
	_reply(p, id, {"ok": true, "paths": paths})

func _shot(p: StreamPeerTCP, id, path: String) -> void:
	_update_camera(true)
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	get_viewport().get_texture().get_image().save_png(path)
	_reply(p, id, {"ok": true, "path": path})
