# JLCEDA MCP 核心痛点开发计划

**日期**: 2026-05-11  
**范围**: 对象身份贯通、exact/fuzzy 边界、任务级 review、设计意图、规则缺失审查、统一证据链。  
**排除项**: MCP 服务诊断、连接质量、直接编辑/放置器件。  
**输入依据**: `docs/frontier-painpoints-spec-2026-05-11.md` 中 P1/P2/P5/P6/P7，以及当前 `shared/`、`mcp-bridge/src/mcp/`、`mcp-bridge/src/plugins/`、`mcp-hub/src/server/mcp/` 实现。

## 1. Development Assumptions

- 本轮先设计可执行 plan，不直接实现功能代码。
- 所有新能力默认以 MCP tool 暴露，同时在 `shared/` 固化请求/响应类型。
- 工具输出必须采用 evidence-bound schema；没有证据时返回 gap，不输出专家式断言。
- 设计意图 inference 先做可解释分类，不做不可验证的最终 SI/PI/EMC 判断。
- 任务级 review 优先组合已有快照能力，不直接依赖 raw `api_invoke`。

## 2. What Can Be Merged

### 2.1 Merge Into One Shared Foundation

以下痛点应先合并开发为一个共享底座，否则后续每个工具都会重复造 schema：

1. **对象身份贯通**
2. **exact / fuzzy 边界**
3. **证据链不统一**

合并后的底座建议命名为 `design-object-core`，包含：

- `DesignObjectRef`: 统一表示 schematic component、PCB component、pad、pin、net、BOM item、rule。
- `EvidenceRef`: 统一绑定 document/page/primitive/net/pin/rule/capturedAt/sourceTool。
- `MatchResult`: 统一表达 `exact_match`、`no_exact_match`、`ambiguous`、`suggestions`。
- `ObjectIdentityGraph`: 统一连接 schematic object、PCB object、net、pad/pin、BOM metadata。

### 2.2 Merge Into One Review Layer

以下痛点应合并为一个任务级 review engine，而不是分散成多个一次性工具：

1. **快照不是答案**
2. **设计意图缺失**
3. **规则缺失也应被审查**

合并后的能力建议命名为 `engineering-review-core`，包含：

- `ReviewProfile`: `usb_basic`、`ldo_decoupling`、`crystal_layout`、`high_impedance_input`、`power_domain`、`net_route_basic`。
- `NetClassification`: 高速、差分、时钟、电源、地、模拟高阻、反馈、普通信号。
- `ConstraintExpectation`: 某类 net/profile 应存在的规则，如 differential pair、net class、clearance、length、pad-pair 等。
- `ReviewFinding`: severity、claim、evidenceRefs、missingEvidence、recommendedAction、confidence。

### 2.3 Merge Testing Fixtures

所有痛点应共享一套 replay/fixture 测试数据：

- schematic fixture: component + pins + netlist + cross-page net。
- PCB fixture: component + pads + traces + layers + constraints。
- mismatch fixture: schematic 有对象但 PCB 无对象、PCB 有 footprint 但 BOM 缺失。
- ambiguous fixture: `U1`、`U10`、`U11`、不存在 `U16`。

## 3. What Can Be Built On Existing Responsibilities

### 3.1 Existing Bridge Responsibilities To Reuse

- `schematic_locate`: 已经支持按器件/网络定位，并返回 pin-net 细节；适合承载 exact/fuzzy contract 的改造。
- `schematic_read` / `schematic_review`: 已经构建原理图语义快照与跨页 netlist；适合支撑对象身份图。
- `pcb_snapshot`: 已经读取 PCB components、pads、nets、layers、traces；适合支撑 PCB 侧对象身份与 review evidence。
- `pcb_geometry_analyze`: 已经输出 loop area proxy、reference/route/spatial relations；适合支撑任务级 review。
- `pcb_constraint_snapshot`: 已经读取 DRC rules、差分对、等长组、网络类、pad/via 约束；适合支撑规则缺失审查。
- `api_search`: 已有离线 API 文档与 ranking 逻辑；适合补充 capability catalog，但不应作为 review 主路径。

### 3.2 Existing Hub Responsibilities To Reuse

- `ToolDispatcher`: 已经统一 MCP tool dispatch 与 `structuredContent` 输出；适合增加新工具分发。
- `mcp-tool-definitions.json`: 已经是工具 schema source；适合新增工具输入输出说明。
- `agent-instructions.md`: 已经指导 agent 优先基础工具；适合加入新工具优先级规则。
- `tool-dispatcher.test.ts`: 已经覆盖工具分发；适合新增新工具转发测试。

### 3.3 Existing Shared Contracts To Extend

- `shared/schematic-locator.ts`: 可扩展或被新 `shared/design-object-core.ts` 引用。
- `shared/pcb-geometry-engine.ts`: 已定义 PCB snapshot 与 analysis schema，可作为 evidence source。
- `shared/pcb-constraint-engine.ts`: 已定义 constraint snapshot schema，可作为 rule evidence source。

## 4. What Needs To Start From Zero

以下能力当前没有明确业务职责或契约，需要从零建立：

1. `shared/design-object-core.ts`
   - 统一对象身份、匹配状态、证据引用和 gap schema。
2. `mcp-bridge/src/plugins/design-object-engine/`
   - 聚合 schematic、PCB、BOM、net、pin/pad 的 identity graph。
3. `mcp-bridge/src/mcp/design-object-lookup-handler.ts`
   - 暴露 exact-first object lookup。
4. `shared/engineering-review-core.ts`
   - 定义 review profile、finding、net classification、constraint expectation。
5. `mcp-bridge/src/plugins/engineering-review-engine/`
   - 聚合 geometry/constraint/object identity 输出 task-level findings。
6. `mcp-bridge/src/mcp/engineering-review-handler.ts`
   - 暴露任务级 review tool。
7. BOM identity adapter
   - 当前只看到 manufacture/BOM file API 资源，没有已实现 BOM item 语义归一化层。
8. design intent classifier
   - 需要从 net name、component role、constraint、geometry 和 optional user hints 生成保守 classification。

## 5. External Resources And Local Archival Status

### 5.1 Already Archived Locally

- JLCEDA official/pro API projection exists at `mcp-bridge/resources/jlceda-pro-api-doc.json`.
- API generator exists at `tool/generate_jlceda_api_doc.py` and states it extracts official `index.d.ts` into AI-searchable JSON.
- `api_search` consumes the local JSON projection and tests ranking behavior.
- Local API projection includes relevant callable APIs:
  - BOM/manufacturing: `eda.pcb_ManufactureData.getBomFile`, `getInteractiveBomFile`, BOM template APIs.
  - PCB component/pads: `eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId`, `getState_Designator`, `getState_Pads`.
  - Schematic component/pins: `eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId`.
  - Rules/constraints: `eda.pcb_Drc.getCurrentRuleConfiguration`, `getAllDifferentialPairs`, `getAllNetClasses`, `getAllPadPairGroups`.
  - Netlist: `eda.sch_ManufactureData.getNetlistFile`, `eda.pcb_ManufactureData.getNetlistFile`, `eda.pcb_Net.getNetlist`.

### 5.2 Present But Ignored By Git

- `references/` exists locally and contains `references/easyeda`, but root `.gitignore` ignores `references/*`.
- `docs/` was previously ignored; current tracked plan requires explicit unignore for selected docs.

### 5.3 Not Yet Archived Or Not Verified

- MCP external spec pages are referenced in `docs/frontier-painpoints-spec-2026-05-11.md`, but not vendored locally.
- AI+EDA papers are linked in `docs/frontier-painpoints-spec-2026-05-11.md`, but PDFs are not archived locally.
- JLCEDA live API behavioral samples for BOM file shape, PCB/schematic cross-probe IDs, and DRC check result format are not yet recorded as fixtures.

### 5.4 Required Resource Preparation Before Implementation

- Capture one real schematic+PCB project trace with:
  - `schematic_locate` exact hit and no-hit.
  - `schematic_review` or netlist export.
  - `pcb_snapshot` with components/pads/nets.
  - `pcb_constraint_snapshot` with rule/differential/net class data.
  - BOM file output shape from `eda.pcb_ManufactureData.getBomFile` or equivalent.
- Store sanitized fixtures under a non-ignored test fixture path, e.g. `mcp-bridge/src/test-fixtures/design-object/`.
- Record API signatures used by new adapters in tests, not only docs.

## 6. Per-painpoint Development Plans

### 6.1 Object Identity Unification

**Goal**: A user can ask for `U1` and receive one unified object that connects schematic symbol, PCB footprint, pins/pads, nets and BOM metadata when available.

**Can merge with**

- exact/fuzzy boundary and evidence chain foundation.

**Can build on**

- `schematic_locate`, `schematic_read`, `schematic_review`.
- `pcb_snapshot` component/pad readers.
- Local BOM APIs from `mcp-bridge/resources/jlceda-pro-api-doc.json`.

**Needs from zero**

- `DesignObjectRef`, `ObjectIdentityGraph`, BOM adapter, cross-domain matching heuristics.

**Implementation steps**

1. Define `shared/design-object-core.ts` with `DesignObjectLookupRequest`, `DesignObjectLookupResponse`, `DesignObjectMatch`, `DesignObjectRef`, `EvidenceRef`, `EvidenceGap`.
2. Add bridge plugin `design-object-engine` that builds a normalized graph from schematic and optionally PCB snapshots.
3. Implement schematic adapter by reusing `schematic_locate` internals or extracting shared snapshot builders.
4. Implement PCB adapter from `pcb_snapshot(include.components/pads/layers)` result, matching by designator and pad net.
5. Implement BOM adapter after recording real BOM output shape; until then mark BOM as `gap: bom_shape_unverified`.
6. Add hub tool definition `design_object_lookup` and dispatcher forwarding.
7. Add tests for schematic-only, PCB-only, both, BOM unavailable and cross-domain mismatch.

**Acceptance criteria**

- Query existing `U1` returns `status: exact_match` and includes schematic component id, pins, nets and evidence refs.
- If PCB context is available, same response includes PCB primitive id, layer, position, pads and pad nets.
- If BOM is unavailable or shape unknown, response includes explicit `evidenceGaps` and does not fabricate BOM fields.
- Response includes one stable `designObjectId` for the unified object.

### 6.2 Exact / Fuzzy Boundary

**Goal**: A nonexistent designator such as `U16` must never silently return `U1` as a factual match.

**Can merge with**

- object identity lookup and shared `MatchResult` contract.

**Can build on**

- `schematic_locate` scorer, current tests around exact designator ranking.

**Needs from zero**

- Explicit match mode and response status contract.

**Implementation steps**

1. Add `matchMode: exact|prefix|fuzzy` to new `design_object_lookup`; keep default as `exact`.
2. Add `status: exact_match|no_exact_match|ambiguous|suggestions_only`.
3. Keep fuzzy candidates only in `suggestions`, never `matches`, unless caller explicitly asks `matchMode: fuzzy`.
4. Backport safer response metadata to `schematic_locate` if backward-compatible: add `exactMatchCount`, `suggestions`, `matchPolicy` without removing existing fields.
5. Add tests for `U1`, `U16`, `U1*`, net names and ambiguous component names.

**Acceptance criteria**

- `design_object_lookup({ query: "U16" })` returns `no_exact_match`, zero factual matches and possible suggestions.
- `design_object_lookup({ query: "U1" })` returns exactly `U1` even if `U10` and `U11` exist.
- Fuzzy mode is opt-in and visibly marked in response metadata.
- Agent instruction says suggestions are not facts.

### 6.3 Snapshot Is Not An Answer

**Goal**: Convert raw PCB/schematic/constraint facts into task-level review findings for concrete questions.

**Can merge with**

- design intent classification and rule-missing review layer.

**Can build on**

- `pcb_snapshot`, `pcb_geometry_analyze`, `pcb_constraint_snapshot`, `schematic_locate`.

**Needs from zero**

- `engineering_review` schema, review profiles, finding severity model.

**Implementation steps**

1. Define `shared/engineering-review-core.ts` with request, profile, finding, evidence, gap and verification status.
2. Implement `engineering-review-engine` plugin that orchestrates existing geometry and constraint plugins.
3. Start with two profiles: `net_route_basic` and `schematic_connectivity`.
4. Add profile-specific rules as pure functions that consume normalized snapshots.
5. Return findings with `severity`, `claim`, `evidenceRefs`, `recommendedAction`, `confidence`, `missingEvidence`.
6. Add hub tool definition and dispatcher tests.

**Acceptance criteria**

- Review without required PCB context returns `blocked` with missing evidence, not fabricated findings.
- Review for one net returns findings or `no_findings` with evidence summary.
- Every finding has at least one `EvidenceRef` or explicit `missingEvidence`.
- Common questions map to profiles in agent instructions.

### 6.4 Design Intent Classification

**Goal**: Classify nets/components into conservative intent classes such as power, ground, differential, clock, high-speed, analog/high-impedance, feedback or ordinary signal.

**Can merge with**

- engineering review layer and rule-missing review.

**Can build on**

- Net names from schematic/PCB snapshots.
- Constraint objects: differential pairs, net classes, equal length groups.
- Component/pin names from schematic locate.

**Needs from zero**

- Net classifier with evidence-scored rules and optional user hints.

**Implementation steps**

1. Define `NetClassification` and `IntentEvidence` in `shared/engineering-review-core.ts`.
2. Implement deterministic classifiers:
   - net name patterns: `GND`, `VCC`, `VBUS`, `USB_DP`, `USB_DN`, `XTAL`, `CLK`, `FB`.
   - paired naming patterns: `_P/_N`, `DP/DN`, `+/-`.
   - constraint evidence: existing differential pair/net class/equal length group.
   - pin/component hints: crystal pins, regulator feedback pins, op-amp inputs.
3. Classifier returns `confidence` and evidence, not final truth.
4. Allow user-provided hints in request to override or supplement classifier.
5. Add tests for power, ground, USB pair, clock, feedback and unknown net.

**Acceptance criteria**

- `USB_DP/USB_DN` classify as likely differential/high-speed only when pair evidence or naming evidence exists.
- `FB` near regulator/op-amp returns feedback/high-impedance with low/medium confidence and evidence.
- Unknown nets remain `ordinary_or_unknown`, not overclassified.
- All classifications include reason and source evidence.

### 6.5 Missing-rule Review

**Goal**: Detect not only current rule violations, but missing expected constraints for important nets.

**Can merge with**

- design intent classification and engineering review.

**Can build on**

- `pcb_constraint_snapshot` rules/differential pairs/equal length/net classes/pad pair groups.
- `pcb_geometry_analyze` route facts.

**Needs from zero**

- Constraint expectation matrix by intent/profile.

**Implementation steps**

1. Define `ConstraintExpectation` and `MissingConstraintFinding`.
2. Map classifications to expectations:
   - differential/high-speed pair: differential pair exists, spacing/width rules exist, optional length skew rule.
   - clock: net class or route constraints expected.
   - power domain: net class or width/current intent expected.
   - sensitive feedback/high impedance: clearance/short route/guarding manual check expected.
3. Compare expected constraints against `pcb_constraint_snapshot`.
4. Generate `missing_constraint` findings with severity based on confidence and profile.
5. Add tests for missing USB differential pair, existing pair, missing net class and unknown net no-op.

**Acceptance criteria**

- If `USB_DP/USB_DN` classify as differential but no differential pair exists, review returns a `missing_constraint` finding.
- If differential pair exists, no missing-pair finding is emitted.
- Low-confidence classification yields warning/manual-check, not error.
- Findings cite classification evidence and constraint snapshot evidence.

### 6.6 Unified Evidence Chain

**Goal**: Every match, classification and finding can be traced back to source object, tool, field and capture time.

**Can merge with**

- shared design object foundation and engineering review output.

**Can build on**

- Current structured tool responses and existing primitive ids/net names/page ids.

**Needs from zero**

- Cross-tool `EvidenceRef` schema and helper builders.

**Implementation steps**

1. Add `EvidenceRef` to `shared/design-object-core.ts` and re-export or reuse in review core.
2. Create bridge helper functions to build evidence refs from schematic, PCB, rule and BOM sources.
3. Add `EvidenceGap` schema for absent context, unavailable API, unsupported source or unverified shape.
4. Add `capturedAt` at top-level and per evidence source where needed.
5. Update new tools to return `result`, `evidence`, `evidenceGaps`, `summary`.
6. Add tests that reject findings without evidence or gap.

**Acceptance criteria**

- `design_object_lookup` exact match includes evidence refs for schematic component and pins.
- `engineering_review` finding includes evidence refs for net/primitive/rule or explicit gap.
- Response consumers can link from finding to raw source field path.
- Large evidence lists are summarized without losing source ids.

## 7. Recommended Implementation Order

1. **Foundation A: evidence and match schema**
   - `shared/design-object-core.ts`
   - test-only fixtures
   - no tool surface change yet
2. **Foundation B: strict object lookup MVP**
   - schematic exact/no-match/suggestions
   - hub tool definition and dispatcher
3. **Foundation C: PCB/BOM enrichment**
   - PCB designator/pads/nets enrichment
   - BOM adapter behind explicit gap until real output fixture exists
4. **Review A: engineering review core schema**
   - `shared/engineering-review-core.ts`
   - `net_route_basic` and `schematic_connectivity`
5. **Review B: net classification**
   - deterministic classifier with evidence and confidence
6. **Review C: missing-rule findings**
   - expectation matrix against constraint snapshot
7. **Docs and agent instructions**
   - README tool descriptions
   - `agent-instructions.md` priority and no-fabrication rules
8. **Regression and fixture hardening**
   - replay tests for exact/no-match, partial contexts, missing constraints and review output shape

## 8. High-level Acceptance Matrix

| Painpoint | Primary tool/API | Minimum acceptance |
| --- | --- | --- |
| Object identity | `design_object_lookup` | `U1` returns unified schematic + PCB object when available |
| Exact/fuzzy | `design_object_lookup` / `schematic_locate` metadata | `U16` returns no exact match, `U1` suggestions never become facts |
| Snapshot to answer | `engineering_review` | one net/profile returns evidence-bound findings |
| Design intent | `engineering_review` classifier | USB/clock/power/feedback classifications include confidence and evidence |
| Missing rules | `engineering_review` constraint checks | missing differential pair/net class emits explicit finding |
| Evidence chain | shared `EvidenceRef` | every match/finding has evidence refs or explicit gaps |

## 9. Open Questions Before Coding

- BOM output shape must be captured from live EDA before implementing hard schema.
- Cross-probe identity between schematic and PCB may not be stable; initial matching may need designator + footprint + net overlap confidence.
- Should `schematic_locate` be changed in place or left backward-compatible while `design_object_lookup` becomes strict by default?
- Which review profiles should be first after `net_route_basic`: USB, LDO decoupling, crystal, high impedance or power domain?
- Where should sanitized EDA fixtures live so they are tracked and do not expose private designs?

