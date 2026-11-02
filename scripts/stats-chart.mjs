// 下载统计图：读 release-stats.mjs 记的 CSV，画一张 SVG 放进 README（像 star 历史图那样）。
// 上面一行：标题，右边两个大数字（累计下载、昨天在用）；下面图例。
// 一张图两条线，都是人数，共用一根纵轴：
//   红：累计下载 = 所有版本的 安装包 − 签名（≈ 手动下载的新用户）加起来，平滑曲线 + 渐变；
//   蓝：每天在用 = 所有版本 latest.json 的次数比前一天多了多少（自动检查一天最多一次，≈ 那天打开过的人），从第二天起才有。
//   两条线之间的差 ≈ 下载了但没在用的人。
// 每个版本第一次出现在 CSV 的那天标一条细线和版本号，看得出发版后有没有涨。
// 每天 0 点记的数算前一天的；同一天记了几次只用最后一次。亮色、暗色跟着 GitHub 的主题（SVG 里的 prefers-color-scheme）。
//
// 单独运行：node scripts/stats-chart.mjs downloads.csv downloads.svg

import { readFileSync, writeFileSync } from "node:fs";

const [csv, out] = process.argv.slice(2);
if (!csv || !out) throw new Error("用法：node scripts/stats-chart.mjs <downloads.csv> <downloads.svg>");

/** 记录时间往前推 1 分钟取日期：0 点那次算前一天 */
const dayOf = (time) => new Date(new Date(`${time.replace(" ", "T")}:00Z`).getTime() - 60e3).toISOString().slice(0, 10);

// 按天把各版本加起来；记下每个版本第一次出现的那天
const byDay = new Map();
const released = new Map();
const byTime = new Map();
for (const line of readFileSync(csv, "utf8").trim().split("\n").slice(1)) {
  const [time, tag, checks, setup, sig] = line.split(",");
  const s = byTime.get(time) ?? { checks: 0, fresh: 0 };
  s.checks += +checks;
  s.fresh += +setup - +sig;
  byTime.set(time, s);
  if (!released.has(tag)) released.set(tag, dayOf(time));
}
for (const [time, s] of byTime) byDay.set(dayOf(time), s);
const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, s]) => ({ day, ...s }));
const n = days.length;
const daily = days.map((d, i) => (i ? Math.max(0, d.checks - days[i - 1].checks) : null));

const W = 840;
const H = 340;
const L = 52; // 图的左边（纵轴刻度在它左边）
const R = W - 28;
const LEGEND_Y = 102;
const MAIN = { top: 140, bottom: 296 };
const RED = "#E5533D";
const BLUE = "#2F7FD8";
const md = (day) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;
const fmt = (v) => v.toLocaleString("en-US");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const x = (i) => (n <= 1 ? (L + R) / 2 : L + (i / (n - 1)) * (R - L));

/** 0 到 max 之间取 3 格左右的整齐刻度 */
function ticks(max) {
  const raw = Math.max(1, max) / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw));
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, list: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** 平滑曲线（单调三次插值，不会冲过数据点，累计数不会画出往下的弯） */
function smooth(pts) {
  if (pts.length < 3) return pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const k = pts.length;
  const d = [];
  const m = [];
  for (let i = 0; i < k - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m.push(d[0]);
  for (let i = 1; i < k - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
  m.push(d[k - 2]);
  let s = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < k - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = (x1 - x0) / 3;
    s += `C${(x0 + h).toFixed(1)},${(y0 + m[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - m[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return s;
}

let body = "";

// 上面一行：标题 + 两个大数字
const total = n ? days[n - 1].fresh : 0;
const lastDaily = n > 1 ? daily[n - 1] : null;
body += `<text x="${L - 24}" y="44" class="title">声墨 · 下载统计</text>`;
body += `<text x="${L - 24}" y="66" class="t3">每天自动更新${n ? ` · 截至 ${md(days[n - 1].day)}` : ""}</text>`;
const kpi = (rx, label, value) =>
  `<text x="${rx}" y="34" class="t3" text-anchor="end">${esc(label)}</text><text x="${rx}" y="66" class="hero" text-anchor="end">${esc(value)}</text>`;
body += kpi(R, "昨天在用", lastDaily === null ? "—" : fmt(lastDaily));
body += kpi(R - 180, "累计下载", fmt(total));

// 图例：两条线，圆点 + 文字（颜色不单独表意）
const legend = (lx, color, label) =>
  `<circle cx="${lx + 5}" cy="${LEGEND_Y - 4}" r="5" fill="${color}"/><text x="${lx + 16}" y="${LEGEND_Y}" class="t2">${esc(label)}</text>`;
body += legend(L - 24, RED, "累计下载（新用户）");
body += legend(L + 130, BLUE, "每天在用（检查更新）");

// 网格、刻度：两条线都是人数，共用一根纵轴
const t = ticks(Math.max(0, ...days.map((d) => d.fresh), ...daily.slice(1)));
const y = (v) => MAIN.bottom - (v / t.top) * (MAIN.bottom - MAIN.top);
for (const v of t.list) {
  body += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
  body += `<text x="${L - 10}" y="${y(v) + 4}" class="t3" text-anchor="end">${fmt(v)}</text>`;
}

// 发版标记：细线 + 版本号，挨得太近的跳过；只有一天时不标（线会穿过唯一的点）
let lastLabel = -Infinity;
if (n > 1) for (const [tag, day] of [...released.entries()].sort(([, a], [, b]) => a.localeCompare(b))) {
  const i = days.findIndex((d) => d.day === day);
  if (i < 0) continue;
  const px = x(i);
  body += `<line x1="${px}" x2="${px}" y1="${MAIN.top - 8}" y2="${MAIN.bottom}" class="mark"/>`;
  if (px - lastLabel < 64) continue;
  body += `<text x="${px + 4}" y="${MAIN.top - 10}" class="tag">${esc(tag)}</text>`;
  lastLabel = px;
}

// 累计下载：曲线 + 渐变
const pts = days.map((d, i) => [x(i), y(d.fresh)]);
if (n > 1) {
  const line = smooth(pts);
  body += `<path d="${line}L${pts[n - 1][0].toFixed(1)},${MAIN.bottom}L${pts[0][0].toFixed(1)},${MAIN.bottom}Z" fill="url(#wash)"/>`;
  body += `<path d="${line}" fill="none" stroke="${RED}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
}

// 每天在用：从第二天起才有，只画线不画面积
const dpts = daily.map((v, i) => (i ? [x(i), y(v)] : null)).filter(Boolean);
if (dpts.length > 1) body += `<path d="${smooth(dpts)}" fill="none" stroke="${BLUE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

// 末端圆点（带一圈底色，压在线上也看得清）
if (dpts.length) body += `<circle cx="${dpts.at(-1)[0]}" cy="${dpts.at(-1)[1]}" r="4.5" fill="${BLUE}" class="ring"/>`;
if (n) body += `<circle cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="4.5" fill="${RED}" class="ring"/>`;
if (n < 2) body += `<text x="${(L + R) / 2}" y="${MAIN.bottom - 12}" class="t3" text-anchor="middle">记满两天才有曲线，明天再来看</text>`;

// 横轴：第一天、中间、最后一天
if (n) {
  const at = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n > 1 ? [0, n - 1] : [0];
  at.forEach((i, j) => {
    const anchor = n <= 1 ? "middle" : j === 0 ? "start" : j === at.length - 1 ? "end" : "middle";
    body += `<text x="${x(i)}" y="${MAIN.bottom + 22}" class="t3" text-anchor="${anchor}">${md(days[i].day)}</text>`;
  });
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="声墨下载统计：累计下载 ${total}">
<defs>
  <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${RED}" stop-opacity="0.28"/>
    <stop offset="1" stop-color="${RED}" stop-opacity="0"/>
  </linearGradient>
</defs>
<style>
  text { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; }
  .bg { fill: #f6f8fa; }
  .title { font-size: 18px; font-weight: 600; fill: #1f2328; }
  .t2 { font-size: 13px; fill: #59636e; }
  .t3 { font-size: 12px; fill: #818b98; }
  .tag { font-size: 11px; font-weight: 600; fill: #59636e; }
  .hero { font-size: 28px; font-weight: 600; fill: #1f2328; }
  .grid { stroke: #e6eaef; stroke-width: 1; }
  .mark { stroke: #d1d9e0; stroke-width: 1; }
  .ring { stroke: #f6f8fa; stroke-width: 2; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #151b23; }
    .title, .hero { fill: #f0f6fc; }
    .t2, .tag { fill: #9198a1; }
    .t3 { fill: #768390; }
    .grid { stroke: #262c36; }
    .mark { stroke: #3d444d; }
    .ring { stroke: #151b23; }
  }
</style>
<rect class="bg" width="${W}" height="${H}" rx="12"/>
${body}
</svg>
`;
writeFileSync(out, svg);
