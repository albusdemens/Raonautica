# "DIVER'S BAG" inventory bar: one icon slot per lunch ingredient; slots light up as items are collected.
class_name BagBar
extends Control

const SLOTS := ["fish", "fish", "fish", "salad", "mineral"]
const FISH_COLORS := {"Bubblefin": Color("#ffcf3b"), "Kelp Peeper": Color("#a4e05a"), "Glow Lanternfish": Color("#5ff7ff")}
var filled: Array = []   # [{kind, name}] in pickup order

func set_items(items: Array) -> void:
	filled = items
	queue_redraw()

func _draw() -> void:
	var w := size.x
	draw_style_box(_panel(), Rect2(Vector2.ZERO, size))
	draw_string(ThemeDB.fallback_font, Vector2(12, 20), "DIVER'S BAG", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color("#7ff0ff"))
	var by_kind := {"fish": [], "salad": [], "mineral": []}
	for f in filled:
		by_kind[f.kind].append(f)
	var used := {"fish": 0, "salad": 0, "mineral": 0}
	var n := SLOTS.size()
	var slot_w := (w - 24.0) / n
	for i in n:
		var kind: String = SLOTS[i]
		var c := Vector2(12 + slot_w * (i + 0.5), 52)
		var got: Dictionary = by_kind[kind][used[kind]] if used[kind] < by_kind[kind].size() else {}
		used[kind] += 1
		draw_circle(c, 22, Color(1, 1, 1, 0.08) if got.is_empty() else Color(1, 1, 1, 0.16))
		var col := Color(0.55, 0.62, 0.66, 0.55)
		if not got.is_empty():
			col = FISH_COLORS.get(got.name, Color("#ffcf3b")) if kind == "fish" else (Color("#8ee05a") if kind == "salad" else Color("#c9a8ff"))
		match kind:
			"fish": _fish(c, col, got.is_empty())
			"salad": _leaf(c, col, got.is_empty())
			"mineral": _crystal(c, col, got.is_empty())
		if not got.is_empty():
			draw_circle(c + Vector2(15, -15), 7, Color("#2ecc71"))
			draw_polyline(PackedVector2Array([c + Vector2(11, -15), c + Vector2(14, -12), c + Vector2(19, -18)]), Color.WHITE, 2.0)

func _panel() -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.02, 0.11, 0.19, 0.72)
	s.border_color = Color(0.47, 0.9, 1.0, 0.35)
	s.set_border_width_all(1)
	s.set_corner_radius_all(8)
	return s

func _shape(pts: PackedVector2Array, col: Color, outline_only: bool) -> void:
	if outline_only:
		pts.append(pts[0])
		draw_polyline(pts, col, 2.0, true)
	else:
		draw_colored_polygon(pts, col)

func _ellipse(c: Vector2, rx: float, ry: float, from_a := 0.0, to_a := TAU, n := 20) -> PackedVector2Array:
	var p := PackedVector2Array()
	for k in n + 1:
		var a := from_a + (to_a - from_a) * k / n
		p.append(c + Vector2(cos(a) * rx, sin(a) * ry))
	return p

func _fish(c: Vector2, col: Color, empty: bool) -> void:
	_shape(_ellipse(c + Vector2(-3, 0), 12, 8), col, empty)
	_shape(PackedVector2Array([c + Vector2(7, 0), c + Vector2(16, -7), c + Vector2(16, 7)]), col, empty)
	if not empty:
		draw_circle(c + Vector2(-9, -2), 2.6, Color.WHITE)
		draw_circle(c + Vector2(-9.5, -2), 1.2, Color.BLACK)

func _leaf(c: Vector2, col: Color, empty: bool) -> void:
	for a in [-0.6, 0.0, 0.6]:
		var pts := PackedVector2Array()
		for k in 13:
			var t := float(k) / 12.0
			var y := -14.0 + t * 26.0
			var x := sin(t * PI) * 6.0
			pts.append(c + Vector2(x, y).rotated(a))
		for k in range(12, -1, -1):
			var t := float(k) / 12.0
			pts.append(c + Vector2(-sin(t * PI) * 6.0, -14.0 + t * 26.0).rotated(a))
		_shape(pts, col, empty)

func _crystal(c: Vector2, col: Color, empty: bool) -> void:
	for o in [Vector2(-7, 4), Vector2(0, 0), Vector2(7, 5)]:
		var h := 15.0 if o.x == 0 else 10.0
		_shape(PackedVector2Array([c + o + Vector2(0, -h), c + o + Vector2(4, -h * 0.4), c + o + Vector2(3, 8), c + o + Vector2(-3, 8), c + o + Vector2(-4, -h * 0.4)]), col, empty)
