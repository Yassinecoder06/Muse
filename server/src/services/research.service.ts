// Backward-compatible façade: research jobs now use the modular report engine.
import { generateReport, type EngineProgress } from './reporting/engine.js'
import type { ResearchDocument } from './research-document.repository.js'
import type { ReportRequest } from './reporting/types.js'
export type ResearchDepth = 'concise' | 'standard' | 'in-depth'
export const researchDepths: ResearchDepth[] = ['concise', 'standard', 'in-depth']
export async function research(request: ReportRequest, model: string | undefined, apiKey: any, documents: ResearchDocument[], progress: EngineProgress) { return generateReport(request, documents, model, apiKey, progress) }
