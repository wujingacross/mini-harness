# Project Guidelines & Rules

## Mermaid 图表规范与避坑规则

当在项目文档中生成或修改 Mermaid 图表时，必须遵循以下规则：

### 1. 时序图（sequenceDiagram）保留关键字避坑
Mermaid 时序图词法解析器对语法关键字**大小写不敏感**。**严禁将 Mermaid 语法关键字用作 Participant / Actor 别名或标识符**。
- **常见保留关键字（禁止作为 Actor 别名）**：
  - `loop` / `Loop`（Agent 主循环严禁使用 `Loop` 别名，否则触发 `Expecting 'ACTOR', got 'loop'` 报错）
  - `alt` / `Alt`, `opt` / `Opt`, `par` / `Par`
  - `critical` / `Critical`, `break` / `Break`, `rect` / `Rect`
  - `note` / `Note`, `over` / `Over`, `end` / `End`
  - `participant` / `Participant`, `actor` / `Actor`
- **推荐做法**：
  - 主循环使用 `Agent`、`MainLoop` 或 `ReactAgent`。
  - 参与者别名一律使用具名、非保留字的专有名词（如 `Client`, `SessionStore`, `DiskPersistence`）。

### 2. 节点文本特殊字符转义
- 在 `graph` / `flowchart` 中，若节点文案包含括号 `()`、方括号 `[]`、冒号 `:`、斜杠 `/` 或空格，必须使用双引号包裹：
  `A["ReactLoopAgent (主循环)"] --> B["Session (事件流)"]`

### 3. 多 Participant 的 Note 标注
- `Note over A,B: 描述文本` 中，`A` 与 `B` 必须已预先显式定义为 `participant` 或 `actor`。
