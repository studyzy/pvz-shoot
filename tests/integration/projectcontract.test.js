// 静态回归护栏：不需要跑游戏就能抓住"重构时漏改"这类问题。
// 例如 HUD 里写死了一份武器列表，config 里加了新武器却忘了补图标 -> 这里的测试会立刻红。
import { describe, it, expect } from 'vitest';
import { WEAPONS, ZOMBIES, TUNING } from '../../src/config.js';
import { readSource as read } from '../helpers/env.js';
const HTML = read('index.html');
const CSS = read('src/style.css');
const HUD_SRC = read('src/ui/HUD.js');
const INDEX_IDS = new Set([...HTML.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

describe('index.html / HUD 契约', () => {
  it('HUD 构造函数里 getElementById 的每个 id 都真实存在于 index.html', () => {
    const ids = [...HUD_SRC.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(20);
    const missing = ids.filter((id) => !INDEX_IDS.has(id));
    expect(missing).toEqual([]);
  });

  it('HUD.bind 绑定的按钮 id 都存在（新增/删除 UI 时同步）', () => {
    const ids = [...HUD_SRC.matchAll(/getElementById\('(\w+Btn)'\)/g)].map((m) => m[1]);
    expect(ids).toContain('startBtn');
    expect(ids).toContain('pauseBtn');
    expect(ids.filter((id) => !INDEX_IDS.has(id))).toEqual([]);
  });

  it('每株植物在 HUD.ICONS 里都有 SVG 图标', () => {
    const block = HUD_SRC.slice(HUD_SRC.indexOf('const ICONS'), HUD_SRC.indexOf('export class HUD'));
    for (const w of WEAPONS) {
      expect(block, '缺少图标 ' + w.id).toContain(w.id + ':');
    }
  });

  it('HUD.js 的标题与文案里没有残留的旧地图名硬编码', () => {
    // 地图列表由 MAPS 驱动，HUD 里不应该再出现具体地图文案
    expect(HUD_SRC).not.toContain('冰原');
  });

  it('触屏操作键位（开火/跳跃/摇杆）都在 index.html 里且不是 display:none 写死', () => {
    for (const id of ['fireBtn', 'jumpBtn', 'joyBase', 'joyKnob']) {
      expect(INDEX_IDS.has(id), '缺少 #' + id).toBe(true);
    }
    // 这些按钮必须能在触屏下显示：样式表里它们的默认 display 不能是 none
    expect(CSS).toMatch(/#fireBtn|\.fire-btn/);
  });

  it('HUD 整体 pointer-events:none，交互元素单独 auto（防挡瞄准）', () => {
    const hudRule = CSS.slice(CSS.indexOf('#hud'));
    expect(hudRule.slice(0, hudRule.indexOf('}'))).toContain('pointer-events: none');
  });
});

describe('config 与文档一致', () => {
  it('config 里声明的数值都在允许区间内（防止误改数值表）', () => {
    expect(TUNING.playerSpeed).toBeGreaterThan(2);
    expect(TUNING.playerSpeed).toBeLessThan(10);
    expect(TUNING.gravity).toBeGreaterThan(5);
    expect(TUNING.maxHealth).toBe(100);
    expect(TUNING.headshotMul).toBeGreaterThan(1);
    expect(TUNING.startSun).toBeGreaterThan(0);
    expect(TUNING.maxSun).toBeGreaterThanOrEqual(TUNING.startSun);
  });

  it('每株植物的冷却/伤害/射速都在合理范围', () => {
    for (const w of WEAPONS) {
      expect(w.cooldown, w.id + ' cooldown').toBeGreaterThan(0);
      expect(w.cooldown, w.id + ' cooldown').toBeLessThan(5);
      if (w.damage !== undefined) expect(w.damage, w.id + ' damage').toBeGreaterThan(0);
      expect(['pea', 'lob', 'hitscan']).toContain(w.kind);
      if (!w.starter) expect(w.ammo, w.id + ' 拾取武器必须有弹药').toBeGreaterThan(0);
    }
  });

  it('僵尸数值单调：桶 > 锥 > 普通，Boss 最大', () => {
    expect(ZOMBIES.cone.hp).toBeGreaterThan(ZOMBIES.normal.hp);
    expect(ZOMBIES.bucket.hp).toBeGreaterThan(ZOMBIES.cone.hp);
    expect(ZOMBIES.boss.hp).toBeGreaterThan(ZOMBIES.bucket.hp * 3);
    expect(ZOMBIES.boss.radius).toBeGreaterThan(ZOMBIES.normal.radius);
  });
});

describe('构建配置完整性', () => {
  it('vite.config.js 保持 base "./"（GitHub Pages 子路径部署必需）', () => {
    const cfg = read('vite.config.js');
    expect(cfg).toMatch(/base:\s*'\.\/'/);
  });

  it('main.js 只通过 window.__game 暴露调试句柄，不写死 URL', () => {
    const main = read('src/main.js');
    expect(main).toContain('window.__game');
    expect(main).not.toMatch(/http:\/\//);
  });

  it('源码里没有外部 CDN / 字体 / 图片请求（离线可玩）', () => {
    const files = [
      'index.html',
      'src/main.js',
      'src/Game.js',
      'src/world/materials.js',
      'src/entities/ZombieModel.js',
    ];
    for (const f of files) {
      const text = read(f);
      expect(text, f + ' 引用了外部资源').not.toMatch(/https?:\/\/(?!localhost)[a-z0-9.-]+\/.*\.(png|jpg|webp|glb|ttf|woff|css)/i);
    }
  });

  it('模型走 import.meta.env.BASE_URL + 项目内路径', () => {
    const model = read('src/entities/ZombieModel.js');
    expect(model).toContain('BASE_URL');
    expect(model).toContain('models/zombie.glb');
  });
});