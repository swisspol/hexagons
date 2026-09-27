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
    { key: 'radius', url: 'r',   label: 'Disk radius',      unit: 'px', group: 'emitters', min: 1,   max: 500,  step: 1,   def: 40 },
    { key: 'growth', url: 'g',   label: 'Growth per ring',  unit: '%',  group: 'pattern',  min: 2,   max: 60,   step: 0.5, def: 20 },
    { key: 'line',   url: 'lw',  label: 'Line width',       unit: 'px', group: 'pattern',  min: 0.5, max: 10,   step: 0.5, def: 2 },
];

const config = Object.fromEntries(PARAMS.map(p => [p.key, p.def]));

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
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
    const V = [[2 * h / 3, 0], [h / 3, s / 2], [-h / 3, s / 2], [-2 * h / 3, 0]];

    // Cell centres at (k·h, j·s + offset). w = 0 (the point at infinity) is a
    // cell centre, so no mapped edge ever passes through infinity.
    const segments = [];
    const rows = K + 2;
    for (let k = -rows; k <= rows; k++) {
        const cr = k * h;
        const offset = (k & 1) ? s / 2 : 0;
        for (let j = 0; j < N; j++) {
            const ci = j * s + offset;
            const pts = V.map(([vr, vi]) => toPlane(cr + vr, ci + vi));
            for (let e = 0; e < 3; e++) segments.push(pts[e], pts[e + 1]);
        }
    }

    return {
        c1, c2, radius, segments, warning,
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
    const { width, height, line } = config;

    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = line;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Clip the lattice to the canvas minus both disks.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    for (const c of [t.c1, t.c2]) {
        ctx.moveTo(c.x + t.radius, c.y);
        ctx.arc(c.x, c.y, t.radius, 0, TAU);
    }
    ctx.clip('evenodd');

    ctx.beginPath();
    const seg = t.segments;
    for (let i = 0; i < seg.length; i += 2) {
        ctx.moveTo(seg[i][0], seg[i][1]);
        ctx.lineTo(seg[i + 1][0], seg[i + 1][1]);
    }
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    for (const c of [t.c1, t.c2]) {
        ctx.moveTo(c.x + t.radius, c.y);
        ctx.arc(c.x, c.y, t.radius, 0, TAU);
    }
    ctx.stroke();

    renderStats(t);
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
        const v = parseFloat(params.get(p.url));
        if (!isNaN(v)) config[p.key] = clamp(p, v);
    }
}

function paramString() {
    return new URLSearchParams(PARAMS.map(p => [p.url, config[p.key]])).toString();
}

function updateUrl() {
    try {
        history.replaceState(null, '', `${location.pathname}?${paramString()}`);
    } catch {
        // Sandboxed or file:// contexts may refuse; the page still works.
    }
}

document.getElementById('downloadBtn').addEventListener('click', () => {
    canvas.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `hexagons-${config.width}x${config.height}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
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
