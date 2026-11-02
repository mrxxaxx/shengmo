// 下载统计：读公开仓库 mrxxaxx/shengmo 每个发行版附件的下载次数（GitHub 只给累计数）。
// 每个版本看两样：安装包的下载次数（新装和自动更新都算），latest.json 的下载次数（声墨每天自动检查更新一次就下载一次，
// 只记在当时最新的版本上，约等于日活）。CSV 里还留着签名的次数一列（以前用过），现在不用了。
// 给了 --csv 就把这次的数追加到 CSV（每个版本一行），并和 CSV 里这个版本上一次的数比，算出新增；
// 同一目录下再写一份 releases.csv（各版本的发布日期），给 stats-chart.mjs 标版本用。
// 本仓库的 .github/workflows/stats.yml 每天跑一次，CSV 存在本仓库的 stats 分支。
//
// 单独运行：node scripts/release-stats.mjs            只看现在的累计数
//          node scripts/release-stats.mjs --csv x.csv  追加到 CSV 并显示新增
// 输出是 Markdown 表格（流程里直接写进运行页面的摘要）。

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO = "mrxxaxx/shengmo";
const HEADER = "time,tag,checks,setup,sig";

const i = process.argv.indexOf("--csv");
const csv = i > 0 ? process.argv[i + 1] : null;

const headers = { Accept: "application/vnd.github+json", "User-Agent": "shengmo-stats" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers });
if (!res.ok) throw new Error(`读取发行版失败：HTTP ${res.status}`);
const releases = await res.json();

/** 每个版本的三个累计数，新版本在前 */
const now = releases.map((r) => {
  const count = (test) => r.assets.filter((a) => test(a.name)).reduce((n, a) => n + a.download_count, 0);
  return {
    tag: r.tag_name,
    checks: count((n) => n === "latest.json"),
    setup: count((n) => n.endsWith("-setup.exe")),
    sig: count((n) => n.endsWith("-setup.exe.sig")),
  };
});

// 北京时间，精确到分钟
const time = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

/** CSV 里每个版本最后一次的数 */
const last = new Map();
if (csv && existsSync(csv)) {
  for (const line of readFileSync(csv, "utf8").trim().split("\n").slice(1)) {
    const [t, tag, checks, setup, sig] = line.split(",");
    last.set(tag, { time: t, checks: +checks, setup: +setup, sig: +sig });
  }
}

const out = [];
if (csv) {
  if (!existsSync(csv)) writeFileSync(csv, `${HEADER}\n`);
  appendFileSync(csv, now.map((r) => `${time},${r.tag},${r.checks},${r.setup},${r.sig}\n`).join(""));
  // 各版本的发布日期（北京时间），画图时标在时间轴上
  const pub = releases.map((r) => `${r.tag_name},${new Date(new Date(r.published_at).getTime() + 8 * 3600e3).toISOString().slice(0, 10)}\n`);
  writeFileSync(join(dirname(csv), "releases.csv"), `tag,published\n${pub.join("")}`);
  const since = [...last.values()][0]?.time;
  out.push(`### 下载统计（${time}，新增从 ${since ?? "第一次记录"} 算起）`, "");
  out.push("| 版本 | 下载 | 检查更新 |", "|---|---|---|");
  for (const r of now) {
    const p = last.get(r.tag) ?? { checks: 0, setup: 0 };
    out.push(`| ${r.tag} | ${r.setup}（+${r.setup - p.setup}） | ${r.checks}（+${r.checks - p.checks}） |`);
  }
} else {
  out.push(`### 下载统计（${time}，累计）`, "");
  out.push("| 版本 | 下载 | 检查更新 |", "|---|---|---|");
  for (const r of now) out.push(`| ${r.tag} | ${r.setup} | ${r.checks} |`);
}
console.log(out.join("\n"));
