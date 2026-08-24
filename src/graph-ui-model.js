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

export function nodeTypePresentation(node) {
  const type = String(node?.type || '').trim();
  if (type.includes('目标')) return { icon: '标', label: '目标企业', tone: 'target' };
  if (type.includes('自然人') || type.includes('个人')) return { icon: '人', label: '自然人', tone: 'person' };
  if (type.includes('平台')) return { icon: '平', label: '持股平台', tone: 'platform' };
  if (type.includes('基金') || type.includes('合伙')) return { icon: '基', label: '基金/合伙', tone: 'fund' };
  if (type.includes('企业') || type.includes('公司') || type.includes('股东')) {
    return { icon: '企', label: '企业', tone: 'company' };
  }
  return { icon: '主', label: '其他主体', tone: 'other' };
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

export function isGraphInteractionTarget(target) {
  return Boolean(target?.closest?.('.graph-node, .graph-relation, .relation-label-group'));
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

  const alignLevel = level => {
    const layer = groups.get(level);
    const desired = new Map(layer.map(nodeId => {
      const parentCenters = incoming.get(nodeId).filter(centers.has.bind(centers)).map(id => centers.get(id));
      const investeeCenters = outgoing.get(nodeId).filter(centers.has.bind(centers)).map(id => centers.get(id));
      const parentCenter = median(parentCenters);
      const investeeCenter = median(investeeCenters);
      if (parentCenter !== null && investeeCenter !== null) {
        // A holding platform belongs visually between its owners and investees.
        // Equal weighting shortens both sides instead of snapping to whichever
        // directional sweep happened to run last.
        return [nodeId, (parentCenter + investeeCenter) / 2];
      }
      return [nodeId, parentCenter ?? investeeCenter ?? centers.get(nodeId)];
    }));
    packOrderedCenters(layer, desired, sizes, nodeGap).forEach((value, nodeId) => centers.set(nodeId, value));
  };
  for (let iteration = 0; iteration < 12; iteration += 1) {
    [...levelNumbers].reverse().forEach(alignLevel);
    levelNumbers.forEach(alignLevel);
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

function pathFromSegments(segments) {
  if (!segments.length) return '';
  return segments.reduce((path, segment, index) => {
    if (index === 0) return `M ${segment.x1} ${segment.y1} L ${segment.x2} ${segment.y2}`;
    return `${path} L ${segment.x2} ${segment.y2}`;
  }, '');
}

function routeSegments(points) {
  const compact = points.filter((point, index) => index === 0
    || point.x !== points[index - 1].x
    || point.y !== points[index - 1].y);
  return compact.slice(1).map((point, index) => {
    const previous = compact[index];
    return {
      x1: previous.x,
      y1: previous.y,
      x2: point.x,
      y2: point.y,
      orientation: previous.x === point.x ? 'vertical' : 'horizontal'
    };
  });
}

function routeHorizontalInterval(route) {
  return {
    left: Math.min(route.startX, route.endX),
    right: Math.max(route.startX, route.endX)
  };
}

function routeIntervalsConflict(left, right) {
  return !(left.right + 18 <= right.left || left.left >= right.right + 18);
}

function assignRouteLanes(orderedRoutes) {
  const occupiedByLane = [];
  orderedRoutes.forEach(route => {
    const interval = routeHorizontalInterval(route);
    let lane = 0;
    while (occupiedByLane[lane]?.some(existing => routeIntervalsConflict(interval, existing))) lane += 1;
    if (!occupiedByLane[lane]) occupiedByLane[lane] = [];
    occupiedByLane[lane].push(interval);
    route.laneIndex = lane;
  });
}

function pointInsideRouteInterval(route, x) {
  const interval = routeHorizontalInterval(route);
  return x > interval.left && x < interval.right;
}

function routeLaneScore(routes, forward) {
  let crossings = 0;
  routes.forEach(horizontalRoute => {
    routes.forEach(verticalRoute => {
      if (horizontalRoute === verticalRoute) return;
      if (horizontalRoute.laneIndex < verticalRoute.laneIndex
        && pointInsideRouteInterval(horizontalRoute, verticalRoute.startX)) crossings += 1;
      if (forward && horizontalRoute.laneIndex > verticalRoute.laneIndex
        && pointInsideRouteInterval(horizontalRoute, verticalRoute.endX)) crossings += 1;
      if (!forward && horizontalRoute.laneIndex < verticalRoute.laneIndex
        && pointInsideRouteInterval(horizontalRoute, verticalRoute.endX)) crossings += 1;
    });
  });
  const maxLane = Math.max(0, ...routes.map(route => route.laneIndex));
  const totalLaneDepth = routes.reduce((total, route) => total + route.laneIndex, 0);
  return [crossings, maxLane, totalLaneDepth];
}

function compareRouteLaneScores(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function optimizeBandRouteLanes(bandRoutes, forward) {
  if (bandRoutes.length <= 1) {
    bandRoutes.forEach(route => { route.laneIndex = 0; });
    return;
  }
  let best = null;
  const evaluate = order => {
    assignRouteLanes(order);
    const score = routeLaneScore(bandRoutes, forward);
    const signature = order.map(route => route.relation.id).join('\u0000');
    if (!best || compareRouteLaneScores(score, best.score) < 0
      || (compareRouteLaneScores(score, best.score) === 0 && signature < best.signature)) {
      best = {
        score,
        signature,
        lanes: new Map(bandRoutes.map(route => [route.relation.id, route.laneIndex]))
      };
    }
    return score;
  };
  const stable = [...bandRoutes].sort((left, right) => left.relation.id.localeCompare(right.relation.id));

  if (stable.length <= 7) {
    const visit = (prefix, remaining) => {
      if (!remaining.length) {
        evaluate(prefix);
        return;
      }
      remaining.forEach((route, index) => visit(
        [...prefix, route],
        [...remaining.slice(0, index), ...remaining.slice(index + 1)]
      ));
    };
    visit([], stable);
  } else {
    const span = route => Math.abs(route.startX - route.endX);
    const candidateOrders = [
      stable,
      [...stable].sort((left, right) => left.startX - right.startX || left.endX - right.endX),
      [...stable].sort((left, right) => right.startX - left.startX || right.endX - left.endX),
      [...stable].sort((left, right) => left.endX - right.endX || left.startX - right.startX),
      [...stable].sort((left, right) => right.endX - left.endX || right.startX - left.startX),
      [...stable].sort((left, right) => span(left) - span(right) || left.startX - right.startX),
      [...stable].sort((left, right) => span(right) - span(left) || left.startX - right.startX)
    ];
    const seen = new Set();
    candidateOrders.forEach(candidate => {
      const key = candidate.map(route => route.relation.id).join('\u0000');
      if (seen.has(key)) return;
      seen.add(key);
      const order = [...candidate];
      let currentScore = evaluate(order);
      if (order.length > 40) return;
      for (let pass = 0; pass < 6; pass += 1) {
        let improved = false;
        for (let index = 0; index < order.length - 1; index += 1) {
          [order[index], order[index + 1]] = [order[index + 1], order[index]];
          const candidateScore = evaluate(order);
          if (compareRouteLaneScores(candidateScore, currentScore) < 0) {
            currentScore = candidateScore;
            improved = true;
          } else {
            [order[index], order[index + 1]] = [order[index + 1], order[index]];
          }
        }
        if (!improved) break;
      }
    });
  }

  bandRoutes.forEach(route => { route.laneIndex = best.lanes.get(route.relation.id); });
}

/**
 * Orthogonal edge router shared by automatic and manually adjusted layouts.
 * Routes are grouped by semantic hierarchy levels, not rounded y coordinates,
 * so different node heights cannot accidentally reuse the same track.
 */
export function calculateEquityRelationRoutes(nodes, links, options = {}) {
  const normalizedNodes = (Array.isArray(nodes) ? nodes : [])
    .filter(node => String(node?.id || ''))
    .map(node => ({
      ...node,
      id: String(node.id),
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      width: Math.max(80, Number(node.layoutWidth ?? node.width) || (node.root ? 330 : 220)),
      height: Math.max(60, Number(node.layoutHeight ?? node.height) || (node.root ? 76 : 88))
    }));
  const nodeById = new Map(normalizedNodes.map(node => [node.id, node]));
  const normalizedLinks = (Array.isArray(links) ? links : [])
    .map((link, index) => ({
      ...link,
      id: String(link?.id || `route-${index}`),
      from: String(link?.from || ''),
      to: String(link?.to || '')
    }))
    .filter(link => nodeById.has(link.from) && nodeById.has(link.to));
  const { levels } = calculateEquityHierarchyLevels(normalizedNodes, normalizedLinks);
  const laneGap = Math.max(14, Number(options.routeGap ?? options.laneGap) || 30);
  const obstacleGap = Math.max(10, Number(options.nodeClearance ?? options.obstacleGap) || 18);
  const incoming = new Map(normalizedNodes.map(node => [node.id, []]));
  const outgoing = new Map(normalizedNodes.map(node => [node.id, []]));
  normalizedLinks.forEach(link => {
    incoming.get(link.to).push(link);
    outgoing.get(link.from).push(link);
  });
  const nodeCenterX = node => node.x + node.width / 2;
  incoming.forEach(relations => relations.sort((left, right) =>
    nodeCenterX(nodeById.get(left.from)) - nodeCenterX(nodeById.get(right.from))
    || left.id.localeCompare(right.id)
  ));
  outgoing.forEach(relations => relations.sort((left, right) =>
    nodeCenterX(nodeById.get(left.to)) - nodeCenterX(nodeById.get(right.to))
    || left.id.localeCompare(right.id)
  ));

  const routes = new Map();
  const bands = new Map();
  normalizedLinks.forEach(link => {
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    const outgoingRelations = outgoing.get(link.from);
    const incomingRelations = incoming.get(link.to);
    const outgoingIndex = outgoingRelations.findIndex(candidate => candidate.id === link.id);
    const incomingIndex = incomingRelations.findIndex(candidate => candidate.id === link.id);
    const startX = outgoingRelations.length <= 1
      ? nodeCenterX(from)
      : from.x + from.width * ((outgoingIndex + 1) / (outgoingRelations.length + 1));
    const endX = incomingRelations.length <= 1
      ? nodeCenterX(to)
      : to.x + to.width * ((incomingIndex + 1) / (incomingRelations.length + 1));
    const startY = from.y + from.height;
    const endY = to.y;
    const sourceLevel = levels.get(link.from) || 0;
    const targetLevel = levels.get(link.to) || 0;
    const bandKey = `${sourceLevel}:${targetLevel}`;
    const route = {
      relation: link,
      from,
      to,
      startX,
      startY,
      endX,
      endY,
      sourceLevel,
      targetLevel,
      bandKey
    };
    routes.set(link.id, route);
    if (!bands.has(bandKey)) bands.set(bandKey, []);
    bands.get(bandKey).push(route);
  });

  bands.forEach(bandRoutes => {
    const sourceLevel = bandRoutes[0].sourceLevel;
    const targetLevel = bandRoutes[0].targetLevel;
    const sourceBottom = Math.max(...bandRoutes.map(route => route.startY));
    const targetTop = Math.min(...bandRoutes.map(route => route.endY));
    const forward = targetLevel > sourceLevel && targetTop > sourceBottom;
    const availableGap = Math.max(48, targetTop - sourceBottom);
    optimizeBandRouteLanes(bandRoutes, forward);
    const maxLane = Math.max(0, ...bandRoutes.map(route => route.laneIndex));
    const spacing = maxLane > 0
      ? Math.max(12, Math.min(laneGap, (availableGap - 64) / maxLane))
      : 0;
    bandRoutes.forEach(route => {
      route.midY = forward
        ? sourceBottom + 32 + route.laneIndex * spacing
        : Math.max(route.startY, route.endY) + 32 + route.laneIndex * laneGap;
    });
  });

  routes.forEach(route => {
    route.obstacles = normalizedNodes.filter(node =>
      node.id !== route.relation.from
      && node.id !== route.relation.to
      && node.y > route.startY + obstacleGap
      && node.y + node.height < route.endY - obstacleGap
    ).map(node => ({
      left: node.x - obstacleGap,
      right: node.x + node.width + obstacleGap,
      top: node.y - obstacleGap,
      bottom: node.y + node.height + obstacleGap
    }));
  });
  const longRoutes = [...routes.values()]
    .filter(route => route.obstacles.length > 0)
    .sort((left, right) => left.startX - right.startX || left.endX - right.endX);
  const usedCorridors = [];
  longRoutes.forEach(route => {
    const obstacles = route.obstacles;
    const candidates = [route.startX, route.endX, (route.startX + route.endX) / 2];
    obstacles.forEach(box => candidates.push(box.left - obstacleGap, box.right + obstacleGap));
    usedCorridors.forEach(x => candidates.push(x - laneGap, x + laneGap));
    const clearCandidates = candidates.filter(x =>
      obstacles.every(box => x <= box.left || x >= box.right)
      && usedCorridors.every(existing => Math.abs(existing - x) >= laneGap)
    );
    route.corridorX = (clearCandidates.length ? clearCandidates : candidates)
      .sort((left, right) => {
        const leftCost = Math.abs(left - route.startX) + Math.abs(left - route.endX);
        const rightCost = Math.abs(right - route.startX) + Math.abs(right - route.endX);
        return leftCost - rightCost || left - right;
      })[0];
    usedCorridors.push(route.corridorX);
  });

  routes.forEach(route => {
    const isLong = route.obstacles.length > 0;
    const defaultTargetLaneY = Math.max(route.midY + 24, route.endY - 42 - route.laneIndex * 14);
    const lastObstacleBottom = isLong
      ? Math.max(...route.obstacles.map(obstacle => obstacle.bottom))
      : -Infinity;
    const remainingTargetGap = route.endY - lastObstacleBottom;
    const safeTargetLaneY = isLong
      ? lastObstacleBottom + Math.max(2, Math.min(obstacleGap, remainingTargetGap / 2))
      : defaultTargetLaneY;
    const targetLaneY = Math.min(route.endY - 2, Math.max(defaultTargetLaneY, safeTargetLaneY));
    const points = isLong
      ? [
          { x: route.startX, y: route.startY },
          { x: route.startX, y: route.midY },
          { x: route.corridorX, y: route.midY },
          { x: route.corridorX, y: targetLaneY },
          { x: route.endX, y: targetLaneY },
          { x: route.endX, y: route.endY }
        ]
      : [
          { x: route.startX, y: route.startY },
          { x: route.startX, y: route.midY },
          { x: route.endX, y: route.midY },
          { x: route.endX, y: route.endY }
        ];
    route.segments = routeSegments(points);
    route.pathData = pathFromSegments(route.segments);
    route.labelAnchor = { x: route.endX, y: route.endY - 25 };
  });

  return { routes, levels };
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
