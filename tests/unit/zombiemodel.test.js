import { describe, it, expect, vi } from 'vitest';

// ZombieModel.js 只做两件事：加载 glb 暴露 scene/clips，以及 findClip 按名取动画。
// 这里单独覆盖它，避免其余用例把 ZombieModel 整个 mock 掉后这段逻辑无人测。

describe('ZombieModel.findClip', () => {
  it('按名精确匹配，忽略大小写', async () => {
    const { findClip } = await import('../../src/entities/ZombieModel.js');
    const clips = [{ name: 'Idle' }, { name: 'Walk' }];
    expect(findClip(clips, 'idle')).toBe(clips[0]);
    expect(findClip(clips, 'walk')).toBe(clips[1]);
  });

  it('剥掉 CharacterArmature| 之类的前缀再匹配', async () => {
    const { findClip } = await import('../../src/entities/ZombieModel.js');
    const clips = [{ name: 'CharacterArmature|Idle_Attack' }, { name: 'Armature|Death' }];
    expect(findClip(clips, 'idle_attack')).toBe(clips[0]);
    expect(findClip(clips, 'death')).toBe(clips[1]);
  });

  it('找不到返回 null，不抛错', async () => {
    const { findClip } = await import('../../src/entities/ZombieModel.js');
    expect(findClip([], 'idle')).toBeNull();
    expect(findClip([{ name: 'Walk' }], 'death')).toBeNull();
    expect(findClip(undefined, 'idle')).toBeNull();
  });
});

describe('ZombieModel.initZombieModel', () => {
  it('加载成功后写入 scene 与 clips，并把 mesh 设为投射阴影', async () => {
    const THREE = await import('three');
    const gltfScene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    gltfScene.add(mesh);
    const animations = [{ name: 'Idle' }, { name: 'Walk' }];

    vi.resetModules();
    vi.doMock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
      GLTFLoader: class {
        load(url, onLoad) {
          onLoad({ scene: gltfScene, animations });
        }
      },
    }));
    const mod = await import('../../src/entities/ZombieModel.js');
    mod.initZombieModel();
    expect(mod.zombieModel.ready).toBe(true);
    expect(mod.zombieModel.failed).toBe(false);
    expect(mod.zombieModel.scene).toBe(gltfScene);
    expect(mod.zombieModel.clips).toBe(animations);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);

    // 归一化表以外（没有 targetHeight）的老模型不量包围盒
    expect(mod.zombieModel.box).toBeUndefined();

    // 只加载一次：再次调用不应替换 scene
    const before = mod.zombieModel.scene;
    mod.initZombieModel();
    expect(mod.zombieModel.scene).toBe(before);

    vi.doUnmock('three/examples/jsm/loaders/GLTFLoader.js');
    vi.resetModules();
  });

  it('targetHeight 模型加载后量出包围盒（巨人命中球靠它推）', async () => {
    const THREE = await import('three');
    const gltfScene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), new THREE.MeshBasicMaterial());
    gltfScene.add(mesh);
    mesh.position.y = 4;

    vi.resetModules();
    vi.doMock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
      GLTFLoader: class {
        load(url, onLoad) {
          onLoad({ scene: gltfScene, animations: [] });
        }
      },
    }));
    const mod = await import('../../src/entities/ZombieModel.js');
    mod.initZombieModel();
    const slot = mod.zombieModel.giant;
    expect(slot.ready).toBe(true);
    // 盒子 2×4×1 初始放在 y=4。量包围盒时它已按 1.85 归一化并被 fitToHeight 贴到地面，
    // 所以尺寸是 2×4×1 的等比缩小（比例才是巨人命中球真正用到的）
    expect(slot.box.size.y / slot.box.size.x).toBeCloseTo(2, 6);
    expect(slot.box.min.y).toBeCloseTo(0, 6);
    expect(slot.box.max.y).toBeCloseTo(slot.box.size.y, 6);
    vi.doUnmock('three/examples/jsm/loaders/GLTFLoader.js');
    vi.resetModules();
  });

  it('加载失败时置 failed 并给出警告', async () => {
    vi.resetModules();
    vi.doMock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
      GLTFLoader: class {
        load(url, onLoad, onProgress, onError) {
          onError(new Error('404'));
        }
      },
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('../../src/entities/ZombieModel.js');
    mod.initZombieModel();
    expect(mod.zombieModel.failed).toBe(true);
    expect(mod.zombieModel.ready).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.doUnmock('three/examples/jsm/loaders/GLTFLoader.js');
    vi.resetModules();
  });
});