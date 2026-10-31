# pvz-shoot 免费 3D 素材库

原有 82 个低模用于「植物大战僵尸 + 第一人称射击」题材，来源 [Poly Pizza](https://poly.pizza)，原始作者以 Quaternius 为主，另有 Kay Lousberg、Polygonal Mind、CreativeTrio。另在 `map-kits/` 储备了 12 套 Kenney 地图素材，共 **1,189 个实际 GLB 模型**。上述下载资源均为 **CC0 1.0**（可商用、可修改、无需署名）。

| 目录 | 数量 | 内容 | 说明 |
| --- | --- | --- | --- |
| [monsters/](monsters/README.md) | 40 | 哥布林、兽人、恶魔、史莱姆、亡灵、野兽 | 39 个带骨骼动画（宝箱怪除外） |
| [plants/](plants/README.md) | 16 | 向日葵人、胡萝卜人、土豆人、食人鱼头、仙人掌怪、各种蔬菜 | 4 个带动画 |
| [weapons/](weapons/README.md) | 19 | 步枪、霰弹、手枪、火箭筒、榴弹、手雷、大炮、射线枪 | 全静态 |
| [props/](props/README.md) | 7 | 墓碑、木栅栏、木箱、木桶、炸药桶 | 全静态 |
| `map-kits/` | 1189 | 森林、墓地、郊区、工厂、街道、奇幻城镇、地牢、洞穴、家具、雪地、空间站、海岛 | 12 套 Kenney CC0 原包；本地暂存，不进 Git/游戏 |

`map-kits/manifest.json` 列出逐包来源、实际版本、SHA-256、模型路径与依赖；各包保留 `original.zip` 和原始 `License.txt`。共约 103.4 MiB（含原包与解压 GLB），模型数不重复计算 ZIP 中的 OBJ/FBX。正式接地图时只将选中的资源复制到 `public/models/`，再校准比例、碰撞和性能。

原有四类目录下都有四样东西：`README.md`（逐件说明 + 来源表）、`manifest.json`（机器可读）、`preview.jpg`（预览拼图，按表格顺序从左到右、从上到下）、`previews/`（单张缩略图）。

## 按 PvZ 玩法挑素材

| 游戏里的东西 | 建议文件 | 备注 |
| --- | --- | --- |
| 向日葵 / 产阳光 | `plants/sunflower-person.glb` | 笑脸向日葵人，静态 |
| 大嘴花（Chomper） | `plants/piranha.glb` | 会张嘴的食人鱼头，带 Attack/Death 动画 |
| 仙人掌 | `plants/cactoro.glb`、`plants/cactus.glb` | 前者是会走的仙人掌怪，后者是素体 |
| 蘑菇 / 大喷菇 | `plants/mushroom-evolved.glb`、`monsters/humanoid/mushnub.glb` | 都带动画 |
| 坚果墙 / 南瓜套 | `plants/pumpkin.glb` | 当掩体，静态 |
| 土豆雷 | `weapons/landmine.glb` + `plants/potato-character.glb` | 地雷 + 土豆人 |
| 樱桃炸弹 | `weapons/grenade.glb`、`weapons/fire-grenade.glb` | 绿色手雷 / 红白燃烧弹 |
| 玉米加农炮 | `weapons/cannon.glb` + `plants/corn.glb` | 古典大炮当炮台底座 |
| 火炬树桩 | `weapons/flare-gun.glb` | 红色信号枪 |
| 僵尸野怪 | `monsters/` 全目录 | 40 种，见其 README |
| 后院 / 墓地布景 | `props/` | 墓碑、栅栏、木箱 |

## 接入要点

- 三个目录的 GLB 都是单文件（几何 + 材质内嵌），`GLTFLoader.load()` 直接读；蒙皮模型克隆必须用 `SkeletonUtils.clone()`。
- 尺度不统一：内部普遍有 100 倍 Armature 缩放，加载后按包围盒归一化到目标身高，别照抄绝对尺寸。
- 动画名带重复前缀（如 `CharacterArmature|CharacterArmature|Walk`），匹配时取最后一段并忽略大小写。
- 武器全部不带骨骼、没有 muzzle 节点，枪口位置要按包围盒自己算；后坐/摇摆靠代码做。
- 植物角色大多没有骨骼（静态摆姿），适合当不会走位的炮台；会动的是 piranha、cactoro、cactoro-small、mushroom-evolved。

## 许可

全部 **CC0 1.0**，逐件的作者与页面链接在各自 `README.md` 的来源表里。

Quaternius 官网现行的 QAL v1.0 禁止「以独立资产形式再分发」，这批是 Poly Pizza 上 QAL 生效前发布的 CC0 版本，因此可以随仓库分发；如果以后从 quaternius.com 官方包直接下载模型，性质不同，需要单独确认。
