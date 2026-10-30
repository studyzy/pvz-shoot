# 免费 3D 野怪模型库

40 个低模野怪，全部来自 [Poly Pizza](https://poly.pizza)，原始作者 **Quaternius**，许可 **CC0 1.0**（可商用、可修改、无需署名）。
下载于 2026-10-30。均为 **GLB** 单文件：几何 + 材质 + 骨骼动画内嵌，Three.js 用 `GLTFLoader.load()` 直接读。

> `aigc/` 下只有素材库目录（monsters/plants/weapons/props）进仓库，根目录的自备 FBX 仍被 .gitignore 忽略。

预览图 `preview.jpg` 按表格顺序（人形 → 史莱姆 → 亡灵 → 野兽，每类按下面的表序）拼成，8 列 5 行；单张缩略图在 `previews/` 下。

## 用法速记

- 蒙皮模型必须用 `SkeletonUtils.clone()` 克隆；`scene.clone(true)` 会让同种怪共用一套骨骼。
- 动画名带前缀且常重复（如 `CharacterArmature|CharacterArmature|Walk`），匹配时取最后一段，忽略大小写。
- 尺度不统一：内部普遍有 100 倍 Armature 缩放，加载后按包围盒归一化到目标身高再上场。
- 朝向以 +Z 为主，少数（恶魔、幽灵、石头人一类飞行姿态）需实测，建议先在场景里单独看一眼。
- 每个 GLB 网格数很少、共享一个材质；多只同屏只克隆，不要 dispose 共享几何体。
- 背包清单见同目录 `manifest.json`（含文件、分类、面数、骨骼、动画名、来源链接）。

## 人形 / 类人（15）

| 文件 | 中文名 | 原名 | 三角面 | 骨骼 | 动画 | 动画名（去前缀） |
| --- | --- | --- | --- | --- | --- | --- |
| `humanoid/goblin.glb` | 哥布林 | Goblin | 2912 | 12 | 7 | Attack, Death, HitRecieve, Idle, Jump, Run, Walk |
| `humanoid/orc.glb` | 兽人战士 | Orc | 4312 | 43 | 14 | Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Walk, Wave, Weapon, Yes |
| `humanoid/orc-enemy.glb` | 兽人小兵 | Orc Enemy | 2152 | 4 | 9 | Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `humanoid/blue-demon.glb` | 蓝皮恶魔 | Blue Demon | 4456 | 43 | 15 | Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Run2, Walk, Wave, Weapon, Yes |
| `humanoid/demon.glb` | 恶魔（飞行） | Demon | 3712 | 43 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |
| `humanoid/demon-brute.glb` | 恶魔壮汉 | Demon | 5832 | 43 | 14 | Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Walk, Wave, Weapon, Yes |
| `humanoid/demon-3.glb` | 小恶魔 | Demon | 3292 | 12 | 7 | Attack, Death, HitRecieve, Idle, Jump, Run, Walk |
| `humanoid/tribal.glb` | 部落蛮兵 | Tribal | 2976 | 38 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |
| `humanoid/giant.glb` | 巨人 | Giant | 3812 | 12 | 7 | Attack, Death, HitRecieve, Idle, Jump, Run, Walk |
| `humanoid/goleling.glb` | 石头人 | Goleling | 3648 | 13 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |
| `humanoid/goleling-evolved.glb` | 石头人·进化 | Goleling Evolved | 4120 | 13 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |
| `humanoid/yeti.glb` | 雪怪 | Yeti | 2088 | 4 | 9 | Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `humanoid/alien.glb` | 外星怪 | Alien | 2592 | 4 | 9 | Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `humanoid/mushroom-king.glb` | 蘑菇王 | Mushroom King | 5116 | 43 | 14 | Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Walk, Wave, Weapon, Yes |
| `humanoid/mushnub.glb` | 蘑菇精 | Mushnub | 1200 | 4 | 9 | Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |

## 史莱姆 / 软体（7）

| 文件 | 中文名 | 原名 | 三角面 | 骨骼 | 动画 | 动画名（去前缀） |
| --- | --- | --- | --- | --- | --- | --- |
| `slime/slime.glb` | 史莱姆 | Slime | 1440 | 12 | 4 | Slime_Attack, Slime_Death, Slime_Idle, Slime_Walk |
| `slime/slime-enemy.glb` | 敌对史莱姆 | Slime Enemy | 1744 | 7 | 10 | Bite_Front, Bite_InPlace, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `slime/green-blob.glb` | 绿色软泥 | Green Blob | 1496 | 4 | 9 | Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `slime/green-spiky-blob.glb` | 尖刺软泥 | Green Spiky Blob | 4520 | 4 | 9 | Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `slime/pink-slime.glb` | 粉色史莱姆 | Pink Slime | 982 | 4 | 9 | Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `slime/glub-evolved.glb` | 深渊软泥·进化 | Glub Evolved | 2372 | 13 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |
| `slime/squidle.glb` | 章鱼怪 | Squidle | 3576 | 43 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |

## 亡灵（5）

| 文件 | 中文名 | 原名 | 三角面 | 骨骼 | 动画 | 动画名（去前缀） |
| --- | --- | --- | --- | --- | --- | --- |
| `undead/skeleton.glb` | 骷髅兵 | Skeleton | 4278 | 12 | 7 | Attack, Death, HitRecieve, Idle, Jump, Run, Walk |
| `undead/ghost.glb` | 幽灵 | Ghost | 2056 | 38 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |
| `undead/ghost-skull.glb` | 骷髅幽灵 | Ghost Skull | 2024 | 38 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |
| `undead/zombie.glb` | 僵尸 | Zombie | 7570 | 50 | 16 | Crawl, Death, HitReact, Idle, Idle_Attack, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Run_Arms, Walk, Wave, Yes, Run_Attack |
| `undead/mimic.glb` | 宝箱怪（静态） | Mimic | 11377 | 0 | 0 | 无（静态网格） |

## 野兽 / 虫（13）

| 文件 | 中文名 | 原名 | 三角面 | 骨骼 | 动画 | 动画名（去前缀） |
| --- | --- | --- | --- | --- | --- | --- |
| `beasts/wolf.glb` | 狼 | Wolf | 2740 | 16 | 8 | Death, Headbutt, Idle, Idle_Eating, Jump_Loop, Jump_Start, Run, Walk |
| `beasts/bat.glb` | 蝙蝠 | Bat | 772 | 23 | 5 | Bat_Attack, Bat_Attack2, Bat_Death, Bat_Flying, Bat_Hit |
| `beasts/spider.glb` | 蜘蛛 | Spider | 2712 | 39 | 5 | Spider_Attack, Spider_Death, Spider_Idle, Spider_Jump, Spider_Walk |
| `beasts/snake.glb` | 蛇 | Snake | 1618 | 15 | 4 | Snake_Attack, Snake_Idle, Snake_Jump, Snake_Walk |
| `beasts/rat.glb` | 老鼠 | Rat | 4004 | 31 | 6 | Rat_Attack, Rat_Death, Rat_Idle, Rat_Jump, Rat_Run, Rat_Walk |
| `beasts/crab.glb` | 螃蟹怪 | Crab Enemy | 3144 | 7 | 10 | Bite_Front, Bite_InPlace, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `beasts/wasp.glb` | 黄蜂 | Wasp | 3734 | 29 | 3 | Wasp_Attack, Wasp_Death, Wasp_Flying |
| `beasts/frog.glb` | 巨蛙 | Frog | 4280 | 43 | 14 | Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Walk, Wave, Weapon, Yes |
| `beasts/dino.glb` | 恐龙 | Dino | 4318 | 43 | 14 | Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Walk, Wave, Weapon, Yes |
| `beasts/dragon.glb` | 小龙 | Dragon | 1088 | 27 | 5 | Dragon_Attack, Dragon_Attack2, Dragon_Death, Dragon_Flying, Dragon_Hit |
| `beasts/dragon-evolved.glb` | 巨龙·进化 | Dragon Evolved | 6702 | 46 | 8 | Death, Fast_Flying, Flying_Idle, Headbutt, HitReact, No, Punch, Yes |
| `beasts/tentacle.glb` | 触手 | Tentacle | 3874 | 21 | 3 | TentacleArma, TentacleArmat, TentacleArmatur |
| `beasts/bull.glb` | 蛮牛 | Bull | 2064 | 42 | 13 | Attack_Headbutt, Attack_Kick, Death, Eating, Gallop, Gallop_Jump, Idle_HitReact_Left, Idle_HitReact_Right, Jump_toIdle, Walk, Idle_Headlow, Idle_2, Idle |

## 来源与许可

| 文件 | 作者 | 许可 | Poly Pizza 页面 |
| --- | --- | --- | --- |
| humanoid/goblin.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/OdCOFSmEhl |
| humanoid/orc.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/5vO2YJsPEf |
| humanoid/orc-enemy.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/Q3z8ZX4kUy |
| humanoid/blue-demon.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/S7jYW6Amye |
| humanoid/demon.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/Mo2ky6vkf8 |
| humanoid/demon-brute.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/LnfIziKv4o |
| humanoid/demon-3.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/IkB63XOPvr |
| humanoid/tribal.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/t91lDHaqRW |
| humanoid/giant.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/BldaiPtyJa |
| humanoid/goleling.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/71gomWolax |
| humanoid/goleling-evolved.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/iHEuXiH6Aj |
| humanoid/yeti.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/S1E7idPFhe |
| humanoid/alien.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/sUTLXji0aL |
| humanoid/mushroom-king.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/grnFTziU8u |
| humanoid/mushnub.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/LWKmS30Xxl |
| slime/slime.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/LyjSUKHKnh |
| slime/slime-enemy.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/eSLKTsbl7F |
| slime/green-blob.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/y4kJh8EeYS |
| slime/green-spiky-blob.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/IoWG5F9WUc |
| slime/pink-slime.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/AyP8sQmDLh |
| slime/glub-evolved.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/Z9lddNpM1M |
| slime/squidle.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/54QyRcsogk |
| undead/skeleton.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/DM4QScSmbS |
| undead/ghost.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/Iip30bDHmu |
| undead/ghost-skull.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/TX8r9WBXpe |
| undead/zombie.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/VlXjG0N8Eg |
| undead/mimic.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/B8HrWzkuNp |
| beasts/wolf.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/XU7oNeKShV |
| beasts/bat.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/hNO9XvjlKa |
| beasts/spider.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/yRYJiAJyiM |
| beasts/snake.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/x9x0viZs8V |
| beasts/rat.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/iltq5bVNaV |
| beasts/crab.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/Gs3yfsV5lB |
| beasts/wasp.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/3aQgc75sUR |
| beasts/frog.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/37wofOCOzG |
| beasts/dino.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/wuerCFCWNR |
| beasts/dragon.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/VBvzjFIYws |
| beasts/dragon-evolved.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/LlwD0QNUPj |
| beasts/tentacle.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/BR1vpIvvvv |
| beasts/bull.glb | Quaternius | CC0 1.0 | https://poly.pizza/m/a8PIIYwF7r |

Quaternius 官网现行的 QAL v1.0 禁止「以独立资产形式再分发」，而本目录这批是 Poly Pizza 上 QAL 生效前发布的 **CC0** 版本。本地自用、打进自己的游戏都没问题；如果要公开再分发整套模型，以 CC0 原始发布为准。
