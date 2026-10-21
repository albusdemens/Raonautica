// The sea surface seen from below: bright Snell's window overhead, total internal reflection beyond.
shader_type spatial;
render_mode unshaded, cull_disabled, blend_mix, depth_draw_never, fog_disabled;

varying vec3 wpos;

float caustic(vec2 p, float t) {
	vec2 i = p; float c = 1.0; float inten = 0.005;
	for (int n = 0; n < 3; n++) {
		float tt = t * (1.0 - (3.5 / float(n + 1)));
		i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
		c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
	}
	c /= 3.0; c = 1.17 - pow(c, 1.4);
	return clamp(pow(abs(c), 8.0), 0.0, 1.5);
}

void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }

void fragment() {
	vec3 cam = (INV_VIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	vec3 V = normalize(wpos - cam);
	vec2 p = wpos.xz * 0.35;
	vec2 n = vec2(sin(p.x * 1.3 + TIME * 1.1) + sin(p.y * 1.7 - TIME * 0.9), cos(p.y * 1.1 + TIME) + sin(p.x * 0.9 + p.y * 0.7 + TIME * 1.3)) * 0.06;
	float cosT = abs(V.y) + n.x * 0.5;
	float win = smoothstep(0.62, 0.70, cosT);
	float c = caustic(wpos.xz * 0.12 + n * 6.0 - 250.0, TIME * 0.4);
	vec3 sky = vec3(1.4, 2.2, 2.3) + c * 1.2;
	vec3 tir = vec3(0.02, 0.20, 0.27) * (0.8 + c * 0.6);
	float dist = length(wpos - cam);
	float fade = exp(-dist * 0.012);
	ALBEDO = mix(tir, sky, win) * fade;
	ALPHA = mix(0.0, 0.95, fade);
}
