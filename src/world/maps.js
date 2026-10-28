import { Arena } from './Arena.js';
import { IceWorld } from './IceWorld.js';

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
];

export const DEFAULT_MAP = 'backyard';

export function createMaps(scene) {
  return MAPS.map((m) => {
    const map = m.create(scene);
    map.meta = m;
    map.startLabel = m.startLabel;
    return map;
  });
}
