# Proximity — 当前界面 UX 交接

使用角色：课堂模拟运营者。目标：知道“谁接近谁、系统做了什么、风险是否仍在、是否要人工关注”。
当前界面保留 full-page map + floating panels，不新增独立业务导航。尺寸基准1440×900，复核1280×800。
灰度参考稿仅用于信息层级交接，不是线上飞控，也不是视觉稿；实际运行入口仍是 ../index.html。
Desktop UI 规范用于灰度线框，8px间距、14/22正文、32px控件、克制边框；参考稿不替换原 UI 品牌。

## 入口与组件映射

| 区域 | 当前实现 | 用户路径 |
|---|---|---|
| TopHeader | 原Run/Pause、倍速、Reset、Advanced | Run/Pause 控制模拟时间；Reset原确认弹窗保留 |
| 地图 Map | 原航线/建筑/无人机，灰色球为新鸽子标记 | 原点击无人机选中；鸟标记暂不支持点击详情 |
| 左侧 Incident Queue | Critical 显示 HUMAN_REQUIRED；Updates 显示 AUTO_* 与恢复 | 点击事件打开原无人机 inspector |
| 底部 Fleet Monitoring | 原 flight state / attention 保留 | 点击无人机行进入详情 |
| Drawer/Inspector Flight details | 增加 Proximity 原因与最近建筑表面净距 | 阅读原因、对象、响应；原Location/History切换保留 |
| Drawer/Advanced Proximity | 参数、active条件、Pigeon encounter、Clear pigeons、复核、导出 | 交互为真实本地模拟操作；active条件可点击选中无人机 |

## 状态与文案

| 状态 | 意义 | 自动动作 | 人的动作 |
|---|---|---|---|
| Clear | 无已检测近距风险 | 原任务继续 | 无 |
| AUTO_SLOW | 预测无人机冲突 | 减速让行 | 可查看详情 |
| AUTO_HOLD | 不能接受当前移动 | 停止前进，每步重查 | 可查看；不是安全保证 |
| AUTO_EVADE | 已选择紧急候选 | 侧移/高度调整并接回原任务，仍受最终guard限制 | 观察结果 |
| AUTO_REROUTE | 静态障碍阻断旧路径 | 用已有允许空域规划器换路 | 查看建筑/空域原因 |
| HUMAN_REQUIRED | 当前已违约束、鸟仍会接近悬停点，或持续风险8s | 不强行穿越/下降/瞬移 | 记录复核；课堂中调规则/清场景以观察恢复 |
| HUMAN_ACK | 人已看过 | 不解除任何风险 | 可继续关注；复核按钮禁用直到新未复核风险 |
| AUTO_RESUME | 风险已安静2s | 原任务可继续；事件自动解除 | 无需手动关闭 |

自动事件不应挤占 Critical。打开事件/选中无人机/记录复核，均不等于风险解决。
已经在冲突区内时显示“风险未解除”，不使用“避让成功”。地图俯视近邻不一定是3D近距，详情需显示高度与表面净距。
建筑/空域组合原因是当前实现粒度，后续可细分建筑、restricted、map bounds，不能提前宣称已细分。

## 操作与边界状态

- 初始化：Proximity 显示 Initializing；初始化完成后显示鸽子数/活动条件/人工关注数。
- 空：0 active conditions；原事件队列保留 No updates / No open critical。
- 无空中无人机：Pigeon encounter 给出“先启动并等到20m以上”的反馈，不伪造鸟遭遇。
- 满8只：拒绝继续添加并提示先 Clear pigeons。
- Clear pigeons 无对象时禁用；这是测试工具，不是物理世界能力。
- 无需复核时 Record human review 禁用；复核后明确“记录成功，危险仍未解除”。
- 导出：真实 JSON 下载；失败提示重新尝试支持下载的浏览器。
- 所有新增按钮保留可见focus；active条件长文换行，详情完整原因可读。
- 参数：滑杆限定有效范围，即改即生效，不存在未保存表单；刷新恢复默认。无网络请求故无需虚构服务端加载状态。
- 数据保留：原 Updates 200，独立audit 2000，超出记录dropped计数；原未关闭Critical不裁剪。
- 不提供删除/修改审计事件；Reset 使用原确认流程，刷新则是原应用行为，需先导出。
- 暂无角色权限或远程服务，不能画“已通知值班员”“飞控已执行”等虚构状态。

## 交接命名与检查

建议 Figma：Page/Ops/Proximity、Component/Incident/Auto、Component/Incident/HumanRequired、
Component/Drawer/DroneDetail、Component/Toolbar/ProximityControls、Component/State/Unresolved。

检查项：1440/1280文字和滚动可读；选中无人机不改变地图尺寸；Esc/关闭逻辑沿用原版；
Critical/Updates能从事件进入正确无人机；复核不减少活动风险数；清风险后解除；Reset同时清鸟/事件/条件。
灰度参考稿若含比运行版本更丰富的列表筛选或详情字段，仅是后续交接建议，须按上表核对实现。
