import { z } from 'zod';
import { DOMAIN_IDS } from './domains.js';

export const DomainIdSchema = z.enum(DOMAIN_IDS);
export const SafeIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Invalid identifier format');
export const SafeSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug format');

export const NodeTypeSchema = z.enum([
  'concept',
  'protocol',
  'pattern',
  'framework',
  'tool',
  'paper',
  'case',
  'lab',
  'term',
  'resource',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const DifficultyLevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export type DifficultyLevel = z.infer<typeof DifficultyLevelSchema>;

export const RelationTypeSchema = z.enum([
  'requires',
  'related',
  'contrasts',
  'implements',
  'example-of',
  'supersedes',
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const ProgressStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'read',
  'assessed',
  'needs_review',
]);
export type ProgressStatus = z.infer<typeof ProgressStatusSchema>;

export const SourceKindSchema = z.enum(['official', 'spec', 'paper', 'open-source', 'engineering-blog', 'personal']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SourceEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  kind: SourceKindSchema,
  licenseStatus: z.string().min(1),
  upstreamVersion: z.string().default('latest'),
  verifiedAt: z.string().min(1),
  notes: z.string().optional(),
});
export type SourceEntry = z.infer<typeof SourceEntrySchema>;

export const GlossaryTermSchema = z.object({
  id: SafeIdSchema,
  term: z.string().min(1),
  zhTerm: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  domain: DomainIdSchema,
  definition: z.string().min(1),
  controversyNotes: z.string().optional(),
  sourceIds: z.array(z.string()).min(1),
  nodeId: z.string().optional(),
});
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;

export const KnowledgeFrontmatterSchema = z.object({
  id: SafeIdSchema,
  slug: SafeSlugSchema,
  title: z.string().min(1),
  enTitle: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  type: NodeTypeSchema,
  domain: DomainIdSchema,
  level: DifficultyLevelSchema,
  revision: z.number().int().positive().default(1),
  majorUpdate: z.boolean().default(false),
  estimatedMinutes: z.number().int().positive().default(15),
  summary: z.string().min(1),
  objectives: z.array(z.string()).min(1),
  requires: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  contrasts: z.array(z.string()).default([]),
  implements: z.array(z.string()).default([]),
  exampleOf: z.array(z.string()).default([]),
  supersedes: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).min(1),
  labIds: z.array(z.string()).default([]),
  verifiedAt: z.string().min(1),
});
export type KnowledgeFrontmatter = z.infer<typeof KnowledgeFrontmatterSchema>;

export interface TocHeading {
  level: number;
  text: string;
  slug: string;
}

export interface KnowledgeNode extends KnowledgeFrontmatter {
  bodyPath: string;
  body: string;
  wikilinks: string[];
  backlinks: string[];
  headings: TocHeading[];
}

export interface Relation {
  fromId: string;
  toId: string;
  type: RelationType;
}

export const PathStageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  nodeIds: z.array(z.string()).min(1),
});
export type PathStage = z.infer<typeof PathStageSchema>;

export const LearningPathSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  enTitle: z.string().min(1),
  goal: z.string().min(1),
  audience: z.string().default(''),
  estimatedHours: z.number().positive().default(4),
  stages: z.array(PathStageSchema).min(1),
  requiredNodeIds: z.array(z.string()).min(1),
  optionalNodeIds: z.array(z.string()).default([]),
  extensionEdges: z
    .array(
      z.object({
        fromId: z.string(),
        toId: z.string(),
        kind: z.enum(['recommended', 'extension']),
      }),
    )
    .default([]),
});
export type LearningPath = z.infer<typeof LearningPathSchema>;

export const AssessmentOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  misconception: z.string().optional(),
});

export const AssessmentQuestionSchema = z.object({
  id: SafeIdSchema,
  nodeId: z.string().min(1),
  domain: DomainIdSchema,
  kind: z.enum(['single-choice', 'scenario-judgment']),
  difficulty: DifficultyLevelSchema,
  prompt: z.string().min(1),
  scenario: z.string().optional(),
  options: z.array(AssessmentOptionSchema).min(2),
  correctOptionId: z.string().min(1),
  explanation: z.string().min(1),
  judgmentCriteria: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
});
export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>;

export const EcosystemCategorySchema = z.enum([
  'sdk-framework',
  'orchestration',
  'protocol',
  'retrieval-memory',
  'observability',
  'evaluation',
  'local-runtime',
  'agent-ide',
]);
export type EcosystemCategory = z.infer<typeof EcosystemCategorySchema>;

export const EcosystemItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: EcosystemCategorySchema,
  positioning: z.string().min(1),
  architecture: z.string().min(1),
  controlFlow: z.string().min(1),
  statePersistence: z.string().min(1),
  toolIntegration: z.string().min(1),
  suitableFor: z.array(z.string()).min(1),
  notSuitableFor: z.array(z.string()).min(1),
  complexity: z.enum(['low', 'medium', 'high']),
  costTradeoffs: z.string().min(1),
  deploymentPrereqs: z.string().min(1),
  license: z.string().min(1),
  version: z.string().min(1),
  maintenanceStatus: z.string().min(1),
  verifiedAt: z.string().min(1),
  officialUrl: z.string().url(),
  sourceIds: z.array(z.string()).min(1),
  relatedNodeIds: z.array(z.string()).default([]),
});
export type EcosystemItem = z.infer<typeof EcosystemItemSchema>;

export const CasebookFrontmatterSchema = z.object({
  id: SafeIdSchema,
  title: z.string().min(1),
  enTitle: z.string().min(1),
  domain: DomainIdSchema,
  difficulty: DifficultyLevelSchema,
  patternSummary: z.string().min(1),
  recommendedArchitecture: z.string().min(1),
  rejectedAlternatives: z.array(
    z.object({
      option: z.string(),
      reason: z.string(),
    }),
  ),
  relatedNodeIds: z.array(z.string()).min(1),
  relatedLabIds: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).min(1),
  verifiedAt: z.string().min(1),
});
export type CasebookFrontmatter = z.infer<typeof CasebookFrontmatterSchema>;

export interface CasebookEntry extends CasebookFrontmatter {
  bodyPath: string;
  body: string;
}

export const LabMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  enTitle: z.string().min(1),
  category: z.string().min(1),
  summary: z.string().min(1),
  observableVars: z.array(z.string()).min(1),
  controls: z.array(z.string()).min(1),
  relatedNodeIds: z.array(z.string()).min(1),
  defaultSeed: z.number().int().default(42),
  defaultParams: z.record(z.any()).default({}),
  faultOptions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
    }),
  ),
});
export type LabMeta = z.infer<typeof LabMetaSchema>;

export interface ContentBundle {
  version: string;
  compiledAt: string;
  sources: SourceEntry[];
  glossary: GlossaryTerm[];
  nodes: KnowledgeNode[];
  relations: Relation[];
  paths: LearningPath[];
  assessments: AssessmentQuestion[];
  labs: LabMeta[];
  ecosystem: EcosystemItem[];
  casebooks: CasebookEntry[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  file?: string;
  field?: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  stats: {
    nodes: number;
    relations: number;
    paths: number;
    assessments: number;
    labs: number;
    sources: number;
    glossary: number;
    ecosystem: number;
    casebooks: number;
  };
}

export type LabPlayStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface SimGraphNode {
  id: string;
  label: string;
  kind: 'start' | 'llm' | 'tool' | 'decision' | 'memory' | 'checkpoint' | 'human' | 'end' | 'worker';
  description?: string;
}

export interface SimGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  conditional?: boolean;
}

export interface SimStepEvent {
  stepIndex: number;
  nodeId: string;
  status: 'ok' | 'warning' | 'error' | 'interrupted';
  phase: string;
  title: string;
  detail: string;
  inputSnapshot: Record<string, unknown>;
  outputSnapshot: Record<string, unknown>;
  stateSnapshot: Record<string, unknown>;
  simulatedLatencyMs: number;
  simulatedTokens: number;
  simulated: true;
}

export interface SimRunResult {
  labId: string;
  seed: number;
  params: Record<string, unknown>;
  faultInjection: string | null;
  status: LabPlayStatus;
  graphNodes: SimGraphNode[];
  graphEdges: SimGraphEdge[];
  steps: SimStepEvent[];
  initialState: Record<string, unknown>;
  finalState: Record<string, unknown>;
  metrics: {
    totalSteps: number;
    simulatedTotalLatencyMs: number;
    simulatedTotalTokens: number;
    simulatedEstimatedCostUsd: number;
    simulated: true;
  };
}

export interface UserProgressRecord {
  nodeId: string;
  status: ProgressStatus;
  lastReadAt: string | null;
  readRevision: number;
  updatedAt: string;
}

export interface TutorConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  keyStorage: 'memory' | 'dpapi';
  hasApiKey: boolean;
}
