// 服务器侧的地图加载：从构建期导出的 JSON 重建一个「只有数据、没有外观」的地图对象。
//
// 地图外观（mesh / 材质 / 灯光）在浏览器里由 src/world/*.js 创建，
// 服务器只需要：碰撞体、平台、边界、出生点、流场。这些都从 mapdata.json 来，
// 由 tools/extract-map-data.mjs 在构建期从真实的 createMaps() 榨出来 —— 保证与客户端同源。
//
// 无限地图（赛博空间）是唯一的例外：它没有「整图」，mapdata.json 里只有出生区块的快照
// 加 infinite:true。这类地图在这里改成**运行时按坐标生成**（直接复用客户端的
// cyberChunks 生成器，同一份代码 → 同一份碰撞体），流场也用同一份 ChunkNav。
// 这样双人模式里服务器和客户端的碰撞、僵尸寻路完全一致，不然客人会撞上看不见的墙。
import { FlowField } from '../world/FlowField.js';
import {
  CHUNK, SOLID_RADIUS, collect, chunkIndex, ChunkNav,
} from '../world/cyberChunks.js';
import MAPDATA from './mapdata.json' with { type: 'json' };

const byId = new Map(MAPDATA.map((m) => [m.id, m]));

export const HEADLESS_MAP_IDS = MAPDATA.map((m) => m.id);

/**
 * 建一个可模拟的地图对象。字段与 src/world/*.js 的实例保持同名，
 * 所以 Zombie / Player 原有的读取路径完全不用改。
 */
export function headlessMap(id) {
  const d = byId.get(id) || MAPDATA[0];
  if (d.infinite) return infiniteMap(d);

  const map = {
    id: d.id,
    bounds: d.bounds || { x: 23, z: 23 },
    spawn: d.spawn || { x: 0, z: 13, yaw: 0 },
    colliders: d.colliders.map((c) => ({ x: c.x, z: c.z, r: c.r })),
    platforms: d.platforms.map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d, h: p.h })),
    // 原样带过来：盒体墙靠 hx/hy/hz/c/s 求交，圆柱墙靠 r/h，少一个字段就判错
    walls: d.walls.map((w) => ({ ...w })),
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

/**
 * 无限地图的服务端实例。
 *
 * 与客户端的对应关系：Client 是 CyberSpace（有网格/灯光/InstancedMesh），
 * 这里是同一份「数据面」—— 同样的 chunkData 生成器、同样的 3×3 碰撞圈、
 * 同样的 ChunkNav 流场。唯一的区别是这里没有任何渲染对象。
 */
function infiniteMap(d) {
  const map = {
    id: d.id,
    infinite: true,
    bounds: d.bounds || { x: 10000, z: 10000 },
    spawn: d.spawn || { x: 0, z: 0, yaw: 0 },
    colliders: [],
    platforms: [],
    walls: [],
    pickupSpots: [],
    zombieSpawnPoints: null,
    nav: null,
    anchorCx: 0,
    anchorCz: 0,
    flowAt: null,
    updateNav: null,
    skySunSpot: null,
    spotsDirty: false,
  };

  const applyWindow = (cx, cz) => {
    const w = collect(cx, cz, SOLID_RADIUS);
    map.colliders = w.colliders;
    map.platforms = w.platforms;
    map.walls = w.walls;
  };

  const computeSpots = () => {
    const w = collect(map.anchorCx, map.anchorCz, SOLID_RADIUS);
    const ox = map.anchorCx * CHUNK;
    const oz = map.anchorCz * CHUNK;
    const spots = [];
    const radii = [8, 14, 20];
    for (let ri = 0; ri < radii.length && spots.length < 8; ri++) {
      for (let i = 0; i < 10 && spots.length < 8; i++) {
        const a = (i / 10) * Math.PI * 2 + ri * 0.41;
        const x = ox + Math.cos(a) * radii[ri];
        const z = oz + Math.sin(a) * radii[ri];
        if (radii[ri] < 6) continue;
        let bad = false;
        for (const p of w.platforms) {
          if (p.h < 0.6) continue;
          if (Math.abs(x - p.x) <= p.w / 2 + 0.5 && Math.abs(z - p.z) <= p.d / 2 + 0.5) { bad = true; break; }
        }
        if (!bad) {
          for (const c of w.colliders) {
            if (Math.hypot(x - c.x, z - c.z) < c.r + 0.5) { bad = true; break; }
          }
        }
        if (bad) continue;
        spots.push([x, z]);
      }
    }
    map.pickupSpots = spots.length ? spots : [[ox + 7, oz], [ox - 7, oz], [ox, oz + 7]];
  };

  const spawnRing = () => {
    const out = [];
    const cx = map.anchorCx * CHUNK;
    const cz = map.anchorCz * CHUNK;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 22 + (i % 3) * 3.5;
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return out;
  };

  const nav = new ChunkNav();
  nav.rebuild(0, 0);
  applyWindow(0, 0);
  computeSpots();
  map.nav = nav;
  map.flowAt = (x, z, out) => nav.flowAt(x, z, out);
  map.zombieSpawnPoints = spawnRing();

  map.updateNav = (player, dt) => {
    const cx = chunkIndex(player.pos.x);
    const cz = chunkIndex(player.pos.z);
    if (cx !== map.anchorCx || cz !== map.anchorCz) {
      map.anchorCx = cx;
      map.anchorCz = cz;
      applyWindow(cx, cz);
      nav.rebuild(cx, cz);
      computeSpots();
      map.zombieSpawnPoints = spawnRing();
    }
    nav.update(player.pos.x, player.pos.z, dt || 1 / 30);
  };

  // 天降阳光：与客户端同口径，落在玩家附近而不是 10 公里外的哨兵边界上
  map.skySunSpot = () => ({
    x: map.anchorCx * CHUNK + (Math.random() - 0.5) * 32,
    z: map.anchorCz * CHUNK + (Math.random() - 0.5) * 32,
  });

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