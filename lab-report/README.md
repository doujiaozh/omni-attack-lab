/**
 * lab-report — 战报归档说明 / Battle report archive notes
 *
 * 每次对抗结束后，lab-engine/report.js 会把 Markdown 战报写入上级的 reports/ 目录：
 *   reports/battle-report-<YYYYMMDD-HHmmss-<6hex>>.md
 *
 * 前端「⬇ 下载战报」按钮直接把这份数据以 Blob 形式下载，文件名与服务端一致。
 *
 * 战报结构 / Report structure:
 *   1. 元数据表（runId / startedAt / totalMs / 输入 / 红蓝双方引擎与耗时）
 *   2. 判定（score / grade / label / summary / 还原相似度明细）
 *   3. 防御雷达五轴表（值 + 权重 + 公式）
 *   4. 红方统计（加密 / 重命名 / 死代码 / 掐断 / 密文体积 / 静态探测评分）
 *   5. 蓝方统计（vault 解包 / 字符串还原 / 死代码剪枝 / 云端模型）
 *   6. findings 与 IOC 指纹
 *   7. 时间线（timeline 分阶段）
 *   8. 三段代码快照（原始 6KB / 密文 8KB / 还原 10KB 截断）
 *
 * 随仓库附带的示例战报：docs/example-report.md
 */
