# 云上发条游乐园 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 用户已授权在本会话并行子Agent开发，完成全量验收后提交，不推送。

**Goal:** 实现 docs/DESIGN-cloud-carnival.md 的第五张地图、六原创玩具、敲钟停机与权威联机，保留已有四图玩法。

**Architecture:** 场景 CloudCarnival 管几何与视觉；CloudCombat 管三钟公共冷却、敌方投射物与圈波；Zombie 保留生命周期并执行玩具技能。Game 与弹道接线，同步沿用现有 host/guest/seq。离线原创GLB包含真实节点动画，图鉴复用Zombie。

**Tech Stack:** Three.js / Vite / 原生ESM、已有 @gltf-transform/core、Vitest、真实Chromium WebGL。

**Baseline:** 1434/1434 tests passing，47 files；已有模型纹理解码 warning 属基线。

## 分工与固定接口

共享工作区中各人仅写自己的文件，不提交、不改CI、不改覆盖率门槛。父Agent负责最终接线与单次提交。三独立域允许并行；同域或共享文件变更串行。所有新逻辑先写失败测试并确认，再实现。

- 场景域：src/world/CloudCarnival.js、materials.js、maps.js、tests/unit/cloudcarnival.test.js、maps.test.js。
- 模型域：tools/build-toy-models.mjs、public/models/toys/*、ZombieModel.js、gallery/presets.js、tests/unit/toyassets.test.js、zombiemodel/gallery测试。
- 战斗域：config.js、Zombie.js、entities/CloudCombat.js、tests/unit/cloudcombat.test.js、cloudcreatures.test.js、相关config/zombie测试。
- 父Agent：Game.js、ZombieManager.js、WeaponSystem.js、ProjectileSystem.js、net协议/DuoSession、HUD/CSS、集成/E2E、docs。

CLOUD 从 config.js 导出，必须包含 bell={radius:8,duration:1.6,cooldown:18,hitRadius:.575,y:1.7,positions:[[-16,3],[16,3],[0,-17]]}, intermission=15,bossIntermission=20。所有技能参数和玩具ZOMBIES数据集中此文件；波次W1..W6普通数量=5,7,11,15,19,25，cloud Boss为clockRabbit每五波一只。

CloudCarnival 提供标准地图接口，id=cloud、bounds36/36、spawn0/28/yaw0、noShadows=true、10 pickupSpots、initialPickupSpot=0、openingSpawnPoints、zombieSpawnPoints、updateNav/flowAt；bells=[{id,pos:Vector3,radius,group}]。bellHit(id,active)只播视觉反馈；不决定伤害/冷却；所有几何/灯/钟/鲸归root。

CloudCombat(ctx) 绑定 ctx.map/ctx.zombies/ctx.player/ctx.particles/ctx.sfx，由 Game 写 ctx.cloud。提供 reset(),update(dt),bellIntersection(a,b) 返回最近{id,t}或null,ringBell(id) 返回是否有效且执行公共冷却/范围stop,serialize()/applyNetState(state) 同步完整钟/飞出茶滴/圈波。提供 throwTea(z,target)/emitWave(z)（技能调用）、canStartAttack(z)限普通预警并发、onNetBell(request)由Game/host验证后调用ringBell。具体参数结构由战斗域尽早通报。

Zombie的toy数据驱动分支提供停止计时字段 stopTimer=0；serialize/applyNetState 包含剩余停止时间与新技能有效状态；guest不自推进技能伤害。资产id与类型id一致：toySoldier/springDuck/teaSprite/paperGlider/jackBox/clockRabbit。模型动画统一 Idle/Walk/Attack/Death/HitReact，关键模型节点ChestArmor/Head，含外观标志节点用于技能反馈。

### Task 1: 场景与可达性

Files: 场景域上述文件。
1. 写失败地图契约：注册cloud、72m边界、十点可达、三钟位置、四区地标、两退路、root切换。
2. Run: CI=1 npm test -- tests/unit/cloudcarnival.test.js tests/unit/maps.test.js --reporter=dot；确认缺地图行为失败。
3. 实现暖阳云海、18m倒挂钟楼、木马/积木/茶杯、慢鲸、碰撞和流场；不可移动平台。
4. 重跑定向并检查源码diff。等待规格和质量审查后完成。

### Task 2: 六原创动画模型

Files: 模型域上述文件。
1. 写生成资产测试：6文件、各自剪影节点、顶点色、Yup/脚底/目标尺寸、mesh和面数预算、5动画可加载和真实推进；先确认失败。
2. Run: CI=1 npm test -- tests/unit/toyassets.test.js --reporter=dot。
3. 离线建曲面玩具GLB+真实节点动画；卫兵有可隐藏ChestArmor。登记MODELS/图鉴，保持旧模型加载不变。
4. 跑定向UT，真实GLB预览，规格和质量审查。

### Task 3: 停机与玩具技能

Files: 战斗域上述文件。
1. 写失败测试：公共18秒/1.6秒边界、空响、死亡不暂停、飞出茶滴不停、六玩具数据/波次、冲撞锁向/撞墙、茶滴/圈波一次伤害、落地飞机、Boss恢复倍率与双圈。
2. Run: CI=1 npm test -- tests/unit/cloudcombat.test.js tests/unit/cloudcreatures.test.js --reporter=dot。
3. 实现CloudCombat固定池、Zombie数据驱动技能/停机/快照，配置和原地图零回归。
4. 重跑新旧zombie/config定向，明确网络字段传父Agent；规格/质量审查。

### Task 4: 集成与权威同步

Files: 父Agent上述文件。
1. 写真实Game集成失败用例：shoot→nearest wall/enemy/bell→ring；host验证guest bell请求；cloud快照/冷却/茶滴/圈波，休整，重开与四图切换。
2. Run: CI=1 npm test -- tests/integration/cloud-carnival.test.js --reporter=dot，确认缺接线失败。
3. 接入ctx.cloud、CloudCombat生命周期，Projectile/hitscan最早交点，guest请求重算视线seq/武器/墙/冷却；地图协议allowlist加cloud。复用HUD休整入口，加五图布局。
4. 真实E2E cloud-carnival场景覆盖六真实模型、铜钟弹道、敌人技能、触屏/平板、guest权威、14混编与切图清理。更新GAMEPLAY/AGENTS/设计实现状态。

### Task 5: 全量审查与提交

1. 规格审查完成后代码质量审查；修复所有阻塞，再复查。
2. Run: CI=1 npm test -- --reporter=dot；npm run test:coverage；npm run build；npm run test:e2e。原门槛不降。
3. git diff --check，确认只本任务文件；正式记录真实WebGL预算，不声称真机60fps。
4. git add显式文件列表；git commit -m 'feat: 新增云上发条游乐园与玩具战斗'。不push、不删除用户文件或其他worktree。
