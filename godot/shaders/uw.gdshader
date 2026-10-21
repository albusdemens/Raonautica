// Shared underwater material: vertex/instance colour, caustics on up-facing surfaces near the surface,
// depth light absorption, and optional animation (0 none, 1 sway by height, 2 kelp, 3 fish tail).
shader_type spatial;
render_mode cull_disabled;

uniform vec4 albedo : source_color = vec4(1.0);
uniform int anim = 0;
uniform float amt = 0.15;
uniform vec4 emission_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float emission_strength = 0.0;
uniform float roughness_v = 0.8;
uniform float metallic_v = 0.0;
uniform float caustic_strength = 1.0;
uniform float clearcoat_v = 0.0;
uniform float desat = 0.0;            // mute decoration so targets stand out
uniform vec4 rim_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float rim_strength = 0.0;     // glowing outline for mission targets

varying vec3 wpos;
varying vec3 wnorm;

// vertex/instance colours arrive as raw sRGB; light them in linear space
vec3 srgb_to_linear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }

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
	vec3 o = MODEL_MATRIX[3].xyz;
	float ph = o.x * 0.37 + o.z * 0.23;
	if (anim == 1) {
		float k = max(VERTEX.y, 0.0);
		VERTEX.x += sin(TIME * 1.4 + ph) * amt * k * k;
		VERTEX.z += cos(TIME * 1.1 + ph) * amt * 0.6 * k * k;
	} else if (anim == 2) {
		float s = pow(max(VERTEX.y, 0.0) / 30.0, 1.5) * 1.8;
		VERTEX.x += sin(TIME * 0.9 + ph + VERTEX.y * 0.15) * s;
		VERTEX.z += cos(TIME * 0.7 + ph + VERTEX.y * 0.11) * s * 0.6;
	} else if (anim == 3) {
		VERTEX.x += sin(TIME * 9.0 + VERTEX.z * 5.0 + ph) * amt * smoothstep(-0.3, 0.9, VERTEX.z);
	}
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnorm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 base = albedo.rgb * srgb_to_linear(COLOR.rgb);
	base = mix(base, vec3(dot(base, vec3(0.3, 0.59, 0.11))), desat);
	float depthF = smoothstep(-8.0, -170.0, wpos.y);
	vec3 absorb = mix(vec3(1.0), vec3(0.10, 0.19, 0.34), depthF);
	float cs = caustic(wpos.xz * 0.22 - 250.0, TIME * 0.55) * (1.0 - smoothstep(-6.0, -60.0, wpos.y)) * smoothstep(-0.2, 0.6, wnorm.y);
	ALBEDO = base * absorb;
	ROUGHNESS = roughness_v;
	METALLIC = metallic_v;
	CLEARCOAT = clearcoat_v;
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.5);
	EMISSION = base * cs * caustic_strength * 0.3 * absorb + emission_color.rgb * emission_strength + rim_color.rgb * rim * rim_strength;
}
