#!/usr/bin/env node
/**
 * scripts/release-local.mjs — 本地构建并自动上传 GitHub Release
 * Build locally, then upload the artifacts to a GitHub Release automatically.
 *
 * 流程 / Pipeline:
 *   1. 预检查(gh 登录、git 状态、平台)/ preflight (gh auth, git state, platform)
 *   2. pnpm run build(electron-vite build)
 *   3. pnpm exec electron-builder --<platform> --publish=never
 *   4. 收集 dist/ 产物 / collect artifacts(含 electron-updater 所需的 latest*.yml 与 *.blockmap)
 *   5. gh release create(tag 不存在时新建)或 gh release upload --clobber(已存在时覆盖)
 *
 * 用法 / Usage:
 *   pnpm release:local                    # 当前平台,直接发布(非草稿)
 *   pnpm release:local --draft            # 上传为草稿 release,人工确认后再 publish
 *   pnpm release:local --tag v1.2.3       # 自定义 tag,默认 v{package.json 的 version}
 *   pnpm release:local --skip-build       # 跳过构建,直接上传 dist/ 里现有产物
 *   pnpm release:local --dry-run          # 演练:只打印将执行的命令,不构建、不上传
 *   pnpm release:local --platform win     # 指定平台 mac|win|linux(默认取当前系统;
 *                                         #   跨平台打包需要 wine/docker 等额外工具链,一般会失败)
 *
 * 说明 / Notes:
 *   - 上传依赖 GitHub CLI(gh),需先 `gh auth login`。
 *   - MAIN_VITE_* 环境变量:electron-vite 会自动读取根目录 .env,把 CI secrets
 *     写进 .env 即可得到与 CI 一致的构建产物。
 *   - 建议在干净的工作区运行;工作区有未提交改动时脚本只提示、不拦截。
 *   - 版本号带预发布段(如 4.0.0-alpha)时,release 会自动标记为 prerelease。
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const PLATFORM_BY_OS = { darwin: 'mac', win32: 'win', linux: 'linux' };
const BUILDER_FLAG = { mac: '--mac', win: '--win', linux: '--linux' };
// 与 CI(.github/workflows/build.yml)上传的产物类型保持一致
const ARTIFACT_SUFFIXES = [
  '.exe',
  '.zip',
  '.dmg',
  '.AppImage',
  '.snap',
  '.deb',
  '.rpm',
  '.tar.gz',
  '.yml',
  '.blockmap'
];
// electron-builder 的内部调试文件,不上传 / internal builder debug file, never upload
const ARTIFACT_EXCLUSIONS = [/^builder-debug\.yml$/];

const log = (...m) => console.log(...m);

function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function usage() {
  return [
    '用法 / usage: pnpm release:local [options]',
    '',
    '  --platform <mac|win|linux>  目标平台,默认当前系统 / target platform, defaults to current OS',
    '  --tag <tag>                 release tag,默认 v{version} / release tag, defaults to v{version}',
    '  --draft                     上传为草稿 / upload as draft release',
    '  --prerelease | --stable     覆盖预发布标记 / override the prerelease flag (auto-detected from version)',
    '  --skip-build                跳过构建,复用 dist/ 现有产物 / reuse existing dist/ artifacts',
    '  --dry-run                   演练,不构建不上传 / print commands only',
    '  -h, --help                  帮助 / help'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    platform: null,
    tag: null,
    draft: false,
    skipBuild: false,
    dryRun: false,
    prerelease: null,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const [name, inlineValue] = eq > -1 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, null];
    const takeValue = () => {
      if (inlineValue !== null) return inlineValue;
      if (i + 1 >= argv.length) die(`缺少参数值 / missing value for ${name}\n\n${usage()}`);
      return argv[++i];
    };
    switch (name) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--draft':
        args.draft = true;
        break;
      case '--skip-build':
        args.skipBuild = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--prerelease':
        args.prerelease = true;
        break;
      case '--stable':
        args.prerelease = false;
        break;
      case '--platform':
        args.platform = takeValue();
        break;
      case '--tag':
        args.tag = takeValue();
        break;
      default:
        die(`未知参数 / unknown argument: ${a}\n\n${usage()}`);
    }
  }
  return args;
}

/** 静默执行并捕获输出(只用于只读命令)/ run a read-only command and capture output */
function sh(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8' });
  return {
    ok: r.status === 0,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim()
  };
}

function buildBody(notesJson, version, shortSha) {
  const entry = Array.isArray(notesJson?.versions)
    ? notesJson.versions.find((v) => v.version === version)
    : null;
  const lines = [
    `Local build of Melodict ${version}.`,
    '',
    `Built from commit ${shortSha} on ${new Date().toISOString().slice(0, 10)}.`
  ];
  if (entry?.importantNotes?.length) {
    lines.push('', '## Important', ...entry.importantNotes.map((n) => `- ${n}`));
  }
  const notes = entry?.notes;
  if (notes?.new?.length) {
    lines.push('', '## New', ...notes.new.map((x) => `- ${x.note}`));
  }
  if (notes?.fixed?.length) {
    lines.push('', '## Fixed', ...notes.fixed.map((x) => `- ${x.note}`));
  }
  if (notes?.developerUpdates?.length) {
    lines.push('', '## Developer Updates', ...notes.developerUpdates.map((x) => `- ${x.note}`));
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    log(usage());
    return;
  }

  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const isPrerelease = args.prerelease ?? /-/.test(version);

  // [1/5] 预检查 / preflight
  log('\n==> [1/5] 预检查 / preflight');
  const sha = sh('git', ['rev-parse', 'HEAD']).stdout;
  if (!sha) die('无法读取 git HEAD / cannot read git HEAD(需要在仓库内运行)');
  if (sh('git', ['status', '--porcelain']).stdout) {
    log('   ⚠ 工作区有未提交改动,产物不对应某个干净提交 / worktree has uncommitted changes');
  }
  const platform = args.platform || PLATFORM_BY_OS[process.platform];
  if (!BUILDER_FLAG[platform]) {
    die(`未知平台 / unknown platform: ${platform}(可选 mac|win|linux)`);
  }
  if (args.platform && args.platform !== PLATFORM_BY_OS[process.platform]) {
    log(
      '   ⚠ 交叉打包需要 wine/docker 等额外工具链,本机通常无法完成 / cross-building usually needs extra tooling'
    );
  }
  if (!sh('gh', ['auth', 'token']).ok) {
    die('gh 未登录 / gh not authenticated:请先运行 `gh auth login`');
  }
  log(
    `   version=${version}  platform=${platform}  commit=${sha.slice(0, 7)}${args.dryRun ? '  (dry-run)' : ''}`
  );

  // [2/5] 构建 / build
  log('\n==> [2/5] 构建 / build');
  const runVisible = (cmd, cmdArgs) => {
    log(`   $ ${cmd} ${cmdArgs.join(' ')}`);
    if (args.dryRun) return;
    const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) die(`命令失败 / command failed: ${cmd} ${cmdArgs.join(' ')}`);
  };
  if (args.skipBuild) {
    log('   (--skip-build) 已跳过 / skipped');
  } else {
    runVisible('pnpm', ['run', 'build']);
    runVisible('pnpm', ['exec', 'electron-builder', BUILDER_FLAG[platform], '--publish=never']);
  }

  // [3/5] 收集产物 / collect artifacts
  log('\n==> [3/5] 收集产物 / collect artifacts');
  let files;
  try {
    files = (await readdir(DIST))
      .filter((n) => ARTIFACT_SUFFIXES.some((s) => n.endsWith(s)))
      .filter((n) => !ARTIFACT_EXCLUSIONS.some((re) => re.test(n)))
      .sort()
      .map((n) => path.join(DIST, n));
  } catch {
    die('dist/ 不存在,请先构建 / dist/ missing, run a build first');
  }
  if (files.length === 0) {
    die('dist/ 里没有可上传的产物 / no artifacts to upload in dist/');
  }
  if (!files.some((f) => /latest.*\.yml$/.test(path.basename(f)))) {
    log('   ⚠ 未找到 latest*.yml,自动更新将不可用 / auto-update feed missing');
  }
  for (const f of files) log(`   - ${path.basename(f)}`);

  // [4/5] 生成 release 说明 / generate release notes
  log('\n==> [4/5] 生成 release 说明 / generate release notes');
  const tag = args.tag || `v${version}`;
  let notesJson = {};
  try {
    notesJson = JSON.parse(await readFile(path.join(ROOT, 'release-notes.json'), 'utf8'));
  } catch {
    // 可选文件,缺失时用兜底说明 / optional file, fall back to a generic body
  }
  const body = buildBody(notesJson, version, sha.slice(0, 7));
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'melodict-release-'));
  const notesPath = path.join(tmpDir, 'notes.md');
  await writeFile(notesPath, body);
  log(`   tag=${tag}  ${args.draft ? '(draft)' : isPrerelease ? '(prerelease)' : '(latest)'}`);
  if (args.dryRun) log(body.split('\n').slice(0, 40).join('\n'));

  // [5/5] 上传 / upload
  log('\n==> [5/5] 上传到 GitHub Releases / upload to GitHub Releases');
  const view = sh('gh', ['release', 'view', tag, '--json', 'isDraft,url']);
  const existing = view.ok ? JSON.parse(view.stdout) : null;
  let cmdArgs;
  if (existing) {
    log(
      `   release 已存在(${existing.isDraft ? 'draft' : 'published'}),追加并覆盖同名资产 / uploading with --clobber`
    );
    cmdArgs = ['release', 'upload', tag, ...files, '--clobber'];
  } else {
    cmdArgs = [
      'release',
      'create',
      tag,
      ...files,
      '--title',
      `Melodict ${version}`,
      '--notes-file',
      notesPath,
      '--target',
      sha
    ];
    if (args.draft) cmdArgs.push('--draft');
    else if (isPrerelease) cmdArgs.push('--prerelease');
    else cmdArgs.push('--latest');
  }
  log(`   $ gh ${cmdArgs.join(' ')}`);
  if (!args.dryRun) {
    const r = spawnSync('gh', cmdArgs, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) die('上传失败 / upload failed');
  }

  const url = sh('gh', ['release', 'view', tag, '--json', 'url', '-q', '.url']).stdout;
  log(`\n✓ 完成 / done${url ? `: ${url}` : ''}`);
}

main().catch((e) => die(e?.message || String(e)));
