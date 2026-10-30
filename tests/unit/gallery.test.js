import { describe, it, expect } from 'vitest';
import { ZOMBIES } from '../../src/config.js';
import { MODELS } from '../../src/entities/ZombieModel.js';
import {
  GALLERY_TYPES,
  ANGLE_PRESETS,
  typeMeta,
  typeInfo,
  anglePosition,
  walkTimeScale,
  statLines,
  modelFile,
} from '../../src/gallery/presets.js';

describe('僵尸图鉴数据', () => {
  it('覆盖 config 里的全部僵尸类型，且每项都有名称/副标题/描述', () => {
    expect(GALLERY_TYPES.map((t) => t.id).sort()).toEqual(Object.keys(ZOMBIES).sort());
    expect(new Set(GALLERY_TYPES.map((t) => t.id)).size).toBe(GALLERY_TYPES.length);
    for (const t of GALLERY_TYPES) {
      expect(t.name, t.id).toBeTruthy();
      expect(t.subtitle, t.id).toBeTruthy();
      expect(t.desc, t.id).toBeTruthy();
    }
  });

  it('typeInfo 从 MODELS + 类型 scale 算高度、悬浮高度和相机距离', () => {
    const normal = typeInfo('normal');
    expect(normal.modelId).toBe('alchemist');
    expect(normal.modelFile).toBe('alchemist.glb');
    expect(normal.height).toBeCloseTo(MODELS.alchemist.height, 5);
    expect(normal.air).toBe(0);
    expect(normal.focusY).toBeCloseTo(normal.height * 0.55, 5);

    const football = typeInfo('football');
    expect(football.modelId).toBe('football');
    expect(football.height).toBeCloseTo(MODELS.football.height * ZOMBIES.football.scale, 5);
    expect(football.height).toBeCloseTo(2.06, 2);
    expect(football.modelFile).toBe('football.glb');

    const balloon = typeInfo('balloon');
    expect(balloon.air).toBe(2.2);
    expect(balloon.height).toBeCloseTo(MODELS.zombie.height, 5);
    expect(balloon.focusY).toBeGreaterThan(balloon.air);
    expect(balloon.distance).toBeGreaterThan(normal.distance);

    const boss = typeInfo('boss');
    expect(boss.modelId).toBe('skeleton');
    expect(boss.height).toBeCloseTo(MODELS.skeleton.height * ZOMBIES.boss.scale, 5);
    expect(boss.distance).toBeGreaterThan(football.distance);
  });

  it('未知类型有安全兜底，不会抛错', () => {
    const meta = typeMeta('missing');
    expect(meta.name).toBe('missing');
    const info = typeInfo('missing');
    expect(info.modelId).toBe('zombie');
    expect(info.height).toBeCloseTo(MODELS.zombie.height, 5);
  });

  it('视角预设：正面/侧面/背面/俯视的方向正确', () => {
    const focus = 1;
    const d = 5;
    const front = anglePosition('front', d, focus);
    expect(front.x).toBeCloseTo(0, 5);
    expect(front.z).toBeGreaterThan(4.9);
    expect(front.y).toBeCloseTo(focus + 0.1, 3);

    const back = anglePosition('back', d, focus);
    expect(back.z).toBeLessThan(-4.9);
    const side = anglePosition('side', d, focus);
    expect(side.x).toBeGreaterThan(4.9);
    expect(side.z).toBeCloseTo(0, 5);

    const top = anglePosition('top', d, focus);
    expect(top.y).toBeGreaterThan(focus + 4);
    expect(top.z).toBeGreaterThan(1);
    expect(top.x).toBeCloseTo(0, 5);

    const fallback = anglePosition('unknown', d, focus);
    expect(fallback.z).toBeGreaterThan(0);
    expect(ANGLE_PRESETS.length).toBe(5);
  });

  it('走路动画速度与游戏内 Zombie.update 同口径', () => {
    expect(walkTimeScale(0)).toBe(0.8);
    expect(walkTimeScale(2.6)).toBeCloseTo(1.322, 5);
    expect(walkTimeScale(10)).toBe(1.7);
    expect(walkTimeScale(undefined)).toBe(0.8);
  });

  it('图鉴数值行包含护甲名称，无护甲显示“无”', () => {
    const f = statLines('football');
    expect(f.find((x) => x.label === '护甲').value).toBe('水牛角头盔 140');
    expect(f.find((x) => x.label === '速度').value).toBe('2.60 m/s');
    const n = statLines('normal');
    expect(n.find((x) => x.label === '护甲').value).toBe('无');
  });

  it('modelFile 只取文件名', () => {
    expect(modelFile(MODELS.football)).toBe('football.glb');
    expect(modelFile(null)).toBe('—');
  });
});
