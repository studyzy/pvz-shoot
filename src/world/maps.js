import { Arena } from './Arena.js';
import { IceWorld } from './IceWorld.js';
import { DustYard } from './DustYard.js';
import { NightForest } from './NightForest.js';

export const MAPS = [
  {
    id: 'backyard',
    name: '戴夫的后院',
    short: '后院',
    tag: '经典草地',
    desc: '草坪开阔，墓碑与树会挡路',
    startLabel: '开始保卫后院',
    create: (scene) => new Arena(scene),
  },
  {
    id: 'snow',
    name: '雪地',
    short: '雪地',
    tag: 'FY_ICEWORLD',
    desc: 'CS 经典 fy_iceworld：田字四柱与两侧矮墙',
    startLabel: '进入雪地',
    create: (scene) => new IceWorld(scene),
  },
  {
    id: 'dust',
    name: '沙城',
    short: '沙城',
    tag: 'DUST YARD',
    desc: '致敬 de_dust2：中门、长 A、B 长廊三线压进',
    startLabel: '进入沙城',
    create: (scene) => new DustYard(scene),
  },
  {
    id: 'forest',
    name: '夜之森林',
    short: '森林',
    tag: 'NIGHT FOREST',
    desc: '奇幻夜间大森林：哥布林、史莱姆、亡灵与野兽各族出没',
    startLabel: '进入夜之森林',
    // 夜之森林要相机引用：手电是相机的子节点，跟视角走（TECH-flashlight.md §4）
    create: (scene, camera) => new NightForest(scene, camera),
  },
];

export const DEFAULT_MAP = 'backyard';

export function createMaps(scene, camera = null) {
  return MAPS.map((m) => {
    const map = m.create(scene, camera);
    map.meta = m;
    map.startLabel = m.startLabel;
    return map;
  });
}
