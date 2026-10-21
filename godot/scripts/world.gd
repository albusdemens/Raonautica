# The ocean: 1 km x 1 km, up to ~190 m deep. Biomes: Safe Shallows (SW, start), Kelp Forest (W),
# Grassy Plateaus with a ship wreck (centre/S), Mushroom Forest (NE, deep), Deep Canyon (E) with the
# Crystal Crevice at its bottom. Same layout as the three.js version.
# Coordinates: Godot x = East, z = -North, y = up (surface at y = 0). Raon sees E / N / depth.
class_name World
extends Node3D

const HALF := 500.0
const CHUNK := 100.0
const VIEW_DIST := 240.0
const UW := preload("res://shaders/uw.gdshader")
const TERRAIN := preload("res://shaders/terrain.gdshader")
const SURFACE := preload("res://shaders/surface.gdshader")

var colliders: Array = []   # {type: "cyl"|"sph", E, N, r, y0, y1, y, label}
var items: Array = []       # {id, kind, name, home: Vector3(E, y, N), node, state, phase}
var zones: Array = []
var start := {"E": -360.0, "N": -385.0, "depth": 1.5, "heading": 45.0}

var rng := RandomNumberGenerator.new()
var n4 := FastNoiseLite.new()
var n3 := FastNoiseLite.new()
var n2 := FastNoiseLite.new()
var n1 := FastNoiseLite.new()
var crevice := Vector2.ZERO
var ledge := Vector2.ZERO
var wreck := Vector2(40, -250)
var fish_updaters: Array = []
var _mat_cache := {}

func _init() -> void:
	for n in [n4, n3, n2, n1]:
		n.noise_type = FastNoiseLite.TYPE_PERLIN
		n.frequency = 1.0
		n.fractal_type = FastNoiseLite.FRACTAL_FBM
		n.seed = 1337
	n4.fractal_octaves = 4
	n3.fractal_octaves = 3
	n2.fractal_octaves = 2
	n1.fractal_octaves = 1
	crevice = Vector2(canyon_x(-120.0), -120.0)
	ledge = Vector2(canyon_x(-262.0) - 78.0, -262.0)

# ------------------------------------------------------------------ terrain function

func canyon_x(N: float) -> float:
	return 395.0 + 28.0 * n1.get_noise_2d(N * 0.004, 3.1)

static func sstep(a: float, b: float, x: float) -> float:
	var t: float = clamp((x - a) / (b - a), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)

func floor_at(E: float, N: float) -> float:
	var y := -55.0 + 10.0 * n4.get_noise_2d(E * 0.005 + 3.0, N * 0.005 - 7.0) + 2.5 * n2.get_noise_2d(E * 0.04, N * 0.04)
	y = lerp(y, -19.0 + 4.0 * n3.get_noise_2d(E * 0.02 + 1.0, N * 0.02), sstep(250.0, 130.0, Vector2(E + 330.0, N + 320.0).length()))
	y = lerp(y, -36.0 + 3.0 * n3.get_noise_2d(E * 0.015, N * 0.015 + 5.0), sstep(160.0, 100.0, Vector2(E + 320.0, N - 170.0).length()))
	y = lerp(y, -100.0 + 6.0 * n3.get_noise_2d(E * 0.01 + 8.0, N * 0.01), sstep(180.0, 110.0, Vector2(E - 230.0, N - 260.0).length()))
	y = lerp(y, -182.0 + 6.0 * n3.get_noise_2d(E * 0.02, N * 0.02 + 2.0), sstep(100.0, 50.0, absf(E - canyon_x(N))))
	var dl := Vector2(E - ledge.x, N - ledge.y).length()
	if dl < 14.0:
		y = lerp(y, maxf(y, -112.0), sstep(14.0, 9.0, dl))
	y -= 10.0 * sstep(8.0, 3.0, Vector2(E - crevice.x, N - crevice.y).length())
	var out: float = maxf(absf(E), absf(N)) - HALF
	if out > 0.0:
		y = lerp(y, -8.0, sstep(0.0, 60.0, out))
	return y

func w_shallow(E: float, N: float) -> float: return sstep(240.0, 140.0, Vector2(E + 330.0, N + 320.0).length())
func w_kelp(E: float, N: float) -> float: return sstep(125.0, 95.0, Vector2(E + 320.0, N - 170.0).length())
func w_mush(E: float, N: float) -> float: return sstep(150.0, 105.0, Vector2(E - 230.0, N - 260.0).length())

static func xz(E: float, y: float, N: float) -> Vector3:
	return Vector3(E, y, -N)

# ------------------------------------------------------------------ materials

func uw_mat(color: Color, opts := {}) -> ShaderMaterial:
	var key := str(color) + str(opts)
	if _mat_cache.has(key):
		return _mat_cache[key]
	var m := ShaderMaterial.new()
	m.shader = UW
	m.set_shader_parameter("albedo", color)
	m.set_shader_parameter("anim", opts.get("anim", 0))
	m.set_shader_parameter("amt", opts.get("amt", 0.15))
	m.set_shader_parameter("emission_color", opts.get("emission", Color(0, 0, 0)))
	m.set_shader_parameter("emission_strength", opts.get("emit", 0.0))
	m.set_shader_parameter("roughness_v", opts.get("rough", 0.8))
	m.set_shader_parameter("metallic_v", opts.get("metal", 0.0))
	m.set_shader_parameter("caustic_strength", opts.get("caustics", 1.0))
	m.set_shader_parameter("clearcoat_v", opts.get("clearcoat", 0.0))
	m.set_shader_parameter("desat", opts.get("desat", 0.0))
	m.set_shader_parameter("rim_color", opts.get("rim", Color(0, 0, 0)))
	m.set_shader_parameter("rim_strength", opts.get("rim_k", 0.0))
	_mat_cache[key] = m
	return m

static func glow_mat(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	return m

# merge primitive meshes with transforms into one mesh: parts = [[mesh, Transform3D], ...]
static func merge(parts: Array) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for p in parts:
		st.append_from(p[0], 0, p[1])
	return st.commit()

static func half_disc() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 18
	for i in n:
		var a0 := PI * i / n; var a1 := PI * (i + 1) / n
		for v in [Vector3.ZERO, Vector3(cos(a0), sin(a0), 0), Vector3(cos(a1), sin(a1), 0)]:
			st.set_normal(Vector3(0, 0, 1)); st.add_vertex(v)
	return st.commit()

# ------------------------------------------------------------------ zones & items

func _defs() -> void:
	zones = [
		{"id": "Z1", "name": "Safe Shallows", "E": -330, "N": -320, "parkDepth": 8, "r": 90,
			"desc": "sunlit coral shallows, floor ~19 m deep. Exactly 2 Bubblefins (round yellow fish) live here, near the centre - once you have caught 2 Bubblefins, nothing more is needed here."},
		{"id": "Z2", "name": "Kelp Forest", "E": -320, "N": 170, "parkDepth": 3, "r": 100,
			"desc": "huge dense kelp forest, floor ~36 m, kelp tops 6.5-9.5 m deep. The sub CANNOT go between kelp stalks - park above the canopy (depth ~3 m) at the centre and send the diver down. Exactly 2 Kelp Peepers (green fish) and 3 sea lettuces (salad: a bright green leafy ball on the floor) live near the centre."},
		{"id": "Z3", "name": "Grassy Plateaus", "E": 0, "N": 0, "parkDepth": 30, "r": 160,
			"desc": "open red-grass plateau, floor ~55 m, rock arches. Nothing needed here; it is the fast road across the map."},
		{"id": "Z4", "name": "Ship Wreck", "E": wreck.x, "N": wreck.y, "parkDepth": 30, "r": 80,
			"desc": "a huge crashed ship on the plateau (~55 m). A landmark; nothing needed here."},
		{"id": "Z5", "name": "Mushroom Forest", "E": 230, "N": 260, "parkDepth": 85, "r": 110,
			"desc": "dark basin, floor ~100 m, giant glowing purple mushrooms (caps are obstacles). Exactly 2 Glow Lanternfish (dark fish with a cyan glowing lure) drift near the centre at ~90-95 m."},
		{"id": "Z6", "name": "Deep Canyon", "E": roundf(canyon_x(0)), "N": 0, "parkDepth": 150, "r": 60,
			"desc": "long winding canyon along the east side, floor ~182 m, very dark. A mineral ledge sits on its west wall near E=%d N=%d at ~110 m depth." % [roundi(ledge.x), roundi(ledge.y)]},
		{"id": "Z7", "name": "Crystal Crevice", "E": roundf(crevice.x), "N": crevice.y, "parkDepth": 165, "r": 10,
			"desc": "a pocket at the canyon bottom (~190 m) ringed by rock pillars and capped by a boulder. Only the diver fits through the gaps. Mineral crystals (glowing violet crystal clusters) grow inside."},
	]
	var defs := [
		["F1", "fish", "Bubblefin", -320, -300, 12], ["F2", "fish", "Bubblefin", -345, -336, 11],
		["F3", "fish", "Kelp Peeper", -330, 160, 22], ["F4", "fish", "Kelp Peeper", -306, 184, 18],
		["F5", "fish", "Glow Lanternfish", 220, 250, 92], ["F6", "fish", "Glow Lanternfish", 246, 272, 95],
		["S1", "salad", "Sea Lettuce", -322, 175, null], ["S2", "salad", "Sea Lettuce", -336, 150, null], ["S3", "salad", "Sea Lettuce", -300, 166, null],
		["M1", "mineral", "Salt Crystal", crevice.x - 1, crevice.y + 1, null], ["M2", "mineral", "Salt Crystal", crevice.x + 1.5, crevice.y - 1.5, null],
		["M3", "mineral", "Salt Crystal", ledge.x, ledge.y, null],
	]
	for d in defs:
		var E: float = d[3]
		var N: float = d[4]
		var y: float = -float(d[5]) if d[5] != null else floor_at(E, N) + (0.6 if d[1] == "salad" else 0.5)
		items.append({"id": d[0], "kind": d[1], "name": d[2], "home": Vector3(E, y, N), "state": "world", "phase": rng.randf() * TAU})

func _clear_of_items(E: float, N: float, r: float) -> bool:
	for it in items:
		if Vector2(E - it.home.x, N - it.home.z).length() < r:
			return false
	return Vector2(E - start.E, N - start.N).length() > 14.0

# ------------------------------------------------------------------ build

func build() -> void:
	rng.seed = 7
	_defs()
	_build_terrain()
	_build_surface()
	_build_rocks()
	_build_shallows()
	_build_plateau()
	_build_kelp()
	_build_deep()
	_build_wreck()
	_build_schools()
	_build_item_nodes()

func _chunk_center(E: float, N: float) -> Vector2:
	return Vector2(floorf((E + HALF) / CHUNK) * CHUNK - HALF + CHUNK / 2.0, floorf((N + HALF) / CHUNK) * CHUNK - HALF + CHUNK / 2.0)

func _build_terrain() -> void:
	var mat := ShaderMaterial.new()
	mat.shader = TERRAIN
	var res := 2.0
	var n := int(CHUNK / res)
	var c_plateau := Color("#c9b48e"); var c_sand := Color("#cfbb8e"); var c_kelp := Color("#a99a68")
	var c_deep := Color("#556584"); var c_mush := Color("#4b3f6e"); var c_rock := Color("#8a8578"); var c_deeprock := Color("#463f63"); var c_strata := Color("#6c5a7c")
	var starts: Array = []
	var s := -HALF - CHUNK
	while s <= HALF:
		starts.append(s)
		s += CHUNK
	for N0 in starts:
		for E0 in starts:
			var W := n + 3
			var H := PackedFloat32Array()
			H.resize(W * W)
			for j in W:
				for i in W:
					H[j * W + i] = floor_at(E0 + (i - 1) * res, N0 + (j - 1) * res)
			var verts := PackedVector3Array(); var norms := PackedVector3Array(); var cols := PackedColorArray(); var idx := PackedInt32Array()
			for j in range(n + 1):
				for i in range(n + 1):
					var E: float = E0 + i * res
					var N: float = N0 + j * res
					var y: float = H[(j + 1) * W + i + 1]
					var dE: float = (H[(j + 1) * W + i + 2] - H[(j + 1) * W + i]) / (2.0 * res)
					var dN: float = (H[(j + 2) * W + i + 1] - H[j * W + i + 1]) / (2.0 * res)
					verts.append(Vector3(E, y, -N))
					norms.append(Vector3(-dE, 1.0, dN).normalized())
					var slope: float = minf(1.0, Vector2(dE, dN).length())
					var c := c_plateau.lerp(c_sand, w_shallow(E, N)).lerp(c_kelp, w_kelp(E, N))
					c = c.lerp(c_deep, sstep(-70.0, -150.0, y)).lerp(c_mush, w_mush(E, N))
					var band := 0.5 + 0.5 * sin(y * 0.8 + n2.get_noise_2d(E * 0.05, N * 0.05) * 2.0)
					c = c.lerp((c_deeprock if y < -80.0 else c_rock).lerp(c_strata, band * 0.5), sstep(0.45, 0.9, slope))
					cols.append(c)
			for j in n:
				for i in n:
					var a := j * (n + 1) + i
					var b := a + 1
					var c2 := a + (n + 1)
					var d := c2 + 1
					idx.append_array(PackedInt32Array([a, c2, b, b, c2, d]))   # clockwise = front face in Godot
			var arrays := []
			arrays.resize(Mesh.ARRAY_MAX)
			arrays[Mesh.ARRAY_VERTEX] = verts
			arrays[Mesh.ARRAY_NORMAL] = norms
			arrays[Mesh.ARRAY_COLOR] = cols
			arrays[Mesh.ARRAY_INDEX] = idx
			var mesh := ArrayMesh.new()
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			mesh.surface_set_material(0, mat)
			var mi := MeshInstance3D.new()
			mi.mesh = mesh
			mi.visibility_range_end = VIEW_DIST + 80.0
			add_child(mi)

func _build_surface() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(1400, 1400)
	var m := ShaderMaterial.new()
	m.shader = SURFACE
	plane.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = plane
	mi.name = "Surface"
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

# jittered grid scatter over a box, kept with probability density(E, N)
func scatter(spacing: float, box: Rect2, density: Callable) -> Array:
	var out: Array = []
	var N := box.position.y
	while N < box.end.y:
		var E := box.position.x
		while E < box.end.x:
			var e := E + rng.randf() * spacing
			var nn := N + rng.randf() * spacing
			if absf(e) < HALF - 2.0 and absf(nn) < HALF - 2.0 and rng.randf() < float(density.call(e, nn)):
				out.append(Vector2(e, nn))
			E += spacing
		N += spacing
	return out

# one MultiMeshInstance3D per chunk; place(E, N) -> {t: Transform3D, c: Color} or {} to skip
func decor(mesh: Mesh, mat: Material, spots: Array, place: Callable, cast := true) -> void:
	var bins := {}
	for s in spots:
		var key := _chunk_center(s.x, s.y)
		if not bins.has(key):
			bins[key] = []
		bins[key].append(s)
	for key in bins:
		var placed: Array = []
		for s in bins[key]:
			var r: Dictionary = place.call(s.x, s.y)
			if not r.is_empty():
				placed.append(r)
		if placed.is_empty():
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = mesh
		mm.instance_count = placed.size()
		for i in placed.size():
			mm.set_instance_transform(i, placed[i].t)
			mm.set_instance_color(i, placed[i].get("c", Color.WHITE))
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = mat
		mmi.visibility_range_end = VIEW_DIST
		mmi.visibility_range_end_margin = 20.0
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)

func _t(E: float, y: float, N: float, rot_y: float, scale: Vector3) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, rot_y).scaled(scale), xz(E, y, N))

func _pick(arr: Array):
	return arr[rng.randi() % arr.size()]

func rock_mesh(detail: int, seed_: float) -> ArrayMesh:
	var sphere := SphereMesh.new()
	sphere.radial_segments = 10 + detail * 4
	sphere.rings = 6 + detail * 2
	var arrays := sphere.get_mesh_arrays()
	var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	for i in v.size():
		var p := v[i] * 2.0
		var d := 1.0 + 0.28 * n2.get_noise_3d(p.x * 1.7 + seed_, p.y * 1.9, p.z * 1.3) * 2.0 + 0.1 * n1.get_noise_3d(p.x * 5.0, p.z * 5.0 + seed_, p.y)
		p *= d
		p.y = maxf(p.y, -0.45)
		v[i] = p
	arrays[Mesh.ARRAY_VERTEX] = v
	var st := SurfaceTool.new()
	st.create_from_arrays(arrays)
	st.generate_normals()
	return st.commit()

func _build_rocks() -> void:
	var spots := scatter(22.0, Rect2(-HALF, -HALF, 2 * HALF, 2 * HALF), func(E, N): return 0.55 if _clear_of_items(E, N, 8.0) else 0.0)
	decor(rock_mesh(2, 3.3), uw_mat(Color.WHITE, {"rough": 0.9}), spots, func(E, N):
		var s := 1.0 + rng.randf() * rng.randf() * 6.0
		var y := floor_at(E, N) + s * 0.15
		colliders.append({"type": "sph", "E": E, "N": N, "y": y, "r": s * 1.05, "label": "rock"})
		var c := Color("#5a5478") if y < -80.0 else Color("#b3a896")
		return {"t": _t(E, y, N, rng.randf() * TAU, Vector3(s * 1.2, s * 0.8, s)), "c": c.lightened(rng.randf_range(-0.1, 0.1))})

func _build_shallows() -> void:
	var box := Rect2(-HALF, -HALF, HALF - 60.0, HALF - 80.0)
	var reef := func(k: float) -> Callable:
		return func(E, N): return w_shallow(E, N) * k if _clear_of_items(E, N, 3.0) else 0.0
	# brain coral
	var brain := SphereMesh.new(); brain.radial_segments = 24; brain.rings = 12; brain.height = 1.5
	decor(brain, uw_mat(Color.WHITE, {"rough": 0.7, "desat": 0.45}), scatter(10.0, box, reef.call(0.6)), func(E, N):
		var s := 0.6 + rng.randf() * 1.5
		return {"t": _t(E, floor_at(E, N) + s * 0.2, N, 0.0, Vector3(s, s * 0.75, s)), "c": Color(_pick(["#e0569c", "#b05ad9", "#d8643a", "#7a5cd6", "#3f9fb8"]))})
	# table coral
	var stem := CylinderMesh.new(); stem.top_radius = 0.12; stem.bottom_radius = 0.22; stem.height = 1.2
	var plate := CylinderMesh.new(); plate.top_radius = 1.4; plate.bottom_radius = 1.15; plate.height = 0.14
	var plate2 := CylinderMesh.new(); plate2.top_radius = 0.9; plate2.bottom_radius = 0.75; plate2.height = 0.12
	var table := merge([[stem, Transform3D(Basis(), Vector3(0, 0.6, 0))], [plate, Transform3D(Basis(), Vector3(0, 1.2, 0))], [plate2, Transform3D(Basis(), Vector3(0.5, 0.85, 0.3))]])
	decor(table, uw_mat(Color.WHITE, {"rough": 0.6, "desat": 0.45}), scatter(13.0, box, reef.call(0.6)), func(E, N):
		var s := 0.8 + rng.randf() * 1.4
		return {"t": _t(E, floor_at(E, N), N, rng.randf() * TAU, Vector3(s, s, s)), "c": Color(_pick(["#ff8a3d", "#3ec1c9", "#9ad94e", "#f35f8a"]))})
	# tube coral
	var tparts := []
	for i in 7:
		var tb := CylinderMesh.new(); tb.top_radius = 0.12; tb.bottom_radius = 0.09; tb.height = 0.6 + (i % 3) * 0.35; tb.cap_top = false
		var a := i * 0.9; var dd := 0.0 if i == 0 else 0.28
		tparts.append([tb, Transform3D(Basis(), Vector3(cos(a) * dd, tb.height / 2.0, sin(a) * dd))])
	decor(merge(tparts), uw_mat(Color.WHITE, {"anim": 1, "amt": 0.04, "desat": 0.45}), scatter(9.0, box, reef.call(0.6)), func(E, N):
		var s := 0.9 + rng.randf() * 1.5
		return {"t": _t(E, floor_at(E, N) - 0.05, N, rng.randf() * TAU, Vector3(s, s, s)), "c": Color(_pick(["#a35ee8", "#c74fa0", "#ff6f61", "#56e0c2"]))})
	# sea fans
	decor(half_disc(), uw_mat(Color.WHITE, {"anim": 1, "amt": 0.05, "rough": 0.9, "desat": 0.45}), scatter(12.0, box, reef.call(0.6)), func(E, N):
		var s := 0.8 + rng.randf() * 1.3
		return {"t": _t(E, floor_at(E, N), N, rng.randf() * TAU, Vector3(s, s * 1.3, s)), "c": Color(_pick(["#e8434f", "#f0884a", "#c94fd6"]))})
	# glowing acid mushrooms
	var mstem := CylinderMesh.new(); mstem.top_radius = 0.08; mstem.bottom_radius = 0.11; mstem.height = 0.7
	var mcap := SphereMesh.new(); mcap.radius = 0.4; mcap.height = 0.4; mcap.is_hemisphere = true
	var mush := merge([[mstem, Transform3D(Basis(), Vector3(0, 0.35, 0))], [mcap, Transform3D(Basis(), Vector3(0, 0.65, 0))]])
	decor(mush, uw_mat(Color.WHITE, {"rough": 0.5, "desat": 0.45}), scatter(11.0, box, reef.call(0.6)), func(E, N):
		var s := 0.7 + rng.randf() * 1.1
		return {"t": _t(E, floor_at(E, N), N, 0.0, Vector3(s, s, s)), "c": Color("#7de05a")})
	# sea grass
	var blade := QuadMesh.new(); blade.size = Vector2(0.1, 1.0); blade.center_offset = Vector3(0, 0.5, 0)
	decor(blade, uw_mat(Color.WHITE, {"anim": 1, "amt": 0.25}), scatter(1.8, box, func(E, N): return w_shallow(E, N) * 0.9), func(E, N):
		var s := 0.6 + rng.randf() * 1.6
		return {"t": _t(E, floor_at(E, N) - 0.05, N, rng.randf() * TAU, Vector3(1, s, 1)), "c": Color(_pick(["#6fbf5a", "#9ccf4f", "#4f9e6a", "#c2c95a"]))}, false)

func _build_plateau() -> void:
	var box := Rect2(-HALF, -HALF, HALF + 330.0, 2 * HALF)
	var blade := QuadMesh.new(); blade.size = Vector2(0.15, 1.0); blade.center_offset = Vector3(0, 0.5, 0)
	decor(blade, uw_mat(Color.WHITE, {"anim": 1, "amt": 0.22, "emission": Color("#3a0a06"), "emit": 0.4}),
		scatter(1.9, box, func(E, N):
			var y := floor_at(E, N)
			var ok := y < -40.0 and y > -75.0 and w_kelp(E, N) < 0.1 and w_mush(E, N) < 0.1 and n2.get_noise_2d(E * 0.02, N * 0.02) > 0.05
			return 0.9 if ok else 0.0),
		func(E, N):
			var s := 0.9 + rng.randf() * 2.2
			return {"t": _t(E, floor_at(E, N) - 0.05, N, rng.randf() * TAU, Vector3(1.5, s, 1.5)), "c": Color(_pick(["#c9483a", "#e0603f", "#a8362e", "#d9733f"]))}, false)
	# rock arches and spires
	var stone := uw_mat(Color("#9b8a80"), {"rough": 0.9})
	var spire_mesh := rock_mesh(3, 1.0)
	for a in [[-80, 60, 1.4, "arch"], [120, -90, 1.8, "arch"], [-150, -120, 1.2, "spire"], [60, 140, 1.6, "spire"],
			[180, 40, 1.3, "arch"], [-40, -60, 1.0, "spire"], [250, -200, 1.5, "spire"], [-200, 20, 1.3, "arch"]]:
		var E: float = a[0]; var N: float = a[1]; var s: float = a[2]
		var y0 := floor_at(E, N)
		var g := Node3D.new()
		if a[3] == "arch":
			for dx in [-14.0, 14.0]:
				var p := MeshInstance3D.new(); p.mesh = spire_mesh; p.material_override = stone
				p.scale = Vector3(5, 16, 5); p.position = Vector3(dx, 10, 0); g.add_child(p)
				colliders.append({"type": "cyl", "E": E + dx * s, "N": N, "r": 5.5 * s, "y0": y0, "y1": y0 + 26.0 * s, "label": "rock arch pillar"})
			var top := MeshInstance3D.new(); var tm := TorusMesh.new(); tm.inner_radius = 10.0; tm.outer_radius = 18.0; tm.rings = 24
			top.mesh = tm; top.material_override = stone; top.rotation = Vector3(PI / 2, 0, 0); top.position = Vector3(0, 22, 0); top.scale = Vector3(1, 1, 0.6)
			g.add_child(top)
			colliders.append({"type": "sph", "E": E, "N": N, "y": y0 + 36.0 * s, "r": 6.0 * s, "label": "rock arch top"})
		else:
			var p2 := MeshInstance3D.new(); p2.mesh = spire_mesh; p2.material_override = stone
			p2.scale = Vector3(7, 30, 7); p2.position = Vector3(0, 18, 0); g.add_child(p2)
			colliders.append({"type": "cyl", "E": E, "N": N, "r": 7.5 * s, "y0": y0, "y1": y0 + 48.0 * s, "label": "rock spire"})
		g.position = xz(E, y0 - 1.0, N)
		g.scale = Vector3(s, s, s)
		add_child(g)

func _leaf_into(st: SurfaceTool, base: Vector3, yaw: float, tilt: float, length: float, width: float, color: Color) -> void:
	var segs := 6
	var b := Basis(Vector3.UP, yaw) * Basis(Vector3.FORWARD, tilt)
	var prev_l := Vector3.ZERO; var prev_r := Vector3.ZERO
	for k in range(segs + 1):
		var u := float(k) / segs
		var w := width * sin(PI * minf(1.0, u * 1.15)) * (1.0 - u * 0.3) * 0.5
		var cl := base + b * Vector3(u * length, w, -u * u * length * 0.35)
		var cr := base + b * Vector3(u * length, -w, -u * u * length * 0.35)
		if k > 0:
			for v in [prev_l, prev_r, cl, prev_r, cr, cl]:
				st.set_color(color); st.add_vertex(v)
		prev_l = cl; prev_r = cr

# a 30 m kelp stalk prototype (instances are scaled so the canopy sits 6.5-9.5 m deep)
func _kelp_proto() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var h := 30.0
	var ph := rng.randf() * TAU
	var segs := 22
	for k in segs:
		var y0 := float(k) / segs * h; var y1 := float(k + 1) / segs * h
		var c0 := Vector3(sin(y0 / h * 7.0 + ph) * 0.4, y0, cos(y0 / h * 5.6 + ph) * 0.4)
		var c1 := Vector3(sin(y1 / h * 7.0 + ph) * 0.4, y1, cos(y1 / h * 5.6 + ph) * 0.4)
		for s in 5:
			var a0 := float(s) / 5 * TAU; var a1 := float(s + 1) / 5 * TAU
			var o0 := Vector3(cos(a0), 0, sin(a0)) * 0.12; var o1 := Vector3(cos(a1), 0, sin(a1)) * 0.12
			for v in [c0 + o0, c0 + o1, c1 + o0, c0 + o1, c1 + o1, c1 + o0]:
				st.set_color(Color("#5b7f2e")); st.add_vertex(v)
	var y := 1.5
	while y < h - 0.5:
		var c := Vector3(sin(y / h * 7.0 + ph) * 0.4, y, cos(y / h * 5.6 + ph) * 0.4)
		_leaf_into(st, c, rng.randf() * TAU, 0.5 + rng.randf() * 0.4, 1.5 + rng.randf(), 0.55, Color("#7fae3a") if rng.randf() < 0.5 else Color("#9cc24a"))
		y += 1.1 + rng.randf() * 0.8
	st.generate_normals()
	return st.commit()

func _build_kelp() -> void:
	var mat := uw_mat(Color.WHITE, {"anim": 2, "emission": Color("#1d3008"), "emit": 0.8, "rough": 0.6})
	var protos := [_kelp_proto(), _kelp_proto(), _kelp_proto()]
	var spots := scatter(3.8, Rect2(-460, 40, 280, 260), func(E, N):
		if not _clear_of_items(E, N, 2.4): return 0.0
		var w := w_kelp(E, N)
		return 0.95 if w > 0.5 else w * 0.6)
	var by: Array = [[], [], []]
	for i in spots.size():
		by[i % 3].append(spots[i])
	for k in 3:
		decor(protos[k], mat, by[k], func(E, N):
			var base := floor_at(E, N)
			var top := -6.5 - rng.randf() * 3.0
			var h := top - base
			if h < 3.0: return {}
			colliders.append({"type": "cyl", "E": E, "N": N, "r": 0.4, "y0": base, "y1": top, "label": "kelp stalk"})
			return {"t": _t(E, base, N, rng.randf() * TAU, Vector3(1, h / 30.0, 1))})
	# glowing seed pods in the canopy
	var pod := SphereMesh.new(); pod.radius = 0.2; pod.height = 0.5
	decor(pod, glow_mat(Color("#ffd23a"), 3.0), scatter(6.0, Rect2(-460, 40, 280, 260), func(E, N): return w_kelp(E, N) * 0.5), func(E, N):
		return {"t": _t(E, -8.0 - rng.randf() * 3.0, N, 0.0, Vector3.ONE)}, false)

func _build_deep() -> void:
	# bioluminescent bulbs
	var bulb := SphereMesh.new(); bulb.radius = 0.3; bulb.height = 0.6
	var palette := ["#3ff0ff", "#a96bff", "#47ffa3", "#ff5fd2"]
	decor(bulb, glow_mat(Color.WHITE, 4.0), scatter(9.0, Rect2(60, -HALF, HALF - 60, 2 * HALF), func(E, N): return 0.5 if floor_at(E, N) < -85.0 else 0.0), func(E, N):
		return {"t": _t(E, floor_at(E, N) + 0.8 + rng.randf() * 2.0, N, 0.0, Vector3.ONE), "c": Color(_pick(palette))}, false)
	# glowing dots on canyon walls
	var dot := SphereMesh.new(); dot.radius = 0.14; dot.height = 0.28; dot.radial_segments = 6; dot.rings = 4
	decor(dot, glow_mat(Color.WHITE, 5.0), scatter(6.0, Rect2(260, -HALF, HALF - 260, 2 * HALF), func(E, N):
		var y := floor_at(E, N)
		return 0.8 if y < -70.0 and absf(floor_at(E + 1.0, N) - y) > 0.6 else 0.0), func(E, N):
		return {"t": _t(E, floor_at(E, N) + 0.2, N, 0.0, Vector3.ONE), "c": Color(_pick(["#3ff0ff", "#a96bff"]))}, false)
	# giant mushrooms
	var trunk := CylinderMesh.new(); trunk.top_radius = 0.6; trunk.bottom_radius = 1.2; trunk.height = 12.0
	var capm := SphereMesh.new(); capm.radius = 5.5; capm.height = 5.5; capm.is_hemisphere = true
	var gill := CylinderMesh.new(); gill.top_radius = 5.0; gill.bottom_radius = 5.0; gill.height = 0.1
	var trunk_mat := uw_mat(Color("#d8cfe8"), {"rough": 0.7})
	var cap_mat := uw_mat(Color("#6b3fa8"), {"emission": Color("#3a1670"), "emit": 0.8, "rough": 0.5, "clearcoat": 0.6})
	var gill_mat := glow_mat(Color("#c48bff"), 3.0)
	for s in scatter(38.0, Rect2(100, 140, 260, 250), func(E, N): return 0.8 if w_mush(E, N) > 0.5 and _clear_of_items(E, N, 14.0) else 0.0):
		var E: float = s.x; var N: float = s.y
		var sc := 1.4 + rng.randf() * 1.4
		var base := floor_at(E, N)
		var g := Node3D.new()
		var t := MeshInstance3D.new(); t.mesh = trunk; t.material_override = trunk_mat; t.position.y = 6.0; g.add_child(t)
		var c := MeshInstance3D.new(); c.mesh = capm; c.material_override = cap_mat; c.position.y = 12.0; c.scale = Vector3(1, 0.75, 1); g.add_child(c)
		var gl := MeshInstance3D.new(); gl.mesh = gill; gl.material_override = gill_mat; gl.position.y = 12.05; g.add_child(gl)
		var light := OmniLight3D.new(); light.light_color = Color("#b67cff"); light.light_energy = 2.0; light.omni_range = 14.0; light.position.y = 10.0
		light.distance_fade_enabled = true
		light.distance_fade_begin = VIEW_DIST - 60.0
		light.distance_fade_length = 40.0
		g.add_child(light)
		g.position = xz(E, base - 0.5, N)
		g.scale = Vector3(sc, sc, sc)
		for m in g.get_children():
			if m is GeometryInstance3D: m.visibility_range_end = VIEW_DIST
		add_child(g)
		colliders.append({"type": "cyl", "E": E, "N": N, "r": 1.2 * sc, "y0": base, "y1": base + 11.0 * sc, "label": "giant mushroom stem"})
		colliders.append({"type": "cyl", "E": E, "N": N, "r": 5.5 * sc, "y0": base + 11.0 * sc, "y1": base + 15.0 * sc, "label": "giant mushroom cap"})
	# crystal crevice: 7 pillars on a 7 m ring (diver fits through, sub does not) + boulder cap
	var rock_mat := uw_mat(Color("#4c4868"), {"rough": 0.9})
	var floor_c := floor_at(crevice.x, crevice.y)
	var pm := rock_mesh(2, 5.0)
	for i in 7:
		var a := float(i) / 7.0 * TAU + 0.2
		var E := crevice.x + cos(a) * 7.0; var N := crevice.y + sin(a) * 7.0
		var base := floor_at(E, N) - 1.0; var top := floor_c + 15.0
		var p := MeshInstance3D.new(); p.mesh = pm; p.material_override = rock_mat
		p.scale = Vector3(1.35, (top - base) / 2.0, 1.35); p.position = xz(E, (top + base) / 2.0, N)
		add_child(p)
		colliders.append({"type": "cyl", "E": E, "N": N, "r": 1.4, "y0": base, "y1": top, "label": "crevice pillar"})
	var capr := MeshInstance3D.new(); capr.mesh = rock_mesh(3, 9.1); capr.material_override = rock_mat
	capr.scale = Vector3(8, 3.6, 8); capr.position = xz(crevice.x, floor_c + 17.0, crevice.y)
	add_child(capr)
	colliders.append({"type": "sph", "E": crevice.x, "N": crevice.y, "y": floor_c + 17.0, "r": 7.6, "label": "crevice cap boulder"})
	var crystal := PrismMesh.new(); crystal.size = Vector3(0.7, 2.2, 0.7)
	for i in 12:
		var a := rng.randf() * TAU; var d := rng.randf() * 4.0
		var E := crevice.x + cos(a) * d; var N := crevice.y + sin(a) * d
		var cr := MeshInstance3D.new(); cr.mesh = crystal; cr.material_override = glow_mat(Color("#e070ff"), 2.5)
		cr.position = xz(E, floor_at(E, N) + 1.0, N); cr.rotation = Vector3(rng.randf() * 0.5, rng.randf() * 3.0, rng.randf() * 0.5)
		add_child(cr)
	var cl := OmniLight3D.new(); cl.light_color = Color("#e070ff"); cl.light_energy = 4.0; cl.omni_range = 18.0
	cl.position = xz(crevice.x, floor_c + 2.0, crevice.y)
	add_child(cl)

func _build_wreck() -> void:
	var g := Node3D.new()
	var hull := uw_mat(Color("#d9d4c8"), {"rough": 0.45, "metal": 0.5, "clearcoat": 0.3})
	var rust := uw_mat(Color("#8a4a32"), {"rough": 0.8, "metal": 0.4})
	var stripe := uw_mat(Color("#ff7a1a"), {"rough": 0.5})
	var body := CylinderMesh.new(); body.top_radius = 6.0; body.bottom_radius = 14.0; body.height = 70.0
	for p in [[Vector3(-10, 4, 0), Vector3(PI / 2 - 0.12, 0, 0.35)], [Vector3(14, 3, 18), Vector3(-PI / 2 + 0.2, 0.4, -0.5)]]:
		var m := MeshInstance3D.new(); m.mesh = body; m.material_override = hull; m.position = p[0]; m.rotation = p[1]
		for k in 6:
			var rib := MeshInstance3D.new(); var tm := TorusMesh.new(); tm.inner_radius = 12.5 - k * 1.0; tm.outer_radius = 13.5 - k * 1.0
			rib.mesh = tm; rib.material_override = rust if k > 0 else stripe; rib.position.y = -28.0 + k * 10.0
			m.add_child(rib)
		g.add_child(m)
	for k in 14:
		var d := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(2 + k % 4, 1 + k % 3, 3 + k % 5)
		d.mesh = bm; d.material_override = hull if k % 3 else rust
		d.position = Vector3(sin(k * 2.3) * 40.0, 0.5, cos(k * 1.7) * 45.0); d.rotation = Vector3(k, k * 2, k * 0.5)
		g.add_child(d)
	for p in [Vector3(-10, 18, -40), Vector3(14, 16, 50), Vector3(0, 10, 5), Vector3(-25, 6, -10)]:
		var l := MeshInstance3D.new(); var sm := SphereMesh.new(); sm.radius = 0.5; sm.height = 1.0
		l.mesh = sm; l.material_override = glow_mat(Color("#ff3b2a"), 8.0); l.position = p; g.add_child(l)
		var ol := OmniLight3D.new(); ol.light_color = Color("#ff4030"); ol.light_energy = 3.0; ol.omni_range = 12.0; ol.position = p; g.add_child(ol)
	var y0 := floor_at(wreck.x, wreck.y)
	g.position = xz(wreck.x, y0, wreck.y)
	add_child(g)
	for k in range(-3, 4):
		colliders.append({"type": "sph", "E": wreck.x - 4.0, "N": wreck.y - k * 10.0, "y": y0 + 6.0, "r": 13.0, "label": "ship wreck hull"})

# fish body mesh: elongated sphere + tail + fin (nose at -z, tail at +z)
func fish_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 10; var segs := 10
	for i in rings:
		for j in segs:
			var pts := []
			for dd in [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]]:
				var t := float(i + dd[0]) / rings
				var a := float(j + dd[1]) / segs * TAU
				var r := sin(PI * pow(t, 0.8)) * 0.32 * (1.0 - t * 0.35)
				pts.append(Vector3(cos(a) * r * 0.8, sin(a) * r * 1.1, t * 1.3 - 0.55))
			for p in pts:
				st.set_color(Color.WHITE); st.add_vertex(p)
	for tri in [[Vector3(0, 0, 0.65), Vector3(0, 0.32, 1.0), Vector3(0, -0.32, 1.0)], [Vector3(0, 0.3, -0.1), Vector3(0, 0.5, 0.25), Vector3(0, 0.28, 0.35)]]:
		for p in tri:
			st.set_color(Color(0.87, 0.87, 0.87)); st.add_vertex(p)
	st.generate_normals()
	return st.commit()

func _build_schools() -> void:
	var defs := [[-330, -12, -310, "#5fb8ff", 9], [-300, -10, -360, "#56c8ff", 7], [-380, -8, -290, "#ff6aa6", 10], [-260, -14, -250, "#ff8fb1", 8],
		[-320, -14, 170, "#c2ff6b", 6], [-280, -20, 120, "#7fe6ff", 7], [0, -30, 0, "#ff8a5c", 12], [-100, -35, 80, "#9be7ff", 10],
		[120, -30, -120, "#ff6aa6", 10], [60, -35, -230, "#c7a0ff", 9], [230, -70, 260, "#9e8cff", 8], [390, -120, 50, "#5ff0d8", 7], [390, -140, -200, "#7af0ff", 7]]
	var mesh := fish_mesh()
	var mat := uw_mat(Color.WHITE, {"anim": 3, "amt": 0.08, "rough": 0.35, "metal": 0.3, "caustics": 0.5})
	for d in defs:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = mesh
		mm.instance_count = 30
		var fish := []
		for i in 30:
			fish.append({"ph": rng.randf() * TAU, "rad": d[4] * (0.5 + rng.randf() * 0.6), "dy": rng.randf_range(-2, 2), "sp": 0.12 + rng.randf() * 0.06, "sc": 0.6 + rng.randf() * 0.5})
			mm.set_instance_color(i, Color(d[3]).lightened(rng.randf_range(-0.15, 0.15)))
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm; mmi.material_override = mat
		mmi.visibility_range_end = VIEW_DIST
		add_child(mmi)
		var c := Vector3(d[0], d[1], -d[2])
		fish_updaters.append(func(t: float) -> void:
			for i in 30:
				var f: Dictionary = fish[i]
				var a: float = t * f.sp + f.ph
				var p := c + Vector3(cos(a) * f.rad, f.dy + sin(a * 2.0 + f.ph) * 1.2, sin(a) * f.rad * 0.8)
				# face along the orbit velocity (models look down -z): yaw = PI - a
				mm.set_instance_transform(i, Transform3D(Basis(Vector3.UP, PI - a).scaled(Vector3.ONE * f.sc), p)))

func _build_item_nodes() -> void:
	var fmesh := fish_mesh()
	for it in items:
		var g := Node3D.new()
		if it.kind == "fish":
			var pal: Array = {"Bubblefin": ["#ffcf3b", "#ff7a2f"], "Kelp Peeper": ["#a4e05a", "#2f8f4f"], "Glow Lanternfish": ["#2c3150", "#5ff7ff"]}[it.name]
			var body := MeshInstance3D.new(); body.mesh = fmesh
			body.material_override = uw_mat(Color(pal[0]), {"anim": 3, "amt": 0.12, "rough": 0.35, "metal": 0.2, "caustics": 0.4, "emission": Color(pal[0]), "emit": 0.35, "rim": Color(pal[0]).lightened(0.3), "rim_k": 2.5})
			body.scale = Vector3(1.3, 1.5, 1.1); g.add_child(body)
			var halo := OmniLight3D.new(); halo.light_color = Color(pal[0]); halo.light_energy = 1.2; halo.omni_range = 4.0; g.add_child(halo)
			for sx in [-1.0, 1.0]:
				var eye := MeshInstance3D.new(); var es := SphereMesh.new(); es.radius = 0.17; es.height = 0.34
				eye.mesh = es; eye.material_override = glow_mat(Color.WHITE, 0.6); eye.position = Vector3(sx * 0.3, 0.12, -0.32); g.add_child(eye)
				var pupil := MeshInstance3D.new(); var ps := SphereMesh.new(); ps.radius = 0.09; ps.height = 0.18
				pupil.mesh = ps; pupil.material_override = glow_mat(Color.BLACK, 0.0); pupil.position = Vector3(sx * 0.37, 0.12, -0.4); g.add_child(pupil)
			if it.name == "Glow Lanternfish":
				var lure := MeshInstance3D.new(); var ls := SphereMesh.new(); ls.radius = 0.12; ls.height = 0.24
				lure.mesh = ls; lure.material_override = glow_mat(Color(pal[1]), 6.0); lure.position = Vector3(0, 0.6, -0.7); g.add_child(lure)
				var ll := OmniLight3D.new(); ll.light_color = Color(pal[1]); ll.light_energy = 1.5; ll.omni_range = 6.0; ll.position = lure.position; g.add_child(ll)
			g.scale = Vector3.ONE * 1.6
		elif it.kind == "salad":
			var mat := uw_mat(Color("#8ee05a"), {"emission": Color("#3a8a10"), "emit": 1.0, "rough": 0.5, "rim": Color("#c8ff7a"), "rim_k": 2.5})
			var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
			for i in 11:
				_leaf_into(st, Vector3(0, 0.1, 0), float(i) / 11.0 * TAU, 0.9 + (i % 3) * 0.2, 0.9, 0.7, Color.WHITE)
			st.generate_normals()
			var leaves := MeshInstance3D.new(); leaves.mesh = st.commit(); leaves.material_override = mat; g.add_child(leaves)
			g.scale = Vector3.ONE * 1.3
		else:
			var crystal := PrismMesh.new(); crystal.size = Vector3(0.35, 0.9, 0.35)
			for i in 5:
				var cr := MeshInstance3D.new(); cr.mesh = crystal; cr.material_override = glow_mat(Color("#b9a8ff"), 2.5)
				cr.position = Vector3((i - 2) * 0.18, 0.4, (i % 2) * 0.2 - 0.1); cr.rotation.z = (i - 2) * 0.25
				g.add_child(cr)
			var ol := OmniLight3D.new(); ol.light_color = Color("#a890ff"); ol.light_energy = 1.0; ol.omni_range = 5.0; ol.position.y = 0.5; g.add_child(ol)
			g.scale = Vector3.ONE * 1.4
		it.node = g
		add_child(g)

func item_pos(it: Dictionary, t: float) -> Vector3:
	# returns (E, y, N)
	if it.kind != "fish":
		return it.home
	# wandering loop (~5 m across, ~0.8 m/s) with a slow depth bob: swims, but a 2 m/s diver can catch it
	var ph: float = it.phase
	var w := 0.16
	return Vector3(
		it.home.x + cos(w * t + ph) * 4.0 + sin(2.3 * w * t + ph * 1.7) * 1.5,
		it.home.y + sin(0.9 * w * t + ph) * 1.4,
		it.home.z + sin(w * t + ph) * 3.0 + cos(1.7 * w * t + ph) * 1.2)

func update_visuals(t: float) -> void:
	for u in fish_updaters:
		u.call(t)
	for it in items:
		var n: Node3D = it.node
		n.visible = it.state == "world"
		if n.visible:
			var p := item_pos(it, t)
			n.position = xz(p.x, p.y, p.z)
			if it.kind == "fish":
				var p2 := item_pos(it, t + 0.2)
				n.rotation.y = atan2(-(p2.x - p.x), (p2.z - p.z))
			else:
				n.rotation.y = t * 0.3
