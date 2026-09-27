/*
 * Hex Emitters
 *
 * The pattern is a perfectly regular hexagonal lattice drawn on a cylinder and
 * mapped onto the plane with the bipolar conformal map
 *
 *     w = log((z - f1) / (z - f2))
 *
 * where f1 and f2 are the two foci of the bipolar coordinate system. Because
 * the map is conformal it only scales and rotates the lattice locally, so the
 * cells stay regular hexagons (no shear) while shrinking toward the emitters
 * and growing away from them. Around each focus Re(w) behaves like
 * log(distance) and Im(w) like the angle, so every ring of cells is a constant
 * factor larger than the previous one.
 *
 * The foci are chosen so both emitter disks are exactly lines of constant
 * Re(w); the lattice rows are then aligned so the disk cuts every cell of the
 * first ring the same way.
 */

const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);

// key, URL param, label, unit, UI group, limits, default
const PARAMS = [
    { key: 'width',  url: 'w',   label: 'Width',            unit: 'px', group: 'canvas',   min: 100, max: 8000, step: 1,   def: 900,  range: false },
    { key: 'height', url: 'h',   label: 'Height',           unit: 'px', group: 'canvas',   min: 100, max: 8000, step: 1,   def: 1024, range: false },
    { key: 'e1x',    url: 'e1x', label: 'Emitter 1 — X',    unit: '%',  group: 'emitters', min: 0,   max: 100,  step: 0.5, def: 62.5 },
    { key: 'e1y',    url: 'e1y', label: 'Emitter 1 — Y',    unit: '%',  group: 'emitters', min: 0,   max: 100,  step: 0.5, def: 18 },
    { key: 'e2x',    url: 'e2x', label: 'Emitter 2 — X',    unit: '%',  group: 'emitters', min: 0,   max: 100,  step: 0.5, def: 47 },
    { key: 'e2y',    url: 'e2y', label: 'Emitter 2 — Y',    unit: '%',  group: 'emitters', min: 0,   max: 100,  step: 0.5, def: 61.5 },
    { key: 'radius', url: 'r',   label: 'Emitter size',     unit: 'px', group: 'emitters', min: 1,   max: 500,  step: 1,   def: 40 },
    { key: 'growth', url: 'g',   label: 'Growth per ring',  unit: '%',  group: 'pattern',  min: 2,   max: 60,   step: 0.5, def: 20 },
    { key: 'line',   url: 'lw',  label: 'Line width',       unit: 'px', group: 'pattern',  min: 0.5, max: 10,   step: 0.5, def: 2 },
    { key: 'overlay', url: 'od', label: 'Size',            unit: 'px', group: 'disks',    min: 0,   max: 500,  step: 1,   def: 40 },
    { key: 'discBorder', url: 'db', label: 'Draw border',               group: 'disks',    min: 0,   max: 1,    step: 1,   def: 0,    type: 'checkbox' },
    { key: 'colorize', url: 'col', label: 'Colorize',                   group: 'coloring', min: 0,   max: 1,    step: 1,   def: 0,    type: 'checkbox' },
    { key: 'color1', url: 'c1',  label: 'Disc 1 color',                 group: 'coloring', def: '#8ee06a', type: 'color' },
    { key: 'colorMid', url: 'cm', label: 'Mid-point color',             group: 'coloring', def: '#e8542a', type: 'color' },
    { key: 'color2', url: 'c2',  label: 'Disc 2 color',                 group: 'coloring', def: '#6a4fc0', type: 'color' },
    { key: 'dotStart', url: 'dss', label: 'Dot start size', unit: '%',  group: 'coloring', min: 0,   max: 100,  step: 1,   def: 50 },
    { key: 'dotEnd',   url: 'dse', label: 'Dot end size',   unit: '%',  group: 'coloring', min: 0,   max: 100,  step: 1,   def: 50 },
    { key: 'bgOpacity', url: 'bg', label: 'Image opacity',  unit: '%',  group: 'background', min: 0, max: 100, step: 1,   def: 30 },
];

// Background image, scaled to fit the canvas without distortion.
const background = new Image();
background.addEventListener('load', () => scheduleRender());
background.src = 'audi_r8.png';

const config = Object.fromEntries(PARAMS.map(p => [p.key, p.def]));

const canvas = document.getElementById('canvas');
const statsEl = document.getElementById('stats');
const warningEl = document.getElementById('warning');

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// Number of cells around each emitter for a given growth per ring (in %).
// Consecutive rings are exp(h) apart in size, with h = (sqrt(3)/2) * (2π/N).
function cellsPerRing(growthPercent) {
    const h = Math.log(1 + growthPercent / 100);
    return Math.max(6, Math.round((SQRT3 * Math.PI) / h));
}

function buildTiling(p) {
    const c1 = { x: p.width * p.e1x / 100, y: p.height * p.e1y / 100 };
    const c2 = { x: p.width * p.e2x / 100, y: p.height * p.e2y / 100 };
    const dx = c2.x - c1.x, dy = c2.y - c1.y;
    const D = Math.hypot(dx, dy);

    if (D < 2) {
        return { c1, c2, radius: p.radius, segments: [], warning: 'The two emitters are at the same position.' };
    }

    // The disks must not overlap for the bipolar system to exist.
    let radius = p.radius;
    let warning = null;
    if (radius > 0.49 * D) {
        radius = 0.49 * D;
        warning = `The disks would overlap: radius reduced to ${radius.toFixed(1)} px.`;
    }

    // Foci: for two circles of radius R whose centres are D apart, the limit
    // points sit on the centre line at ±sqrt((D/2)² − R²) from the midpoint.
    const ex = dx / D, ey = dy / D;
    const mx = (c1.x + c2.x) / 2, my = (c1.y + c2.y) / 2;
    const c = Math.sqrt(D * D / 4 - radius * radius);
    const f1 = { x: mx - c * ex, y: my - c * ey };
    const f2 = { x: mx + c * ex, y: my + c * ey };

    // Disk 1 is the line Re(w) = -rho0, disk 2 is Re(w) = +rho0.
    const px = c1.x + radius * ex, py = c1.y + radius * ey;
    const rho0 = Math.log(Math.hypot(px - f2.x, py - f2.y) / Math.hypot(px - f1.x, py - f1.y));

    // Lattice spacing: s along Im(w) (must divide 2π), h between rows along Re(w).
    const N = cellsPerRing(p.growth);
    const s = TAU / N;
    const hIdeal = (SQRT3 / 2) * s;

    // Snap the row spacing so each disk passes through the side vertices of
    // the ring of cells touching it (disk at (K + 1/3)·h). This is the only
    // deformation: a uniform radial stretch, usually of a few percent.
    const K = Math.max(0, Math.round(rho0 / hIdeal - 1 / 3));
    const h = rho0 / (K + 1 / 3);

    // Inverse map: u = e^w, z = (f1 − u·f2) / (1 − u)
    function toPlane(wr, wi) {
        const m = Math.exp(wr);
        const ur = m * Math.cos(wi), ui = m * Math.sin(wi);
        const nr = f1.x - (ur * f2.x - ui * f2.y);
        const ni = f1.y - (ur * f2.y + ui * f2.x);
        const dr = 1 - ur, di = -ui;
        const den = dr * dr + di * di;
        return [(nr * dr + ni * di) / den, (ni * dr - nr * di) / den];
    }

    // Hexagon vertices relative to the cell centre, pointy along Re(w).
    // Each cell draws its upper three edges (0-1, 1-2, 2-3); the other three
    // belong to neighbours, so every edge is drawn exactly once.
    const V = [
        [2 * h / 3, 0], [h / 3, s / 2], [-h / 3, s / 2],
        [-2 * h / 3, 0], [-h / 3, -s / 2], [h / 3, -s / 2],
    ];

    // The lattice is drawn unclipped and continues toward the foci, row by
    // row, until the cells' edges become shorter than the line width (beyond
    // that they would merge into a black blob). The innermost rows also draw
    // the edges that would otherwise belong to the omitted row beyond them.
    // The overlay discs, if any, are painted on top.
    const edgeLength = k => {
        const [x1, y1] = toPlane(k * h + h / 3, s / 2);
        const [x2, y2] = toPlane(k * h - h / 3, s / 2);
        return Math.hypot(x2 - x1, y2 - y1);
    };
    const minEdge = Math.max(1, p.line);
    let kMax = K, kMin = -K;
    while (kMax < 200 && edgeLength(kMax + 1) >= minEdge) kMax++;
    while (kMin > -200 && edgeLength(kMin - 1) >= minEdge) kMin--;

    // Cell centres at (k·h, j·s + offset). w = 0 (the point at infinity) is a
    // cell centre, so no mapped edge ever passes through infinity.
    const segments = [];
    const dots = [];
    for (let k = kMin; k <= kMax; k++) {
        const cr = k * h;
        const offset = (k & 1) ? s / 2 : 0;
        const edges = [[0, 1], [1, 2], [2, 3]];
        if (k === kMax) edges.push([5, 0]);
        if (k === kMin) edges.push([3, 4]);
        for (let j = 0; j < N; j++) {
            const ci = j * s + offset;
            const pts = V.map(([vr, vi]) => toPlane(cr + vr, ci + vi));
            for (const [a, b] of edges) segments.push(pts[a], pts[b]);

            // A dot at the cell centre, sized from the cell's inradius
            // (√3/2 × mean centre-to-vertex distance). Its colour position
            // runs from 0 on disk 1 through 0.5 halfway (the rings furthest
            // from both emitters) to 1 on disk 2.
            const [x, y] = toPlane(cr, ci);
            const circum = pts.reduce((sum, [px, py]) => sum + Math.hypot(px - x, py - y), 0) / 6;
            dots.push({ x, y, r: circum * SQRT3 / 2, t: Math.min(1, Math.max(0, (cr + rho0) / (2 * rho0))) });
        }
    }

    return {
        c1, c2, f1, f2, radius, segments, dots, warning,
        stats: {
            cellsPerRing: N,
            rings: K + 1,
            growth: Math.exp(h) - 1,
            stretch: h / hIdeal - 1,
        },
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
    const t = buildTiling(config);
    drawPattern(canvas, t, true);
    renderStats(t);
}

// Draws the pattern onto `target`, optionally with the background image.
function drawPattern(target, t, withBackground) {
    const { width, height, line } = config;
    const ctx = target.getContext('2d');

    target.width = width;
    target.height = height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    if (withBackground) drawBackground(ctx, width, height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = line;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const seg = t.segments;
    for (let i = 0; i < seg.length; i += 2) {
        ctx.moveTo(seg[i][0], seg[i][1]);
        ctx.lineTo(seg[i + 1][0], seg[i + 1][1]);
    }
    ctx.stroke();

    for (const d of visibleDots(t)) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fillStyle = d.color;
        ctx.fill();
    }

    // Overlay discs: plain white (no outline), sized independently of the
    // emitters and aligned with the rings of cells, painted on top.
    const discs = overlayDiscs(t, config.overlay);
    discs.forEach((d, i) => {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fillStyle = discColor(i);
        ctx.fill();
        if (config.discBorder) ctx.stroke();
    });
}

// Dots scaled by the dot size, coloured along the gradient, and limited to
// those that are visible (on the canvas and at least a fraction of a pixel).
// The size, relative to the cell, goes from the start size at the emitter
// disks (small cells) to the end size halfway between them (large cells).
function visibleDots(t) {
    const { width, height, dotStart, dotEnd } = config;
    if (!config.colorize || (dotStart <= 0 && dotEnd <= 0)) return [];
    const out = [];
    for (const d of t.dots) {
        const nearEmitter = Math.abs(d.t - 0.5) * 2;
        const r = d.r * (dotEnd + (dotStart - dotEnd) * nearEmitter) / 100;
        if (r < 0.3 || d.x < -r || d.y < -r || d.x > width + r || d.y > height + r) continue;
        out.push({ x: d.x, y: d.y, r, color: gradientColor(d.t) });
    }
    return out;
}

// Overlay disc i is plain white unless coloring is enabled.
function discColor(i) {
    return config.colorize ? [config.color1, config.color2][i] : '#ffffff';
}

// Colour at position t ∈ [0, 1]: disc 1 colour → mid-point colour → disc 2
// colour, interpolated linearly in RGB.
function gradientColor(t) {
    const [a, b, u] = t < 0.5
        ? [config.color1, config.colorMid, t * 2]
        : [config.colorMid, config.color2, t * 2 - 1];
    const ca = parseInt(a.slice(1), 16), cb = parseInt(b.slice(1), 16);
    let hex = '#';
    for (const shift of [16, 8, 0]) {
        const va = (ca >> shift) & 255, vb = (cb >> shift) & 255;
        hex += Math.round(va + (vb - va) * u).toString(16).padStart(2, '0');
    }
    return hex;
}

// The rings of cells around an emitter are circles of the bipolar system
// (Apollonius circles |z − f1| / |z − f2| = k), which are not concentric:
// their centres drift toward the focus as they shrink. To line up with the
// hexagons, each overlay disc is the ring of the requested radius r rather
// than a circle around the emitter centre. For r = emitter size it is
// centred exactly on the emitter.
//
// For foci 2c apart, that circle has radius 2ck / (1 − k²), so
// k = (√(c² + r²) − c) / r, and its centre is (f1 − k²·f2) / (1 − k²).
function overlayDiscs(t, r) {
    if (r <= 0 || !t.f1) return [];
    const c = Math.hypot(t.f2.x - t.f1.x, t.f2.y - t.f1.y) / 2;
    const k = (Math.sqrt(c * c + r * r) - c) / r;
    const k2 = k * k;
    return [[t.f1, t.f2], [t.f2, t.f1]].map(([a, b]) => ({
        x: (a.x - k2 * b.x) / (1 - k2),
        y: (a.y - k2 * b.y) / (1 - k2),
        r,
    }));
}

function drawBackground(ctx, width, height) {
    if (!background.complete || !background.naturalWidth || config.bgOpacity <= 0) return;
    const scale = Math.min(width / background.naturalWidth, height / background.naturalHeight);
    const w = background.naturalWidth * scale;
    const h = background.naturalHeight * scale;
    ctx.save();
    ctx.globalAlpha = config.bgOpacity / 100;
    ctx.drawImage(background, (width - w) / 2, (height - h) / 2, w, h);
    ctx.restore();
}

function renderStats(t) {
    warningEl.hidden = !t.warning;
    warningEl.textContent = t.warning || '';

    if (!t.stats) {
        statsEl.innerHTML = '';
        return;
    }
    const rows = [
        ['Cells per ring', t.stats.cellsPerRing],
        ['Actual growth per ring', `${(t.stats.growth * 100).toFixed(1)} %`],
        ['Rings between the disks', 2 * t.stats.rings],
        ['Radial stretch', `${t.stats.stretch >= 0 ? '+' : ''}${(t.stats.stretch * 100).toFixed(1)} %`],
    ];
    statsEl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

let frameRequested = false;
function scheduleRender() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
        frameRequested = false;
        render();
    });
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function clamp(p, v) {
    return Math.min(p.max, Math.max(p.min, v));
}

function buildControls() {
    for (const p of PARAMS) {
        const field = document.createElement('div');

        if (p.type === 'color') {
            field.className = 'field color';
            field.innerHTML = `<label><input type="color" id="color-${p.key}"> ${p.label}</label>`;
            document.querySelector(`[data-group="${p.group}"]`).appendChild(field);
            const picker = field.querySelector('input');
            picker.value = config[p.key];
            picker.addEventListener('input', () => {
                config[p.key] = picker.value;
                updateUrl();
                scheduleRender();
            });
            continue;
        }

        // Booleans are stored as 1 / 0 so the URL and clamping code apply.
        if (p.type === 'checkbox') {
            field.className = 'field checkbox';
            field.innerHTML = `<label><input type="checkbox" id="check-${p.key}"> ${p.label}</label>`;
            document.querySelector(`[data-group="${p.group}"]`).appendChild(field);
            const box = field.querySelector('input');
            box.checked = !!config[p.key];
            box.addEventListener('change', () => {
                config[p.key] = box.checked ? 1 : 0;
                updateUrl();
                scheduleRender();
            });
            continue;
        }

        field.className = 'field' + (p.range === false ? ' no-range' : '');
        field.innerHTML = `
            <label for="num-${p.key}">${p.label} <span class="unit">(${p.unit})</span></label>
            <div class="controls">
                ${p.range === false ? '' : `<input type="range" id="range-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}">`}
                <input type="number" id="num-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}">
            </div>`;
        document.querySelector(`[data-group="${p.group}"]`).appendChild(field);

        const range = field.querySelector('input[type=range]');
        const num = field.querySelector('input[type=number]');
        const inputs = [range, num].filter(Boolean);

        const sync = () => inputs.forEach(el => { el.value = config[p.key]; });
        sync();

        for (const el of inputs) {
            el.addEventListener('input', () => {
                const v = parseFloat(el.value);
                if (isNaN(v)) return;
                config[p.key] = clamp(p, v);
                if (el === num && range) range.value = config[p.key];
                if (el === range) num.value = config[p.key];
                updateUrl();
                scheduleRender();
            });
        }
        // Show the clamped value once the user leaves the number box.
        num.addEventListener('change', sync);
    }
}

function readUrl() {
    const params = new URLSearchParams(window.location.search);
    for (const p of PARAMS) {
        const raw = params.get(p.url);
        if (p.type === 'color') {
            // Colours are stored without the '#', e.g. c1=8ee06a.
            if (/^[0-9a-f]{6}$/i.test(raw || '')) config[p.key] = '#' + raw.toLowerCase();
            continue;
        }
        const v = parseFloat(raw);
        if (!isNaN(v)) config[p.key] = clamp(p, v);
    }
}

function paramString() {
    return new URLSearchParams(PARAMS.map(p =>
        [p.url, p.type === 'color' ? config[p.key].slice(1) : config[p.key]])).toString();
}

function updateUrl() {
    try {
        history.replaceState(null, '', `${location.pathname}?${paramString()}`);
    } catch {
        // Sandboxed or file:// contexts may refuse; the page still works.
    }
}

function saveBlob(blob, ext) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hexagons-${config.width}x${config.height}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Vector version of drawPattern (without the background image).
function buildSvg(t) {
    const { width, height, line } = config;
    const f = v => +v.toFixed(2);
    const dots = visibleDots(t).map(d =>
        `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(d.r)}" fill="${d.color}"/>\n`).join('');
    const border = config.discBorder ? ` stroke="#000000" stroke-width="${line}"` : '';
    const disks = overlayDiscs(t, config.overlay).map((d, i) =>
        `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${d.r}" fill="${discColor(i)}"${border}/>\n`).join('');

    // Skip segments that lie entirely on one side outside the canvas.
    const parts = [];
    const seg = t.segments;
    for (let i = 0; i < seg.length; i += 2) {
        const [x1, y1] = seg[i], [x2, y2] = seg[i + 1];
        if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) ||
            (x1 > width && x2 > width) || (y1 > height && y2 > height)) continue;
        parts.push(`M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#ffffff"/>
<g fill="none" stroke="#000000" stroke-width="${line}" stroke-linecap="round" stroke-linejoin="round">
<path d="${parts.join('')}"/>
</g>
${dots}${disks}
</svg>
`;
}

// Exports never include the background image. The PNG is drawn on an
// offscreen canvas, which also avoids canvas tainting under file://.
document.getElementById('downloadBtn').addEventListener('click', () => {
    const out = document.createElement('canvas');
    drawPattern(out, buildTiling(config), false);
    out.toBlob(blob => saveBlob(blob, 'png'), 'image/png');
});

document.getElementById('svgBtn').addEventListener('click', () => {
    const svg = buildSvg(buildTiling(config));
    saveBlob(new Blob([svg], { type: 'image/svg+xml' }), 'svg');
});

document.getElementById('shareBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const url = `${location.origin}${location.pathname}?${paramString()}`;
    try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Copied!';
    } catch {
        btn.textContent = 'Copy failed';
    }
    setTimeout(() => { btn.textContent = 'Copy shareable link'; }, 1500);
});

readUrl();
buildControls();
render();
