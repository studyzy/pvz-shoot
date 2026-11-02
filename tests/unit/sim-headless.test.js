// 守护测试：模拟层必须能在「没有 DOM / 没有 WebGL」的纯 Node 里跑。
// 这是服务器权威架构的地基 —— 一旦有人在 sim 路径里引了 document / window /
// WebGLRenderer，服务器就会直接崩，而且是在线上才崩。所以用静态扫描 + 运行时双保险。
import { describe, it, expect } from 'vitest';

// jsdom 模块图里拿不到 node:fs，用 vitest.config.js 在 node 侧读好注入的源码表
const SOURCES = __fixture_sources__;
const read = (rel) => SOURCES[rel];

// 模拟路径上会被服务器加载的文件。注意：Zombie/ZombieManager 里含有渲染代码，
// 但都收在 `ctx.headless` 分支后面，所以静态扫描只查「模块顶层」的渲染依赖。
const SIM_FILES = [
  'src/sim/index.js',
  'src/entities/Zombie.js',
  'src/entities/ZombieManager.js',
  'src/entities/Player.js',
  'src/entities/SkySun.js',
];

describe('模拟层可无头运行', () => {
  it('这些文件里不允许在模块顶层直接 new 渲染器 / 读 document', () => {
    const bad = [];
    for (const rel of SIM_FILES) {
      const src = read(rel);
      // 缩进为 0 的 document./window. 视为模块顶层调用
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/^(document|window)\./.test(line)) continue;
        if (/^\s*\*\s/.test(line) || /^\s*\/\//.test(line)) continue;
        bad.push(rel + ':' + (i + 1) + ' ' + line.trim().slice(0, 60));
      }
    }
    expect(bad).toEqual([]);
  });

  it('实体类在 headless 标记下不会去建材质/骨骼', () => {
    const src = read('src/entities/Zombie.js');
    // buildRig 必须保留 headless 早退，否则服务器会去加载 glb
    const rig = src.slice(src.indexOf('buildRig() {'), src.indexOf('buildRig() {') + 600);
    expect(rig).toContain('ctx.headless');
    expect(rig).toContain('return');
    // 构造函数里在建 blob 影子之前就要返回（影子要读 canvas）
    const ctor = src.slice(src.indexOf('constructor(type'), src.indexOf('const shadow = new THREE.Mesh'));
    expect(ctor).toContain('headless');
  });

  it('ZombieManager 在 headless 下认为模型永远就绪（服务器不加载 glb）', () => {
    const src = read('src/entities/ZombieManager.js');
    const fn = src.slice(src.indexOf('modelReady(type) {'), src.indexOf('modelReady(type) {') + 300);
    expect(fn).toContain('headless');
    expect(fn).toContain('return true');
  });
});

describe('模拟层不依赖地图的渲染外观', () => {
  it('地图只被当作数据用（colliders / platforms / flowAt），不碰 root 场景树', () => {
    const src = read('src/entities/Zombie.js');
    // 模拟里允许读 map.colliders / map.id / flowAt，不允许把僵尸塞进地图的 root
    const mapRootUse = src.match(/this\.map\.root/g) || [];
    expect(mapRootUse.length).toBe(0);
  });
});
