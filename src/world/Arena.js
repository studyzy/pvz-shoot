import * as THREE from 'three';
import { toon, grassTexture, skyTexture, glowTexture, cloudTexture } from './materials.js';
import { COLORS } from '../config.js';
import { rand, TAU } from '../utils.js';

const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.build();
  }

  addCollider(x, z, r) {
    this.colliders.push({ x, z, r });
  }

  build() {
    const scene = this.scene;
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0xdff1ff, 58, 140);

    this.buildLights();
    this.buildGround();
    this.buildFence();
    this.buildHouse();
    this.buildTrees();
    this.buildTombs();
    this.buildMowers();
    this.buildSunflowers();
    this.buildGrassTufts();
    this.buildFlowers();
    this.buildSkyProps();
    this.buildSign();
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xcdeaff, 0x5f8a34, 1.12);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d2, 2.55);
    sun.position.set(24, 32, 16);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;

    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.45);
    fill.position.set(-20, 14, -24);
    this.scene.add(fill);
  }

  buildGround() {
    const geo = new THREE.PlaneGeometry(180, 180);
    const mat = new THREE.MeshLambertMaterial({ map: grassTexture() });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // stone path from the house toward the yard
    const pathMat = new THREE.MeshLambertMaterial({ color: 0xc9bda0 });
    const stoneGeo = new THREE.BoxGeometry(0.82, 0.07, 0.82);
    const stones = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(stoneGeo, pathMat);
      s.position.set(Math.sin(i * 0.9) * 0.75, 0.035, 21 - i * 2.1);
      s.rotation.y = rand(-0.25, 0.25);
      s.receiveShadow = true;
      stones.add(s);
    }
    this.scene.add(stones);
  }

  buildFence() {
    const half = 24.2;
    const spacing = 0.62;
    const per = Math.floor((half * 2) / spacing);
    const total = per * 4;

    const bodyGeo = new THREE.BoxGeometry(0.14, 1.05, 0.14);
    bodyGeo.translate(0, 0.525, 0);
    const tipGeo = new THREE.ConeGeometry(0.11, 0.2, 4);
    tipGeo.rotateY(Math.PI / 4);
    tipGeo.translate(0, 1.15, 0);

    const mat = toon(COLORS.fence);
    const bodies = new THREE.InstancedMesh(bodyGeo, mat, total);
    const tips = new THREE.InstancedMesh(tipGeo, mat, total);
    bodies.castShadow = true;
    bodies.receiveShadow = true;
    tips.castShadow = true;

    let idx = 0;
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < per; i++) {
        const t = -half + spacing * i + spacing * 0.5;
        let x = 0;
        let z = 0;
        if (side === 0) { x = t; z = -half; }
        else if (side === 1) { x = t; z = half; }
        else if (side === 2) { x = -half; z = t; }
        else { x = half; z = t; }
        const jitter = (Math.random() - 0.5) * 0.04;
        tmpPos.set(x, jitter, z);
        tmpQuat.setFromEuler(tmpEuler.set(0, (Math.random() - 0.5) * 0.06, 0));
        tmpScale.set(1, 1 + jitter, 1);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        bodies.setMatrixAt(idx, tmpMat);
        tips.setMatrixAt(idx, tmpMat);
        idx++;
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    tips.instanceMatrix.needsUpdate = true;
    this.scene.add(bodies);
    this.scene.add(tips);

    const railMat = toon(0xe9e2cf);
    const railGeoLong = new THREE.BoxGeometry(half * 2, 0.1, 0.06);
    const railGeoShort = new THREE.BoxGeometry(0.06, 0.1, half * 2);
    for (let i = 0; i < 2; i++) {
      const y = 0.36 + i * 0.42;
      let rail = new THREE.Mesh(railGeoLong, railMat);
      rail.position.set(0, y, -half + 0.1);
      this.scene.add(rail);
      rail = new THREE.Mesh(railGeoLong, railMat);
      rail.position.set(0, y, half - 0.1);
      this.scene.add(rail);
      rail = new THREE.Mesh(railGeoShort, railMat);
      rail.position.set(-half + 0.1, y, 0);
      this.scene.add(rail);
      rail = new THREE.Mesh(railGeoShort, railMat);
      rail.position.set(half - 0.1, y, 0);
      this.scene.add(rail);
    }
  }

  buildHouse() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(new THREE.BoxGeometry(18, 5.4, 10), toon(COLORS.house));
    body.position.set(0, 2.7, 32);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // gable roof extruded along x
    const shape = new THREE.Shape();
    shape.moveTo(-5.9, 0);
    shape.lineTo(5.9, 0);
    shape.lineTo(0, 3.3);
    shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 19.4, bevelEnabled: false });
    const roof = new THREE.Mesh(roofGeo, toon(COLORS.roof));
    roof.rotation.y = Math.PI / 2;
    roof.position.set(-9.7, 5.35, 32);
    roof.castShadow = true;
    group.add(roof);

    const trimMat = toon(0xf3ead6);
    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(19.6, 0.24, 0.3), trimMat);
    roofTrim.position.set(0, 5.35, 26.05);
    group.add(roofTrim);

    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.7, 0.16), toon(0x7a4a28));
    door.position.set(0, 1.35, 26.9);
    group.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), toon(0xffd85e));
    knob.position.set(0.55, 1.4, 26.8);
    group.add(knob);

    const winGlass = toon(0x9fd6ef, { emissive: 0x2c5a70, emissiveIntensity: 0.25 });
    const winFrame = toon(0xf6efdd);
    const addWindow = (x, y) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 0.12), winFrame);
      f.position.set(x, y, 26.94);
      group.add(f);
      const g = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.14), winGlass);
      g.position.set(x, y, 26.9);
      group.add(g);
      const barV = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.2, 0.16), winFrame);
      barV.position.set(x, y, 26.88);
      group.add(barV);
      const barH = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.09, 0.16), winFrame);
      barH.position.set(x, y, 26.88);
      group.add(barH);
    };
    addWindow(-5.8, 3.4);
    addWindow(5.8, 3.4);
    addWindow(-5.8, 1.3);
    addWindow(5.8, 1.3);

    const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.2, 1.1), toon(0xa9553f));
    chimney.position.set(6.2, 7.4, 33.5);
    chimney.castShadow = true;
    group.add(chimney);

    const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.36, 1.5), toon(0xcbbfa6));
    step.position.set(0, 0.18, 26.2);
    group.add(step);

    this.scene.add(group);
  }

  makeTree(x, z, scale) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 2.8, 7), toon(0x8a5a34));
    trunk.position.y = 1.4;
    trunk.castShadow = true;
    g.add(trunk);

    const leafMat = toon(COLORS.leaf);
    const leafMat2 = toon(0x63b031);
    const blobs = [
      [0, 3.1, 0, 1.55, leafMat],
      [0.75, 2.6, 0.3, 1.05, leafMat2],
      [-0.7, 2.75, -0.25, 1.0, leafMat2],
      [0.1, 3.9, -0.1, 0.85, leafMat],
    ];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(b[3], 1), b[4]);
      m.position.set(b[0], b[1], b[2]);
      m.castShadow = true;
      g.add(m);
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    this.scene.add(g);
    this.addCollider(x, z, 0.55 * scale + 0.25);
  }

  buildTrees() {
    const inner = 20.6;
    this.makeTree(-inner, -inner, 1.15);
    this.makeTree(inner, -inner, 1.05);
    this.makeTree(-inner, inner * 0.55, 0.95);
    this.makeTree(inner + 0.5, inner * 0.5, 1.1);
    // outside the fence, for depth
    this.makeTree(-29, -12, 1.5);
    this.makeTree(30, -8, 1.35);
    this.makeTree(-30, 14, 1.25);
    this.makeTree(29, 20, 1.4);
    this.makeTree(-12, -31, 1.3);
  }

  buildTombs() {
    const spots = [
      [-10.5, -5.5, 0.2],
      [7.5, -9.5, -0.35],
      [-4.5, 4.5, 0.1],
      [11.5, 2.5, 0.5],
      [-14, 8.5, -0.2],
      [3.6, -16, 0.15],
    ];
    const mat = toon(COLORS.tomb);
    const matDark = toon(0x8e8d7c);
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.15, 0.26), mat);
      body.position.y = 0.575;
      body.castShadow = true;
      g.add(body);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.475, 0.475, 0.26, 12, 1, false, 0, Math.PI), mat);
      top.rotation.x = Math.PI / 2;
      top.rotation.z = Math.PI;
      top.position.y = 1.15;
      g.add(top);
      const engrave = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.05), matDark);
      engrave.position.set(0, 0.75, 0.14);
      g.add(engrave);
      const engrave2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.05), matDark);
      engrave2.position.set(0, 0.55, 0.14);
      g.add(engrave2);
      g.position.set(s[0], 0, s[1]);
      g.rotation.y = s[2];
      this.scene.add(g);
      this.addCollider(s[0], s[1], 0.55);
    }
  }

  buildMowers() {
    const red = toon(0xd6483a);
    const dark = toon(0x3f3f45);
    const gray = toon(0xbfc3c9);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.62), red);
      body.position.y = 0.42;
      body.castShadow = true;
      g.add(body);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.5), gray);
      deck.position.set(0, 0.68, 0);
      g.add(deck);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), dark);
      handle.position.set(0, 1.14, -0.28);
      handle.rotation.x = 0.42;
      g.add(handle);
      const wheelGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.1, 10);
      for (let w = 0; w < 4; w++) {
        const wheel = new THREE.Mesh(wheelGeo, dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(w < 2 ? -0.47 : 0.47, 0.17, w % 2 === 0 ? -0.28 : 0.28);
        g.add(wheel);
      }
      g.position.set(-7 + i * 7, 0, 20.6);
      g.rotation.y = rand(-0.15, 0.15);
      this.scene.add(g);
      this.addCollider(g.position.x, g.position.z, 0.55);
    }
  }

  buildSunflowers() {
    const petalGeos = [];
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.SphereGeometry(0.16, 6, 4);
      geo.scale(1, 0.45, 1.7);
      geo.translate(0, 0, 0.34);
      geo.rotateY((i / 10) * TAU);
      petalGeos.push(geo);
    }
    const merged = mergeSimple(petalGeos);
    const petalMat = toon(0xffd23f);
    const centerMat = toon(0x7a4a1f);
    const stemMat = toon(0x4f9c26);

    const spots = [[-21.5, -21], [21.5, -21.5], [22, 6]];
    for (let i = 0; i < spots.length; i++) {
      const g = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.5, 6), stemMat);
      stem.position.y = 0.75;
      g.add(stem);
      const head = new THREE.Mesh(merged, petalMat);
      head.position.set(0, 1.55, 0);
      head.rotation.x = -0.25;
      head.castShadow = true;
      g.add(head);
      const center = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), centerMat);
      center.position.set(0, 1.58, 0.06);
      center.scale.z = 0.5;
      g.add(center);
      g.position.set(spots[i][0], 0, spots[i][1]);
      g.rotation.y = rand(0, TAU);
      this.scene.add(g);
      this.addCollider(spots[i][0], spots[i][1], 0.4);
    }
  }

  buildGrassTufts() {
    const geo = new THREE.ConeGeometry(0.06, 0.26, 4);
    geo.translate(0, 0.13, 0);
    const mat = toon(0x5fa62f);
    const count = 520;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) {
      const x = rand(-22.5, 22.5);
      const z = rand(-22.5, 22.5);
      tmpPos.set(x, 0, z);
      tmpQuat.setFromEuler(tmpEuler.set(0, rand(0, TAU), rand(-0.25, 0.25)));
      const s = rand(0.6, 1.5);
      tmpScale.set(s, s, s);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMat);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  buildFlowers() {
    const geo = new THREE.SphereGeometry(0.075, 5, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const count = 110;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const palette = [0xff8fb1, 0xffe066, 0xffffff, 0xc78bff, 0xff7a5c];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const side = Math.floor(rand(0, 4));
      let x = rand(-22, 22);
      let z = rand(-22, 22);
      if (side === 0) z = rand(-22.8, -20.2);
      else if (side === 1) z = rand(20.2, 22.8);
      else if (side === 2) x = rand(-22.8, -20.2);
      else x = rand(20.2, 22.8);
      tmpPos.set(x, rand(0.16, 0.34), z);
      tmpQuat.identity();
      tmpScale.setScalar(rand(0.7, 1.4));
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMat);
      color.setHex(palette[Math.floor(Math.random() * palette.length)]);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
  }

  buildSkyProps() {
    const cloudMat = new THREE.SpriteMaterial({
      map: cloudTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false,
    });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(cloudMat);
      const a = (i / 6) * TAU + rand(-0.3, 0.3);
      const dist = rand(70, 110);
      s.position.set(Math.cos(a) * dist, rand(38, 62), Math.sin(a) * dist);
      s.scale.set(rand(26, 44), rand(12, 18), 1);
      s.material = s.material;
      this.scene.add(s);
    }

    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.75,
    }));
    sunSprite.position.set(74, 88, 42);
    sunSprite.scale.set(21, 21, 1);
    this.scene.add(sunSprite);
  }

  buildSign() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c99b62';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#7b4d24';
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, 494, 238);
    ctx.fillStyle = '#3b2410';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 54px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('戴夫的后院', 256, 92);
    ctx.font = '700 26px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = '#5a3a1c';
    ctx.fillText('DAVE\'S BACKYARD', 256, 160);
    ctx.font = '700 20px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('僵尸禁止入内', 256, 206);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;

    const g = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.3, 0.12),
      [toon(0x9a7746), toon(0x9a7746), toon(0x9a7746), toon(0x9a7746), new THREE.MeshToonMaterial({ map: tex }), toon(0x9a7746)]
    );
    board.position.y = 1.75;
    board.castShadow = true;
    g.add(board);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.8, 0.16), toon(0x7a5630));
    post.position.y = 0.9;
    g.add(post);
    g.position.set(-8.5, 0, 16.5);
    g.rotation.y = Math.PI + 0.32;
    this.scene.add(g);
    this.addCollider(-8.5, 16.5, 0.4);
  }
}

function mergeSimple(geos) {
  const merged = new THREE.BufferGeometry();
  let totalVerts = 0;
  let totalIdx = 0;
  for (let i = 0; i < geos.length; i++) {
    totalVerts += geos[i].attributes.position.count;
    totalIdx += geos[i].index ? geos[i].index.count : geos[i].attributes.position.count;
  }
  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const idx = new Uint16Array(totalIdx);
  let vOff = 0;
  let iOff = 0;
  for (let i = 0; i < geos.length; i++) {
    const g = geos[i];
    pos.set(g.attributes.position.array, vOff * 3);
    norm.set(g.attributes.normal.array, vOff * 3);
    const gi = g.index ? g.index.array : null;
    if (gi) {
      for (let k = 0; k < gi.length; k++) idx[iOff + k] = gi[k] + vOff;
      iOff += gi.length;
    } else {
      const n = g.attributes.position.count;
      for (let k = 0; k < n; k++) idx[iOff + k] = k + vOff;
      iOff += n;
    }
    vOff += g.attributes.position.count;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  return merged;
}
