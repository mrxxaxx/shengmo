// 下载统计：读公开仓库 mrxxaxx/shengmo 每个发行版附件的下载次数（GitHub 只给累计数）。
// 每个版本看三样：latest.json（自动检查更新每次都下载它，只记在当时最新的版本上，约等于检查更新次数）、
// 安装包（手动下载的 + 自动更新的）、签名（只有自动更新才下载）。所以 安装包 − 签名 ≈ 手动下载的新用户。
// 给了 --csv 就把这次的数追加到 CSV（每个版本一行），并和 CSV 里这个版本上一次的数比，算出新增。
// 本仓库的 .github/workflows/stats.yml 每天跑一次，CSV 存在本仓库的 stats 分支。
//
// 单独运行：node scripts/release-stats.mjs            只看现在的累计数
//          node scripts/release-stats.mjs --csv x.csv  追加到 CSV 并显示新增
// 输出是 Markdown 表格（流程里直接写进运行页面的摘要）。

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

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
  const since = [...last.values()][0]?.time;
  out.push(`### 下载统计（${time}，新增从 ${since ?? "第一次记录"} 算起）`, "");
  out.push("| 版本 | 检查更新 | 新用户下载 | 自动更新 | 累计：检查 / 安装包 / 签名 |", "|---|---|---|---|---|");
  for (const r of now) {
    const p = last.get(r.tag) ?? { checks: 0, setup: 0, sig: 0 };
    const dc = r.checks - p.checks;
    const ds = r.setup - p.setup;
    const dg = r.sig - p.sig;
    out.push(`| ${r.tag} | +${dc} | +${ds - dg} | +${dg} | ${r.checks} / ${r.setup} / ${r.sig} |`);
  }
} else {
  out.push(`### 下载统计（${time}，累计）`, "");
  out.push("| 版本 | 检查更新 | 安装包 | 签名（自动更新） | 新用户下载 ≈ |", "|---|---|---|---|---|");
  for (const r of now) out.push(`| ${r.tag} | ${r.checks} | ${r.setup} | ${r.sig} | ${r.setup - r.sig} |`);
}
console.log(out.join("\n"));
