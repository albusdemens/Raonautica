# The submarine ("Minnow") and the diver, built from primitives. Both face -z (North) at heading 0.
class_name Actors
extends RefCounted

static func _mi(mesh: Mesh, mat: Material, pos := Vector3.ZERO, rot := Vector3.ZERO, scale := Vector3.ONE) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = mesh; m.material_override = mat; m.position = pos; m.rotation = rot; m.scale = scale
	return m

static func _pbr(color: Color, rough := 0.4, metal := 0.0, clearcoat := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color; m.roughness = rough; m.metallic = metal
	if clearcoat > 0.0:
		m.clearcoat_enabled = true; m.clearcoat = clearcoat; m.clearcoat_roughness = 0.1
	return m

static func make_sub() -> Node3D:
	var root := Node3D.new()
	root.name = "Sub"
	var hull := _pbr(Color("#f2f0ea"), 0.3, 0.1, 1.0)
	var accent := _pbr(Color("#ff8a2a"), 0.35, 0.0, 1.0)
	var dark := _pbr(Color("#2d3440"), 0.4, 0.6)
	var body := SphereMesh.new(); body.radius = 1.6; body.height = 3.2
	root.add_child(_mi(body, hull, Vector3.ZERO, Vector3.ZERO, Vector3(1, 0.85, 1.7)))
	var stripe := TorusMesh.new(); stripe.inner_radius = 1.3; stripe.outer_radius = 1.55
	root.add_child(_mi(stripe, accent, Vector3(0, 0.05, 0), Vector3(0, 0, PI / 2), Vector3(1, 1, 1.7)))
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.55, 0.88, 1.0, 0.35); glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass.roughness = 0.04; glass.metallic_specular = 1.0; glass.clearcoat_enabled = true
	glass.emission_enabled = true; glass.emission = Color("#1b5c78"); glass.emission_energy_multiplier = 0.5
	var dome := SphereMesh.new(); dome.radius = 1.25; dome.height = 2.5
	root.add_child(_mi(dome, glass, Vector3(0, 0.25, -1.6)))
	var screen := QuadMesh.new(); screen.size = Vector2(0.9, 0.35)
	root.add_child(_mi(screen, World.glow_mat(Color("#5ff7ff"), 3.0), Vector3(0, -0.2, -2.3), Vector3(-0.6, 0, 0)))
	for s in [-1.0, 1.0]:
		var pod := CapsuleMesh.new(); pod.radius = 0.42; pod.height = 3.2
		root.add_child(_mi(pod, hull, Vector3(s * 1.75, -0.45, 0.3), Vector3(PI / 2, 0, 0)))
		var ring := TorusMesh.new(); ring.inner_radius = 0.38; ring.outer_radius = 0.52
		root.add_child(_mi(ring, accent, Vector3(s * 1.75, -0.45, 1.85), Vector3(PI / 2, 0, 0)))
		var jet := SphereMesh.new(); jet.radius = 0.3; jet.height = 0.3
		root.add_child(_mi(jet, World.glow_mat(Color("#9ff3ff"), 4.0), Vector3(s * 1.75, -0.45, 2.0)))
		var lamp := CylinderMesh.new(); lamp.top_radius = 0.18; lamp.bottom_radius = 0.22; lamp.height = 0.25
		root.add_child(_mi(lamp, World.glow_mat(Color("#fff6c8"), 10.0), Vector3(s * 1.75, -0.45, -1.5), Vector3(PI / 2, 0, 0)))
		var L := SpotLight3D.new()
		L.name = "Headlight%d" % (1 if s > 0 else 0)
		L.light_color = Color("#fff3d0"); L.light_energy = 0.0; L.spot_range = 45.0; L.spot_angle = 28.0
		L.light_volumetric_fog_energy = 1.5
		L.position = Vector3(s * 1.75, -0.45, -1.7)
		L.rotation = Vector3(-0.1, 0, 0)
		root.add_child(L)
	var fin := BoxMesh.new(); fin.size = Vector3(0.12, 0.9, 1.2)
	root.add_child(_mi(fin, accent, Vector3(0, 1.35, 1.4)))
	var hatch := CylinderMesh.new(); hatch.top_radius = 0.45; hatch.bottom_radius = 0.45; hatch.height = 0.12
	root.add_child(_mi(hatch, dark, Vector3(0, -1.35, 0.4)))
	return root

static func make_diver() -> Node3D:
	var root := Node3D.new()
	root.name = "Diver"
	var body := Node3D.new(); body.name = "Body"
	root.add_child(body)
	var suit := _pbr(Color("#f4f1e8"), 0.6)
	var orange := _pbr(Color("#ff7b2e"), 0.35, 0.0, 1.0)
	var dark := _pbr(Color("#30384a"), 0.3, 0.8)
	var torso := CapsuleMesh.new(); torso.radius = 0.28; torso.height = 1.16
	body.add_child(_mi(torso, suit, Vector3.ZERO, Vector3(PI / 2, 0, 0)))
	var helmet := SphereMesh.new(); helmet.radius = 0.27; helmet.height = 0.54
	body.add_child(_mi(helmet, orange, Vector3(0, 0.05, -0.62)))
	var visor := SphereMesh.new(); visor.radius = 0.2; visor.height = 0.2; visor.is_hemisphere = true
	body.add_child(_mi(visor, World.glow_mat(Color("#6fe3ff"), 2.5), Vector3(0, 0, -0.78), Vector3(-PI / 2, 0, 0)))
	var tank := CapsuleMesh.new(); tank.radius = 0.13; tank.height = 0.7
	body.add_child(_mi(tank, dark, Vector3(0, 0.28, -0.05), Vector3(PI / 2, 0, 0)))
	for s in [-1.0, 1.0]:
		var leg := Node3D.new(); leg.name = "Leg%d" % (1 if s > 0 else 0); leg.position = Vector3(s * 0.13, 0, 0.35)
		var thigh := CapsuleMesh.new(); thigh.radius = 0.1; thigh.height = 0.75
		leg.add_child(_mi(thigh, suit, Vector3(0, 0, 0.3), Vector3(PI / 2, 0, 0)))
		var flipper := BoxMesh.new(); flipper.size = Vector3(0.22, 0.03, 0.42)
		leg.add_child(_mi(flipper, orange, Vector3(0, 0, 0.8)))
		body.add_child(leg)
		var arm := CapsuleMesh.new(); arm.radius = 0.075; arm.height = 0.65
		body.add_child(_mi(arm, suit, Vector3(s * 0.32, -0.05, -0.55), Vector3(PI / 2 - 0.3, 0, s * 0.35)))
	var torch := SpotLight3D.new(); torch.name = "Torch"
	torch.light_color = Color("#e8fbff"); torch.light_energy = 0.0; torch.spot_range = 22.0; torch.spot_angle = 30.0
	torch.light_volumetric_fog_energy = 1.0
	torch.position = Vector3(0.3, -0.05, -0.9); torch.rotation = Vector3(-0.12, 0, 0)
	body.add_child(torch)
	root.scale = Vector3.ONE * 1.15
	return root

# VLM cameras: rendered into small SubViewports only when the harness asks to "look"
static func make_vlm_rig(parent: Node, size := Vector2i(512, 288)) -> Dictionary:
	var rig := {}
	for name in ["front", "left", "right", "back", "down"]:
		var vp := SubViewport.new()
		vp.name = "VLM_" + name
		vp.size = size
		vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
		vp.msaa_3d = Viewport.MSAA_2X
		var cam := Camera3D.new()
		cam.fov = 70.0 if name == "down" else 62.0
		cam.far = 400.0
		vp.add_child(cam)
		parent.add_child(vp)
		rig[name] = {"vp": vp, "cam": cam}
	return rig
