# Report types and skills

Muse reports are evidence-led: the user supplies a topic and may attach up to
five selected PDF, DOCX, Markdown/text, or CSV files. The report workflow uses
only those files and web results; it does not read unrelated Muse notes.

## What a user should expect from each report type

| Report type | Best for | Expected output |
| --- | --- | --- |
| Business report | Market, operating, growth, or strategic questions | Executive summary, business context, performance analysis, findings, concrete recommendations, risks, and sources. |
| Technical report | Systems, architecture, implementation, engineering trade-offs | Scope, methodology, technical analysis, evidence-backed findings, risks/limitations, and implementation recommendations. |
| Financial analysis | Revenue, cost, investment, CAPEX/OPEX, ROI, or scenarios | Sourced figures, financial methodology, calculations, scenarios, sensitivity/limitations, decision-ready recommendations, and sources. |
| Research report | A topic requiring web and/or document investigation | Executive summary, methodology, evidence analysis, key findings, limitations, conclusion, and sources. |
| Management report | Decision support for leaders | Concise context, key performance or decision analysis, risks, recommended actions, and an executive-ready conclusion. |
| Project report | Project status, delivery, scope, objectives, or next steps | Objectives, scope, progress/evidence, risks, recommendations, next steps, and source material. |

Every report should be concise and specific. The writer uses short,
evidence-first paragraphs, places key findings and recommendations in lists,
marks weak evidence as a limitation, and avoids generic filler.

## Skills

| Skill | What it does | Expected result |
| --- | --- | --- |
| Research | Collects relevant web evidence and evaluates selected source material. | Source-backed facts, assumptions, gaps, and source IDs. |
| Information extraction | Reads supplied material into a machine-readable evidence record. | Entities, dates, metrics, KPIs, facts, assumptions, and relationships. |
| Data analysis | Analyzes actual structured numeric data. | Trends, comparisons, growth rates, ratios, anomalies, calculations, and explicit data gaps. |
| Financial analysis | Performs financial reasoning separately from generic analysis. | CAPEX/OPEX, ROI, payback, cost-benefit/scenario analysis, explicit formulas, and assumptions. |
| Critical reasoning | Challenges findings before writing. | Unsupported claims, contradictions, alternative explanations, weak assumptions, bias, and evidence limits. |
| Recommendation | Turns supported findings into actions. | Recommendation, reason, evidence, expected impact, cost/effort, risk, and confidence. |
| Visualization | Decides whether data deserves a visual. | KPI-card, table, or chart recommendation only when meaningful source data exists. |
| Report structure | Selects the right outline for the report type and audience. | Executive summary, relevant analytical sections, findings, recommendations, limitations, conclusion, and references. |
| Citation management | Preserves traceability. | Source ID, name/type, URL when present, and the claim it supports; never fabricated citations. |
| Professional writing | Renders the structured analysis as polished HTML. | Compact, formal, audience-appropriate report prose without changing calculations or conclusions. |
| Quality control | Checks the final draft and can trigger revision. | Quality score, actionable issues, and up to two bounded revision passes for serious problems. |

## Visuals

When a selected CSV contains reliable numeric values, Muse extracts those values
in code before the AI runs. The resulting report can show KPI cards and a
compact comparison chart. Muse intentionally does not create a chart when the
source data is missing, ambiguous, or non-numeric.

## Model routing

Reports automatically use the three available cloud models by task:

| Model | Used for |
| --- | --- |
| `gemma4:31b-cloud` | Structured extraction and citation management. |
| `nemotron-3-super:cloud` | Research, analysis, financial reasoning, recommendations, visualization decisions, and report structure. |
| `gpt-oss:120b-cloud` | Final writing, quality control, and revisions. |

This routing is report-specific. The general Chat Model setting remains for
normal note AI actions.

## Customizing a run

The Research dialog supports title, report type, objective, audience,
instructions, detail level, source documents, output format, and optional skill
selection. Keep the preset skills for the best default result. Disable a skill
only when it is genuinely irrelevant; for example, financial analysis can be
skipped for a non-financial technical report.
