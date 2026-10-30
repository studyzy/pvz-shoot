import { ZOMBIES } from '../config.js';
import { MODELS } from '../entities/ZombieModel.js';

// 图鉴页只做展示：这里不碰游戏状态，只把 config / MODELS 翻译成 UI 需要的值。
export const GALLERY_TYPES = [
  {
    id: 'normal',
    name: '普通僵尸',
    subtitle: '炼金术士',
    desc: 'Q 版大头身，跑得最快的基础僵尸；成群时最容易贴脸。',
  },
  {
    id: 'cone',
    name: '路障僵尸',
    subtitle: '塑料锥',
    desc: '头顶交通锥，吸收 35% 伤害，对燃烧免疫。',
  },
  {
    id: 'bucket',
    name: '铁桶僵尸',
    subtitle: '生锈铁桶',
    desc: '金属桶吸收 70% 伤害、挡穿透，是前排肉盾。',
  },
  {
    id: 'football',
    name: '橄榄球僵尸',
    subtitle: '水牛角护甲',
    desc: '红色球衣 + 白色护肩 + 深红头盔；全场第二快，护甲怕火。',
  },
  {
    id: 'balloon',
    name: '气球僵尸',
    subtitle: '悬浮 2.2 米',
    desc: '飞在天上，普通弹丸打不到；要靠爆炸或火豌豆解决。',
  },
  {
    id: 'skeleton',
    name: '骷髅',
    subtitle: '雪地专属精英',
    desc: '骨架细，命中球更小；只在雪地图出现，同屏最多 3 只。',
  },
  {
    id: 'boss',
    name: '巨型骷髅',
    subtitle: '骷髅 Boss',
    desc: '约 4.48 米高，手持带钉木棒；每 5 波出现一只。',
  },
];

// 单位方向向量：乘以相机距离后加到注视点上。top 特意留一点 z，避免相机与 up 轴共线。
export const ANGLE_PRESETS = [
  { id: 'threeQuarter', label: '3/4', x: 0.62, y: 0.18, z: 0.76 },
  { id: 'front', label: '正面', x: 0, y: 0.02, z: 1 },
  { id: 'side', label: '侧面', x: 1, y: 0.02, z: 0 },
  { id: 'back', label: '背面', x: 0, y: 0.02, z: -1 },
  { id: 'top', label: '俯视', x: 0, y: 0.94, z: 0.34 },
];

const ARMOR_NAMES = {
  plastic: '塑料路障',
  metal: '金属铁桶',
  buffalo: '水牛角头盔',
};

const META_BY_ID = new Map(GALLERY_TYPES.map((t) => [t.id, t]));

export function typeMeta(id) {
  return META_BY_ID.get(id) || { id, name: id, subtitle: '', desc: '' };
}

export function modelFile(model) {
  return model && model.url ? model.url.split('/').pop() : '—';
}

export function walkTimeScale(speed) {
  // 和 Zombie.update 里 walk 的 mixer.timeScale 同一口径，看着才像游戏里那只。
  return Math.min(1.7, Math.max(0.8, 0.75 + (Number(speed) || 0) * 0.22));
}

export function typeInfo(id) {
  const def = ZOMBIES[id] || {};
  const meta = typeMeta(id);
  const modelId = def.model || 'zombie';
  const model = MODELS[modelId] || MODELS.zombie;
  const height = (model.height || 1.8) * (def.scale || 1);
  const air = def.airborne ? def.airHeight || 2.2 : 0;
  // 锥帽/铁桶会把头顶再抬高 0.6 米左右；不单独算进取景，图鉴里帽子会被顶栏裁掉。
  const hat = def.acc === 'cone' ? 0.65 : def.acc === 'bucket' ? 0.55 : 0;
  const total = height + air + hat;
  return {
    ...meta,
    id,
    def,
    modelId,
    model,
    modelFile: modelFile(model),
    height,
    air,
    total,
    focusY: air + height * 0.55 + hat * 0.7,
    // 让 Boss / 悬浮气球 / 戴帽僵尸也能完整入镜；普通僵尸约 3.8 米，Boss 约 9.2 米。
    distance: Math.max(2.4, (height + air) * 2.05 + hat * 1.6),
  };
}

export function anglePosition(id, distance, focusY) {
  const p = ANGLE_PRESETS.find((a) => a.id === id) || ANGLE_PRESETS[0];
  const len = Math.hypot(p.x, p.y, p.z) || 1;
  return {
    x: (p.x / len) * distance,
    y: focusY + (p.y / len) * distance,
    z: (p.z / len) * distance,
  };
}

export function statLines(id) {
  const def = ZOMBIES[id] || {};
  const armor = def.armor
    ? ARMOR_NAMES[def.armor.material] + ' ' + def.armor.hp
    : '无';
  return [
    { label: '生命', value: def.hp },
    { label: '护甲', value: armor },
    { label: '速度', value: (def.speed || 0).toFixed(2) + ' m/s' },
    { label: '伤害', value: def.damage },
    { label: '分数', value: def.score },
    { label: '体型', value: (def.scale || 1).toFixed(2) + '×' },
  ];
}
