// 服务器侧的地图加载：从构建期导出的 JSON 重建一个「只有数据、没有外观」的地图对象。
//
// 地图外观（mesh / 材质 / 灯光）在浏览器里由 src/world/*.js 创建，
// 服务器只需要：碰撞体、平台、边界、出生点、流场。这些都从 mapdata.json 来，
// 由 tools/extract-map-data.mjs 在构建期从真实的 createMaps() 榨出来 —— 保证与客户端同源。
import { FlowField } from '../world/FlowField.js';
import MAPDATA from './mapdata.json' with { type: 'json' };

const byId = new Map(MAPDATA.map((m) => [m.id, m]));

export const HEADLESS_MAP_IDS = MAPDATA.map((m) => m.id);

/**
 * 建一个可模拟的地图对象。字段与 src/world/*.js 的实例保持同名，
 * 所以 Zombie / Player 原有的读取路径完全不用改。
 */
export function headlessMap(id) {
  const d = byId.get(id) || MAPDATA[0];
  const map = {
    id: d.id,
    bounds: d.bounds || { x: 23, z: 23 },
    spawn: d.spawn || { x: 0, z: 13, yaw: 0 },
    colliders: d.colliders.map((c) => ({ x: c.x, z: c.z, r: c.r })),
    platforms: d.platforms.map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d, h: p.h })),
    walls: d.walls.map((w) => ({ x: w.x, z: w.z, w: w.w, d: w.d, y0: w.y0, y1: w.y1 })),
    pickupSpots: d.pickupSpots.map((p) => ({ x: p.x, z: p.z })),
    zombieSpawnPoints: d.zombieSpawnPoints.length ? d.zombieSpawnPoints.map((p) => [p.x, p.z]) : null,
    nav: null,
    // 地图没有流场（如后院）时返回 null，Zombie 会退化成直线追踪 —— 与客户端行为一致
    flowAt: null,
    updateNav: null,
  };

  if (d.nav) {
    const nav = new FlowField(d.bounds.x, d.bounds.z, d.nav.cell || 1);
    if (d.nav.blocked) nav.blocked.set(Buffer.from(d.nav.blocked));
    map.nav = nav;
    map.flowAt = (x, z, out) => nav.flowAt(x, z, out);
    map.updateNav = (player) => nav.update(player.pos.x, player.pos.z, 1 / 30);
  }
  return map;
}

// 双人出生点：必须与 Game.js 的 duoSpawn() 逐字一致 —— 客户端预测的起点就是服务器的起点，
// 两边不一致会让开局第一次校正就「瞬移」。客户端：x = spawn.x + side*1.8, z = spawn.z, yaw = spawn.yaw
export function duoSpawn(map, seat) {
  const s = (map && map.spawn) || { x: 0, z: 0, yaw: 0 };
  const side = seat === 0 ? -1 : 1;
  return { x: (s.x || 0) + side * 1.8, z: s.z || 0, yaw: s.yaw || 0 };
}

export function duoStartSpawns(map) {
  return [duoSpawn(map, 0), duoSpawn(map, 1)];
}
