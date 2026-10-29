import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

// 集成测试要读真实仓库文件（index.html 的 DOM 结构、public/models/zombie.glb）。
// jsdom 测试环境的模块图里 node:fs 被 vite externalize 成空壳，所以在这里（node 环境）
// 读好文件内容，再用 define 注入到测试环境。
const SOURCE_FILES = [
  'index.html',
  'vite.config.js',
  'src/style.css',
  'src/main.js',
  'src/Game.js',
  'src/ui/HUD.js',
  'src/world/materials.js',
  'src/entities/ZombieModel.js',
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
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000/', pretendToBeVisual: true } },
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/main.js'],
      // --coverage 在并行 worker 下偶发 ENOENT（读 .tmp 时被另一 worker 清掉），每次先清空目录
      clean: true,
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'lcov'],
      // CI 门槛：当前 99.5% 行 / 96.2% 分支，留 1 个点余量卡住回退。
      // 注意 branches 是全局比值，新增大量分支逻辑时记得同步补测试而不是降阈值。
      thresholds: {
        statements: 98,
        lines: 98,
        branches: 94,
        functions: 97,
      },
    },
  },
});
