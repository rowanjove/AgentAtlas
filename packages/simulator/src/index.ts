import { SimRunResult } from '@agent-atlas/shared';
import {
  runAgentLoopLab,
  runContextEngineeringLab,
  runFunctionCallingLab,
  runRagLab,
  runReactLab,
  SimInput,
} from './labs/coreLabs.js';
import {
  runEvalsLab,
  runHarnessLab,
  runMemoryLab,
  runMultiAgentLab,
  runWorkflowLab,
} from './labs/advancedLabs.js';

export type { SimInput };

export const SUPPORTED_LAB_IDS = [
  'agent-loop',
  'function-calling',
  'react',
  'rag',
  'context-engineering',
  'memory',
  'workflow',
  'multi-agent',
  'harness-engineering',
  'evals',
] as const;

export type SupportedLabId = (typeof SUPPORTED_LAB_IDS)[number];

export function runSimulation(labId: string, input: SimInput = {}): SimRunResult {
  switch (labId) {
    case 'agent-loop':
      return runAgentLoopLab(input);
    case 'function-calling':
      return runFunctionCallingLab(input);
    case 'react':
      return runReactLab(input);
    case 'rag':
      return runRagLab(input);
    case 'context-engineering':
      return runContextEngineeringLab(input);
    case 'memory':
      return runMemoryLab(input);
    case 'workflow':
      return runWorkflowLab(input);
    case 'multi-agent':
      return runMultiAgentLab(input);
    case 'harness-engineering':
      return runHarnessLab(input);
    case 'evals':
      return runEvalsLab(input);
    default:
      throw new Error(`Unsupported lab ID: ${labId}`);
  }
}
