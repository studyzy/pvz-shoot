import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZOMBIES } from '../config.js';
import { rand, TAU } from '../utils.js';

const cache = new Map();

const COL = {
  eye: 0xe9e6cf,
  pupil: 0x191d13,
  socket: 0x455134,
  mouth: 0x241610,
  teeth: 0xd8d2b2,
  tongue: 0x7c4141,
  shoe: 0x3a3138,
  sole: 0x272226,
  belt: 0x3d2b1c,
  buckle: 0xb9932f,
  tie: 0x9c2f26,
  blood: 0x5f1d16,
  cone: 0xe0662a,
  coneStripe: 0xf3efe2,
  bucket: 0x9aa1a8,
  bucketDark: 0x6f767d,
  rust: 0x7a4a2a,
  wood: 0x7d5733,
  woodDark: 0x5b3d22,
};

const HAIRS = [0x352b22, 0x463829, 0x2b2620];

// atlas cells: 512px each, 16px gutter, 480px inner
const S = 480 / 1024;
const UV_REG = {
  skin: [16 / 1024, 528 / 1024, S],
  cloth: [528 / 1024, 528 / 1024, S],
  pants: [16 / 1024, 16 / 1024, S],
  metal: [528 / 1024, 16 / 1024, S],
};
let curRegion = 'skin';

function setRegion(name) {
  curRegion = name;
}

function addPrim(list, geo, color, opts) {
  opts = opts || {};
  const pos = opts.pos || [0, 0, 0];
  const rot = opts.rot || [0, 0, 0];
  const scl = opts.scale || [1, 1, 1];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    q,
    new THREE.Vector3(scl[0], scl[1], scl[2])
  );
  geo.applyMatrix4(m);

  const reg = UV_REG[curRegion] || UV_REG.skin;
  const uv = geo.attributes.uv;
  if (uv) {
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, reg[0] + uv.getX(i) * reg[2], reg[1] + uv.getY(i) * reg[2]);
    }
  }

  const base = new THREE.Color(color);
  base.offsetHSL(rand(-0.012, 0.012), rand(-0.04, 0.04), rand(-(opts.jitter || 0.05), opts.jitter || 0.05));
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const noise = opts.noise === undefined ? 0.07 : opts.noise;
  for (let i = 0; i < n; i++) {
    const k = 1 + (Math.random() - 0.5) * noise;
    arr[i * 3] = base.r * k;
    arr[i * 3 + 1] = base.g * k;
    arr[i * 3 + 2] = base.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  list.push(geo);
}

function merge(list) {
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere();
  return g;
}

function shade(hex, dl) {
  return new THREE.Color(hex).offsetHSL(0, 0, dl).getHex();
}

/* ---------------- head ---------------- */

function buildHead(cfg, variant) {
  setRegion('skin');
  const L = [];
  const skin = cfg.skin;
  const skinDark = shade(skin, -0.08);
  const hair = HAIRS[variant % HAIRS.length];

  // neck
  addPrim(L, new THREE.CylinderGeometry(0.096, 0.112, 0.2, 10), skin, { pos: [0, 0.03, -0.005] });

  // skull
  addPrim(L, new THREE.SphereGeometry(0.245, 20, 16), skin, { pos: [0, 0.3, -0.012], scale: [1.03, 1.09, 1.0] });
  // jaw + chin
  addPrim(L, new THREE.SphereGeometry(0.185, 16, 12), skin, { pos: [0, 0.17, 0.05], scale: [0.95, 0.63, 0.86] });
  addPrim(L, new THREE.SphereGeometry(0.072, 12, 9), skin, { pos: [0, 0.085, 0.155], scale: [1.05, 0.82, 0.9] });

  // cheek bones
  addPrim(L, new THREE.SphereGeometry(0.072, 10, 8), skin, { pos: [-0.145, 0.235, 0.135], scale: [1, 0.9, 0.9] });
  addPrim(L, new THREE.SphereGeometry(0.072, 10, 8), skin, { pos: [0.145, 0.235, 0.135], scale: [1, 0.9, 0.9] });

  // brow ridge (angled, angry)
  addPrim(L, new THREE.BoxGeometry(0.118, 0.032, 0.05), skinDark, {
    pos: [-0.1, 0.385, 0.196], rot: [0.08, 0, -0.22], jitter: 0.03,
  });
  addPrim(L, new THREE.BoxGeometry(0.118, 0.032, 0.05), skinDark, {
    pos: [0.1, 0.385, 0.196], rot: [0.08, 0, 0.22], jitter: 0.03,
  });

  // eye sockets + sunken eyes
  const squint = variant === 1 ? -0.012 : 0;
  const eyeY = 0.327;
  addPrim(L, new THREE.SphereGeometry(0.082, 12, 10), COL.socket, {
    pos: [-0.102, eyeY - 0.004, 0.176], scale: [1.12, 1, 0.36], jitter: 0.03,
  });
  addPrim(L, new THREE.SphereGeometry(0.082, 12, 10), COL.socket, {
    pos: [0.102, eyeY + squint - 0.004, 0.176], scale: [1.12, 1, 0.36], jitter: 0.03,
  });
  addPrim(L, new THREE.SphereGeometry(0.042, 12, 10), COL.eye, { pos: [-0.1, eyeY, 0.186], jitter: 0.012 });
  addPrim(L, new THREE.SphereGeometry(0.042, 12, 10), COL.eye, { pos: [0.1, eyeY + squint, 0.186], jitter: 0.012 });
  addPrim(L, new THREE.SphereGeometry(0.021, 8, 6), COL.pupil, { pos: [-0.094, eyeY + 0.002, 0.215], jitter: 0.01 });
  addPrim(L, new THREE.SphereGeometry(0.021, 8, 6), COL.pupil, { pos: [0.106, eyeY + squint + 0.002, 0.215], jitter: 0.01 });
  // droopy eyelids (just the top third)
  addPrim(L, new THREE.SphereGeometry(0.05, 10, 8), skinDark, {
    pos: [-0.1, eyeY + 0.046, 0.19], scale: [1.2, 0.4, 0.55], jitter: 0.02,
  });
  addPrim(L, new THREE.SphereGeometry(0.05, 10, 8), skinDark, {
    pos: [0.1, eyeY + squint + 0.046, 0.19], scale: [1.2, 0.4, 0.55], jitter: 0.02,
  });

  // nose bridge + nose
  addPrim(L, new THREE.SphereGeometry(0.055, 10, 8), skinDark, {
    pos: [0, 0.315, 0.198], scale: [0.85, 1.75, 0.55], jitter: 0.025,
  });
  addPrim(L, new THREE.ConeGeometry(0.05, 0.13, 10), skin, {
    pos: [0, 0.262, 0.248], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.85],
  });

  // forehead wrinkles
  addPrim(L, new THREE.BoxGeometry(0.15, 0.012, 0.012), skinDark, {
    pos: [0, 0.462, 0.196], rot: [0.05, 0, 0], jitter: 0.02,
  });
  addPrim(L, new THREE.BoxGeometry(0.11, 0.01, 0.012), skinDark, {
    pos: [0, 0.492, 0.183], rot: [0.05, 0, 0], jitter: 0.02,
  });
  addPrim(L, new THREE.SphereGeometry(0.014, 6, 5), COL.mouth, { pos: [-0.024, 0.232, 0.281], jitter: 0.01 });
  addPrim(L, new THREE.SphereGeometry(0.014, 6, 5), COL.mouth, { pos: [0.024, 0.232, 0.281], jitter: 0.01 });

  // mouth cavity + lips
  const mouthX = variant === 2 ? 0.018 : 0;
  addPrim(L, new THREE.SphereGeometry(0.105, 14, 10), COL.mouth, {
    pos: [mouthX, 0.176, 0.174], scale: [1.05, 0.64, 0.38], jitter: 0.02,
  });
  addPrim(L, new THREE.TorusGeometry(0.096, 0.018, 6, 16), skinDark, {
    pos: [mouthX, 0.176, 0.203], scale: [1.03, 0.6, 0.9], jitter: 0.03,
  });
  // teeth
  for (let i = 0; i < 5; i++) {
    const x = -0.072 + i * 0.036 + mouthX;
    addPrim(L, new THREE.BoxGeometry(0.024, 0.026, 0.014), COL.teeth, {
      pos: [x, 0.2, 0.207], rot: [0, 0, rand(-0.16, 0.16)], jitter: 0.02,
    });
    if (i < 4) {
      addPrim(L, new THREE.BoxGeometry(0.022, 0.02, 0.012), COL.teeth, {
        pos: [-0.054 + i * 0.036 + mouthX, 0.152, 0.205], rot: [0, 0, rand(-0.12, 0.12)], jitter: 0.02,
      });
    }
  }
  addPrim(L, new THREE.SphereGeometry(0.038, 10, 8), COL.tongue, {
    pos: [mouthX, 0.158, 0.196], scale: [1.1, 0.4, 0.45], jitter: 0.02,
  });
  addPrim(L, new THREE.SphereGeometry(0.024, 6, 5), COL.blood, {
    pos: [mouthX + 0.075, 0.168, 0.215], scale: [0.9, 1.5, 0.4], jitter: 0.02,
  });

  // ears
  addPrim(L, new THREE.SphereGeometry(0.055, 10, 8), skin, { pos: [-0.258, 0.3, 0.005], scale: [0.42, 1.35, 0.95] });
  addPrim(L, new THREE.SphereGeometry(0.055, 10, 8), skin, { pos: [0.258, 0.3, 0.005], scale: [0.42, 1.35, 0.95] });
  addPrim(L, new THREE.SphereGeometry(0.03, 8, 6), skinDark, { pos: [-0.268, 0.3, 0.02], scale: [0.4, 1.1, 0.7], jitter: 0.02 });
  addPrim(L, new THREE.SphereGeometry(0.03, 8, 6), skinDark, { pos: [0.268, 0.3, 0.02], scale: [0.4, 1.1, 0.7], jitter: 0.02 });

  // sparse hair tufts around the back/top
  const tuftCount = 5 + (variant % 3);
  for (let i = 0; i < tuftCount; i++) {
    const a = -Math.PI * 0.05 - (i / (tuftCount - 1)) * Math.PI * 0.9;
    const r = 0.19;
    addPrim(L, new THREE.ConeGeometry(0.026, 0.09 + Math.random() * 0.05, 5), hair, {
      pos: [Math.cos(a) * r, 0.48 + Math.random() * 0.035, Math.sin(a) * r * 0.9 - 0.04],
      rot: [rand(-0.7, -0.2), 0, Math.cos(a) * -0.6],
      jitter: 0.06,
    });
  }
  addPrim(L, new THREE.SphereGeometry(0.03, 6, 5), hair, { pos: [-0.24, 0.36, 0.05], scale: [0.5, 1.6, 0.7] });
  addPrim(L, new THREE.SphereGeometry(0.03, 6, 5), hair, { pos: [0.24, 0.36, 0.05], scale: [0.5, 1.6, 0.7] });

  // grime / wounds
  addPrim(L, new THREE.SphereGeometry(0.06, 8, 6), COL.blood, {
    pos: [0.08, 0.16, 0.23], scale: [0.6, 0.5, 0.25], jitter: 0.02,
  });
  if (variant !== 1) {
    addPrim(L, new THREE.BoxGeometry(0.012, 0.1, 0.012), shade(COL.blood, -0.05), {
      pos: [0.09, 0.44, 0.2], rot: [0, 0, 0.5], jitter: 0.02,
    });
  }

  buildHat(L, cfg, variant);

  return merge(L);
}

function buildHat(L, cfg, variant) {
  setRegion('metal');
  if (cfg.acc === 'cone') {
    addPrim(L, new THREE.CylinderGeometry(0.34, 0.36, 0.035, 16), COL.cone, { pos: [0, 0.55, 0] });
    addPrim(L, new THREE.ConeGeometry(0.275, 0.52, 18), COL.cone, { pos: [0, 0.815, 0] });
    addPrim(L, new THREE.CylinderGeometry(0.2, 0.226, 0.07, 18, 1, true), COL.coneStripe, { pos: [0, 0.695, 0] });
    addPrim(L, new THREE.CylinderGeometry(0.11, 0.136, 0.06, 18, 1, true), COL.coneStripe, { pos: [0, 0.86, 0] });
    // dirt on the cone
    addPrim(L, new THREE.SphereGeometry(0.09, 8, 6), 0x6b4a2a, {
      pos: [0.12, 0.64, 0.16], scale: [1, 0.5, 0.4], jitter: 0.03,
    });
  } else if (cfg.acc === 'bucket') {
    addPrim(L, new THREE.CylinderGeometry(0.29, 0.265, 0.36, 18), COL.bucket, {
      pos: [0, 0.735, 0], jitter: 0.03,
    });
    addPrim(L, new THREE.TorusGeometry(0.288, 0.022, 5, 18), COL.bucketDark, {
      pos: [0, 0.915, 0], rot: [Math.PI / 2, 0, 0],
    });
    addPrim(L, new THREE.TorusGeometry(0.272, 0.018, 5, 18), COL.bucketDark, {
      pos: [0, 0.56, 0], rot: [Math.PI / 2, 0, 0],
    });
    // handle
    addPrim(L, new THREE.TorusGeometry(0.29, 0.016, 5, 12, Math.PI), COL.bucketDark, {
      pos: [0, 0.915, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    });
    // dents + rust
    addPrim(L, new THREE.SphereGeometry(0.085, 8, 6), COL.bucketDark, {
      pos: [0.19, 0.675, 0.16], scale: [1, 1.3, 0.4], jitter: 0.03,
    });
    addPrim(L, new THREE.SphereGeometry(0.06, 7, 5), COL.rust, {
      pos: [-0.16, 0.635, 0.21], scale: [1.3, 1, 0.35], jitter: 0.04,
    });
  } else if (cfg.acc === 'club') {
    setRegion('skin');
    addPrim(L, new THREE.SphereGeometry(0.05, 8, 6), COL.blood, {
      pos: [-0.1, 0.45, 0.16], scale: [1.4, 0.5, 0.4], jitter: 0.03,
    });
  }
  setRegion('skin');
}

/* ---------------- torso ---------------- */

function buildBody(cfg, variant) {
  setRegion('cloth');
  const L = [];
  const shirt = cfg.shirt;
  const shirtDark = shade(shirt, -0.06);
  const pants = cfg.pants;

  // pelvis / hips
  setRegion('pants');
  addPrim(L, new THREE.SphereGeometry(0.24, 16, 12), pants, { pos: [0, 0.0, 0], scale: [1.02, 0.78, 0.8] });
  setRegion('cloth');

  // torso cloth (lathe)
  const pts = [
    new THREE.Vector2(0.215, -0.205),
    new THREE.Vector2(0.245, -0.12),
    new THREE.Vector2(0.262, -0.02),
    new THREE.Vector2(0.278, 0.1),
    new THREE.Vector2(0.3, 0.24),
    new THREE.Vector2(0.318, 0.38),
    new THREE.Vector2(0.317, 0.5),
    new THREE.Vector2(0.286, 0.59),
    new THREE.Vector2(0.22, 0.645),
    new THREE.Vector2(0.15, 0.66),
  ];
  const torso = new THREE.LatheGeometry(pts, 20);
  addPrim(L, torso, shirt, { scale: [1, 1, 0.78], jitter: 0.035, noise: 0.05 });

  // collar
  addPrim(L, new THREE.TorusGeometry(0.135, 0.03, 6, 16), shirtDark, {
    pos: [0, 0.648, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.82], jitter: 0.03,
  });

  // chest opening (skin V)
  setRegion('skin');
  addPrim(L, new THREE.ConeGeometry(0.085, 0.16, 3), cfg.skin, {
    pos: [0, 0.56, 0.2], rot: [0.2, Math.PI, 0], scale: [1, 1, 0.35], jitter: 0.03,
  });
  setRegion('cloth');

  // buttons
  for (let i = 0; i < 3; i++) {
    addPrim(L, new THREE.SphereGeometry(0.012, 6, 5), 0x3a2f22, { pos: [0, 0.42 - i * 0.13, 0.248] });
  }

  // tie
  if (variant !== 2) {
    addPrim(L, new THREE.BoxGeometry(0.085, 0.06, 0.035), COL.tie, { pos: [0, 0.585, 0.235], rot: [0.1, 0, 0] });
    addPrim(L, new THREE.BoxGeometry(0.07, 0.26, 0.026), COL.tie, { pos: [0, 0.44, 0.25], rot: [0.06, 0, 0.02] });
    addPrim(L, new THREE.ConeGeometry(0.05, 0.1, 4), COL.tie, {
      pos: [0, 0.28, 0.255], rot: [Math.PI, Math.PI / 4, 0], scale: [1, 1, 0.4],
    });
  } else {
    // torn shirt showing skin
    setRegion('skin');
    addPrim(L, new THREE.SphereGeometry(0.11, 10, 8), cfg.skin, {
      pos: [0.1, 0.42, 0.21], scale: [1.2, 1.6, 0.4], jitter: 0.03,
    });
    setRegion('cloth');
  }

  // pocket
  addPrim(L, new THREE.BoxGeometry(0.1, 0.09, 0.012), shirtDark, { pos: [-0.15, 0.42, 0.238], rot: [0.1, -0.12, 0] });

  // belt
  addPrim(L, new THREE.CylinderGeometry(0.252, 0.252, 0.06, 18), COL.belt, {
    pos: [0, 0.0, 0], scale: [1, 1, 0.8], jitter: 0.02,
  });
  setRegion('metal');
  addPrim(L, new THREE.BoxGeometry(0.09, 0.07, 0.03), COL.buckle, { pos: [0, 0.0, 0.205], jitter: 0.02 });
  setRegion('cloth');

  // tattered hem
  const strips = 7;
  for (let i = 0; i < strips; i++) {
    const a = (i / strips) * TAU;
    const x = Math.cos(a) * 0.24;
    const z = Math.sin(a) * 0.19;
    addPrim(L, new THREE.ConeGeometry(0.04, 0.09 + Math.random() * 0.05, 3), shirtDark, {
      pos: [x, -0.235, z], rot: [Math.PI, rand(-0.2, 0.2), rand(-0.2, 0.2)], jitter: 0.05,
    });
  }

  // blood / dirt on the shirt

  return merge(L);
}

/* ---------------- limbs ---------------- */

function buildUpperArm(cfg, variant) {
  setRegion('cloth');
  const L = [];
  const shirt = cfg.shirt;
  addPrim(L, new THREE.SphereGeometry(0.102, 12, 10), shirt, { pos: [0, -0.005, 0], jitter: 0.04 });
  addPrim(L, new THREE.CylinderGeometry(0.098, 0.115, 0.17, 12), shirt, { pos: [0, -0.07, 0], jitter: 0.04 });
  addPrim(L, new THREE.CylinderGeometry(0.105, 0.098, 0.03, 12), shade(shirt, -0.08), { pos: [0, -0.165, 0], jitter: 0.04 });
  setRegion('skin');
  addPrim(L, new THREE.CapsuleGeometry(0.072, 0.17, 4, 10), cfg.skin, { pos: [0, -0.2, 0] });
  return merge(L);
}

function buildLowerArm(cfg, variant, boss) {
  setRegion('skin');
  const L = [];
  addPrim(L, new THREE.CapsuleGeometry(0.062, 0.18, 4, 10), cfg.skin, { pos: [0, -0.135, 0] });
  // hand
  addPrim(L, new THREE.SphereGeometry(0.07, 10, 8), cfg.skin, { pos: [0, -0.3, 0.01], scale: [0.95, 1.05, 0.65] });
  for (let i = 0; i < 4; i++) {
    const x = -0.045 + i * 0.03;
    addPrim(L, new THREE.CapsuleGeometry(0.014, 0.058, 3, 6), cfg.skin, {
      pos: [x, -0.365, 0.015], rot: [0.15, 0, (i - 1.5) * 0.06], jitter: 0.03,
    });
  }
  addPrim(L, new THREE.CapsuleGeometry(0.016, 0.06, 3, 6), cfg.skin, {
    pos: [-0.055, -0.325, 0.02], rot: [0.2, 0, 0.9], jitter: 0.03,
  });
  // torn sleeve cuff on the wrist? no

  if (boss) {
    setRegion('metal');
    addPrim(L, new THREE.CylinderGeometry(0.05, 0.06, 0.52, 9), COL.wood, {
      pos: [0, -0.6, 0.02], rot: [0.28, 0, 0.05], jitter: 0.05,
    });
    addPrim(L, new THREE.CylinderGeometry(0.085, 0.1, 0.22, 9), COL.woodDark, {
      pos: [0, -0.86, 0.17], rot: [0.28, 0, 0.05], jitter: 0.05,
    });
    for (let i = 0; i < 3; i++) {
      addPrim(L, new THREE.ConeGeometry(0.032, 0.07, 5), 0xcfc3ae, {
        pos: [Math.cos(i * 2.1) * 0.075, -0.8 - (i % 2) * 0.08, 0.22 + Math.sin(i * 2.1) * 0.06],
        rot: [0.9, 0, i * 2], jitter: 0.03,
      });
    }
  }
  return merge(L);
}

function buildUpperLeg(cfg, variant) {
  setRegion('pants');
  const L = [];
  addPrim(L, new THREE.CapsuleGeometry(0.098, 0.24, 4, 10), cfg.pants, { pos: [0, -0.2, 0], jitter: 0.04 });
  // torn knee patch
  addPrim(L, new THREE.SphereGeometry(0.05, 8, 6), shade(cfg.pants, -0.08), {
    pos: [0.06, -0.36, 0.08], scale: [1.2, 1, 0.4], jitter: 0.03,
  });
  return merge(L);
}

function buildLowerLeg(cfg, variant) {
  setRegion('pants');
  const L = [];
  addPrim(L, new THREE.CapsuleGeometry(0.08, 0.22, 4, 10), cfg.pants, { pos: [0, -0.16, 0], jitter: 0.04 });
  addPrim(L, new THREE.CylinderGeometry(0.088, 0.082, 0.06, 10), shade(cfg.pants, -0.07), { pos: [0, -0.3, 0], jitter: 0.03 });
  // shoe
  setRegion('metal');
  addPrim(L, new THREE.SphereGeometry(0.1, 10, 8), COL.shoe, { pos: [0, -0.36, 0.06], scale: [0.78, 0.5, 1.45], jitter: 0.03 });
  addPrim(L, new THREE.BoxGeometry(0.17, 0.04, 0.3), COL.sole, { pos: [0, -0.398, 0.06], jitter: 0.02 });
  addPrim(L, new THREE.BoxGeometry(0.16, 0.05, 0.1), COL.shoe, { pos: [0, -0.33, -0.07], jitter: 0.03 });
  return merge(L);
}

/* ---------------- public ---------------- */

export function getZombieRig(type, variant) {
  const key = type + ':' + variant;
  if (cache.has(key)) return cache.get(key);
  const cfg = ZOMBIES[type] || ZOMBIES.normal;
  const boss = type === 'boss';
  const rig = {
    head: buildHead(cfg, variant),
    body: buildBody(cfg, variant),
    armUpper: buildUpperArm(cfg, variant),
    armLower: buildLowerArm(cfg, variant, false),
    armLowerClub: boss ? buildLowerArm(cfg, variant, true) : null,
    legUpper: buildUpperLeg(cfg, variant),
    legLower: buildLowerLeg(cfg, variant),
  };
  cache.set(key, rig);
  return rig;
}

export function zombieVariantCount(type) {
  return type === 'boss' ? 1 : 3;
}
