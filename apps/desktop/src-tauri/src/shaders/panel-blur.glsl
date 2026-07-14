// Rillio - real frosted glass behind the player's panels.
//
// WHY THIS EXISTS: mpv renders into a NATIVE child window BEHIND the transparent
// WebView, so a panel's CSS `backdrop-filter` samples only web content and blurs
// nothing at all. The only way to blur the actual video is to do it on the GPU,
// inside mpv's own render pipeline, which is this file.
//
// HDR SAFETY (read before touching anything): this app's headline feature is
// native HDR/Dolby-Vision passthrough (shell.rs: vo=gpu-next, target-colorspace-
// hint=auto + -mode=source, icc-profile-auto=no, hdr-compute-peak, tone-mapping=
// bt.2446a). This shader hooks OUTPUT, which libplacebo defines as "after alpha
// blending, before dithering and final output pass" - i.e. AFTER the colour
// conversion to the target colorspace has already happened. Tone-mapping (or its
// bypass, under passthrough) and the DV RPU are applied strictly upstream of this
// point, and --target-colorspace-hint only drives swapchain format negotiation,
// which no hook can reach. Blurring here therefore cannot change what colour
// space is presented; it only smears pixels that were already final.
//
// A consequence worth knowing: under passthrough the blur runs on PQ-encoded
// values, not linear light. A linear-light blur would bloom specular highlights
// into a glare bigger than the panel; PQ-space is both cheaper and calmer, which
// is what a UI material wants.
//
// GEOMETRY: at OUTPUT the texture is the VIDEO RECTANGLE, not the window - black
// letterbox/pillarbox bars are not part of it (libplacebo: target_size is "the
// nominal size of the output rectangle"). The rect params below are therefore in
// OUTPUT-normalized coords, and the shell converts window coords into them via
// mpv's `osd-dimensions` (see shell.rs blur_shader_opts). Rects may legitimately
// fall partly outside [0,1] when a panel overhangs into the bars; the SDF below
// handles that on its own, so nothing is clamped.
//
// The two passes are a standard separable gaussian. Both early-out to the
// untouched pixel outside the panels, so cost scales with the panel area, not the
// frame. Both carry `//!WHEN enabled 0 >`: with the panels closed the stages are
// SKIPPED ENTIRELY rather than running a passthrough copy, which is what lets the
// shell keep the shader loaded across a whole session instead of paying a
// pipeline rebuild on every menu open.

//!PARAM enabled
//!DESC 1 while a player panel is open; 0 skips both passes entirely
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 1
0

//!PARAM count
//!DESC How many of the four rects below are live
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 4
0

//!PARAM radius
//!DESC Gaussian blur radius, in OUTPUT pixels
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 512
32

//!PARAM corner
//!DESC Panel corner radius, in OUTPUT pixels
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 512
0

// The four panel rects, in OUTPUT-normalized coords: (x, y) is the top-left
// corner, (w, h) the size. Bounds are deliberately far wider than [0,1]: a panel
// over a heavily letterboxed video maps to large normalized values, and mpv
// rejects the whole option string if any value falls outside its declared range.

//!PARAM r0x
//!TYPE DYNAMIC float
//!MINIMUM -32
//!MAXIMUM 32
0

//!PARAM r0y
//!TYPE DYNAMIC float
//!MINIMUM -32
//!MAXIMUM 32
0

//!PARAM r0w
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 64
0

//!PARAM r0h
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 64
0

//!PARAM r1x
//!TYPE DYNAMIC float
//!MINIMUM -32
//!MAXIMUM 32
0

//!PARAM r1y
//!TYPE DYNAMIC float
//!MINIMUM -32
//!MAXIMUM 32
0

//!PARAM r1w
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 64
0

//!PARAM r1h
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 64
0

//!PARAM r2x
//!TYPE DYNAMIC float
//!MINIMUM -32
//!MAXIMUM 32
0

//!PARAM r2y
//!TYPE DYNAMIC float
//!MINIMUM -32
//!MAXIMUM 32
0

//!PARAM r2w
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 64
0

//!PARAM r2h
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 64
0

//!PARAM r3x
//!TYPE DYNAMIC float
//!MINIMUM -32
//!MAXIMUM 32
0

//!PARAM r3y
//!TYPE DYNAMIC float
//!MINIMUM -32
//!MAXIMUM 32
0

//!PARAM r3w
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 64
0

//!PARAM r3h
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 64
0

//!HOOK OUTPUT
//!BIND HOOKED
//!SAVE RILLIO_PANEL_BLUR_H
//!WHEN enabled 0 >
//!DESC Rillio panel blur (horizontal pass)

// Taps per side, so 2*TAPS+1 fetches per pass. Fixed, so the cost does not grow
// with `radius`: the tap SPACING scales instead (step = radius / TAPS). At the
// radii a UI backdrop uses this stays well inside the gaussian's smooth region,
// and the sampler's bilinear filtering covers the gaps between taps.
#define TAPS 10
#define MAX_RECTS 4

vec4 rillio_rect(int i) {
    if (i == 0) return vec4(r0x, r0y, r0w, r0h);
    if (i == 1) return vec4(r1x, r1y, r1w, r1h);
    if (i == 2) return vec4(r2x, r2y, r2w, r2h);
    return vec4(r3x, r3y, r3w, r3h);
}

// Signed distance to a rounded rect (negative inside). `p`, `center`, `half_size`
// and `rad` are all in OUTPUT pixels, so the corners stay circular no matter how
// non-square the output rectangle is.
float rillio_sd_rrect(vec2 p, vec2 center, vec2 half_size, float rad) {
    rad = min(rad, min(half_size.x, half_size.y));
    vec2 q = abs(p - center) - (half_size - rad);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}

// Signed distance to the nearest open panel, in OUTPUT pixels.
float rillio_sd_panels(vec2 p) {
    float d = 1e9;
    for (int i = 0; i < MAX_RECTS; i++) {
        if (float(i) >= count) break;
        vec4 r = rillio_rect(i);
        vec2 half_size = r.zw * 0.5 * HOOKED_size;
        vec2 center = (r.xy + r.zw * 0.5) * HOOKED_size;
        d = min(d, rillio_sd_rrect(p, center, half_size, corner));
    }
    return d;
}

vec4 hook()
{
    vec2 p = HOOKED_pos * HOOKED_size;
    // Work a `radius`-wide margin AROUND each panel, not just inside it: the
    // vertical pass reads up to `radius` away, so without this dilation the
    // pixels along a panel's top/bottom edge would end up only horizontally
    // blurred - the classic separable-blur-with-an-early-out seam.
    if (rillio_sd_panels(p) > radius) {
        return HOOKED_texOff(vec2(0.0));
    }

    float r = max(radius, 1.0);
    float sigma = r * 0.5;
    float step = r / float(TAPS);

    vec4 sum = vec4(0.0);
    float weight_sum = 0.0;
    for (int i = -TAPS; i <= TAPS; i++) {
        float o = float(i) * step;
        float w = exp(-0.5 * (o * o) / (sigma * sigma));
        sum += w * HOOKED_texOff(vec2(o, 0.0));
        weight_sum += w;
    }
    return sum / weight_sum;
}

//!HOOK OUTPUT
//!BIND HOOKED
//!BIND RILLIO_PANEL_BLUR_H
//!WHEN enabled 0 >
//!DESC Rillio panel blur (vertical pass)

#define TAPS 10
#define MAX_RECTS 4

vec4 rillio_rect(int i) {
    if (i == 0) return vec4(r0x, r0y, r0w, r0h);
    if (i == 1) return vec4(r1x, r1y, r1w, r1h);
    if (i == 2) return vec4(r2x, r2y, r2w, r2h);
    return vec4(r3x, r3y, r3w, r3h);
}

float rillio_sd_rrect(vec2 p, vec2 center, vec2 half_size, float rad) {
    rad = min(rad, min(half_size.x, half_size.y));
    vec2 q = abs(p - center) - (half_size - rad);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}

float rillio_sd_panels(vec2 p) {
    float d = 1e9;
    for (int i = 0; i < MAX_RECTS; i++) {
        if (float(i) >= count) break;
        vec4 r = rillio_rect(i);
        vec2 half_size = r.zw * 0.5 * HOOKED_size;
        vec2 center = (r.xy + r.zw * 0.5) * HOOKED_size;
        d = min(d, rillio_sd_rrect(p, center, half_size, corner));
    }
    return d;
}

vec4 hook()
{
    vec2 p = HOOKED_pos * HOOKED_size;
    float d = rillio_sd_panels(p);
    // HOOKED is the ORIGINAL, untouched OUTPUT (the horizontal pass wrote to
    // RILLIO_PANEL_BLUR_H via //!SAVE, so it never overwrote this one).
    if (d > 0.5) {
        return HOOKED_texOff(vec2(0.0));
    }

    float r = max(radius, 1.0);
    float sigma = r * 0.5;
    float step = r / float(TAPS);

    vec4 sum = vec4(0.0);
    float weight_sum = 0.0;
    for (int i = -TAPS; i <= TAPS; i++) {
        float o = float(i) * step;
        float w = exp(-0.5 * (o * o) / (sigma * sigma));
        sum += w * RILLIO_PANEL_BLUR_H_texOff(vec2(0.0, o));
        weight_sum += w;
    }
    vec4 blurred = sum / weight_sum;

    // A 1px feather across the panel's own edge. The web panel is drawn over this
    // boundary with the same rounded rect, and any subpixel disagreement between
    // the two would otherwise read as a hard sharp/blurred seam.
    return mix(blurred, HOOKED_texOff(vec2(0.0)), smoothstep(-0.5, 0.5, d));
}
