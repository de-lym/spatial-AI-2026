# 实际仓库审计与实现边界

检查来源：[GitHub 指定分支](https://github.com/de-lym/spatial-AI-2026/tree/claude/semantic-model-delivery-system)。
固定 SHA：f7bdcf0ad371ed5e9c2a9248f539ceefa7610b04。下载检查日期：2026-10-29。
读取前面对话后，仅能取得用户消息与图片附件位置；历史助手回复是内容引用占位符，未据此猜测旧方案。
本次架构判断以实际源文件、原 README 与仓库现有界面为准。

| 文件/对象 | 原有事实 | 本次处理 |
|---|---|---|
| main.js / S | 四架无人机、订单/配送/四阶段、单时钟 | 保留；接入 proximity adapter |
| main.js / sepPlan | 0.25s 预测采样+线段 CPA、优先级、减速/等待、死锁候选 | 保留；后置完整间距联合 guard |
| main.js / flyStep | 原在运动前感知并可能改变路线 | 提取 preflight，避免 guard 后换路径 |
| spatial.js | AABB 建筑、segCheck、允许 prism 并集、A*、曲线复验、净距6m | 原文件逐字保留，复用约束与规划 |
| ops-events.js | Structured critical/update store，updates 200 | 原文件逐字保留；新增事件来源 |
| index.html/style.css | 地图、左侧控制和事件、底部 fleet、右侧 inspector/advanced | 局部增补参数与操作；不重做原壳 |
| vendor | vendored Three.js | 逐字保留 |

## 修复的集成缺口

原始 hard guard 使用 0.55×目标间距，因此不能把 cfg.sepM 当绝对保证。
原死锁 sidestep 对其他无人机主要看候选终点，最终需要对沿途的联合运动再检查。
本包增加后置完整目标间距检查和真实 waypoint 时间断点，但不宣称对未知鸟运动保证无碰撞。
原静态预检查和重规划与运动在一个函数里；本包把重规划放到联合 guard 前，保持执行轨迹一致。

## 完成 / 限制

- 已完成：三类风险的可运行联动、可调门槛、现场情况按钮、明确人工升级/复核、自动解除、可下载日志。
- 鸟为灰色球形标记，无真实视觉识别或鸽子美术资产；可连续添加最多8只，Reset 移除。
- 默认没有背景鸟；点击 Pigeon encounter 才注入。明确是演示场景，不暗示实时发现。
- 鸟每次改向后的当前速度被认为立即可知；没有真实传感器延迟、误检、遮挡、轨迹估计。
- 有限方向/高度逃逸候选不是完备规划器；接回的后续路线只做静态验证，动态风险每步重检。
- 没有刹车惯性；停止前进是运动学速度因子0，speedU 仅仪表平滑，不能当实际制动距离。
- 已入危险区或当前位置无效时，悬停也不一定可行。日志使用 unresolved / human review，不写“安全悬停成功”。
- 人工仅有本地复核记录，没有飞控 API、远程通知、派单、身份认证、真实航空规程。
- 阈值会话内修改立即生效，刷新回默认；不具备多操作者同步。
- 现有 NO_VALID_ROUTE 与新 PROX_BUILDING_OR_AIRSPACE 可能并列出现，分别表示任务不可规划和近距/空间风险。
- UI 的 HUMAN_REQUIRED 在风险清除后自动解除；并非强制人工批准后才能重新飞行。
- 后端、真实感知、实时飞行、认证验证均未实现。原电池/准点率缺口维持原样。

## 保留证据

SOURCE_MANIFEST.json 记录原文件 SHA256 与状态。与原版不同的原文件只有 main.js、index.html、style.css、README.md；
原 README 另存 docs/README-original.md。原始下载副本 git status 干净；没有 remote 写入操作。
