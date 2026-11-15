'use strict';

// Text and HTML piano-roll views of an event list.

const GLYPHS = [
  [45, '.'],
  [80, 'o'],
  [105, 'O'],
  [128, '#'],
];
const BLOCKS = ' ▁▂▃▄▅▆▇█';

function glyph(v) {
  for (const [max, g] of GLYPHS) if (v < max) return g;
  return '#';
}

// One block of rows per `barsPerLine` bars; `cols` characters per beat.
function textRoll(events, opts) {
  const lanes = opts.lanes;
  const barLen = opts.barLen || 4;
  const bars = opts.bars;
  const cols = opts.cols || 6;
  const barsPerLine = opts.barsPerLine || 2;
  const nameW = Math.max(6, ...lanes.map((l) => l.name.length)) + 1;
  const lines = [];
  const perBar = Math.round(barLen * cols);
  for (let b0 = 0; b0 < bars; b0 += barsPerLine) {
    const nb = Math.min(barsPerLine, bars - b0);
    const width = nb * perBar;
    let ruler = '';
    for (let c = 0; c < width; c++) {
      if (c % perBar === 0) ruler += String(b0 + c / perBar + 1).slice(-1);
      else ruler += c % cols === 0 ? ':' : ' ';
    }
    lines.push(' '.repeat(nameW) + ruler);
    lanes.forEach((lane, li) => {
      const row = [];
      for (let c = 0; c < width; c++) row.push(c % perBar === 0 ? '|' : c % cols === 0 ? '·' : ' ');
      const best = new Array(width).fill(0);
      for (const e of events) {
        if (e.lane !== li) continue;
        const c = Math.round((e.beat - b0 * barLen) * cols);
        if (c < 0 || c >= width || e.velocity <= best[c]) continue;
        best[c] = e.velocity;
        row[c] = glyph(e.velocity);
      }
      lines.push((lane.name + ' '.repeat(nameW)).slice(0, nameW) + row.join(''));
    });
    if (opts.curve) {
      let row = '';
      for (let c = 0; c < width; c++) {
        const v = Math.max(0, Math.min(1, opts.curve(b0 * barLen + c / cols)));
        row += BLOCKS[Math.round(v * (BLOCKS.length - 1))];
      }
      lines.push(('density' + ' '.repeat(nameW)).slice(0, nameW) + row);
    }
    lines.push('');
  }
  lines.push('velocity: . <45  o <80  O <105  # loud     columns: 1/' + cols + ' beat');
  return lines.join('\n');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const LANE_COLORS = ['#c2410c', '#1d4ed8', '#047857', '#7c3aed', '#b45309', '#be185d', '#0e7490', '#4d7c0f'];

// Self-contained HTML: SVG lanes on a beat grid (16th lines are reference
// only, the notes sit wherever they were played), plus modulator curves.
function htmlRoll(events, opts) {
  const lanes = opts.lanes;
  const barLen = opts.barLen || 4;
  const bars = opts.bars;
  const pxPerBeat = opts.pxPerBeat || 90;
  const laneH = 34;
  const curveH = 60;
  const curves = opts.curves || [];
  const left = 70;
  const totalBeats = bars * barLen;
  const W = left + totalBeats * pxPerBeat + 20;
  const lanesH = lanes.length * laneH;
  const H = 24 + lanesH + curves.length * (curveH + 16) + 20;
  const x = (beat) => left + beat * pxPerBeat;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  const top = 24;
  for (let s = 0; s <= totalBeats * 4; s++) {
    const beat = s / 4;
    const isBar = Math.abs(beat / barLen - Math.round(beat / barLen)) < 1e-9;
    const isBeat = s % 4 === 0;
    const cls = isBar ? 'bar' : isBeat ? 'beat' : 'sub';
    parts.push(`<line class="${cls}" x1="${x(beat)}" y1="${top}" x2="${x(beat)}" y2="${top + lanesH}"/>`);
    if (isBar && beat < totalBeats) parts.push(`<text class="num" x="${x(beat) + 3}" y="${top - 8}">${Math.round(beat / barLen) + 1}</text>`);
  }
  lanes.forEach((lane, li) => {
    const y = top + li * laneH;
    parts.push(`<line class="lane" x1="${left}" y1="${y + laneH}" x2="${W - 20}" y2="${y + laneH}"/>`);
    parts.push(`<text class="name" x="8" y="${y + laneH / 2 + 4}">${esc(lane.name)}</text>`);
  });
  for (const e of events) {
    const y = top + e.lane * laneH;
    const h = 6 + (laneH - 10) * (e.velocity / 127);
    const w = Math.max(2, e.duration * pxPerBeat);
    const color = LANE_COLORS[e.lane % LANE_COLORS.length];
    parts.push(
      `<rect x="${x(e.beat).toFixed(2)}" y="${(y + laneH - 2 - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${color}" fill-opacity="${(0.25 + 0.75 * (e.velocity / 127)).toFixed(2)}"><title>${esc(lanes[e.lane].name)} beat ${e.beat.toFixed(4)} vel ${e.velocity}</title></rect>`
    );
  }
  curves.forEach((cv, i) => {
    const y0 = top + lanesH + 16 + i * (curveH + 16);
    parts.push(`<text class="name" x="8" y="${y0 + curveH / 2 + 4}">${esc(cv.name)}</text>`);
    parts.push(`<rect class="curvebg" x="${left}" y="${y0}" width="${totalBeats * pxPerBeat}" height="${curveH}"/>`);
    const lo = cv.min !== undefined ? cv.min : 0;
    const hi = cv.max !== undefined ? cv.max : 1;
    const pts = cv.points
      .map(([b, v]) => `${x(b).toFixed(1)},${(y0 + curveH - ((v - lo) / (hi - lo)) * curveH).toFixed(1)}`)
      .join(' ');
    parts.push(`<polyline class="curve" points="${pts}"/>`);
  });
  parts.push('</svg>');

  const counts = lanes.map((l, li) => `${esc(l.name)} ${events.filter((e) => e.lane === li).length}`).join(' · ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title || 'Organic piano roll')}</title>
<style>
:root { --bg:#fbfaf7; --fg:#1c1b19; --muted:#6b675f; --grid:#d9d5cc; --bar:#8c877c; --panel:#f1eee7; }
@media (prefers-color-scheme: dark) { :root { --bg:#161513; --fg:#ece9e2; --muted:#9a958a; --grid:#34312c; --bar:#7a756b; --panel:#201e1b; } }
body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:14px/1.4 ui-sans-serif, system-ui, sans-serif; }
h1 { font-size:18px; margin:0 0 4px; } p { margin:0 0 12px; color:var(--muted); }
.wrap { overflow-x:auto; border:1px solid var(--grid); border-radius:8px; background:var(--bg); }
line.sub { stroke:var(--grid); stroke-width:0.5; } line.beat { stroke:var(--grid); stroke-width:1.2; }
line.bar { stroke:var(--bar); stroke-width:1.5; } line.lane { stroke:var(--grid); stroke-width:0.5; }
text.name { fill:var(--fg); font-size:12px; } text.num { fill:var(--muted); font-size:11px; }
rect.curvebg { fill:var(--panel); } polyline.curve { fill:none; stroke:var(--fg); stroke-width:1.5; }
</style></head><body>
<h1>${esc(opts.title || 'Organic piano roll')}</h1>
<p>${esc(opts.subtitle || '')}</p>
<p>${events.length} events · ${counts}. Grid lines are 16ths for reference only.</p>
<div class="wrap">${parts.join('\n')}</div>
</body></html>
`;
}

module.exports = { textRoll, htmlRoll };
