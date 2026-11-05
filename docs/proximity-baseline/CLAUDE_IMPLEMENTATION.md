# 给 Claude 的实施与续作说明

## 交付状态

这份文件包已经在原生 JS / Three.js 项目独立副本内实现工作集成，不是待开发 PRD。
基线分支 `claude/semantic-model-delivery-system`，SHA `f7bdcf0ad371ed5e9c2a9248f539ceefa7610b04`。
尊重用户约束：仅在新目录/新副本使用；不要对现有仓库 commit / push / PR，不要覆盖用户原文件。

## 使用整包（推荐）

1. 解压到全新目录；使用 README 的静态 HTTP 服务器启动。
2. 先跑 `npm test`（Node >=20，没有 npm install 步骤）。
3. 按 TEST_GUIDANCE 在实际页面验证原功能与三类风险。
4. 任何续作保留四阶段、配送语义、原有调参、查询、事件队列、选择/关闭详情与原有图层功能。

## 仅接入代码补丁

根目录外的 `proximity-code.patch` 只包括代码、HTML/CSS、package.json 和测试，不含大图与文档。
必须先复制原始基线到新目录，并确认没有未保留修改，再在副本执行：

```sh
git apply --check /path/to/proximity-code.patch
git apply /path/to/proximity-code.patch
```

如果目标版本不是上述 SHA，不要强行套补丁；用完整交付副本进行人工比对。
若目标已有 package.json，合并 type/module 与 test 脚本，不覆盖现有依赖或脚本。

## 已集成的调用次序（不能随意交换）

`step(dt)`：推进 S.time → 配送准备时钟 → `preflight` 所有任务（原静态感知与重规划）
→ `proximity.prepare(dt)`（更新鸟、紧急路径候选）→ 原 `sepPlan(dt)`（含死锁策略）
→ `proximity.guard(dt)`（最终分段运动联合校验）→ `droneStep` → 原 `sepTrack` → 原自主代理。

重要：`flyStep` 不再重规划；规划必须在最终联合 guard 之前完成，否则 guard 检查的不是实际飞行路径。
保留原 `c.task.route` 对象和订单关联；紧急绕路只更新 pts/idx/plan/rerouted，不创建新订单。
`resetWorld` 调用 proximity.reset；不删除原 ops.reset。
原每子步 <=0.1s 的动画循环保留。纯 trajectory 与原速度 4、垂直因子 0.7 一致；未来改速度必须同步。

## 事件契约

- `PROX_DRONE` / `PROX_BUILDING_OR_AIRSPACE` / `PROX_PIGEON`，通过原 ops store 发事件。
- `AUTO_SLOW / AUTO_HOLD / AUTO_EVADE / AUTO_REROUTE / AUTO_RESUME`：Updates。
- `HUMAN_REQUIRED`：Critical，同一 session+无人机+cause 去重。
- `HUMAN_ACK`：只写审计，不 resolve。
- 当前危险立即升级；否则持续超过 escalateS 升级。安静 recoveryS 后自动 resolve。
- 审计字段：sim time、drone/order、cause、action、targets（适用时）、米坐标、当时阈值。
- audit 最多 2000 条，导出注明 droppedAuditEvents；原 Updates 最多 200。未关闭 Critical 不丢弃。
- 无后端持久化、身份验证和真实操作者 ID；不要把 review 写成“已派单”或“指令已执行”。

## 避让正确性的限制

`guard` 只接受允许空间内的动作，分段轨迹用合并时间断点计算连续 closest approach；
停止一个无人机会改变其他无人机的冲突，因此迭代直到所有可停者稳定。
已有间距不足时，只允许严格分离且不加剧最近距离的运动；无法解决就保留风险并升级。
鸽子使用当前恒速预测，下一次随机改向不被预测器预知。禁止把随机 seed 当成预知未来。
原 sepEvade 仍可提供死锁绕行，但最终 guard 可能拒绝它；不要为了“演示顺畅”跳过检查。
占用停机坪地面例外保留：两者都在 y<0.3 场景单位时不作空中分离要求。
建筑检测用现有 AABB + clearance；最近建筑表面净距是参考位置到 AABB 的欧氏距离，不能称旋翼净距。

## 续作优先级（未实现，不能冒充完成）

1. 为危险持续时间、复核人和事件存储添加真实后端契约及会话历史。
2. 物理制动/加速度、旋翼体积、感知时延、鸟群与追踪不确定性模型。
3. 三维时空联合规划：当前只搜索有限候选，可能存在可行路径但搜索不到，必须保留人工升级。
4. 可经验证的 return / land / pause flight 指令契约。现有全局 Run/Pause 是课堂时钟，不是飞控。
5. 结构化 building vs restricted vs bounds 事件细分（当前统一 BUILDING_OR_AIRSPACE）。

原网页 UI 文案为英文，此次运行集成保留英文；中文低保真与中文说明供团队后续视觉/本地化使用。
