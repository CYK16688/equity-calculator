export const ZOOM_STEP = 1.12;

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function suggestUniqueNodeName(nodes, baseName) {
  const base = String(baseName || '新主体').trim() || '新主体';
  const used = new Set((nodes || []).map(node => normalizeName(node?.name)));
  if (!used.has(normalizeName(base))) return base;
  let index = 2;
  while (used.has(normalizeName(`${base} ${index}`))) index += 1;
  return `${base} ${index}`;
}

export function shortNodeIdentity(node) {
  const code = String(node?.code || '').trim();
  if (code) return code;
  const id = String(node?.id || 'unknown');
  return id.slice(-6) || id;
}

export function nodeDisplayLabel(nodes, node) {
  if (!node) return '';
  const name = String(node.name || node.id || '').replace(/\s+/g, ' ').trim();
  const duplicateCount = (nodes || []).filter(candidate =>
    normalizeName(candidate?.name) === normalizeName(node.name)
  ).length;
  return duplicateCount > 1 ? `${name} · #${shortNodeIdentity(node)}` : name;
}

export function nodeCanvasLabel(nodes, node) {
  if (!node) return '';
  const name = String(node.name || node.id || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .trim();
  const duplicateCount = (nodes || []).filter(candidate =>
    normalizeName(candidate?.name) === normalizeName(node.name)
  ).length;
  return duplicateCount > 1 ? `${name} · #${shortNodeIdentity(node)}` : name;
}

export function zoomInScale(scale) {
  return Number(scale) * ZOOM_STEP;
}

export function zoomOutScale(scale) {
  return Number(scale) / ZOOM_STEP;
}

export function graphLayerOrder(relationPathLayer, nodeLayer, relationLabelLayer) {
  return [relationPathLayer, nodeLayer, relationLabelLayer];
}

export function calculateEquityHierarchyLevels(nodes, links) {
  const nodeIds = (Array.isArray(nodes) ? nodes : [])
    .map(node => String(node?.id || ''))
    .filter(Boolean);
  const nodeSet = new Set(nodeIds);
  const validLinks = (Array.isArray(links) ? links : [])
    .map(link => ({ ...link, from: String(link?.from || ''), to: String(link?.to || '') }))
    .filter(link => nodeSet.has(link.from) && nodeSet.has(link.to));

  const adjacency = new Map(nodeIds.map(id => [id, new Set()]));
  const selfLoops = new Set();
  validLinks.forEach(link => {
    if (link.from === link.to) selfLoops.add(link.from);
    else adjacency.get(link.from).add(link.to);
  });

  // Collapse cycles iteratively, then calculate a hierarchy on the resulting
  // DAG. Iterative Kosaraju traversal avoids call-stack failures on deep chains.
  const reverseAdjacency = new Map(nodeIds.map(id => [id, new Set()]));
  adjacency.forEach((targets, fromNode) => targets.forEach(toNode => reverseAdjacency.get(toNode).add(fromNode)));
  const visited = new Set();
  const finishOrder = [];
  nodeIds.forEach(startNode => {
    if (visited.has(startNode)) return;
    visited.add(startNode);
    const traversal = [{ nodeId: startNode, neighbours: [...adjacency.get(startNode)], index: 0 }];
    while (traversal.length) {
      const frame = traversal.at(-1);
      if (frame.index < frame.neighbours.length) {
        const nextId = frame.neighbours[frame.index];
        frame.index += 1;
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        traversal.push({ nodeId: nextId, neighbours: [...adjacency.get(nextId)], index: 0 });
        continue;
      }
      finishOrder.push(frame.nodeId);
      traversal.pop();
    }
  });

  const components = [];
  const assigned = new Set();
  [...finishOrder].reverse().forEach(startNode => {
    if (assigned.has(startNode)) return;
    const component = [];
    const traversal = [startNode];
    assigned.add(startNode);
    while (traversal.length) {
      const nodeId = traversal.pop();
      component.push(nodeId);
      reverseAdjacency.get(nodeId).forEach(nextId => {
        if (assigned.has(nextId)) return;
        assigned.add(nextId);
        traversal.push(nextId);
      });
    }
    components.push(component);
  });

  const componentByNode = new Map();
  components.forEach((component, index) => component.forEach(nodeId => componentByNode.set(nodeId, index)));
  const componentEdges = new Map(components.map((_, index) => [index, new Set()]));
  const indegree = new Map(components.map((_, index) => [index, 0]));
  adjacency.forEach((targets, fromNode) => {
    const fromComponent = componentByNode.get(fromNode);
    targets.forEach(toNode => {
      const toComponent = componentByNode.get(toNode);
      if (fromComponent === toComponent || componentEdges.get(fromComponent).has(toComponent)) return;
      componentEdges.get(fromComponent).add(toComponent);
      indegree.set(toComponent, indegree.get(toComponent) + 1);
    });
  });

  const componentLevels = new Map();
  const topologicalOrder = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([index]) => index);
  topologicalOrder.forEach(index => componentLevels.set(index, 0));
  for (let index = 0; index < topologicalOrder.length; index += 1) {
    const componentId = topologicalOrder[index];
    componentEdges.get(componentId).forEach(nextId => {
      componentLevels.set(nextId, Math.max(
        componentLevels.get(nextId) || 0,
        (componentLevels.get(componentId) || 0) + 1
      ));
      indegree.set(nextId, indegree.get(nextId) - 1);
      if (indegree.get(nextId) === 0) topologicalOrder.push(nextId);
    });
  }

  // Move each shareholder group as close as possible to its investees. This is
  // what aligns short and long ownership branches without breaking ancestry.
  [...topologicalOrder].reverse().forEach(componentId => {
    const targets = [...componentEdges.get(componentId)];
    if (!targets.length) return;
    const latestValidLevel = Math.min(...targets.map(targetId => componentLevels.get(targetId) - 1));
    componentLevels.set(componentId, Math.max(componentLevels.get(componentId), latestValidLevel));
  });

  const levels = new Map();
  const unresolved = new Set();
  nodeIds.forEach(nodeId => {
    const componentId = componentByNode.get(nodeId);
    levels.set(nodeId, componentLevels.get(componentId) || 0);
    const component = components[componentId];
    if (component.length > 1 || selfLoops.has(nodeId)) unresolved.add(nodeId);
  });
  return { levels, unresolved };
}

function layoutNodeKey(node) {
  // IDs are the graph's stable identity. Names are editable and therefore
  // must not make an unchanged graph jump horizontally after a rename.
  return `${String(node?.id || '')}\u0000${normalizeName(node?.name)}`;
}

function layoutSeedRank(nodeId, seed) {
  let hash = 2166136261 ^ seed;
  const value = String(nodeId);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Least-squares isotonic regression lets nodes move toward their neighbours
// while preserving the selected left-to-right order and minimum spacing.
function packOrderedCenters(nodeIds, desiredCenters, sizes, gap) {
  if (!nodeIds.length) return new Map();
  const offsets = [0];
  for (let index = 1; index < nodeIds.length; index += 1) {
    const previous = sizes.get(nodeIds[index - 1]);
    const current = sizes.get(nodeIds[index]);
    offsets[index] = offsets[index - 1] + previous.width / 2 + gap + current.width / 2;
  }

  const blocks = [];
  nodeIds.forEach((nodeId, index) => {
    blocks.push({ start: index, end: index, weight: 1, value: desiredCenters.get(nodeId) - offsets[index] });
    while (blocks.length > 1 && blocks.at(-2).value > blocks.at(-1).value) {
      const right = blocks.pop();
      const left = blocks.pop();
      const weight = left.weight + right.weight;
      blocks.push({
        start: left.start,
        end: right.end,
        weight,
        value: (left.value * left.weight + right.value * right.weight) / weight
      });
    }
  });

  const fitted = [];
  blocks.forEach(block => {
    for (let index = block.start; index <= block.end; index += 1) fitted[index] = block.value;
  });
  return new Map(nodeIds.map((nodeId, index) => [nodeId, fitted[index] + offsets[index]]));
}

function normalizedOrderPositions(groups) {
  const positions = new Map();
  groups.forEach(nodeIds => {
    const divisor = Math.max(1, nodeIds.length - 1);
    nodeIds.forEach((nodeId, index) => positions.set(nodeId, index / divisor));
  });
  return positions;
}

function layoutOrderScore(groups, links, levels) {
  const positions = normalizedOrderPositions(groups);
  const indexes = new Map();
  groups.forEach(nodeIds => nodeIds.forEach((nodeId, index) => indexes.set(nodeId, index)));
  const valid = links.filter(link => levels.has(link.from) && levels.has(link.to));
  let crossings = 0;
  const edgeGroups = new Map();
  valid.forEach(link => {
    const key = `${levels.get(link.from)}:${levels.get(link.to)}`;
    if (!edgeGroups.has(key)) edgeGroups.set(key, []);
    edgeGroups.get(key).push(link);
  });
  edgeGroups.forEach(edges => {
    edges.sort((left, right) => indexes.get(left.from) - indexes.get(right.from)
      || indexes.get(left.to) - indexes.get(right.to));
    const targetCount = Math.max(1, ...edges.map(edge => indexes.get(edge.to) + 1));
    const tree = new Array(targetCount + 1).fill(0);
    const update = index => {
      for (let cursor = index + 1; cursor < tree.length; cursor += cursor & -cursor) tree[cursor] += 1;
    };
    const query = index => {
      let total = 0;
      for (let cursor = index + 1; cursor > 0; cursor -= cursor & -cursor) total += tree[cursor];
      return total;
    };
    let processed = 0;
    for (let start = 0; start < edges.length;) {
      let end = start + 1;
      while (end < edges.length && edges[end].from === edges[start].from) end += 1;
      for (let index = start; index < end; index += 1) {
        const targetIndex = indexes.get(edges[index].to);
        crossings += processed - query(targetIndex);
      }
      for (let index = start; index < end; index += 1) update(indexes.get(edges[index].to));
      processed += end - start;
      start = end;
    }
  });
  const span = valid.reduce((total, link) => {
    if (!positions.has(link.from) || !positions.has(link.to)) return total;
    return total + Math.abs(positions.get(link.from) - positions.get(link.to));
  }, 0);
  return crossings * 1_000_000 + span;
}

/**
 * Sugiyama-style layout for an ownership graph:
 * 1. keep the business hierarchy calculated above;
 * 2. use alternating barycentric sweeps to reduce crossings;
 * 3. compact variable-width nodes toward their parents and investees.
 */
export function calculateEquityAutoLayout(nodes, links, options = {}) {
  const orderedNodes = (Array.isArray(nodes) ? nodes : [])
    .filter(node => String(node?.id || ''));
  const nodeById = new Map(orderedNodes.map(node => [String(node.id), node]));
  const nodeIds = [...nodeById.keys()];
  if (!nodeIds.length) {
    return { positions: new Map(), levels: new Map(), unresolved: new Set(), score: 0 };
  }
  const nodeSet = new Set(nodeIds);
  const hierarchyLinks = (Array.isArray(links) ? links : [])
    .map(link => ({ ...link, from: String(link?.from || ''), to: String(link?.to || '') }))
    .filter(link => nodeSet.has(link.from) && nodeSet.has(link.to));
  const validLinks = hierarchyLinks.filter(link => link.from !== link.to);
  const { levels, unresolved } = calculateEquityHierarchyLevels(orderedNodes, hierarchyLinks);
  const centerX = Number(options.centerX) || 760;
  const topY = Number(options.topY) || 65;
  const nodeGap = Math.max(24, Number(options.nodeGap) || 64);
  const layerGap = Math.max(72, Number(options.layerGap) || 117);
  const minX = Number.isFinite(Number(options.minX)) ? Number(options.minX) : 20;
  const sweeps = Math.max(2, Math.min(24, Number(options.sweeps) || 10));
  const sizes = new Map(nodeIds.map(nodeId => {
    const node = nodeById.get(nodeId);
    const width = Math.max(80, Number(node.layoutWidth ?? node.width) || (node.root ? 330 : 220));
    const height = Math.max(60, Number(node.layoutHeight ?? node.height) || (node.root ? 76 : 88));
    return [nodeId, { width, height }];
  }));

  const incoming = new Map(nodeIds.map(nodeId => [nodeId, []]));
  const outgoing = new Map(nodeIds.map(nodeId => [nodeId, []]));
  validLinks.forEach(link => {
    if (levels.get(link.from) >= levels.get(link.to)) return;
    outgoing.get(link.from).push(link.to);
    incoming.get(link.to).push(link.from);
  });

  const groups = new Map();
  nodeIds.forEach(nodeId => {
    const level = levels.get(nodeId) || 0;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(nodeId);
  });
  groups.forEach(nodeIdsAtLevel => nodeIdsAtLevel.sort((left, right) =>
    layoutNodeKey(nodeById.get(left)).localeCompare(layoutNodeKey(nodeById.get(right)), 'zh-CN')
  ));
  const levelNumbers = [...groups.keys()].sort((a, b) => a - b);
  const stableGroups = new Map(levelNumbers.map(level => [level, [...groups.get(level)]]));

  let bestGroups = new Map(levelNumbers.map(level => [level, [...groups.get(level)]]));
  let bestScore = layoutOrderScore(bestGroups, validLinks, levels);
  const reorderLevel = (level, neighbours) => {
    const current = groups.get(level);
    const positions = normalizedOrderPositions(groups);
    const priorIndex = new Map(current.map((nodeId, index) => [nodeId, index]));
    current.sort((left, right) => {
      const leftBarycenter = median(neighbours.get(left).filter(positions.has.bind(positions)).map(id => positions.get(id)));
      const rightBarycenter = median(neighbours.get(right).filter(positions.has.bind(positions)).map(id => positions.get(id)));
      if (leftBarycenter !== null && rightBarycenter !== null && Math.abs(leftBarycenter - rightBarycenter) > 1e-9) {
        return leftBarycenter - rightBarycenter;
      }
      if (leftBarycenter === null && rightBarycenter !== null) return 1;
      if (leftBarycenter !== null && rightBarycenter === null) return -1;
      return priorIndex.get(left) - priorIndex.get(right)
        || layoutNodeKey(nodeById.get(left)).localeCompare(layoutNodeKey(nodeById.get(right)), 'zh-CN');
    });
  };

  // Crossing minimisation is NP-hard when both layers can move. A small set of
  // deterministic restarts avoids the common local minima without making the
  // same graph jump between runs.
  const restartCount = nodeIds.length <= 80 ? 20 : 4;
  for (let restart = 0; restart < restartCount; restart += 1) {
    groups.clear();
    stableGroups.forEach((nodeIdsAtLevel, level) => {
      const seeded = [...nodeIdsAtLevel];
      if (restart > 0) seeded.sort((left, right) =>
        layoutSeedRank(left, restart) - layoutSeedRank(right, restart)
        || layoutNodeKey(nodeById.get(left)).localeCompare(layoutNodeKey(nodeById.get(right)), 'zh-CN')
      );
      groups.set(level, seeded);
    });
    for (let sweep = 0; sweep < sweeps; sweep += 1) {
      levelNumbers.slice(1).forEach(level => reorderLevel(level, incoming));
      [...levelNumbers].reverse().slice(1).forEach(level => reorderLevel(level, outgoing));
      const score = layoutOrderScore(groups, validLinks, levels);
      if (score < bestScore - 1e-9) {
        bestScore = score;
        bestGroups = new Map(levelNumbers.map(level => [level, [...groups.get(level)]]));
      }
    }
  }

  // Barycentric sweeps can stop at a local minimum. Adjacent transposition is
  // cheap after the inversion-based scorer above and removes avoidable final crossings.
  groups.clear();
  bestGroups.forEach((nodeIdsAtLevel, level) => groups.set(level, [...nodeIdsAtLevel]));
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    levelNumbers.forEach(level => {
      const layer = groups.get(level);
      for (let index = 0; index < layer.length - 1; index += 1) {
        [layer[index], layer[index + 1]] = [layer[index + 1], layer[index]];
        const score = layoutOrderScore(groups, validLinks, levels);
        if (score < bestScore - 1e-9) {
          bestScore = score;
          bestGroups = new Map(levelNumbers.map(itemLevel => [itemLevel, [...groups.get(itemLevel)]]));
          improved = true;
        } else {
          [layer[index], layer[index + 1]] = [layer[index + 1], layer[index]];
        }
      }
    });
    if (!improved) break;
  }

  bestGroups.forEach((nodeIdsAtLevel, level) => groups.set(level, [...nodeIdsAtLevel]));
  const centers = new Map();
  levelNumbers.forEach(level => {
    const layer = groups.get(level);
    const totalWidth = layer.reduce((sum, nodeId) => sum + sizes.get(nodeId).width, 0)
      + Math.max(0, layer.length - 1) * nodeGap;
    let cursor = centerX - totalWidth / 2;
    layer.forEach(nodeId => {
      centers.set(nodeId, cursor + sizes.get(nodeId).width / 2);
      cursor += sizes.get(nodeId).width + nodeGap;
    });
  });

  const alignLevel = (level, neighbours) => {
    const layer = groups.get(level);
    const desired = new Map(layer.map(nodeId => {
      const neighbourCenters = neighbours.get(nodeId).filter(centers.has.bind(centers)).map(id => centers.get(id));
      return [nodeId, median(neighbourCenters) ?? centers.get(nodeId)];
    }));
    packOrderedCenters(layer, desired, sizes, nodeGap).forEach((value, nodeId) => centers.set(nodeId, value));
  };
  for (let iteration = 0; iteration < 8; iteration += 1) {
    [...levelNumbers].reverse().slice(1).forEach(level => alignLevel(level, outgoing));
    levelNumbers.slice(1).forEach(level => alignLevel(level, incoming));
  }

  const left = Math.min(...nodeIds.map(nodeId => centers.get(nodeId) - sizes.get(nodeId).width / 2));
  const right = Math.max(...nodeIds.map(nodeId => centers.get(nodeId) + sizes.get(nodeId).width / 2));
  let shiftX = centerX - (left + right) / 2;
  if (left + shiftX < minX) shiftX += minX - (left + shiftX);

  const levelY = new Map();
  let y = topY;
  levelNumbers.forEach((level, index) => {
    levelY.set(level, y);
    const maxHeight = Math.max(...groups.get(level).map(nodeId => sizes.get(nodeId).height));
    if (index < levelNumbers.length - 1) y += maxHeight + layerGap;
  });

  const positions = new Map();
  levelNumbers.forEach(level => {
    groups.get(level).forEach((nodeId, order) => {
      positions.set(nodeId, {
        x: Math.round(centers.get(nodeId) + shiftX - sizes.get(nodeId).width / 2),
        y: Math.round(levelY.get(level)),
        level,
        order,
        width: sizes.get(nodeId).width,
        height: sizes.get(nodeId).height
      });
    });
  });
  return { positions, levels, unresolved, score: bestScore };
}

export function buildOwnershipTree(nodes, links, matchedIds = null) {
  const orderedNodes = Array.isArray(nodes) ? nodes : [];
  const nodeById = new Map(orderedNodes.map(node => [String(node.id), node]));
  const outgoing = new Map(orderedNodes.map(node => [String(node.id), []]));
  const incoming = new Map(orderedNodes.map(node => [String(node.id), []]));

  (Array.isArray(links) ? links : []).forEach(link => {
    const from = String(link?.from || '');
    const to = String(link?.to || '');
    if (!nodeById.has(from) || !nodeById.has(to)) return;
    const normalized = { ...link, from, to };
    outgoing.get(from).push(normalized);
    incoming.get(to).push(normalized);
  });

  const matched = matchedIds ? new Set([...matchedIds].map(String)) : null;
  const relevant = matched ? new Set(matched) : new Set(nodeById.keys());
  if (matched) {
    const queue = [...matched];
    while (queue.length) {
      const id = queue.shift();
      (incoming.get(id) || []).forEach(link => {
        if (relevant.has(link.from)) return;
        relevant.add(link.from);
        queue.push(link.from);
      });
    }
  }

  const rootIds = orderedNodes
    .map(node => String(node.id))
    .filter(id => relevant.has(id) && !(incoming.get(id) || []).some(link => relevant.has(link.from)));
  const reached = new Set();
  const expanded = new Set();

  function branch(id, path = new Set()) {
    reached.add(id);
    if (expanded.has(id)) {
      return { nodeId: id, cycle: false, shared: true, children: [] };
    }
    expanded.add(id);
    const nextPath = new Set(path);
    nextPath.add(id);
    const children = (outgoing.get(id) || [])
      .filter(link => relevant.has(link.to))
      .map(link => {
        if (nextPath.has(link.to)) {
          reached.add(link.to);
          return { link, nodeId: link.to, cycle: true, shared: false, children: [] };
        }
        const child = branch(link.to, nextPath);
        return { link, ...child };
      });
    return { nodeId: id, cycle: false, shared: false, children };
  }

  const roots = rootIds.map(id => branch(id));
  const unresolvedIds = orderedNodes
    .map(node => String(node.id))
    .filter(id => relevant.has(id) && !reached.has(id));

  return { roots, unresolvedIds };
}
