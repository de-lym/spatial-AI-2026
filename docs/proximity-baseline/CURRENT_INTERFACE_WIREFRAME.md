# 当前界面结构线框（实现记录）

这是根据已运行页面逐区记录的结构，不是新视觉设计方案。
尺寸：1440×900，参考截图 proximity-live-1440.png；1280×800参考 proximity-live-1280.png。

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ AIRSPACE Drone Operations               Run/Pause  Speed Reset Advanced │
├──────────────────────────────────────────────────────────────────────────┤
│ time | fleet | first deliveries | on-time — | active alerts | sim state │
├──────────────────┬───────────────────────────────┬───────────────────────┤
│ In Progress      │                               │ Selected drone        │
│ Flight / Hub Ops │          3D city map          │ [Flight][Location]    │
├──────────────────┤                               │ [History]             │
│ Operations       │ buildings / permitted volumes │                       │
│ Order intake     │ selected / candidate routes   │ Flight state          │
│ Fleet allocation │ drone positions               │ Separation            │
│ Emergency        │ pigeon markers (synthetic)    │ Surface clearance     │
│ original disabled│                               │ Proximity:            │
│ Return/Repair/Land│ click a drone → inspector     │ cause + action + why  │
├──────────────────┤                               │ Mission / ETA         │
│ Incident Queue   │                               │                       │
│ Critical/Updates │                               │ 或 Advanced drawer    │
│ HUMAN_REQUIRED   │                               │ 原工具 + Proximity:   │
│ AUTO_* / RESUME  │                               │ 当前风险 / 4个操作    │
│ click → drone    │                               │ 门槛 / 升级时间       │
├──────────────────┴───────────────────────────────┴───────────────────────┤
│ Fleet Monitoring: Drone | State | Mission | Altitude | ETA | Attention  │
└──────────────────────────────────────────────────────────────────────────┘
```

右侧 Inspector 与 Advanced 是原有 overlay，实际可能互相覆盖；本次没有重做面板互斥机制。
Advanced 的内容为纵向滚动，Proximity 位于原 route-cost 参数区之前，打开后滚动至此区。
左侧事件队列也可滚动；新事件依原有规则提示，不抢用户阅读位置。

四个新操作：Pigeon encounter（注入场景）、Clear pigeons（清测试对象）、
Record human review（只复核不清风险）、Export session JSON（下载会话）。

独立HTML灰度设计参考稿未生成：Gemini Designer 返回 not_authorized。
不影响此结构记录、实际集成、截图与 UX_HANDOFF.md；未将原有彩色界面截图冒称灰度新设计稿。
