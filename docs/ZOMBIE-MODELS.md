# 僵尸 3D 模型资源调研

> 调研日期：2026-10-29。目标：给本项目找**能直接下载进仓库**的现成僵尸模型，替换/扩充当前 `public/models/zombie.glb`。
> 所有候选都已实际下载并使用项目自带的 three.js `GLTFLoader` 加载验证（三角面、骨骼、动画、包围盒均为实测值）。

---

## 结论先行

**推荐 Quaternius `Zombie_Basic`（CC0 1.0）**，两个等价来源：GitHub 上的 `Zombie_Basic.gltf`，或 Poly Pizza 的 `c4002f69.glb`（实测加载结果完全一致）。理由：

- **CC0 1.0 公共领域**：无需署名、可商用、可再分发，最省心。
- **带 50 根骨骼 + 16 段动画**（Idle / Walk / Run / Idle_Attack / Death / HitReact / Crawl 等），能彻底解决 AGENTS.md 第 8 节记的"僵尸 glb 没有骨骼、腿靠顶点着色器假蒙皮、脚会滑步"这个已知限制。
- 实测 7,822 三角面、单张图集贴图，量级与当前模型（6,258 面）相当。
- 加载后包围盒高 **1.194 米**，与当前模型 1.108 米接近，`ZOMBIE_SCALE` 只需微调。

**配套第二种僵尸 `Zombie_Chubby`（同样 CC0）**：6,174 面、实测高 1.494 米，**共享完全相同的 16 条动画名**——一套 `AnimationMixer` 逻辑就能驱动两种僵尸，只多一个模型文件就多出一种怪，性价比最高。

**已明确排除**：Kenney 的 `character-zombie.glb` 虽 CC0 且只有 1,078 面，但 `skins=0`（6 个部件靠节点关键帧动），用不了骨骼蒙皮且会变成 6 draw call/只；Mixamo 模型禁止再分发；hytopia 的僵尸资产平台独占禁再分发。

---

## 候选对比（全部实测）

| 候选 | 作者 / 许可 | 大小 | 三角面 | 骨骼 | 动画 | 加载后高 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **c4002f69** | Quaternius / **CC0 1.0** | 959 KB | 7,822 | 50 | 16 段 | 1.194 m | ⭐ **首选** |
| af74108f | Quaternius / **CC0 1.0** | 233 KB | 3,550 | 12 | 7 段 | 2.735 m | 备选（最轻） |
| cf4368cf | Quaternius / CC-BY 3.0 | 665 KB | 6,174 | 50 | 16 段 | 1.517 m | 可用，需署名 |
| 972d277d | Quaternius / CC-BY 3.0 | 678 KB | 2,116 | 有 | 5 段 | 7.6 cm（内建 107× 缩放） | 可用，需署名 |
| **Zombie_Chubby** | Quaternius / **CC0 1.0** | 1.67 MB | 6,174 | 50 | 16 段 | 1.494 m | ⭐ 做第二种（胖）僵尸，**共享同一套动画名** |
| Skeleton_Minion | KayKit / CC0 1.0 | 4.8 MB → **1.4 MB** | 5,288 | 41 | 95 段 → 保留 13 段 | 2.166 m | ✅ **已接入**，见下节 |
| 876274d0 | joney_lol / CC-BY 3.0 | 76 KB | 884 | 无 | 无 | — | 静态摆件，做不了动画 |
| 8181fd4f | bachosoftdesign / CC-BY 3.0 | 2.1 MB | 2,157 | 49 (Mixamo) | 13 段 | 4.47 m | ❌ **`SupporterOnly: true`，仅限赞助者，不能用** |
| character-zombie | Kenney / CC0 | 240 KB | 1,078 | **skins=0** | 32 段节点关键帧 | — | ❌ 无骨骼蒙皮，6 个部件 = 6 draw call/只 |
| 4af8f342 | — / — | 172 KB | 2,231 | 无 | 无 | — | 9 个材质 9 个 draw call，浪费 |
| 当前 zombie.glb | 项目内 | 357 KB | 6,258 | **无** | 无 | 1.108 m | 无骨骼，靠假蒙皮 |

> 已排除：`hytopiagg/hytopia-source` 的 `zombies-fps` 虽仓库 MIT，但 `assets/LICENSE.md` 限定**平台独占、禁止在其它引擎/站点/开源仓库使用**——典型的「看起来 MIT 其实资产另有许可」陷阱。另有多个仓库（afarber/godotcraft、mplewis/godot-fps、r-pathak/shooting_scary_shit 等）的 `zombie.glb` 实为 **Git LFS 指针文件**（130–133 B），raw 拿不到真模型。

---

## 下载地址

**推荐用 GitHub 源**（有独立 LICENSE 佐证、不易单点失效）：

```bash
# ⭐ 首选：Quaternius Zombie_Basic，CC0 1.0，单文件全内嵌（buffer base64 + 贴图在 bufferView）
curl -sL -o public/models/zombie-basic.gltf \
  https://raw.githubusercontent.com/rishipr/der-koloss-ce/main/assets/models/zombies/Zombie_Basic.gltf
# 备份源（字节级相同，1,703,033 B）：
#   https://raw.githubusercontent.com/ruiguitos/horde-breaker/master/assets/models/quaternius_zombie_apocalypse/enemies/Zombie_Basic.gltf

# 第二种僵尸（胖僵尸），同套 16 条动画
curl -sL -o public/models/zombie-chubby.gltf \
  https://raw.githubusercontent.com/rishipr/der-koloss-ce/main/assets/models/zombies/Zombie_Chubby.gltf
```

> `rishipr/der-koloss-ce` 的 `NOTICE.md` 明确标注 "zombie meshes → Quaternius, CC0 1.0, no attribution required"，许可证语义比个人仓库更清晰。
> ⚠️ **只取 `assets/models/zombies/` 下的模型文件**：该仓库的 `beauty-of-annihilation.mp3` 是 Activision 版权音频，**不要整仓搬运**。

备选（Poly Pizza 直链，同为 CC0 1.0）：

```
curl -sL https://static.poly.pizza/c4002f69-6979-42e8-ad6e-2f4e14fc3a9d.glb -o zombie-animated.glb
# 模型页：https://poly.pizza/m/22K0aSZkHV
```

- Quaternius 原始包（FBX/OBJ/Blend，同样 CC0）：<https://quaternius.com/packs/zombieapocalypsekit.html>，下载走 Google Drive，**不是 GLB**。

---

## 接入前必须改的地方

按 AGENTS.md 5.3「换模型必须重新确认这四条」逐条核对（已实测）：

| 约定 | 当前 `zombie.glb` | `c4002f69` 实测 | 处理 |
| --- | --- | --- | --- |
| Y 轴向上 | 几何体 **Z-up**（节点挂 +90° X 旋转） | 节点 `CharacterArmature` 带 -90° X 旋转 + 100× 缩放，**加载后已是 Y-up** | ✅ 直接可用 |
| 面朝 +Z | ✅ | 需实机确认朝向 | 若背对，`Zombie.buildRig` 里加 180° 偏航 |
| 脚底在 y=0 | ✅ | 包围盒 min.y = -0.009（≈0） | ✅ 直接可用 |
| 模型原始高 | 1.108 m | **1.194 m** | `ZOMBIE_SCALE` 从 `1.67` 改为约 `1.55`（≈1.85 m） |

连带要改：

1. **`src/entities/ZombieModel.js`**：除了 `ZOMBIE_SCALE`，还要导出 `gltf.animations`，因为现在只存了 `scene`。
2. **`src/entities/Zombie.js` `buildRig()`**：现在用 `scene.clone(true)` + 顶点着色器假蒙皮（`WALK_CHUNK` / `patchWalkShader`）。换成带骨骼模型后，**必须改用 `THREE.SkeletonUtils.clone()`**（`three/examples/jsm/utils/SkeletonUtils.js`），否则 `clone(true)` 出来的骨骼共享同一套骨骼，14 只僵尸会一起动。同时删掉 `patchWalkShader` 和 `customDepthMaterial` 里那套顶点补丁，改成每只僵尸一个 `AnimationMixer`，播放 `Idle`/`Walk`/`Idle_Attack`/`Death`/`HitReact`。
3. **`src/entities/Zombie.js` 命中球**：模型变高（1.108→1.194），`getChest` / `getHead` 的高度要等比调整（当前胸口 0.95×scale、头部 1.45×scale）。**头部球半径必须仍小于身体球**，否则爆头判定会失效。
4. **`buildHat()`**：交通锥/铁桶/Boss 木棒是按旧模型头顶 `y≈1.0` 硬编码的，新模型头顶约 1.09，坐标要重算。或者更好的做法——新骨骼里有 `Head` 关节，直接把配件挂到 `Head` 骨骼上，跟着头一起动。
5. **draw call**：新模型是 2 个 skinned mesh（`Zombie` + `Eyelid`），比当前 1 个多 1 个；`Eyelid` 只有 8 个三角形，可以接受，但要知道同屏 14 只时多了 14 个 draw call。
6. **性能风险**：骨骼动画比顶点着色器假蒙皮贵（每帧 CPU 求骨骼矩阵）。同屏 14 只 × 50 骨骼需要实测帧率，移动端尤其要看。**建议先只给 Boss 和少数类型换新模型**，普通僵尸保留现在的单网格方案，稳了再全量替换。

---

## 许可证说明

- **CC0 1.0**（首选的 c4002f69 和备选 af74108f）：<https://creativecommons.org/publicdomain/zero/1.0/>。作者放弃了全部权利，**不需要署名**，可直接进仓库。出于礼貌仍建议在 `docs/GAMEPLAY.md` 或 README 的致谢里写一句 "Zombie model by Quaternius (CC0)"。
- **CC-BY 3.0**（cf4368cf / 972d277d / 876274d0）：<https://creativecommons.org/licenses/by/3.0/>。**必须署名**，需在游戏内或 README 可见处标注作者与许可证。
- **8181fd4f 不可用**：Poly Pizza 页面元数据明确写了 `"SupporterOnly": true`，是付费赞助者专属内容，不能下载使用。

---

## 其他调研过的方向（供参考）

- **GitHub 上的开源僵尸游戏**：`rishipr/der-koloss-ce`（MIT，19 star）与 `ruiguitos/horde-breaker` 都带了 Quaternius 僵尸的 `.gltf` 版本（见下节）。
- **Kenney**：有 `Animated Characters` 系列，但角色是现代人/机器人风格，**没有僵尸**；`Graveyard Kit` 里的 `character-zombie.glb` **没有 skin**（靠节点关键帧动部件），Three.js 当不了骨骼蒙皮用，不建议。
- **KayKit**：`KayKit-Character-Pack-Skeletons-1.0` 的 `Skeleton_Minion.glb` 已接入为**雪地专属精英怪**，详见下节。
- **Sketchfab / Mixamo**：质量高但不是可再分发许可（Sketchfab 多为 CC-BY 但需逐个确认，且要登录下载；Mixamo 的模型**禁止再分发**，只能用于自己的项目，不适合进仓库）。
- **glTF-Sample-Assets**（Khronos 官方）：没有僵尸模型，只有 `CesiumMan` 这类演示角色。

---

## 同一模型的 Git 镜像（`.gltf` 版本）

除 Poly Pizza 的 `.glb` 外，社区仓库里还有**同一套 Quaternius 僵尸**的 `.gltf` 单文件版本，可作备份源（防 Poly Pizza 单点失效）：

```
# horde-breaker 镜像：1,703,033 B，单文件全内嵌（buffer base64 + 贴图 bufferView），外部依赖 0
https://raw.githubusercontent.com/ruiguitos/horde-breaker/master/assets/models/quaternius_zombie_apocalypse/enemies/Zombie_Basic.gltf
# 同目录 Zombie_Chubby.gltf：6,174 面、同样 CC0 / 16 动画，可作第二种僵尸

# der-koloss-ce 镜像：字节级相同（同为 1,703,033 B），NOTICE.md 明确标注模型来自 Quaternius CC0
https://raw.githubusercontent.com/rishipr/der-koloss-ce/main/assets/models/zombies/Zombie_Basic.gltf
```

**已实测：这份 `.gltf` 与 Poly Pizza 的 `c4002f69.glb` 在 Three.js 里加载结果完全等价**——同为 7,822 三角面、2 个 skinned mesh、50 骨骼、16 条动画（`Crawl/Death/HitReact/Idle/Idle_Attack/Jump/Jump_Idle/Jump_Land/No/Punch/Run/Run_Arms/Run_Attack/Walk/Wave/Yes`）、包围盒 `y=-0.009..1.185`。两者只是导出管线不同（`Khronos glTF Blender I/O` vs `FBX2glTF`），接入代码完全一致。

> ⚠️ **高度口径提醒**：网上能查到的 1.362 m 是**未应用骨骼绑定姿态**的原始网格跨度（`z 跨度 × 100 缩放`）。Three.js 里 `Box3.setFromObject()` 实测得到的是 **1.194 m**，算 `ZOMBIE_SCALE` 必须用后者。同理 `Zombie_Chubby` 的 1.640 m 口径下实测为 **1.494 m**。

> 注：两份 `.gltf` 与 Poly Pizza 的 `.glb` 加载后动画集合完全一致（`.glb` 里 32 条动画含 16 条 `CharacterArmature|` 前缀重复项，去重后同为 16 条）。节点名不同（`Cube.000`/`Cube.004` vs `Zombie`/`Eyelid`）仅为导出管线差异。

---

## ⚠️ 许可证核实：Quaternius 已改用 QAL v1.0（2026-08-28）

**这是本调研最重要的法律发现，直接影响"能不能把模型提交进公开仓库"。**

### 现状

Quaternius 官网 [license.html](https://quaternius.com/license.html) 已不再是 CC0，改为 **Quaternius Asset License (QAL) v1.0**（最后更新 **2026-08-28**）。原文要点：

- **§2 允许**：个人/教育/商用；修改；**嵌入 Product**；发布、分发、销售 Product；**无需署名**。
- **§3a 禁止**：*"You may not extract, repackage, sublicense, sell, or otherwise redistribute the Assets (in original or modified form) as a standalone asset, asset pack, stock file, template, or similar product, whether for free or for payment, and whether alone or bundled with other assets. This restriction applies regardless of how much the Assets have been modified."*
- **§7 关键条款**：*"Changes will not apply retroactively to Assets you've already obtained under an earlier version; the version in effect at the time you obtained the Assets governs your use of them."*

### 对本项目的实际结论

同一个资产存在**两条许可路径**，要分开看：

| 来源 | 声明的许可 | 判断 |
| --- | --- | --- |
| **Poly Pizza `/m/VlXjG0N8Eg`** | 页面 JSON `"Licence":"CC0 1.0"`，**上传日期 2024-03-17** | ✅ 早于 QAL（2026-08-28），**CC0 1.0 有效且不可撤销**。按 §7，QAL 不溯及既往 |
| **quaternius.com 官方包** | 今天下载 → 受 **QAL v1.0** 约束 | ⚠️ §3a 禁止"以独立资产形式再分发"。**把模型原样提交进公开仓库属于灰色地带** |

### 建议（本仓库是 PUBLIC + GitHub Pages）

因为仓库公开、且 `public/models/` 会原样发布到 Pages，**优先走 CC0 那一份**（Poly Pizza `c4002f69.glb`），并在 `public/models/` 旁放 `LICENSE-zombie.txt` 记录：

```
Zombie model by Quaternius (https://quaternius.com)
Licensed under CC0 1.0 Universal (Public Domain Dedication)
  https://creativecommons.org/publicdomain/zero/1.0/
Obtained from: https://poly.pizza/m/VlXjG0N8Eg (uploaded 2024-03-17, CC0 1.0)
Retrieved: 2026-10-29
```

> 保守做法：即使走 CC0 源，也可在 `.gitignore` 里排除模型、改为构建时拉取；但这对 Pages 部署不现实，CC0 那份足够安全。
> **不要**用 `quaternius.com` 官方 Drive 里今天下载的包进公开仓库——那受 QAL §3a 约束。若要更多变种（4 敌 + 4 可玩角色 + 狗），届时只在 **dist 构建产物**中使用，或让仓库保持私有。

---

## 压缩注意（重要，别踩坑）

原始文件 1.7 MB（现模型 357 KB 的 4.8 倍），按 5.3 的流程压缩时：

- ✅ **可以** `webp`（把内嵌图集转 WebP）、可 `resize 512`
- ❌ **不要 `simplify`**：会破坏蒙皮权重（`JOINTS_0`/`WEIGHTS_0`），模型会烂掉。7,822 面本身不高，不需要减面。
- ❌ **不要 `weld` 后直接提交**前先验证动画仍正常（焊接可能影响蒙皮接缝）。
- 压缩后体积**必须实测**确认，别按估值拍板。

另外贴图是**单张图集**（`Zombie_Atlas`，内嵌 bufferView）。5.2 里「每个僵尸克隆材质做白闪/冰冻」的逻辑照旧可用，但将来做换色皮肤要考虑图集 UV 共用问题。

---

## 建议的落地路径

1. 先下载 `c4002f69` 放进 `public/models/zombie-animated.glb`，用 `GLTFLoader` 在浏览器里加载，实机确认朝向、缩放、动画名。
2. 按上面第 1–5 条改 `ZombieModel.js` 和 `Zombie.js`，**先用 `SkeletonUtils.clone` 跑通一只**，别急着替换全部。
3. 用 `__game.zombies.startWave(10)` 压测同屏 14 只，看 `renderer.info.render` 的 draw call 和实际帧率（尤其 iPhone）。
4. 帧率过关再全量替换；不过关就退回「Boss/重装僵尸用骨骼模型，普通僵尸保持单网格」的混合方案。

---

## 附：骷髅（KayKit Skeleton_Minion）的接入决策

骷髅**完全可以出现在游戏里**，不必拘泥于"必须是僵尸"——PVZ 本来就有墓碑和墓园元素，雪地图也很适合亡灵。

### 实测规格

| 项 | 值 |
| --- | --- |
| 许可 | **CC0 1.0**（Kay Lousberg，署名非强制） |
| 原始体积 | 4.81 MB / 95 段动画 |
| 裁剪后 | **1.4 MB / 13 段动画**（`public/models/skeleton.glb`） |
| 三角面 | 5,288（比僵尸 7,822 还省） |
| 骨骼 | 41 根 |
| 高度 | 2.166 m，按 `SKELETON_SCALE = 0.9` 渲染为约 1.95 m |

保留的动画：`Idle / Idle_Combat / Walking_A / Walking_B / Running_A / 1H_Melee_Attack_Chop / 1H_Melee_Attack_Slice_Horizontal / Death_A / Death_B / Hit_A / Hit_B / Spawn_Ground_Skeletons / Skeletons_Awaken_Floor`

后两段（从土里钻出、从地上爬起）**没有在普通流程里用**，将来做"墓地里爬出来"的登场演出可以直接拿。

### 关键约束：draw call

这套模型把身体拆成 **9 个独立蒙皮网格**（左右臂 / 躯干 / 斗篷 / 眼睛 / 头 / 下巴 / 左右腿），所以：

| | Quaternius 僵尸 | KayKit 骷髅 |
| --- | --- | --- |
| 单实例 draw call | **2** | **9** |
| 同屏 14 只（全用） | 28 | **126** |

**这是"限量"的根本原因，和题材无关。** 试过用 `gltf-transform join` 合并，官方工具对蒙皮网格不生效（骨骼动画的节点绑定限制了合并）；手写合并器在蒙皮权重重映射上会破坏数据，已放弃。

### 落地方式

- `config.js` 的 `ZOMBIES.skeleton`：hp 210 / speed 1.75 / damage 18 / score 450 / radius 0.5，`model: 'skeleton'`
- `SKELETON_MAX_ALIVE = 3`：同屏硬上限，超限时 `spawnOne` 改刷别的类型，骷髅留在队列下次再刷
- `SKELETON_MAPS = ['snow']`：只在雪地图出现（墓园氛围），其它地图 `startWave` 时直接滤掉
- 骷髅 glb 加载失败时不会报错崩溃，只是不刷这类怪
- 波次公式：第 4 波起每波 `1 + floor((n-4)*0.5)` 只，封顶 3 只

### 验证

- `npm test`：791 用例全绿，含骷髅专项（模型切换、动作名映射、同屏上限、地图白名单、模型未就绪时不刷）
- `npm run test:e2e`：7/7 场景通过，其中 `skeleton` 场景在真浏览器验证——雪地图刷出骷髅、9 个蒙皮网格、材质 2 种、`Walking_A` 正确匹配、骨骼每只独立、同屏不超 3 只。实测 draw call 165 / 11.6 万三角面（14 只混编）。

---

## 附：炼金僵尸（`public/models/alchemist.glb`，项目内 AIGC 资产）

第三套模型，由仓库所有者提供的 AIGC 模型 `aigc/3_moved.fbx`（Kaydara FBX 7400，38.4 MB）转制。**来源与再分发授权由仓库所有者确认**：如果这份 FBX 来自第三方生成平台，需要按该平台条款确认能否随公开仓库分发。

### 原始规格（实测）

| 项 | 值 |
| --- | --- |
| 三角面 | **499,804**（249,824 顶点，单个蒙皮网格、单材质） |
| 骨骼 | 22 根（`bone_0`…`bone_21`，**没有语义名**） |
| 动画 | **0 段**（FBX 里没有 AnimStack / AnimCurve，只有绑定姿态） |
| 贴图 | 4 × 2048²（baseColor / metallic-roughness / roughness / normal） |
| 原始高 | 1.077 m（Q 版大头身，脚底 y≈0，Blender 里面朝 -Y） |

### 处理管线（可复现）

Blender 4.2 headless（`pip install bpy==4.2.23`；缺 `libSM/libICE` 时用 `dnf download` 解包到本地再 `LD_LIBRARY_PATH`）：

1. **抽面**：`Decimate(COLLAPSE, ratio = 10000/499804, use_collapse_triangulate)` → **9,999 面**。
   ⚠️ **蒙皮网格不能用 `gltf-transform simplify`**（会破坏 `JOINTS_0/WEIGHTS_0`），Blender 的 Decimate 会保留顶点组与 UV。
2. **贴图**：baseColor → 1024 JPEG q88（237 KB）；normal → 512 PNG（248 KB）；metallic-roughness **整张丢掉**，改常数 `metalness 0 / roughness 0.72`。
3. **动画**：骨骼没名字，按 rest 位置推断角色 —— `bone_0` 骨盆、`1-3` 脊柱、`4-5` 颈头、`6-9` / `10-13` 左右臂、`14-17` / `18-21` 左右腿；再用"把世界轴旋转换算到骨骼局部空间"的方式程序化 K 帧，生成 5 段动作。
4. **导出**：`export_animation_mode='ACTIONS'`、`export_yup=True`、GLB 内嵌贴图。

结果：**9,999 面 / 22 骨骼 / 5 段动画 / 1.3 MB**（对比：僵尸 7,822 面 660 KB，骷髅 5,288 面 1.4 MB）。

### 动画命名（关键）

导出的 clip 名**故意对齐 Quaternius**：`Idle` / `Walk` / `Idle_Attack` / `Death` / `HitReact`。这样 `Zombie.buildAnimations()` 里非骷髅的分支**一行都不用改**，`findClip()` 去掉前缀后直接命中。

动作内容：Idle 48 帧呼吸+摇头、Walk 24 帧迈步+摆臂+身体起伏、Idle_Attack 30 帧抬手砸下、HitReact 10 帧后仰、Death 36 帧后仰倒地。攻击节奏仍由代码的 `attackTimer`（1.28 s）控制，动画只是表现层。

### 接入约定

- **归属**：`ZOMBIES.normal.model = 'alchemist'` —— 它是**普通僵尸**的模型（场上最多）；橄榄球用 `football.glb`（见下节）；路障/铁桶/气球继续用 `zombie.glb`，锥帽/铁桶/气球按那个模型头顶尺寸挂，不要互换。
- `MODELS.alchemist = { url: 'models/alchemist.glb', scale: 1.72, height: 1.85 }`：1.077 × 1.72 ≈ 1.85 m，和原普通僵尸同高（Q 版头大，肩线会低一截，这是模型本身的风格）。
- **命中球单独一套口径**：`HIT.alchemist = { chest: 0.83, head: 1.44, radius: 0.85 }`（**世界米**：1.077 × 1.72 换算过，不是模型本地单位）。Q 版头大，头心只有 1.44 而不是普通僵尸的 1.52。
- 一个 `SkinnedMesh` = **1 个 draw call**，比骷髅省；但它 1 万面，是原僵尸的 1.28 倍，而它现在是**主力怪**：同屏 14 只全普通时约 15 万三角面（E2E 实测 15.1 万），已经贴着项目预算上限。
- **抽面已到极限**：Decimate 到 8,500 面时手里的药瓶开始烂，6,500 面瓶子直接消失；10,000 面是保住轮廓的下限。
- 模型未就绪时 `spawnOne` 改刷别的类型、它留在队首等下次（`modelReady(type)` 按 `ZOMBIES[type].model` 查对应槽位）。


---

## 附：橄榄球僵尸（`public/models/football.glb`，项目内 AIGC 资产）

第四套模型，由仓库所有者提供的 AIGC 模型 `aigc/橄榄球僵尸.fbx`（Kaydara FBX 7400，38.1 MB）转制。**授权与 alchemist 一样由仓库所有者确认**，不是 CC0 素材；如果要换成第三方生成的资产，先确认平台条款允许随公开仓库分发。

### 原始规格（实测）

| 项 | 值 |
| --- | --- |
| 三角面 | **49,986**（24,985 顶点，单个蒙皮网格、单材质） |
| 骨骼 | **22 根**（Mixamo 命名：`Hips/Spine/LeftArm/LeftUpLeg/...`，有语义名） |
| 动画 | **0 段**（只有绑定姿态；T-pose，双臂水平） |
| 贴图 | 4 × 4096²（baseColor / normal / metallic / roughness） |
| 原始高 | 1.938 m（T-pose；Blender 里面朝 -Y） |
| Armature | **对象缩放 0.01**（FBX 厘米单位），骨骼坐标是厘米 |

### 处理管线（可复现）

Blender 4.2 headless（同 alchemist，`bpy==4.2.23` + 本地 `libSM/libICE`）：

1. **修 bind**：FBX 的 mesh 是 T-pose、骨骼 rest 是 A-pose，且 armature 对象带 0.01 缩放。先 Apply Armature Modifier 把 T-pose 烘进网格，再 `pose.armature_apply()` 把 T-pose 设为 rest；然后 **unparent → 对 armature 和 mesh 各做一次 `transform_apply(scale)`**，把骨骼/网格都变成米。  
   ⚠️ 不 apply 这 0.01：导出的 glTF 在 three.js 里蒙皮会塌缩/浮空（Blender 里看着正常，浏览器里翻车）。
2. **抽面**：`Decimate(COLLAPSE, ratio = 10000/49986, use_collapse_triangulate)` → **10,000 面**，保留 22 个顶点组与 UV。
3. **贴图**：baseColor → 1024 JPEG q88（252 KB）；normal → 512 PNG（250 KB）；metallic/roughness 丢掉，常量 `metalness 0 / roughness 0.72`。
4. **动画**：源模型 0 段，从 Quaternius `zombie.glb` 重定向：
   - Idle **程序化**：手臂下垂 + 膝盖微屈 + 呼吸摆动（源僵尸的 Idle 是趴地爬行，不能用）。
   - Walk / Idle_Attack / HitReact：取源骨骼的**局部旋转**（转成 armature 空间），**丢弃源根位移**（Quaternius Walk 的根位移会让模型在动画里滑出 4 米）；腿骨旋转幅度 ×0.62（目标腿比源长 1.62 倍）；每段用一个**常量抬升**贴地。
   - Death：保留源 `Body` 的整体旋转，让身体后仰倒地；不加常量抬升，游戏自己负责死亡下沉。
   - 命名仍然对齐 `Idle / Walk / Idle_Attack / Death / HitReact`，`Zombie.buildAnimations` 不需要新分支。
5. **导出**：`export_animation_mode='ACTIONS'`、`export_yup=True`、GLB 内嵌贴图。

结果：**10,000 面 / 22 骨骼 / 5 段动画 / 1.40 MB**（baseColor 252 KB + normal 250 KB）。

### 接入约定

- **归属**：`ZOMBIES.football.model = 'football'`；`MODELS.football = { url: 'models/football.glb', scale: 0.95, height: 1.84 }`。1.938 × 0.95 ≈ 1.84 m，再乘类型 scale 1.12 ≈ 2.06 m。
- **命中球**：`HIT.football = { chest: 1.34, head: 1.66, radius: 1 }`（乘类型 scale 1.12 → 胸口 1.50 / 头 1.86）。头球半径 0.36×1.12 < 身体 0.46×1.12，爆头仍然成立。
- **头盔是程序化的**（模型本身没头盔）：`buildHat` 的 helmet 分支挂在 `Head` 骨骼、本地 Y 1.76；模型自带白色护肩和红球衣，**不要再补护肩**。
- 模型未就绪时 `spawnOne` 会改刷别的类型、它留在队首（`zombieModel.football` 槽）。
- 同屏最多 14 只、单只 1 万面/1 draw call；橄榄球每波数量有限，性能预算与炼金模型同量级。
