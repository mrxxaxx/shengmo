// 下载统计图：读 release-stats.mjs 记的 CSV，画一张 SVG 放进 README（像 star 历史图那样）。
// 图上只写“下载”“日活”，不解释怎么算的。上面一行：截至哪天，右边两个大数字（下载、日活）。
// 下面两张图背靠背，共用中间的时间轴，各有自己的纵轴（累计数越涨越大，放一起日活那条会被压平）：
//   上（红，往上长）：下载 = 所有版本安装包的下载次数加起来（新装和自动更新都算），平滑曲线 + 渐变；
//   下（蓝，往下长）：日活 = 所有版本 latest.json 的次数比前一天多了多少（自动检查一天最多一次，≈ 那天打开过的人），从第二天起才有。
// 每个版本的发布日期（releases.csv，没有就用第一次出现在 CSV 的那天）在两张图上都标一条细线，版本号写在上面那张；
// 发布日期在统计开始之前的不标。
// 每天 0 点记的数算前一天的；同一天记了几次只用最后一次。亮色、暗色跟着 GitHub 的主题（SVG 里的 prefers-color-scheme）。
//
// 单独运行：node scripts/stats-chart.mjs downloads.csv downloads.svg

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [csv, out] = process.argv.slice(2);
if (!csv || !out) throw new Error("用法：node scripts/stats-chart.mjs <downloads.csv> <downloads.svg>");

/** 记录时间往前推 1 分钟取日期：0 点那次算前一天 */
const dayOf = (time) => new Date(new Date(`${time.replace(" ", "T")}:00Z`).getTime() - 60e3).toISOString().slice(0, 10);

// 按天把各版本加起来；记下每个版本第一次出现的那天。
// 删掉的旧版本从某次记录起就没有了：沿用它最后一次的数，不然累计数会往下掉
const byDay = new Map();
const released = new Map();
const byTime = new Map();
for (const line of readFileSync(csv, "utf8").trim().split("\n").slice(1)) {
  const [time, tag, checks, setup] = line.split(",");
  if (!byTime.has(time)) byTime.set(time, new Map());
  byTime.get(time).set(tag, { checks: +checks, setup: +setup });
  if (!released.has(tag)) released.set(tag, dayOf(time));
}
const latest = new Map();
for (const time of [...byTime.keys()].sort()) {
  for (const [tag, v] of byTime.get(time)) latest.set(tag, v);
  const sum = (k) => [...latest.values()].reduce((a, v) => a + v[k], 0);
  byDay.set(dayOf(time), { checks: sum("checks"), fresh: sum("setup") });
}
// 有 releases.csv 就用真实的发布日期（开始统计前发布的版本不会都挤在第一天）
const pubFile = join(dirname(csv), "releases.csv");
if (existsSync(pubFile)) {
  released.clear();
  for (const line of readFileSync(pubFile, "utf8").trim().split("\n").slice(1)) {
    const [tag, day] = line.split(",");
    released.set(tag, day);
  }
}
const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, s]) => ({ day, ...s }));
const n = days.length;
const daily = days.map((d, i) => (i ? Math.max(0, d.checks - days[i - 1].checks) : null));

const W = 840;
const H = 404;
const L = 52; // 图的左边（纵轴刻度在它左边）
const R = W - 28;
// 上面那张的底和下面那张的顶都是 0，中间夹着日期
const TOP = { label: 104, top: 136, bottom: 228 };
const AXIS_Y = 248;
const BOTTOM = { label: 382, top: 264, bottom: 356 };
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
body += `<text x="${L - 24}" y="54" class="title">${n ? `截至 ${md(days[n - 1].day)}` : ""}</text>`;
const kpi = (rx, label, value) =>
  `<text x="${rx}" y="34" class="t3" text-anchor="end">${esc(label)}</text><text x="${rx}" y="66" class="hero" text-anchor="end">${esc(value)}</text>`;
body += kpi(R, "日活", lastDaily === null ? "—" : fmt(lastDaily));
body += kpi(R - 160, "下载", fmt(total));

// 发版的位置（只有一天时不标：线会穿过唯一的点）
const marks = [];
if (n > 1) {
  for (const [tag, day] of [...released.entries()].sort(([, a], [, b]) => a.localeCompare(b))) {
    const i = days.findIndex((d) => d.day === day);
    if (i >= 0) marks.push({ tag, px: x(i) });
  }
}

/** 一张图：名称（圆点 + 文字）、网格、纵轴刻度、发版细线、曲线和末端圆点。down：0 在上面，往下长 */
function panel(box, color, label, values, wash, tags, down) {
  let s = `<circle cx="${L - 19}" cy="${box.label - 4}" r="5" fill="${color}"/><text x="${L - 8}" y="${box.label}" class="t2">${esc(label)}</text>`;
  const pts = values.map((v, i) => (v === null ? null : [x(i), v])).filter(Boolean);
  const t = ticks(Math.max(0, ...pts.map(([, v]) => v)));
  const h = box.bottom - box.top;
  const y = (v) => (down ? box.top + (v / t.top) * h : box.bottom - (v / t.top) * h);
  const base = down ? box.top : box.bottom;
  for (const v of t.list) {
    s += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    s += `<text x="${L - 10}" y="${y(v) + 4}" class="t3" text-anchor="end">${fmt(v)}</text>`;
  }
  let lastLabel = -Infinity;
  for (const m of marks) {
    s += `<line x1="${m.px}" x2="${m.px}" y1="${box.top - (tags ? 12 : 0)}" y2="${box.bottom}" class="mark"/>`;
    if (!tags || m.px - lastLabel < 64) continue;
    s += `<text x="${m.px + 4}" y="${box.top - 4}" class="tag">${esc(m.tag)}</text>`;
    lastLabel = m.px;
  }
  const xy = pts.map(([px, v]) => [px, y(v)]);
  if (xy.length > 1) {
    const line = smooth(xy);
    s += `<path d="${line}L${xy.at(-1)[0].toFixed(1)},${base}L${xy[0][0].toFixed(1)},${base}Z" fill="url(#${wash})"/>`;
    s += `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (xy.length) s += `<circle cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="4.5" fill="${color}" class="ring"/>`;
  else s += `<text x="${(L + R) / 2}" y="${(box.top + box.bottom) / 2 + 4}" class="t3" text-anchor="middle">记满两天才有，明天再来看</text>`;
  return s;
}

body += panel(TOP, RED, "下载", days.map((d) => d.fresh), "wash", true, false);
body += panel(BOTTOM, BLUE, "日活", daily, "washDown", false, true);

// 中间的时间轴：第一天、中间、最后一天
if (n) {
  const at = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n > 1 ? [0, n - 1] : [0];
  at.forEach((i, j) => {
    const anchor = n <= 1 ? "middle" : j === 0 ? "start" : j === at.length - 1 ? "end" : "middle";
    body += `<text x="${x(i)}" y="${AXIS_Y + 4}" class="t3" text-anchor="${anchor}">${md(days[i].day)}</text>`;
  });
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="声墨：下载 ${total}">
<defs>
  <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${RED}" stop-opacity="0.28"/>
    <stop offset="1" stop-color="${RED}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="washDown" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BLUE}" stop-opacity="0"/>
    <stop offset="1" stop-color="${BLUE}" stop-opacity="0.28"/>
  </linearGradient>
</defs>
<style>
  text { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; }
  .bg { fill: #f6f8fa; }
  .title { font-size: 14px; fill: #59636e; }
  .t2 { font-size: 13px; fill: #59636e; }
  .t3 { font-size: 12px; fill: #818b98; }
  .tag { font-size: 11px; font-weight: 600; fill: #59636e; }
  .hero { font-size: 28px; font-weight: 600; fill: #1f2328; }
  .grid { stroke: #e6eaef; stroke-width: 1; }
  .mark { stroke: #d1d9e0; stroke-width: 1; }
  .ring { stroke: #f6f8fa; stroke-width: 2; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #151b23; }
    .hero { fill: #f0f6fc; }
    .title { fill: #9198a1; }
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
