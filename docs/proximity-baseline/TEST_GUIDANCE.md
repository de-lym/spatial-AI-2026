# 测试与验收

## 自动几何/模型测试

Node >=20，在包根目录运行：

```sh
npm test
```

不需要 npm install。七项测试涵盖：交叉/对头连续检测、垂直分离、真实转弯/升降时间、建筑表面距离、
已有违约束时只允许分离、随机鸟可复现、原规划器绕障与全封闭失败、事件去重与解除（部分合并在同一test）。

## 浏览器回归

启动 README 的静态服务器。可人工执行下表；自动脚本需要在本机安装 Playwright 和 Chrome：

```sh
npm install --no-save --package-lock=false playwright
AIRSPACE_URL=http://127.0.0.1:8000 node tests/browser-acceptance.cjs
```

可选脚本生成截图/验收JSON到 docs；在副本执行，不在原仓库执行。
不想安装依赖可以只手动验收；运行应用本身没有该依赖。

| 场景 | 步骤 | 预期 |
|---|---|---|
| 原配送回归 | Stage4，关闭新订单输入，运行240模拟秒 | 首四笔完成；没有proximity阻塞遗留 |
| 无人机冲突 | 原Conflict test | 减速/等待/绕行；Updates记录；持续阻塞升级Critical |
| 建筑绕路 | 原Tall tower/Climb；调净距 | 合法候选绕路；不能穿过膨胀建筑 |
| 无可行路线 | Raise hazard HZ-1覆盖目标 | NO_VALID_ROUTE；相关近距/空域持续风险升级 |
| 鸽子遭遇 | 等空中无人机>20m，点Pigeon encounter | 灰色鸟出现；AUTO_EVADE或AUTO_HOLD；无法避免时HUMAN_REQUIRED |
| 无处可避 | 完全封闭空域/已在鸟缓冲区 | 不承诺安全；原任务保留，记录人工处理 |
| 人工复核 | Record human review | HUMAN_ACK，Critical仍存在，不能关闭危险 |
| 恢复 | 清鸟/清障，运行超过2s | 自动解除相应事件；正常动态约束仍有效 |
| 日志 | Export session JSON | 下载含阈值、坐标、动作、对象与dropped计数的JSON |
| 重置 | Reset →确认 | 原配送重置；鸟/风险/audit清空 |
| 布局与键盘 | 1440×900 / 1280×800，Tab、Esc | 新操作可聚焦；抽屉滚动；无整页横溢出 |

## 自动脚本的人工构造场景

脚本通过 window.__sim 在独立页面注入覆盖全域的 QA-CLOSED volume，以可重复验证不可能避让。
这不是实际产品按钮，也不是新增真实空域服务。测试后用新页面/恢复原始世界，不把 QA volume 当正式配置。
原 resetWorld 只重置原 HZ-1，不移除测试自行增加的 QA-CLOSED，脚本最终重置只断言新增 proximity 状态清空。

## 必须如实报告的限制

单条基线轨迹的最小间距不是所有初始条件的证明；随机鸟可撞入停止位置；有限候选找不到解不等于数学上无解。
当前无物理制动模型和真实鸟感知。不要以这些测试宣称真实飞行安全、认证、航空标准合规。
