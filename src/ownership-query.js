const OUTPUT_DECIMALS = 12;

function roundOutput(value) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(OUTPUT_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeId(value) {
  return value === null || value === undefined ? '' : String(value);
}

function parseStrictPercent(value) {
  const normalized = String(value ?? '').replace('%', '').trim();
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

function stableSum(values) {
  let sum = 0;
  let compensation = 0;

  for (const value of values) {
    const adjusted = value - compensation;
    const next = sum + adjusted;
    compensation = (next - sum) - adjusted;
    sum = next;
  }

  return sum;
}

function emptyResult(sourceId, targetId) {
  return {
    sourceId,
    targetId,
    found: false,
    valid: true,
    invalid: false,
    incomplete: false,
    directPercent: 0,
    indirectPercent: 0,
    totalPercent: 0,
    paths: [],
    hasCycle: false,
    warnings: [],
    invalidReasons: []
  };
}

/**
 * Calculate the known economic ownership from sourceId to targetId.
 *
 * Each link is directed from shareholder to investee (`from -> to`). Every
 * simple path is included once. A path's economic ownership is the product of
 * its link percentages; the total is the sum of all valid path products.
 *
 * Invalid and cyclic links are excluded from the calculation and reported in
 * structured UI-friendly fields. The input nodes and links are never mutated.
 */
export function calculateOwnershipQuery({
  nodes = [],
  links = [],
  sourceId,
  targetId
} = {}) {
  const normalizedSourceId = normalizeId(sourceId);
  const normalizedTargetId = normalizeId(targetId);
  const result = emptyResult(normalizedSourceId, normalizedTargetId);
  const addInvalid = (code, details = {}) => {
    result.invalidReasons.push({ code, ...details });
    result.invalid = true;
    result.valid = false;
  };
  const addWarning = (code, details = {}) => {
    result.warnings.push({ code, ...details });
  };

  if (!Array.isArray(nodes)) addInvalid('INVALID_NODES_INPUT');
  if (!Array.isArray(links)) addInvalid('INVALID_LINKS_INPUT');
  if (result.invalid) return result;

  const nodeIds = new Set();
  nodes.forEach((node, index) => {
    const id = normalizeId(node?.id);
    if (!id) {
      addInvalid('NODE_ID_REQUIRED', { nodeIndex: index });
    } else if (nodeIds.has(id)) {
      addInvalid('DUPLICATE_NODE_ID', { nodeId: id, nodeIndex: index });
    } else {
      nodeIds.add(id);
    }
  });

  if (!normalizedSourceId || !nodeIds.has(normalizedSourceId)) {
    addInvalid('SOURCE_NODE_NOT_FOUND', { nodeId: normalizedSourceId });
  }
  if (!normalizedTargetId || !nodeIds.has(normalizedTargetId)) {
    addInvalid('TARGET_NODE_NOT_FOUND', { nodeId: normalizedTargetId });
  }
  if (normalizedSourceId && normalizedSourceId === normalizedTargetId) {
    addInvalid('SAME_SOURCE_TARGET', { nodeId: normalizedSourceId });
  }
  if (result.invalid) return result;

  const outgoing = new Map([...nodeIds].map(id => [id, []]));
  links.forEach((link, linkIndex) => {
    const from = normalizeId(link?.from);
    const relationId = normalizeId(link?.id) || `link-${linkIndex}`;
    const edge = {
      relationId,
      linkIndex,
      from,
      to: normalizeId(link?.to),
      rawPercent: link?.percent
    };

    // Unknown or empty `from` values cannot be reached from a valid source.
    // They are intentionally ignored so unrelated malformed graph data does
    // not make an otherwise valid point-to-point query incomplete.
    if (outgoing.has(from)) outgoing.get(from).push(edge);
  });

  const invalidLinkIndexes = new Set();
  const cycleKeys = new Set();
  const directProducts = [];
  const indirectProducts = [];

  function invalidateEdge(code, edge, details = {}) {
    if (invalidLinkIndexes.has(edge.linkIndex)) return;
    invalidLinkIndexes.add(edge.linkIndex);
    addInvalid(code, {
      relationId: edge.relationId,
      linkIndex: edge.linkIndex,
      from: edge.from,
      to: edge.to,
      ...details
    });
  }

  function walk(currentId, pathNodeIds, pathEdges, pathFactor, visited) {
    if (currentId === normalizedTargetId) {
      const rawPathPercent = pathFactor * 100;
      if (pathEdges.length === 1) directProducts.push(rawPathPercent);
      if (pathEdges.length > 1) indirectProducts.push(rawPathPercent);
      result.paths.push({
        nodeIds: [...pathNodeIds],
        relationIds: pathEdges.map(edge => edge.relationId),
        segments: pathEdges.map(edge => ({
          relationId: edge.relationId,
          from: edge.from,
          to: edge.to,
          percent: edge.percent
        })),
        pathPercent: roundOutput(rawPathPercent)
      });
      return;
    }

    for (const edge of outgoing.get(currentId) || []) {
      if (!edge.to || !nodeIds.has(edge.to)) {
        invalidateEdge('LINK_NODE_NOT_FOUND', edge);
        continue;
      }

      const percent = parseStrictPercent(edge.rawPercent);
      if (!Number.isFinite(percent)) {
        invalidateEdge('INVALID_PERCENT_FORMAT', edge, { value: edge.rawPercent });
        continue;
      }
      if (percent <= 0) {
        invalidateEdge('NON_POSITIVE_PERCENT', edge, { percent });
        continue;
      }
      if (percent > 100) {
        invalidateEdge('PERCENT_OVER_100', edge, { percent });
        continue;
      }

      if (visited.has(edge.to)) {
        const cycleKey = `${edge.linkIndex}:${pathNodeIds.join('>')}`;
        if (!cycleKeys.has(cycleKey)) {
          cycleKeys.add(cycleKey);
          result.hasCycle = true;
          addWarning('CYCLE_EDGE_IGNORED', {
            relationId: edge.relationId,
            linkIndex: edge.linkIndex,
            from: edge.from,
            to: edge.to,
            cycleNodeIds: [...pathNodeIds, edge.to]
          });
        }
        continue;
      }

      const nextVisited = new Set(visited);
      nextVisited.add(edge.to);
      walk(
        edge.to,
        [...pathNodeIds, edge.to],
        [...pathEdges, { ...edge, percent }],
        pathFactor * (percent / 100),
        nextVisited
      );
    }
  }

  walk(
    normalizedSourceId,
    [normalizedSourceId],
    [],
    1,
    new Set([normalizedSourceId])
  );

  result.directPercent = roundOutput(stableSum(directProducts));
  result.indirectPercent = roundOutput(stableSum(indirectProducts));
  result.totalPercent = roundOutput(stableSum([...directProducts, ...indirectProducts]));
  result.found = result.paths.length > 0;
  result.incomplete = result.invalid || result.hasCycle;

  if (!result.found) addWarning('NO_OWNERSHIP_PATH');
  if (result.invalidReasons.length) {
    addWarning('INVALID_RELATIONS_EXCLUDED', { count: result.invalidReasons.length });
  }

  return result;
}
