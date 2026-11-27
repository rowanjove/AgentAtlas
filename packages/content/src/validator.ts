import { ContentBundle, DOMAIN_MAP, ValidationIssue, ValidationReport } from '@agent-atlas/shared';
import { detectUnsafeHtmlOrMdx } from './security.js';

/**
 * Detects cycles on directed `requires` prerequisite edges via 3-color DFS.
 */
export function findPrerequisiteCycles(bundle: ContentBundle): string[][] {
  const adj = new Map<string, string[]>();
  for (const node of bundle.nodes) {
    adj.set(node.id, [...node.requires]);
  }

  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=done
  const stack: string[] = [];
  const cycles: string[][] = [];

  function dfs(nodeId: string) {
    state.set(nodeId, 1);
    stack.push(nodeId);
    for (const dep of adj.get(nodeId) ?? []) {
      if (!adj.has(dep)) continue;
      const st = state.get(dep) ?? 0;
      if (st === 1) {
        const idx = stack.indexOf(dep);
        cycles.push([...stack.slice(idx), dep]);
      } else if (st === 0) {
        dfs(dep);
      }
    }
    stack.pop();
    state.set(nodeId, 2);
  }

  for (const node of bundle.nodes) {
    if ((state.get(node.id) ?? 0) === 0) {
      dfs(node.id);
    }
  }
  return cycles;
}

export function validateContentBundle(bundle: ContentBundle): ValidationReport {
  const issues: ValidationIssue[] = [];

  const sourceIds = new Set<string>();
  for (const src of bundle.sources) {
    if (sourceIds.has(src.id)) {
      issues.push({ severity: 'error', code: 'DUPLICATE_SOURCE_ID', field: 'id', message: `Duplicate source ID: ${src.id}` });
    }
    sourceIds.add(src.id);
  }

  const nodeIds = new Set<string>();
  const slugMap = new Map<string, string>();
  const titleMap = new Map<string, string>();

  for (const node of bundle.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_NODE_ID',
        file: node.bodyPath,
        field: 'id',
        message: `Duplicate knowledge node ID: ${node.id}`,
      });
    }
    nodeIds.add(node.id);

    const existingSlugOwner = slugMap.get(node.slug);
    if (existingSlugOwner) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_SLUG',
        file: node.bodyPath,
        field: 'slug',
        message: `Slug '${node.slug}' collides with node '${existingSlugOwner}'`,
      });
    } else {
      slugMap.set(node.slug, node.id);
    }

    const normTitle = node.title.trim().toLowerCase();
    const existingTitleOwner = titleMap.get(normTitle);
    if (existingTitleOwner) {
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_TITLE',
        file: node.bodyPath,
        field: 'title',
        message: `Potential duplicate knowledge title '${node.title}' (also in '${existingTitleOwner}')`,
      });
    } else {
      titleMap.set(normTitle, node.id);
    }

    // Domain check
    if (!DOMAIN_MAP.has(node.domain)) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_DOMAIN',
        file: node.bodyPath,
        field: 'domain',
        message: `Node '${node.id}' uses unknown domain '${node.domain}'`,
      });
    }

    // Security check on Markdown body
    for (const finding of detectUnsafeHtmlOrMdx(node.body)) {
      issues.push({
        severity: 'error',
        code: finding.code,
        file: node.bodyPath,
        field: 'body',
        message: `${finding.reason} in ${node.id}`,
      });
    }

    // Source reference integrity
    for (const sid of node.sourceIds) {
      if (!sourceIds.has(sid)) {
        issues.push({
          severity: 'error',
          code: 'MISSING_SOURCE_REF',
          file: node.bodyPath,
          field: 'sourceIds',
          message: `Node '${node.id}' references unknown source '${sid}'`,
        });
      }
    }
  }

  const casebookIds = new Set(bundle.casebooks.map((c) => c.id));

  // Validate node cross-references and wikilinks
  for (const node of bundle.nodes) {
    const refGroups: Array<[string, string[]]> = [
      ['requires', node.requires],
      ['related', node.related],
      ['contrasts', node.contrasts],
      ['implements', node.implements],
      ['exampleOf', node.exampleOf],
      ['supersedes', node.supersedes],
    ];
    for (const [field, refs] of refGroups) {
      for (const target of refs) {
        if (!nodeIds.has(target)) {
          issues.push({
            severity: 'error',
            code: 'DANGLING_RELATION_REF',
            file: node.bodyPath,
            field,
            message: `Node '${node.id}' references unknown node '${target}' in ${field}`,
          });
        }
        if (target === node.id) {
          issues.push({
            severity: 'error',
            code: 'SELF_REFERENCE',
            file: node.bodyPath,
            field,
            message: `Node '${node.id}' cannot reference itself in ${field}`,
          });
        }
      }
    }

    for (const link of node.wikilinks) {
      if (!nodeIds.has(link) && !slugMap.has(link) && !casebookIds.has(link)) {
        issues.push({
          severity: 'error',
          code: 'BROKEN_WIKILINK',
          file: node.bodyPath,
          field: 'body',
          message: `Broken wikilink [[${link}]] in '${node.id}'`,
        });
      }
    }
  }

  // DAG cycle detection
  for (const cycle of findPrerequisiteCycles(bundle)) {
    issues.push({
      severity: 'error',
      code: 'PREREQUISITE_CYCLE',
      field: 'requires',
      message: `Prerequisite cycle detected: ${cycle.join(' -> ')}`,
    });
  }

  // Path integrity
  const pathIds = new Set<string>();
  for (const lp of bundle.paths) {
    if (pathIds.has(lp.id)) {
      issues.push({ severity: 'error', code: 'DUPLICATE_PATH_ID', field: 'id', message: `Duplicate path ID: ${lp.id}` });
    }
    pathIds.add(lp.id);
    for (const nId of [...lp.requiredNodeIds, ...lp.optionalNodeIds]) {
      if (!nodeIds.has(nId)) {
        issues.push({
          severity: 'error',
          code: 'MISSING_PATH_NODE',
          field: lp.id,
          message: `Learning path '${lp.id}' references unknown node '${nId}'`,
        });
      }
    }
    for (const stage of lp.stages) {
      for (const nId of stage.nodeIds) {
        if (!nodeIds.has(nId)) {
          issues.push({
            severity: 'error',
            code: 'MISSING_STAGE_NODE',
            field: `${lp.id}.${stage.id}`,
            message: `Stage '${stage.id}' in path '${lp.id}' references unknown node '${nId}'`,
          });
        }
      }
    }
  }

  // Assessments
  const assessmentIds = new Set<string>();
  for (const q of bundle.assessments) {
    if (assessmentIds.has(q.id)) {
      issues.push({ severity: 'error', code: 'DUPLICATE_ASSESSMENT_ID', message: `Duplicate assessment ID: ${q.id}` });
    }
    assessmentIds.add(q.id);
    if (!DOMAIN_MAP.has(q.domain)) {
      issues.push({ severity: 'error', code: 'UNKNOWN_DOMAIN', field: 'domain', message: `Assessment '${q.id}' uses unknown domain '${q.domain}'` });
    }
    if (!nodeIds.has(q.nodeId)) {
      issues.push({
        severity: 'error',
        code: 'MISSING_ASSESSMENT_NODE',
        message: `Assessment '${q.id}' references unknown node '${q.nodeId}'`,
      });
    }
    if (!q.options.some((o) => o.id === q.correctOptionId)) {
      issues.push({
        severity: 'error',
        code: 'INVALID_CORRECT_OPTION',
        message: `Assessment '${q.id}' correctOptionId '${q.correctOptionId}' not found in options`,
      });
    }
  }

  // Glossary integrity
  for (const g of bundle.glossary) {
    if (!DOMAIN_MAP.has(g.domain)) {
      issues.push({ severity: 'error', code: 'UNKNOWN_DOMAIN', field: 'domain', message: `Glossary '${g.id}' uses unknown domain '${g.domain}'` });
    }
    for (const sid of g.sourceIds) {
      if (!sourceIds.has(sid)) {
        issues.push({ severity: 'error', code: 'MISSING_SOURCE_REF', field: 'sourceIds', message: `Glossary '${g.id}' references unknown source '${sid}'` });
      }
    }
    if (g.nodeId && !nodeIds.has(g.nodeId)) {
      issues.push({ severity: 'error', code: 'MISSING_GLOSSARY_NODE', field: 'nodeId', message: `Glossary '${g.id}' references unknown node '${g.nodeId}'` });
    }
  }

  // Ecosystem integrity
  for (const eco of bundle.ecosystem) {
    for (const sid of eco.sourceIds) {
      if (!sourceIds.has(sid)) {
        issues.push({ severity: 'error', code: 'MISSING_SOURCE_REF', field: 'sourceIds', message: `Ecosystem '${eco.id}' references unknown source '${sid}'` });
      }
    }
    for (const nId of eco.relatedNodeIds) {
      if (!nodeIds.has(nId)) {
        issues.push({ severity: 'error', code: 'MISSING_ECOSYSTEM_NODE', field: 'relatedNodeIds', message: `Ecosystem '${eco.id}' references unknown node '${nId}'` });
      }
    }
  }

  // Labs integrity
  for (const lab of bundle.labs) {
    for (const nId of lab.relatedNodeIds) {
      if (!nodeIds.has(nId)) {
        issues.push({ severity: 'error', code: 'MISSING_LAB_NODE', field: 'relatedNodeIds', message: `Lab '${lab.id}' references unknown node '${nId}'` });
      }
    }
  }

  // Casebooks
  for (const cb of bundle.casebooks) {
    if (!DOMAIN_MAP.has(cb.domain)) {
      issues.push({ severity: 'error', code: 'UNKNOWN_DOMAIN', file: cb.bodyPath, field: 'domain', message: `Casebook '${cb.id}' uses unknown domain '${cb.domain}'` });
    }
    for (const finding of detectUnsafeHtmlOrMdx(cb.body)) {
      issues.push({ severity: 'error', code: finding.code, file: cb.bodyPath, message: finding.reason });
    }
    for (const sid of cb.sourceIds) {
      if (!sourceIds.has(sid)) {
        issues.push({ severity: 'error', code: 'MISSING_SOURCE_REF', file: cb.bodyPath, field: 'sourceIds', message: `Casebook '${cb.id}' references unknown source '${sid}'` });
      }
    }
    for (const nId of cb.relatedNodeIds) {
      if (!nodeIds.has(nId)) {
        issues.push({ severity: 'error', code: 'MISSING_CASEBOOK_NODE', file: cb.bodyPath, message: `Casebook '${cb.id}' references unknown node '${nId}'` });
      }
    }
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
    stats: {
      nodes: bundle.nodes.length,
      relations: bundle.relations.length,
      paths: bundle.paths.length,
      assessments: bundle.assessments.length,
      labs: bundle.labs.length,
      sources: bundle.sources.length,
      glossary: bundle.glossary.length,
      ecosystem: bundle.ecosystem.length,
      casebooks: bundle.casebooks.length,
    },
  };
}
