import { Arena } from './Arena.js';
import { IceWorld } from './IceWorld.js';
import { DustYard } from './DustYard.js';
import { NightForest } from './NightForest.js';
import { CloudCarnival } from './CloudCarnival.js';
import { Downtown } from './Downtown.js';
import { CyberSpace } from './CyberSpace.js';
import { PaintedValley } from './PaintedValley.js';

export const MAPS = [
  {
    id: 'backyard',
    mode: '开阔平地',
    name: '戴夫的后院',
    short: '后院',
    tag: '经典草地',
    desc: '草坪开阔，墓碑与树会挡路',
    startLabel: '开始保卫后院',
    create: (scene) => new Arena(scene),
  },
  {
    id: 'snow',
    mode: '跳跃立体',
    name: '雪地',
    short: '雪地',
    tag: 'FY_ICEWORLD',
    desc: 'CS 经典 fy_iceworld：田字四柱与两侧矮墙',
    startLabel: '进入雪地',
    create: (scene) => new IceWorld(scene),
  },
  {
    id: 'dust',
    mode: '三线交织',
    name: '沙城',
    short: '沙城',
    tag: 'DUST YARD',
    desc: '致敬 de_dust2：中门、长 A、B 长廊三线压进',
    startLabel: '进入沙城',
    create: (scene) => new DustYard(scene),
  },
  {
    id: 'forest',
    mode: '夜间视野',
    name: '夜之森林',
    short: '森林',
    tag: 'NIGHT FOREST',
    desc: '奇幻夜间大森林：哥布林、史莱姆、亡灵与野兽各族出没',
    startLabel: '进入夜之森林',
    // 夜之森林要相机引用：手电是相机的子节点，跟视角走（TECH-flashlight.md §4）
    create: (scene, camera) => new NightForest(scene, camera),
  },
  {
    id: 'cloud',
    mode: '机关机制',
    name: '云上发条游乐园',
    short: '云园',
    tag: 'CLOUD CARNIVAL',
    desc: '72 米云海上的发条游乐园：钟楼报时停住所有发条玩具',
    startLabel: '登上云上发条游乐园',
    create: (scene) => new CloudCarnival(scene),
  },
  {
    id: 'downtown',
    mode: '高低层叠',
    name: '摩天街区',
    short: '街区',
    tag: 'DOWNTOWN',
    desc: '黄昏 CBD 十字大道攻防：双塔楼峡、天桥高线与停车楼顶',
    startLabel: '进入摩天街区',
    create: (scene) => new Downtown(scene),
  },
  {
    id: 'cyber',
    mode: '无限扩展',
    name: '无尽的赛博空间',
    short: '赛博',
    tag: 'CYBERSPACE',
    desc: '没有边界的数据都市：楼群按坐标实时生长，走多远都不会到头',
    startLabel: '接入无尽的赛博空间',
    create: (scene) => new CyberSpace(scene),
  },
  {
    id: 'valley',
    mode: '昼光渐变',
    name: '彩绘山谷',
    short: '山谷',
    tag: 'PAINTED VALLEY',
    desc: '手绘的夏日山谷：草甸、红瓦村庄、堆云与远山，光从正午走到日落',
    startLabel: '走进彩绘山谷',
    // 渲染栈在 attachRenderer(renderer, camera) 里懒构建，构造函数不碰 WebGL。
    create: (scene) => new PaintedValley(scene),
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
