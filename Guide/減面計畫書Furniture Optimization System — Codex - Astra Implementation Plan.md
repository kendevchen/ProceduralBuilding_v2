# Furniture Optimization System — PLAN

## Objective

Optimize the current procedural building project's furniture rendering system so that future buildings can support:

- More floors
- More rooms
- More furniture
- More complex building geometry
- More complex floor plates
- Atriums / voids
- Irregular building shapes
- Multiple buildings in the future

The current performance concern is primarily:

1. Large numbers of furniture objects.
2. Some furniture assets have unnecessarily high triangle counts.

Exterior walls and windows currently do **not** appear to be the main performance problem and should not be modified unless analysis proves otherwise.

The goal is NOT to blindly reduce polygon counts.

The goal is to build a reusable:

**Furniture Optimization System**

based on four layers:

1. Visibility Culling
2. Runtime LOD
3. Mesh Simplification
4. Instancing / Geometry Sharing

---

# IMPORTANT: CURRENT MODE = PLAN ONLY

For the first task:

**DO NOT MODIFY CODE.**

**DO NOT MODIFY ANY 3D ASSET.**

**DO NOT RUN MESH SIMPLIFICATION.**

**DO NOT GENERATE LOD MESHES YET.**

First inspect the existing project and produce an implementation plan.

Avoid unnecessary repository-wide reading.

Only inspect files relevant to:

- Furniture generation
- Furniture loading
- Furniture prototypes
- Scene creation
- Rendering
- Geometry management
- Materials
- Instancing
- Culling
- Camera / visibility logic
- Existing LOD systems

Minimize unnecessary context/tool usage.

---

# Architecture Principle

The furniture optimization system should remain as independent as reasonably possible from the procedural building generator.

Future changes to:

- Building shape
- Floor count
- Room topology
- Building dimensions
- Procedural layout rules
- Facade complexity

should NOT require rewriting the furniture optimization pipeline.

Target architecture:

```text
Procedural Building
        │
 ┌──────┼───────────┐
 ▼      ▼           ▼
Structure Rooms   Furniture
         │           │
         ▼           ▼
   Visibility    Furniture
     Logic       Optimizer
                    │
          ┌─────────┼──────────┐
          ▼         ▼          ▼
         LOD    Simplifier  Instancing
```

Do not over-engineer this architecture.

Prefer the smallest reusable system compatible with the existing project.

---

# LAYER 1 — Visibility Culling

Analyze the current visibility behavior.

Determine whether the project already uses:

- Frustum Culling
- Room-based visibility
- Floor-based visibility
- Occlusion Culling
- Object-level Culling

Determine whether furniture that cannot currently contribute to the rendered image is still being submitted/rendered.

Evaluate the potential usefulness of:

### Frustum Culling

Furniture outside the camera frustum should not render.

### Room / Floor Culling

Because this is a procedural building system, room and floor information may provide stronger visibility information than generic geometry tests.

Example:

```text
Camera
  │
  ▼

Current Room
→ Render

Adjacent visible rooms
→ Render

Hidden rooms
→ Cull

Other floors not currently visible
→ Potential Cull
```

### Occlusion Culling

Evaluate whether occlusion culling is necessary.

Do NOT implement complex occlusion systems unless the current architecture and profiling data justify them.

Report:

- Existing behavior
- Missing functionality
- Expected benefit
- Implementation complexity

---

# LAYER 2 — Runtime LOD

Evaluate a furniture LOD system.

Prefer:

**Projected Screen Size / Screen-space Size**

over simple world-space distance whenever practical.

Do NOT assume:

```text
0–20m = LOD0
20–50m = LOD1
50m+ = LOD2
```

because furniture varies significantly in physical size.

Instead:

```text
Large Screen Coverage
        ↓
       LOD0

Medium Screen Coverage
        ↓
       LOD1

Small Screen Coverage
        ↓
       LOD2

Extremely Small
        ↓
       Cull
```

Analyze:

- Camera system
- Projection
- Object bounding size
- Scene scale

and propose an appropriate runtime LOD selection mechanism.

Also consider LOD hysteresis if necessary to prevent rapid switching near thresholds.

Do not implement it yet.

---

# LAYER 3 — Mesh Simplification

Mesh Simplification should NOT be applied to every furniture asset.

First create a plan for a:

**Furniture Analyzer**

The analyzer should obtain, where practical:

```text
Furniture Name
Prototype / Asset ID

Triangle Count
Vertex Count
Geometry Count
Material Count

Instance Count

Bounding Box
Object Size

Geometry Shared?
Instanced?
Current LOD?
```

If furniture contains multiple child meshes, calculate:

1. Individual mesh statistics.
2. Total furniture statistics.

---

# Performance Ranking

Start with a simple metric:

```text
Triangle Cost Score
=
Triangle Count × Instance Count
```

Example:

```text
DiningChair
18,000 × 120
= 2,160,000

Sofa
85,000 × 12
= 1,020,000

Vase
110,000 × 1
= 110,000
```

Therefore:

Do NOT rank optimization priority based only on triangle count.

A relatively simple object repeated hundreds of times may be more expensive than one extremely detailed object.

Where useful, separately report:

```text
Triangle Cost
Instance Count
Material Count
Geometry / Mesh Count
Potential Draw-call Cost
```

Do not create an unnecessarily complicated scoring algorithm in the first version.

---

# Furniture Optimization Classification

After collecting data, classify expensive furniture according to the most appropriate optimization.

Example:

```text
Furniture       Cull    LOD    Simplify    Instance

DiningChair      ✓       ✓        ?           ✓

Sofa             ✓       ✓        ✓

Plant            ✓       ✓        ✓           ✓

Table            ✓                            ?
```

The purpose is to determine whether a performance problem should be solved by:

```text
Visibility problem
→ Culling

Distance / screen-size problem
→ LOD

High-poly geometry
→ Mesh Simplification

Large repeated population
→ Instancing

Combination
→ Multiple techniques
```

Do NOT assume every performance problem requires polygon reduction.

---

# CRITICAL — USER APPROVAL GATE

Before ANY furniture asset is simplified:

**STOP.**

Present the candidate list to the user.

For every proposed Mesh Simplification candidate report:

```text
Furniture Name
Original Triangle Count
Instance Count
Performance Score
Reason for Optimization

Recommended:
LOD0 triangle target
LOD1 triangle target / percentage
LOD2 triangle target / percentage

Expected benefit
Potential visual risk
```

Example:

```text
1. DiningChair

Original:
18,000 tris

Instances:
120

Cost:
2.16M

Recommendation:

LOD0
100%

LOD1
35%

LOD2
10%

Recommended optimization:
LOD + Instancing
```

Then ask:

**Which furniture assets are approved for Mesh Simplification / LOD generation?**

The user may:

- Approve all.
- Approve selected furniture.
- Reject selected furniture.
- Change LOD ratios.

### Mandatory rule

If the user approves:

```text
Chair
Sofa
```

ONLY Chair and Sofa may enter Mesh Simplification.

Do not automatically include additional furniture.

No approval = no simplification.

---

# Mesh Simplification Implementation

Only after explicit approval should implementation begin.

The target pipeline should resemble:

```text
Original Furniture
        │
        ▼
Mesh Simplifier
        │
 ┌──────┼──────┐
 ▼      ▼      ▼
LOD0   LOD1   LOD2
100%   ~35%   ~10%
```

These percentages are starting recommendations only.

Actual ratios may vary depending on:

- Geometry
- Silhouette
- Furniture type
- Simplifier quality
- Visual results

Original geometry must remain available.

Do NOT destructively overwrite the only original mesh.

---

# Simplification Responsibility

The LLM should NOT manually analyze or rewrite large mesh geometry.

Do NOT place large vertex/index buffers into model context unless absolutely necessary for debugging.

Do NOT ask the LLM to decide triangle-by-triangle simplification.

Correct architecture:

```text
Codex / Astra
     │
     ▼
Implement Pipeline
     │
     ▼
Local Simplification Library
     │
     ▼
Process Mesh
     │
     ▼
LOD Geometry
```

Actual:

- Edge collapse
- QEM calculations
- Vertex processing
- Triangle removal

should be performed by code / local libraries.

This is important for both performance and token efficiency.

---

# LAYER 4 — Instancing / Geometry Sharing

Analyze repeated furniture prototypes.

Determine:

- Which furniture types appear repeatedly.
- Whether repeated objects currently share geometry.
- Whether they share materials.
- Whether each copy creates independent geometry.
- Whether instanced rendering is already used.

Example:

```text
Chair
20K tris
×
150 objects
```

This may be a more important optimization target than:

```text
Sculpture
150K tris
×
1 object
```

Recommend Instancing when appropriate.

The ideal relationship is:

```text
High Triangle Count
→ Simplification

High Instance Count
→ Instancing

High Triangle Count + High Instance Count
→ Simplification + LOD + Instancing
```

Do not force Instancing if it conflicts with required per-object behavior.

Report compatibility risks first.

---

# Token Efficiency Rules

This project is being developed with LLM-based coding agents, so unnecessary context usage should be avoided.

## Avoid

- Re-reading the entire repository repeatedly.
- Loading every furniture asset into model context.
- Reading raw vertex/index data unless necessary.
- Manually analyzing every furniture mesh.
- Performing repetitive furniture-by-furniture edits.
- Repeating already established architecture analysis.

## Prefer

```text
Agent
  ↓
Understand Architecture Once
  ↓
Build Analyzer
  ↓
Local Program Executes
  ↓
Generate Statistics
  ↓
Agent Reads Small Report
  ↓
Make Optimization Decision
```

The number of furniture assets should not cause proportional LLM token consumption.

---

# Recommended Development Phases

## PHASE 1 — Architecture Analysis

Recommended:

**Model: Astra**

**Effort: High**

Tasks:

- Understand relevant architecture.
- Analyze the four optimization layers.
- Identify relevant files.
- Identify existing optimization mechanisms.
- Propose minimal architecture.

### STOP

Report findings before implementation.

---

# PHASE 2 — Furniture Analyzer

After Plan approval:

Recommended:

**Model: Astra**

**Effort: Medium**

Implement only the analyzer.

Collect:

```text
Triangles
Vertices
Instances
Materials
Geometry count
Bounding information
Sharing / Instancing status
```

Generate a compact performance report.

Do NOT implement Mesh Simplification yet.

---

# PHASE 3 — Analyze Performance Report

Recommended:

**Model: Astra**

**Effort: High**

Use the analyzer output to classify bottlenecks.

Determine which objects primarily need:

```text
Culling
LOD
Simplification
Instancing
Combination
No action
```

Produce optimization candidates.

### STOP — USER APPROVAL GATE

Ask the user which furniture assets may be simplified.

Do not continue Mesh Simplification automatically.

---

# PHASE 4 — Implementation

After approval:

Recommended default:

**Model: Astra**

**Effort: Medium**

Implement approved components according to the agreed Plan.

Potential order:

```text
Visibility improvements
        ↓
Runtime LOD framework
        ↓
Approved Mesh Simplification
        ↓
Instancing
```

The exact order may change if Phase 1 profiling shows a clearly better sequence.

Use High effort only when architectural problems arise.

---

# PHASE 5 — Mesh Simplification Execution

Actual furniture simplification should be executed by the local program / simplification library.

It should NOT require LLM reasoning per furniture asset.

Example:

```text
Approved Assets
      ↓
Local Simplifier
      ↓
LOD1
LOD2
      ↓
Save / Cache
```

Recommended:

**No LLM required for the actual geometry computation.**

---

# PHASE 6 — Build / Debug

For normal implementation bugs:

Recommended:

**Model: Sol**

**Effort: Medium**

Examples:

- Compile errors
- Type errors
- Import errors
- Small runtime bugs
- Threshold adjustments
- Straightforward integration fixes

Escalate to:

**Astra + High**

only when debugging reveals an architectural issue such as:

- LOD + Instancing incompatibility
- Scene graph ownership problems
- Geometry disposal problems
- Unexpected renderer architecture limitations
- Complex visibility problems

---

# PHASE 7 — Performance Validation

Recommended:

**Model: Astra**

**Effort: High**

Compare BEFORE vs AFTER.

Measure where available:

```text
FPS
Frame Time

Triangle Count
Rendered Vertices

Draw Calls
Visible Objects

Geometry Count
Memory Usage

LOD Distribution
Culled Furniture Count
```

Also evaluate visual quality.

Optimization is successful only if performance improves without unacceptable furniture degradation.

---

# Model / Effort Rule

General rule:

```text
Deciding WHAT to do
        ↓
Astra + High


Executing an already approved plan
        ↓
Astra + Medium


Routine build/debug
        ↓
Sol + Medium


Unexpected architectural problem
        ↓
Astra + High
```

Do not use High reasoning continuously when the task is already clearly specified.

---

# Future Building Complexity

This system should prepare the project for increasingly complex procedural architecture.

Potential future building features include:

```text
Simple Rectangular Building
        ↓
L / U / T Floor Plates
        ↓
Different Floor Shapes
        ↓
Atriums / Voids
        ↓
Terraces
        ↓
Complex Roofs
        ↓
Curved / Irregular Geometry
        ↓
Multiple Buildings
        ↓
Large Procedural Environments
```

Furniture optimization should remain reusable throughout these changes.

Do NOT implement large-scale building optimization systems now.

Future systems may eventually include:

- Building HLOD
- Spatial Chunking
- Building Streaming
- Portal / Room Visibility
- Large-scene Occlusion
- Multi-building management

These are OUT OF SCOPE for the current implementation.

Only keep the current architecture compatible with reasonable future expansion.

---

# CURRENT TASK

For this first run:

## PLAN ONLY.

Do not modify code.

Do not modify assets.

Do not generate LOD meshes.

Do not perform Mesh Simplification.

Inspect only the project areas necessary to understand the furniture rendering architecture.

Return:

1. Current Furniture Architecture
2. Existing Optimization Features
3. Current / Potential Performance Bottlenecks
4. Layer 1 — Culling Recommendation
5. Layer 2 — Runtime LOD Recommendation
6. Layer 3 — Mesh Simplification / Analyzer Recommendation
7. Layer 4 — Instancing Recommendation
8. Proposed Furniture Analyzer Design
9. Files Expected to Change
10. Compatibility / Technical Risks
11. Recommended Implementation Order
12. Estimated Scope
13. Anything that appears unnecessary or over-engineered

Then:

**STOP and wait for user approval before implementation.**

Later, when Furniture Analyzer results are available, there is a second mandatory STOP before Mesh Simplification:

**No furniture asset may be simplified without explicit user approval.**
