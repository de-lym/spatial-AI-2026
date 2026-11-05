# AIRSPACE Proximity — FINAL separate implementation package

这是独立可运行副本，基于 `de-lym/spatial-AI-2026` 的
`claude/semantic-model-delivery-system` 分支，固定版本：
`f7bdcf0ad371ed5e9c2a9248f539ceefa7610b04`。
未修改、提交、推送原仓库，也没有创建 PR。原 README 保存在 `docs/README-original.md`。

## 启动

解压后进入本目录：

```sh
python3 -m http.server 8000
```

浏览器打开 `http://localhost:8000`。无需安装前端依赖；Three.js 已随原项目提供。
不要直接双击 `index.html`，模块需要 HTTP。Node >=20 仅用于测试。

## 已工作的三个功能

1. **无人机–无人机**：保留原有航迹预测、减速、让行、占用停机坪优先、早出发优先、ID 决胜和死锁绕行。
   新增实际步长内的分段连续轨迹检查，对最终联合动作再次仲裁；追加 guard 使用完整 `cfg.sepM`，不是原 guard 的 55% 门槛。
   持续阻塞升级人工复核；已发生间距不足明确报告，不用瞬移掩盖。
2. **无人机–建筑**：保留原建筑 mesh 派生的 3D 包围盒、净距膨胀、允许空域并集、A* 候选和曲线复验。
   新增实际移动各段复验，以及详情中的最近建筑**表面**净距；规划失败保持阻塞，当前位置本身无效立即人工升级。
3. **无人机–鸽子**：Advanced → Proximity → **Pigeon encounter**。
   在空中无人机的预测航迹附近添加可见的灰色鸽子标记。它每 0.4–1.2 模拟秒随机改向，使用固定种子可复现。
   系统预测含不确定缓冲的近遇，尝试允许空域内的侧移/高度调整并接回原任务；最终动作仍受建筑、其他无人机和鸽子检查。
   无可行避让则停止前进；若鸽子仍可能进入悬停位置，明确 `HUMAN_REQUIRED`。

## 演示路线

- 进入 Stage 4 / Live Flight，Run；等待空中无人机升至 20m 以上。
- Advanced → Proximity → Pigeon encounter。可先选无人机，优先给选中者制造遭遇；最多 8 只。
- 看左侧 Incident Queue：`AUTO_*` 在 Updates，`HUMAN_REQUIRED` 在 Critical；点击跳到对应无人机。
- 无人机 Flight details 显示 proximity 原因及建筑表面净距；History 保留事件。
- **Record human review** 只记录已复核，不解除风险、不发飞控指令。
- **Clear pigeons** 是模拟场景清除工具；不是现实操作员清除动物的能力。风险安静 2s 后自动解除事件。
- **Export session JSON** 下载当前设置、风险对象、事件和坐标。Reset/刷新会清空会话，请先导出。
- 原有 Conflict test、Tall tower、Raise hazard HZ-1 仍在 Route cost & separation。

## 配置（全部为课堂示例，非航空认证参数）

| 配置 | 默认 | 修改位置 |
|---|---:|---|
| 无人机间距 | 30m | 原 Advanced 滑杆 / spatial.js `cfg.sepM` |
| 无人机预测窗 | 6s | 原滑杆 / `cfg.lookS` |
| 建筑净距（参考位置到包围盒） | 6m | 原滑杆 / `cfg.clearanceM` |
| 鸽子净距 + 不确定缓冲 | 18m + 4m | 新滑杆 / proximity.js |
| 鸽子预测窗 | 2s | 新滑杆 |
| 持续风险升级时间 | 8s | 新滑杆 |
| 风险清除确认间隔 | 2s | proximity.js `recoveryS` |
| 避让候选水平距离 | 35m | proximity.js `escapeM` |

单位：场景 x 东、y 上、z 南；1 单位=5m。导出 `positionM` 为 east/north/up 米。

## 文件入口

- `CLAUDE_IMPLEMENTATION.md`：接入、约束、逐步验收和不能做的过度承诺。
- `docs/ARCHITECTURE_AND_GAPS.md`：实际架构审计、实现边界。
- `docs/UX_HANDOFF.md`：当前界面信息与状态交接。
- `docs/TEST_GUIDANCE.md` / `docs/VERIFICATION.md`：测试步骤、实际结果。
- `proximity.js`：纯几何、阈值、鸽子运动模型。
- `proximity-integration.js`：模拟时钟适配、避让、仲裁、生命周期、导出与 UI。
- `tests/proximity.test.js`：无第三方依赖的自动测试。
- `tests/browser-acceptance.cjs`：可选真实浏览器验收（另装 Playwright，Chrome）。
- `SOURCE_MANIFEST.json`：原始快照与文件差异；包外同名 ZIP、补丁及校验文件便于单独分发。

## 已知边界

这是可运行的教学模拟，不是可部署的航空防撞系统。无真实感知、追踪、风、制动动力学、通信或电池模型；
鸽子未来方向未知，恒速预测和缓冲不能保证避撞。无人机/鸽子按位置点加净距近似，未按旋翼实体建模。
建筑用轴对齐包围盒而非精确三角网表面。没有人工 Return/Land 命令，原有禁用按钮保持原状。
事件是本机会话数据；自动恢复不需要人工授权，但“复核”绝不代表危险解除。
