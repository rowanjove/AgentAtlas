import { describe, expect, it } from 'vitest';
import { runSimulation, SUPPORTED_LAB_IDS } from '../index.js';

describe('@agent-atlas/simulator', () => {
  it('runs all 10 mechanism labs deterministically with identical seed and params', () => {
    for (const labId of SUPPORTED_LAB_IDS) {
      const a = runSimulation(labId, { seed: 101 });
      const b = runSimulation(labId, { seed: 101 });
      expect(a).toEqual(b);
      expect(a.steps.length).toBeGreaterThanOrEqual(3);
      expect(a.metrics.simulated).toBe(true);
      expect(a.steps.every((s) => s.simulated === true)).toBe(true);
    }
  });

  it('reproduces fault injection states accurately', () => {
    const loopFail = runSimulation('agent-loop', { seed: 7, faultInjection: 'tool-timeout' });
    expect(loopFail.status).toBe('failed');
    expect(loopFail.finalState.stop_reason).toBe('tool_error_abort');

    const wfCancel = runSimulation('workflow', { seed: 7, faultInjection: 'reject-approval' });
    expect(wfCancel.status).toBe('cancelled');
    expect(wfCancel.finalState.published).toBe(false);

    const harnessBlock = runSimulation('harness-engineering', { seed: 7, faultInjection: 'escape-sandbox' });
    expect(harnessBlock.status).toBe('failed');
    expect(harnessBlock.finalState.blocked).toBe(true);

    const harnessReadOnly = runSimulation('harness-engineering', { seed: 7, params: { sandboxMode: 'read-only' } });
    expect(harnessReadOnly.status).toBe('cancelled');
    expect(harnessReadOnly.finalState.blocked).toBe(true);

    const evalsDet = runSimulation('evals', {
      seed: 7,
      params: { grader: 'deterministic-only', passThreshold: 0.8 },
      faultInjection: 'judge-drift',
    });
    expect(evalsDet.status).toBe('completed');
    expect(evalsDet.finalState.passedGate).toBe(true);

    const maSupervisor = runSimulation('multi-agent', { seed: 7, params: { topology: 'supervisor' } });
    const maParallel = runSimulation('multi-agent', { seed: 7, params: { topology: 'parallel' } });
    expect(maParallel.metrics.simulatedTotalLatencyMs).toBeLessThan(maSupervisor.metrics.simulatedTotalLatencyMs);
  });
});
