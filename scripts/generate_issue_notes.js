#!/usr/bin/env node
/*
  自动生成 issue-notes 的脚本
  功能：递归扫描指定目录（默认 tmp, out, archives），收集每个文件的元信息（路径、大小、SHA256、生成时间、用途推断），并把结果追加到指定的 Markdown 文件中。
  使用：node scripts/generate_issue_notes.js --notes issue-notes/20260301-142215-305.md --scan tmp out archives
*/
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DIRS = ['tmp', 'out', 'archives'];
const EMBED_MAX = 64 * 1024; // 64KB

function usage() {
  console.log('用法: node scripts/generate_issue_notes.js --notes <notes.md> [--scan dir1 dir2 ...]');
}

function isProbablyText(filePath) {
  // 简单用扩展名判断文本文件
  const txtExt = ['.log', '.txt', '.md', '.srt', '.vtt', '.json', '.yaml', '.yml', '.csv', '.xml'];
  return txtExt.includes(path.extname(filePath).toLowerCase());
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function walk(dir, baseDir) {
  let results = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(baseDir, abs).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      results = results.concat(await walk(abs, baseDir));
    } else if (ent.isFile()) {
      results.push({ abs, rel });
    }
  }
  return results;
}

async function gatherFiles(dirs) {
  const cwd = process.cwd();
  let all = [];
  for (const d of dirs) {
    const abs = path.resolve(cwd, d);
    try {
      const stat = await fsp.stat(abs);
      if (!stat.isDirectory()) continue;
    } catch (e) {
      // 目录不存在则跳过
      continue;
    }
    const files = await walk(abs, cwd);
    for (const f of files) {
      const st = await fsp.stat(f.abs);
      all.push({
        path: f.rel,
        abs: f.abs,
        size: st.size,
        mtime: st.mtime.toISOString(),
      });
    }
  }
  // 按路径排序
  all.sort((a, b) => a.path.localeCompare(b.path));
  return all;
}

async function buildMarkdownSection(files, notesPath) {
  const now = new Date().toISOString();
  let md = `\n### 自动生成的文件清单（扫描时间: ${now}）\n\n`;
  for (const f of files) {
    const sha = await sha256File(f.abs);
    md += `- ${f.path} — ${f.size} bytes — SHA256: ${sha} — 生成时间: ${f.mtime} — 用途: 待注明 — 删除策略: 待注明\n`;
    // 若为文本且小于 EMBED_MAX，嵌入内容
    if (isProbablyText(f.path) && f.size > 0 && f.size <= EMBED_MAX) {
      try {
        const content = await fsp.readFile(f.abs, { encoding: 'utf8' });
        md += '\n```\n' + content.trim() + '\n```\n\n';
      } catch (e) {
        // 忽略读取错误
      }
    }
  }
  return md;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    usage();
    process.exit(1);
  }
  let notes = null;
  const dirs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--notes') {
      notes = argv[++i];
    } else if (a === '--scan') {
      while (i + 1 < argv.length && !argv[i+1].startsWith('--')) {
        dirs.push(argv[++i]);
      }
    } else {
      console.warn('未知参数', a);
    }
  }
  if (!notes) {
    console.error('必须指定 --notes <file>');
    process.exit(2);
  }
  const scanDirs = dirs.length ? dirs : DEFAULT_DIRS;
  const files = await gatherFiles(scanDirs);
  const section = await buildMarkdownSection(files, notes);

  // 读取现有 notes（若存在），在末尾追加新节
  try {
    await fsp.access(notes);
    const orig = await fsp.readFile(notes, { encoding: 'utf8' });
    const out = orig + '\n' + section;
    await fsp.writeFile(notes, out, { encoding: 'utf8' });
    console.log('已更新', notes);
  } catch (e) {
    // 文件不存在则创建新文件，写入简单头部
    const header = '# 自动生成的 Issue Notes\n\n' + section;
    await fsp.mkdir(path.dirname(notes), { recursive: true });
    await fsp.writeFile(notes, header, { encoding: 'utf8' });
    console.log('已创建并写入', notes);
  }
}

main().catch((err) => {
  console.error('执行失败:', err);
  process.exit(10);
});
