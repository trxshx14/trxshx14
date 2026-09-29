// .github/scripts/profile-art.mjs
// Generates a self-hosted SVG for the profile README from real
// GitHub contribution data (no third-party image services):
//
//   assets/contribution-bloom.svg — a glowing orb travels the contribution
//       grid; every day with contributions blooms as it passes.
//
// Colors match trisha.dev: plum-black #151118, dusty mauve #D4A6C2,
// deep plum #6E3F62. The panel is dark in both GitHub themes.
//
// Runs in GitHub Actions (see .github/workflows/profile-art.yml).
// Local preview with fake data:  node .github/scripts/profile-art.mjs --demo

import { mkdir, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER || "trxshx14";
const TOKEN = process.env.GITHUB_TOKEN;
const DEMO = process.argv.includes("--demo");
const OUT = "assets";

/* ---------------- theme ---------------- */

const THEME = {
  panel: "#151118",        // --bg
  border: "#3A2B38",
  empty: "#241C29",        // --surface-2
  levels: ["#241C29", "#4A2E44", "#6E3F62", "#A56F93", "#D4A6C2"], // plum → mauve
  title: "#EFE7EE",        // --text
  muted: "#8F8093",        // --text-3
  orbCore: "#FFF4FA",
  orbGlow: "#D4A6C2",      // --accent
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
  const CELL = 11, GAP = 3, PITCH = CELL + GAP, PAD = 24, TOP = 58, LABEL_H = 48;
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
  const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${total} contributions in the last year`)}">
<defs>
  <radialGradient id="orb" cx="35%" cy="30%" r="70%">
    <stop offset="0%" stop-color="${t.orbCore}"/>
    <stop offset="45%" stop-color="${t.orbGlow}" stop-opacity="0.95"/>
    <stop offset="100%" stop-color="${t.orbGlow}" stop-opacity="0.35"/>
  </radialGradient>
  <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.5"/></filter>
</defs>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="16" fill="${t.panel}" stroke="${t.border}"/>
<text x="${PAD}" y="36" font-family="${SERIF}" font-size="18" fill="${t.title}">Contribution <tspan font-style="italic" fill="${t.orbGlow}">activity</tspan></text>
<text x="${width - PAD}" y="36" text-anchor="end" font-family="${FONT}" font-size="12" fill="${t.muted}">${esc(total)} contributions in the last year</text>
${cells}
<g>
  <circle r="10" fill="${t.orbGlow}" opacity="0.45" filter="url(#glow)"/>
  <circle r="6.5" fill="url(#orb)"/>
  <circle r="1.6" cx="-2" cy="-2" fill="#FFFFFF" opacity="0.9"/>
  <animateMotion values="${values}" keyTimes="${keyTimes}" dur="${T}s" repeatCount="indefinite" calcMode="linear"/>
  <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.004;${travelEnd};${f(Math.min(travelEnd + 0.02, 0.99))};1" dur="${T}s" repeatCount="indefinite"/>
</g>
<g transform="translate(${width - PAD - 5 * PITCH - 62}, ${height - 30})" font-family="${FONT}" font-size="11" fill="${t.muted}">
  <text x="0" y="10">Less</text>
  ${t.levels.map((c, i) => `<rect x="${30 + i * PITCH}" y="1" width="${CELL}" height="${CELL}" rx="3" fill="${c}"/>`).join("")}
  <text x="${34 + 5 * PITCH}" y="10">More</text>
</g>
</svg>`;
}

/* ---------------- run ---------------- */

const cal = await fetchCalendar();
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/contribution-bloom.svg`, bloomSVG(cal, THEME));
console.log(`Generated profile art for ${USER}: ${cal.totalContributions} contributions`);
