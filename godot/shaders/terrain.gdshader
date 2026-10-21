// Seabed: biome vertex colours + procedural sand ripples (bump) + grain + caustics + depth absorption.
shader_type spatial;

varying vec3 wpos;
varying vec3 wnorm;

// vertex colours arrive as raw sRGB; light them in linear space
vec3 srgb_to_linear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float ripples(vec2 p) {
	float warp = vnoise(p * 0.15) * 3.0;
	return pow(0.5 + 0.5 * sin(p.x * 1.6 + p.y * 0.35 + warp * 2.0), 1.6) * 0.7 + vnoise(p * 6.0) * 0.3;
}
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

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnorm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 p = wpos.xz;
	float flat_ = smoothstep(0.55, 0.9, wnorm.y);
	// bump: perturb the view-space normal with the ripple gradient on flat sand
	float e = 0.08;
	float h0 = ripples(p), hx = ripples(p + vec2(e, 0.0)), hz = ripples(p + vec2(0.0, e));
	vec3 bumpW = normalize(wnorm + vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.12 * flat_);
	NORMAL = normalize((VIEW_MATRIX * vec4(bumpW, 0.0)).xyz);
	float grain = 0.88 + 0.12 * vnoise(p * 9.0) + (hash(floor(p * 14.0)) > 0.97 ? 0.1 : 0.0);
	vec3 base = srgb_to_linear(COLOR.rgb) * grain * (0.92 + 0.08 * h0);
	float depthF = smoothstep(-8.0, -170.0, wpos.y);
	vec3 absorb = mix(vec3(1.0), vec3(0.10, 0.19, 0.34), depthF);
	float cs = caustic(p * 0.22 - 250.0, TIME * 0.55) * (1.0 - smoothstep(-6.0, -60.0, wpos.y)) * smoothstep(0.2, 0.8, wnorm.y);
	ALBEDO = base * absorb;
	ROUGHNESS = 0.95;
	EMISSION = base * cs * 0.35 * absorb;
}
