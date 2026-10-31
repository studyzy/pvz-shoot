# 月光童话战场 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完整落地已批准评审的 A 方案（P0–P3），不是只做纵切片：全图美术、族群/Boss、导航、公平性、声音、补给、移动端及联机一致性。

**Architecture:** 复用 NightForest/FlowField/Zombie/ZombieManager/WeaponSystem/Sfx；新机制均由现有 config 数据驱动，host 是权威，guest 只播放同步状态。保留 90×90 外围、约 60 米战斗核心、免费豌豆、14 只上限、无实时阴影与原有其他地图规则。文件所有权分离的子任务并行，合流后先规格审查再质量审查，不降低覆盖率或改 CI。

**Tech Stack:** Three.js 0.169、原生 ES Module、Vite、Vitest/jsdom、playwright-core/真实 Chromium。

## 已确认的范围及参数

- 出生 z=30，主地标 4–6 m；三树母型、成簇植被、140 萤火虫、路边灯、非圆盘光斑；菌菇/完整营帐/断墓拱/根骨兽巢全部完成。
- 首波 3 goblin + 2 slime，后期 normal 不超过非 Boss 20%，族群按波次轮换主60%/辅25%/普通15%；总量 waveTotal 守恒，所有12种按首波门槛渐进。
- 巨人 slam 沿用 range=2.6/radius=2.3/telegraph=.85/recover=1.4；蘑菇9秒周期、3秒蹲、伤害×.25、1.2秒恢复；巨龙7秒周期、落地2秒；蝙蝠6秒周期/落地2秒/落地可被普通豌豆攻击。动画和危险形状必须可见，死亡/重开清理。
- 粉史莱姆分裂2小体，小体不再次分裂；同屏总实体含待回收尸体≤14，队满延迟生成，reset清队；子体 sun=0，保留母体掉落，防额外收入。
- 狼用侧翼出生点，不加行为树；蜘蛛伏击有可见预警、靠近/照射可唤醒；幽灵穿实体但不出界。
- FOREST 参数：aimDistance=30、intermission=10、bossIntermission=18、touchWeaponScale=.88、nearSound=18。
- 保留阳光经济，森林阳光使用冷暖相容的视觉包装；首次补给固定可见入口，支路普通/强武器池，仍每点一次、host共享。
- 声音按族群复用已有采样，相机相对声像、距离衰减、优先近危险，低成本林间底声；不添加资源/CDN。
- 技能快照包含 aerial 标志与技能状态/计时/预警中心，guest不模拟技能伤害；host命中裁决使用seq时的空中状态，旧快照兼容当前状态。

## Task 1 — 基线与隔离

Files: worktree/plan only. Run npm ci --include=dev and npm test before edits. 记录基线1291测试通过；已有 jsdom glb贴图警告不冒充真实渲染失败。主目录 .codebuddy/package-lock 的改动不纳入提交。

## Task 2 — 全图美术与导航（文件所有权：地图任务）

Modify src/world/NightForest.js, src/world/materials.js, src/world/FlowField.js；Test tests/unit/nightforest.test.js, tests/unit/flowfield.test.js, tests/unit/maps.test.js。

1. 先写失败断言：出生与地标、三树一体变换、140萤火虫、路中净空、nav.blocked>0、每刷点/拾取点可达、实体挡弹；npx vitest run 上述文件确认 RED。
2. 实现 circle collider 网格阻挡，保留 blockPlatforms 原接口；处理 BFS 对角切角和方向进入阻挡（不造成其它地图寻路回归）。
3. 全部地图物件在 root；主地标 name=moonheart，四区地标加入 map.landmarks。固定几何与种子摆放保证构图/联机一致；三树母型共享几何并实例化。主干不穿插中路灌木。
4. 提供 map.initialPickupSpot=0、map.pickupPools（点位索引→武器id数组），map.zombieSpawnGroups（goblin/slime/undead/beast→点数组）、map.openingSpawnPoints（首波16–22米），其它点不压碰撞/可导航。
5. GREEN 后检查通用地图契约及 draw call，避免高台无敌点；不提交不碰其它所有权文件。

## Task 3 — 生物与Boss运行时（文件所有权：生物任务）

Modify src/entities/Zombie.js；Test tests/unit/zombie.test.js 与 tests/unit/forest-creatures.test.js（新文件必要，集中行为状态机）。

1. 先写失败测试覆盖 land/fly窗口、duck伤害×.25、前摇逃离不扣血、两目标slam、恢复、伏击预警/幽灵穿树、remote不扣血、snapshot状态。
2. 复用config def.slam/duck/dive/landing/ambush/phase；数值只config，由Task4补齐。允许结构性技能状态常量，本文件不硬编码平衡参数。
3. slam 前摇固定中心，影响范围内逐target设置 targetSeat 再 ctx.onAttack(z)，不在远端跑攻击；其它普通近战不变。定义 skillState/skillTimer/skillCenter，serialize字段 ab(0/1), sk(字符串), kt(计时), kx/kz(中心)。guest applyNetState 应用并画预警圈，不自行推进权威状态。使用共享几何、实例独立材质，可dispose。
4. 特殊状态不因每帧walk覆盖duck动作；死亡/回收不残留预警；空气/落地命中球跟随root。GREEN、覆盖率与老模型/配件测试回归，不提交。

## Task 4 — 配置与遭遇导演（文件所有权：导演任务）

Modify src/config.js, src/entities/ZombieManager.js；Test tests/unit/fantasy-units.test.js, tests/unit/zombiemanager.test.js, tests/unit/forest-director.test.js。

1. RED：首波精确3+2、总量守恒/normal≤20%/12种渐进、分裂延迟/限14/reset/remote防重复、出生族群/首波反应距离、近声像方向和间歇。
2. Export FOREST={aimDistance:30,intermission:10,bossIntermission:18,touchWeaponScale:.88,nearSound:18}; config标family（goblin/slime/undead/beast）、bat.landing={period:6,groundTime:2,high:2,ground:.2}，dragon dive同现有但补telegraph=.7，duck recover=1.2，spider ambush={range:10,notice:14,wake:.65}，ghost/ghost-skull phase=true，slimelet sun=0。首波不改变总5只。
3. 族群填充替代旧 normal兜底，不突破总量、空中硬配额应按def.airborne算含落地者。森林出生优先map.openingSpawnPoints/相应group，选择距离适中且避实体的点；狼偏侧向；其他图路径完全不变。
4. 分裂进 pendingSplits队列，不因尸体未回收/池满丢失，不让wave过早clear；计分/掉落各一次、child不产sun；host正常spawn事件同步child。
5. 森林普通休整10、Boss后18（双人也可活动）；提供 skipIntermission() 返回bool，主控制器连UI/网络；其他图保持原值。
6. 更新近敌声调用 sfx.creature(family, volume, pan)，无family/旧sfx保持旧groan；主任务实现Sfx方法。GREEN 后不提交。

## Task 5 — 系统整合（主任务所有权）

Modify src/Game.js, src/weapons/WeaponSystem.js, src/entities/WeaponPickups.js, src/entities/SunOrbs.js, src/audio/Sfx.js, src/ui/HUD.js, index.html, src/style.css, src/net/DuoSession.js（如必须）。Test 对应unit及 tests/integration/forest-rework.test.js。

1. 先RED：森林辅助目标≤30米而弹丸远程规则不变、触屏缩放.88/武器颜色不洗白、初始点与池选择/共享补给、族群声音与森林底声开关、可提前结束休整、guest落地命中按seq裁决、快照远端Boss圈。
2. 视图模型森林受光隔离（不用全局曝光），以现有MeshToon材质最低成本保留颜色；触屏缩放限森林，不改变弹道起点/物理。
3. 固定第一点及各点武器池选择；冷青阳光包装保留5面额与全部经济；不重置共享guest本地刷。
4. 休整按钮仅间歇出现、pointer-events:auto小范围可点击；host可结束、guest发事件请求由host确认并等pstate，不让guest本地startWave；不加阻塞教学。
5. seq快照ab用来判空中，拒绝过期/不存在快照越权；已有墙、冷却、方向验证不能绕过。
6. GREEN 并与任务2–4接口合流；README/GAMEPLAY/night forest design/AGENTS 更新事实和实现参数，旧的“未实现”节必须修正。

## Task 6 — 完整验证与两阶段审查

Run npm test, npm run test:coverage, npm run build, npm run test:e2e。先补森林rework浏览器场景 RED/验收：全部地标、可读光照、bat落地普通武器击杀、粉split、Boss三种技能与guest、手机iPad控件/提前开波/最坏14只。真实截图目检必要；不拿软渲染FPS或模拟触屏冒充真机。覆盖率不得降门槛。规格审查确认Task2–5无遗漏，再代码质量审查修到无阻塞项。

## Task 7 — 合入与提交

检查git diff --check及仅本任务文件；实现完成后提交短中文feat前缀。主目录仍有原改动则保留：只将已审核本分支fast-forward合入main（若main前进则merge并解决冲突，不reset/stash用户文件）。合入后main再次测试/构建确认；不push。不强行删除worktree，保留可核查路径。
