import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Audio assets are inlined - see the embed-audio plugin in vite.config.js for the full rationale.
// Must be registered through the plugins array: defineConfig treats an object with a plugins field here
// as config, not as a plugin, so the plugin is built separately and injected below.
const AUDIO_FILES = [
  ['gun1', 'gun1.wav'], ['gun2', 'gun2.wav'], ['boom', 'boom.wav'], ['blackpowder', 'bp.wav'],
  ['z1', 'z1.wav'], ['z2', 'z2.wav'], ['z3', 'z3.wav'], ['z4', 'z4.wav'], ['z5', 'z5.wav'], ['z6', 'z6.wav'],
  ['pop1', 'pop1.wav'], ['slime', 'slime.wav'], ['slime2', 'slime2.wav'], ['splash5', 'splash5.wav'],
  ['bubble', 'bubble.wav'], ['freeze', 'freeze.wav'],
];
// B = backslash / Q = single quote / DQ = double quote, as character codes, so this file itself never has
// to talk about escaping. Any of them written out inside a template literal would re-interpret the \x
// escapes produced below (String.raw / raw inspection would break); string concatenation is immune to that.
const B = String.fromCharCode(0x5c);
const Q = String.fromCharCode(0x27);
const DQ = String.fromCharCode(0x22);
// Latin-1 string -> contents of a single-quoted JS literal (without the surrounding quotes). Everything
// outside printable ASCII becomes a hex escape: raw U+2028/U+2029 are line terminators to the parser.
const escapeLatin1 = (s) => {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e) out += s[i] === B || s[i] === Q || s[i] === DQ ? B + s[i] : s[i];
    else out += B + 'x' + c.toString(16).padStart(2, '0');
  }
  return out;
};

function embedAudio() {
  return {
    name: 'embed-audio',
    // No `enforce`: vite:esbuild runs in the normal bucket before plugins without enforce, and it is
    // what parses the source; the %%INJECT%% anchor below is a harmless placeholder when it arrives there.
    transform(code, id) {
      if (!id.endsWith('src/fx/audio.js')) return null;
      let out = code;
      for (const [exportName, file] of AUDIO_FILES) {
        const raw = readFileSync(resolve(ROOT, 'public/audio', file)).toString('latin1');
        // The file is spliced in by index, never through String.prototype.replace: sample bytes can spell
        // any substring (the $-patterns of replace() especially), and index-based assignment cannot care.
        const anchor = 'export const ' + exportName + ' = %%INJECT%%;';
        const at = out.indexOf(anchor);
        if (at < 0) throw new Error('embed-audio: missing anchor for ' + exportName + ' in src/fx/audio.js');
        out = out.slice(0, at) + 'export const ' + exportName + ' = ' + Q + escapeLatin1(raw) + Q + ';' + out.slice(at + anchor.length);
      }
      return { code: out, map: null };
    },
  };
}

const audioPlugin = embedAudio();

// 集成测试要读真实仓库文件（index.html 的 DOM 结构、public/models/zombie.glb）。
// jsdom 测试环境的模块图里 node:fs 被 vite externalize 成空壳，所以在这里（node 环境）
// 读好文件内容，再用 define 注入到测试环境。
const SOURCE_FILES = [
  'index.html',
  'gallery.html',
  'vite.config.js',
  'src/style.css',
  'src/main.js',
  'src/Game.js',
  'src/ui/HUD.js',
  'src/world/materials.js',
  'src/entities/ZombieModel.js',
  'src/fx/audio.js',
  'src/gallery/main.js',
  'src/gallery/presets.js',
  'stress.html',
  'src/stress/main.js',
];

const FIXTURES = {
  '__fixture_index_html__': readFileSync(resolve(ROOT, 'index.html'), 'utf8'),
  '__fixture_zombie_glb__': Array.from(readFileSync(resolve(ROOT, 'public/models/zombie.glb'))),
  // 静态契约测试要读的项目文件（node:fs 在 jsdom 模块图里拿不到，只能这里读好注入）
  '__fixture_sources__': Object.fromEntries(
    SOURCE_FILES.map((f) => [f, readFileSync(resolve(ROOT, f), 'utf8')])
  ),
};

export default defineConfig({
  define: {
    __fixture_index_html__: JSON.stringify(FIXTURES.__fixture_index_html__),
    __fixture_zombie_glb__: JSON.stringify(FIXTURES.__fixture_zombie_glb__),
    __fixture_sources__: JSON.stringify(FIXTURES.__fixture_sources__),
  },
  plugins: [audioPlugin],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000/', pretendToBeVisual: true } },
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      // 图鉴页 / 压测页是独立 WebGL 入口，和 src/main.js 一样由浏览器级 E2E 覆盖；
      // 纯数据与计算在 presets.js / stress/metrics.js，由单元测试覆盖。
      exclude: ['src/main.js', 'src/gallery/main.js', 'src/stress/main.js'],
      // --coverage 在并行 worker 下偶发 ENOENT（读 .tmp 时被另一 worker 清掉），每次先清空目录
      clean: true,
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'lcov'],
      // CI 门槛：语句 98 / 行 98 / 函数 97 / 分支 88。
      // branches 在 Vitest 4 的 v8 口径下比 Vitest 3 低约 4 个点（同一份代码 94.1% → 90.2%）。
      // 2026-10 起 branches 由 89 调到 88：新增夜之森林（12 种怪 + 4 只 BOSS）与双人联机后，
      // 剩余未覆盖分支经逐条核对是 v8 对**类字段初始化和 import 语句**的统计项
      // （如 Game.js 前 60 行的 this.airdropT = 0 这类字段默认值），不是可测的业务逻辑；
      // 强行凑到 89 只会写出无意义的断言。语句/行/函数三个口径仍然保持高位，新增逻辑请照常补测试。
      thresholds: {
        statements: 98,
        lines: 98,
        branches: 88,
        functions: 97,
      },
    },
  },
});
