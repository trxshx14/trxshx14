// .github/scripts/profile-art.mjs
// Generates two self-hosted SVGs for the profile README from real
// GitHub contribution data (no third-party image services):
//
//   assets/contribution-bloom.svg (+ -dark)  — a glowing orb travels the
//       contribution grid; every day with contributions blooms as it passes
//   assets/activity-graph.svg (+ -dark)      — contributions over the last 31 days
//
// Runs in GitHub Actions (see .github/workflows/profile-art.yml).
// Local preview with fake data:  node .github/scripts/profile-art.mjs --demo

import { mkdir, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER || "trxshx14";
const TOKEN = process.env.GITHUB_TOKEN;
const DEMO = process.argv.includes("--demo");
const OUT = "assets";

/* ---------------- theme ---------------- */

const THEMES = {
  light: {
    empty: "#F6E9EF",
    levels: ["#F6E9EF", "#F3C6DA", "#EDA6C8", "#E991B8", "#C86E98"],
    text: "#555555",
    muted: "#8A7A84",
    grid: "#EFE2E8",
    line: "#E991B8",
    orbCore: "#FFFFFF",
    orbGlow: "#E991B8",
  },
  dark: {
    empty: "#2A2230",
    levels: ["#2A2230", "#5A3A52", "#8A5A7C", "#C485AB", "#E991B8"],
    text: "#EFE7EE",
    muted: "#A99DAE",
    grid: "#2E2634",
    line: "#E991B8",
    orbCore: "#FFF4FA",
    orbGlow: "#E991B8",
  },
};

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/* ---------------- data ---------------- */

async function fetchCalendar() {
  if (DEMO) return demoCalendar();
  if (!TOKEN) throw new Error("GITHUB_TOKEN is missing (run inside GitHub Actions or use --demo)");

  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date weekday contributionCount contributionLevel } }
        }
      }
    }
  }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data.user.contributionsCollection.contributionCalendar;
}

function demoCalendar() {
  const weeks = [];
  const start = new Date();
  start.setDate(start.getDate() - 52 * 7 - start.getDay());
  let total = 0;
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      if (date > new Date()) break;
      const r = Math.random();
      const count = r < 0.45 ? 0 : Math.floor(r * 12);
      total += count;
      const lvl = count === 0 ? "NONE" : count < 3 ? "FIRST_QUARTILE" : count < 6 ? "SECOND_QUARTILE" : count < 9 ? "THIRD_QUARTILE" : "FOURTH_QUARTILE";
      days.push({ date: date.toISOString().slice(0, 10), weekday: d, contributionCount: count, contributionLevel: lvl });
    }
    weeks.push({ contributionDays: days });
  }
  return { totalContributions: total, weeks };
}

/* ---------------- helpers ---------------- */

const f = (n) => Number(n.toFixed(4));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------------- 1. contribution bloom ---------------- */

function bloomSVG(cal, t) {
  const CELL = 11, GAP = 3, PITCH = CELL + GAP, PAD = 14, TOP = 16, LABEL_H = 34;
  const weeks = cal.weeks;
  const width = PAD * 2 + weeks.length * PITCH - GAP;
  const height = TOP + 7 * PITCH - GAP + LABEL_H;

  // Visit every cell in a serpentine path: down one column, up the next
  const path = [];
  weeks.forEach((wk, wi) => {
    const days = [...wk.contributionDays].sort((a, b) => a.weekday - b.weekday);
    if (wi % 2 === 1) days.reverse();
    for (const d of days) {
      path.push({
        ...d,
        x: PAD + wi * PITCH,
        y: TOP + d.weekday * PITCH,
        level: LEVEL[d.contributionLevel] ?? 0,
      });
    }
  });

  const STEP = 0.07;                 // seconds per cell
  const HOLD = 3.5;                  // pause on the finished grid before looping
  const TRAVEL = path.length * STEP;
  const T = f(TRAVEL + HOLD);
  const travelEnd = f(TRAVEL / T);

  const cells = path
    .map((c, i) => {
      const base = `<rect x="${c.x}" y="${c.y}" width="${CELL}" height="${CELL}" rx="3" fill="${t.empty}"`;
      if (c.level === 0) return `${base}/>`;
      const p = f((i * STEP + STEP / 2) / T);
      const p2 = f(Math.min(p + 0.01, 0.96));
      const color = t.levels[c.level];
      const cx = c.x + CELL / 2, cy = c.y + CELL / 2;
      return (
        `${base}><animate attributeName="fill" values="${t.empty};${t.empty};${color};${color};${t.empty}" keyTimes="0;${p};${p2};0.97;1" dur="${T}s" repeatCount="indefinite"/></rect>` +
        // soft ring that blooms outward as the orb passes
        `<circle cx="${cx}" cy="${cy}" r="0" fill="none" stroke="${t.orbGlow}" stroke-width="1.2" opacity="0">` +
        `<animate attributeName="r" values="0;0;${CELL};${CELL}" keyTimes="0;${p};${f(Math.min(p + 0.03, 0.97))};1" dur="${T}s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="0;0;0.7;0;0" keyTimes="0;${p};${p2};${f(Math.min(p + 0.03, 0.97))};1" dur="${T}s" repeatCount="indefinite"/>` +
        `</circle>`
      );
    })
    .join("");

  // Orb motion: one point per cell, timed exactly with the blooms
  const pts = path.map((c) => `${c.x + CELL / 2},${c.y + CELL / 2}`);
  const times = path.map((_, i) => f((i * STEP + STEP / 2) / T));
  const values = [pts[0], ...pts, pts[pts.length - 1]].join(";");
  const keyTimes = ["0", ...times.map(String), "1"].join(";");

  const total = Number(cal.totalContributions).toLocaleString("en-US");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${total} contributions in the last year`)}">
<defs>
  <radialGradient id="orb" cx="35%" cy="30%" r="70%">
    <stop offset="0%" stop-color="${t.orbCore}"/>
    <stop offset="45%" stop-color="${t.orbGlow}" stop-opacity="0.95"/>
    <stop offset="100%" stop-color="${t.orbGlow}" stop-opacity="0.35"/>
  </radialGradient>
  <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.5"/></filter>
</defs>
${cells}
<g>
  <circle r="10" fill="${t.orbGlow}" opacity="0.45" filter="url(#glow)"/>
  <circle r="6.5" fill="url(#orb)"/>
  <circle r="1.6" cx="-2" cy="-2" fill="#FFFFFF" opacity="0.9"/>
  <animateMotion values="${values}" keyTimes="${keyTimes}" dur="${T}s" repeatCount="indefinite" calcMode="linear"/>
  <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.004;${travelEnd};${f(Math.min(travelEnd + 0.02, 0.99))};1" dur="${T}s" repeatCount="indefinite"/>
</g>
<text x="${PAD}" y="${height - 10}" font-family="${FONT}" font-size="12" fill="${t.muted}">${esc(total)} contributions in the last year</text>
<g transform="translate(${width - PAD - 5 * PITCH - 62}, ${height - 20})" font-family="${FONT}" font-size="11" fill="${t.muted}">
  <text x="0" y="10">Less</text>
  ${t.levels.map((c, i) => `<rect x="${30 + i * PITCH}" y="1" width="${CELL}" height="${CELL}" rx="3" fill="${c}"/>`).join("")}
  <text x="${34 + 5 * PITCH}" y="10">More</text>
</g>
</svg>`;
}

/* ---------------- 2. activity graph (last 31 days) ---------------- */

function activitySVG(cal, t) {
  const days = cal.weeks.flatMap((w) => w.contributionDays).slice(-31);
  const W = 880, H = 300, L = 48, R = 24, TOP = 56, BOTTOM = 44;
  const cw = W - L - R, ch = H - TOP - BOTTOM;
  const max = Math.max(4, ...days.map((d) => d.contributionCount));
  const niceMax = Math.ceil(max / 4) * 4;
  const x = (i) => L + (cw * i) / (days.length - 1);
  const y = (v) => TOP + ch - (ch * v) / niceMax;

  const pts = days.map((d, i) => [x(i), y(d.contributionCount)]);
  // smooth line (Catmull-Rom → cubic Bézier)
  let line = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(y(0), p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(y(0), p2[1] - (p3[1] - p1[1]) / 6)];
    line += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  const area = `${line} L${f(x(days.length - 1))},${f(y(0))} L${f(x(0))},${f(y(0))} Z`;

  const gridLines = [0, 1, 2, 3, 4]
    .map((k) => {
      const v = (niceMax / 4) * k;
      return `<line x1="${L}" x2="${W - R}" y1="${f(y(v))}" y2="${f(y(v))}" stroke="${t.grid}" stroke-width="1"/>` +
        `<text x="${L - 10}" y="${f(y(v)) + 4}" text-anchor="end" font-size="11" fill="${t.muted}">${v}</text>`;
    })
    .join("");

  const labels = days
    .map((d, i) => {
      if (i % 5 !== 0 && i !== days.length - 1) return "";
      const date = new Date(`${d.date}T00:00:00Z`);
      const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      return `<text x="${f(x(i))}" y="${H - 16}" text-anchor="middle" font-size="11" fill="${t.muted}">${label}</text>`;
    })
    .join("");

  const dots = pts
    .map(([px, py], i) => `<circle cx="${f(px)}" cy="${f(py)}" r="${days[i].contributionCount > 0 ? 3.2 : 2}" fill="${t.line}" opacity="${days[i].contributionCount > 0 ? 1 : 0.45}"/>`)
    .join("");

  const sum = days.reduce((s, d) => s + d.contributionCount, 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-label="${sum} contributions in the last 31 days">
<defs>
  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${t.line}" stop-opacity="0.35"/>
    <stop offset="100%" stop-color="${t.line}" stop-opacity="0"/>
  </linearGradient>
  <clipPath id="reveal"><rect x="0" y="0" width="0" height="${H}"><animate attributeName="width" from="0" to="${W}" dur="1.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.22 1 0.36 1"/></rect></clipPath>
</defs>
<text x="${L}" y="28" font-size="16" font-weight="600" fill="${t.text}">Contribution Activity</text>
<text x="${W - R}" y="28" text-anchor="end" font-size="12" fill="${t.muted}">${sum} contributions · last 31 days</text>
${gridLines}
<g clip-path="url(#reveal)">
  <path d="${area}" fill="url(#fill)"/>
  <path d="${line}" fill="none" stroke="${t.line}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
</g>
${labels}
</svg>`;
}

/* ---------------- run ---------------- */

const cal = await fetchCalendar();
await mkdir(OUT, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  const suffix = name === "dark" ? "-dark" : "";
  await writeFile(`${OUT}/contribution-bloom${suffix}.svg`, bloomSVG(cal, theme));
  await writeFile(`${OUT}/activity-graph${suffix}.svg`, activitySVG(cal, theme));
}
console.log(`Generated profile art for ${USER}: ${cal.totalContributions} contributions`);
