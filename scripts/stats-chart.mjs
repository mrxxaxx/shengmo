// 下载统计图：读 release-stats.mjs 记的 CSV，画一张 SVG 放进 README（像 star 历史图那样）。
// 左边“累计下载”：所有版本的 安装包 − 签名（≈ 手动下载的新用户）加起来，一天一个点，折线；
// 右边“每天检查更新”：所有版本 latest.json 的次数比前一天多了多少（≈ 每天在用的人，自动检查一天最多一次），最近 30 天，柱子。
// 每天 0 点记的数算前一天的；同一天记了几次只用最后一次。亮色、暗色跟着 GitHub 的主题（SVG 里的 prefers-color-scheme）。
//
// 单独运行：node scripts/stats-chart.mjs downloads.csv downloads.svg

import { readFileSync, writeFileSync } from "node:fs";

const [csv, out] = process.argv.slice(2);
if (!csv || !out) throw new Error("用法：node scripts/stats-chart.mjs <downloads.csv> <downloads.svg>");

// 按记录时间把各版本加起来
const byTime = new Map();
for (const line of readFileSync(csv, "utf8").trim().split("\n").slice(1)) {
  const [time, , checks, setup, sig] = line.split(",");
  const s = byTime.get(time) ?? { checks: 0, fresh: 0 };
  s.checks += +checks;
  s.fresh += +setup - +sig;
  byTime.set(time, s);
}
// 记录时间往前推 1 分钟取日期：0 点那次算前一天
const byDay = new Map();
for (const [time, s] of byTime) {
  const day = new Date(new Date(`${time.replace(" ", "T")}:00Z`).getTime() - 60e3).toISOString().slice(0, 10);
  byDay.set(day, s);
}
const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, s]) => ({ day, ...s }));
const total = days.map((d) => ({ day: d.day, v: d.fresh }));
const daily = days.slice(1).map((d, i) => ({ day: d.day, v: Math.max(0, d.checks - days[i].checks) })).slice(-30);

const W = 840;
const H = 300;
const PW = 380; // 每块的宽
const PLOT = { top: 96, bottom: 252, left: 44 };
const RED = "#E5533D";
const md = (day) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;
const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** 0 到 max 之间取 3 格左右的整齐刻度 */
function ticks(max) {
  const raw = Math.max(1, max) / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw));
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, list: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** 一块：标题、大数字、网格和纵轴刻度，返回 SVG 片段和画数据用的坐标换算 */
function panel(x0, title, hero, sub, max) {
  const t = ticks(max);
  const w = PW - PLOT.left;
  const y = (v) => PLOT.bottom - (v / t.top) * (PLOT.bottom - PLOT.top);
  let s = `<text x="${x0}" y="34" class="t2">${esc(title)}</text>`;
  s += `<text x="${x0}" y="70" class="hero">${esc(hero)}</text>`;
  if (sub) s += `<text x="${x0 + 10 + hero.length * 16}" y="70" class="t3">${esc(sub)}</text>`;
  for (const v of t.list) {
    s += `<line x1="${x0 + PLOT.left}" x2="${x0 + PW}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    s += `<text x="${x0 + PLOT.left - 8}" y="${y(v) + 4}" class="t3" text-anchor="end">${fmt(v)}</text>`;
  }
  return { s, y, x: (i, n) => x0 + PLOT.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w), w, x0 };
}

/** 横轴：第一天和最后一天 */
function xLabels(first, last, n, xi) {
  let s = `<text x="${xi(0, n)}" y="${PLOT.bottom + 22}" class="t3" text-anchor="${n <= 1 ? "middle" : "start"}">${md(first)}</text>`;
  if (n > 1) s += `<text x="${xi(n - 1, n)}" y="${PLOT.bottom + 22}" class="t3" text-anchor="end">${md(last)}</text>`;
  return s;
}

let body = "";

// 左：累计下载，折线 + 很淡的面积 + 末端圆点和数值
{
  const last = total.at(-1)?.v ?? 0;
  const p = panel(24, "累计下载（新用户）", fmt(last), "次", Math.max(...total.map((d) => d.v), 0));
  body += p.s;
  const n = total.length;
  const pts = total.map((d, i) => [p.x(i, n), p.y(d.v)]);
  if (n > 1) {
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    body += `<path d="${line}L${pts.at(-1)[0].toFixed(1)},${PLOT.bottom}L${pts[0][0].toFixed(1)},${PLOT.bottom}Z" fill="${RED}" fill-opacity="0.1"/>`;
    body += `<path d="${line}" fill="none" stroke="${RED}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (n) {
    const [x, y] = pts.at(-1);
    body += `<circle cx="${x}" cy="${y}" r="4" fill="${RED}" class="ring"/>`;
    body += xLabels(total[0].day, total.at(-1).day, n, p.x);
  }
}

// 右：每天检查更新，柱子（最宽 24px，顶上 4px 圆角，底下方角），最后一根标数值
{
  const p = panel(24 + PW + 36, "每天检查更新（≈ 在用的人）", daily.length ? fmt(daily.at(-1).v) : "—", daily.length ? `${md(daily.at(-1).day)}` : "", Math.max(...daily.map((d) => d.v), 0));
  body += p.s;
  const n = daily.length;
  if (!n) {
    body += `<text x="${p.x0 + PLOT.left + p.w / 2}" y="${(PLOT.top + PLOT.bottom) / 2}" class="t3" text-anchor="middle">记满两天才有，明天再来看</text>`;
  } else {
    const slot = p.w / n;
    const bw = Math.min(24, slot - 2);
    daily.forEach((d, i) => {
      const cx = p.x0 + PLOT.left + slot * (i + 0.5);
      const top = p.y(d.v);
      const h = PLOT.bottom - top;
      if (h <= 0) return;
      const r = Math.min(4, h, bw / 2);
      const l = cx - bw / 2;
      body += `<path d="M${l},${PLOT.bottom}V${top + r}Q${l},${top} ${l + r},${top}H${l + bw - r}Q${l + bw},${top} ${l + bw},${top + r}V${PLOT.bottom}Z" fill="${RED}"/>`;
    });
    const xi = (i) => p.x0 + PLOT.left + slot * (i + 0.5);
    body += xLabels(daily[0].day, daily.at(-1).day, n, xi);
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="声墨下载统计">
<style>
  text { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; }
  .bg { fill: #ffffff; stroke: #d1d9e0; }
  .t2 { font-size: 14px; fill: #59636e; }
  .t3 { font-size: 12px; fill: #818b98; }
  .hero { font-size: 30px; font-weight: 600; fill: #1f2328; }
  .grid { stroke: #eff2f5; stroke-width: 1; }
  .ring { stroke: #ffffff; stroke-width: 2; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #0d1117; stroke: #3d444d; }
    .t2 { fill: #9198a1; }
    .t3 { fill: #768390; }
    .hero { fill: #f0f6fc; }
    .grid { stroke: #21262d; }
    .ring { stroke: #0d1117; }
  }
</style>
<rect class="bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8"/>
${body}
</svg>
`;
writeFileSync(out, svg);
