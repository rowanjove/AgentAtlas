import { SimGraphEdge, SimGraphNode, SimRunResult, SimStepEvent } from '@agent-atlas/shared';

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function buildSimResult(input: {
  labId: string;
  seed: number;
  params: Record<string, unknown>;
  faultInjection: string | null;
  status: SimRunResult['status'];
  graphNodes: SimGraphNode[];
  graphEdges: SimGraphEdge[];
  steps: SimStepEvent[];
  initialState: Record<string, unknown>;
  finalState: Record<string, unknown>;
  simulatedTotalLatencyMs?: number;
}): SimRunResult {
  const totalLatency =
    input.simulatedTotalLatencyMs ?? input.steps.reduce((acc, s) => acc + s.simulatedLatencyMs, 0);
  const totalTokens = input.steps.reduce((acc, s) => acc + s.simulatedTokens, 0);
  return {
    labId: input.labId,
    seed: input.seed,
    params: input.params,
    faultInjection: input.faultInjection,
    status: input.status,
    graphNodes: input.graphNodes,
    graphEdges: input.graphEdges,
    steps: input.steps,
    initialState: input.initialState,
    finalState: input.finalState,
    metrics: {
      totalSteps: input.steps.length,
      simulatedTotalLatencyMs: totalLatency,
      simulatedTotalTokens: totalTokens,
      simulatedEstimatedCostUsd: Number((totalTokens * 0.000003).toFixed(6)),
      simulated: true,
    },
  };
}
