# Product inspiration: notes, structure, and privacy

Reviewed: **2026-08-23**.

This is a design reference, not a feature-by-feature clone plan.

| Product | Useful pattern | Muse interpretation |
| --- | --- | --- |
| [Obsidian Sync](https://obsidian.md/help/sync/security) | Its end-to-end-encryption documentation makes the lost-password consequence explicit and uses AES-256-GCM. | Make the recovery-key warning unmissable, distinguish device authentication from decryption, and never promise recovery that is technically impossible. |
| [Reflect](https://reflect.academy/security-and-encryption) | Pairs connected notes, calendar use, and AI-oriented capture with end-to-end encryption messaging. | Keep Daily as a fast, reflection-oriented structured note without turning a personal journal into a task-management maze. |
| [Capacities](https://docs.capacities.io/reference/content-types) | Typed objects, custom properties, and dashboards let the UI adapt to a note’s purpose. | Use blue specialized templates and a small custom-field builder; keep the flexible note editor rather than forcing every note into a database schema. |
| [Notion AI](https://www.notion.com/help/category/notion-ai/all) | Integrates writing, research, databases, agents, and meeting-notes workflows. | Keep Muse’s AI actions specific and visibly consent-based; use validated deterministic tools for calculations and visuals rather than accepting generated chart markup. |

The main product boundary for Muse is privacy: encrypted-vault content may be
sent to AI only after a clear user action and disclosure, and never becomes a
durable server-side prompt, job result, or semantic-index record.
