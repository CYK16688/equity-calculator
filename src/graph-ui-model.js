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

export function normalizeSelectionRectangle(start, end) {
  const startX = Number(start?.x) || 0;
  const startY = Number(start?.y) || 0;
  const endX = Number(end?.x) || 0;
  const endY = Number(end?.y) || 0;
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY)
  };
}

export function nodeIdsInSelectionRectangle(nodes, rectangle) {
  const left = Number(rectangle?.x) || 0;
  const top = Number(rectangle?.y) || 0;
  const right = left + Math.max(0, Number(rectangle?.width) || 0);
  const bottom = top + Math.max(0, Number(rectangle?.height) || 0);
  return (Array.isArray(nodes) ? nodes : [])
    .filter(node => {
      const nodeLeft = Number(node?.x) || 0;
      const nodeTop = Number(node?.y) || 0;
      const nodeRight = nodeLeft + Math.max(0, Number(node?.width) || 0);
      const nodeBottom = nodeTop + Math.max(0, Number(node?.height) || 0);
      return nodeRight >= left && nodeLeft <= right && nodeBottom >= top && nodeTop <= bottom;
    })
    .map(node => String(node.id));
}

/**
 * Give every relation stable routing identities. Existing hints are preserved,
 * while a newly added relation takes a free port between its neighbours. This
 * prevents one drag-created relation from redistributing every existing port.
 */
export function assignEquityRoutingHints(nodes, links) {
  const normalizedNodes = (Array.isArray(nodes) ? nodes : []).map(node => ({
    ...node,
    id: String(node?.id || ''),
    x: Number(node?.x) || 0,
    y: Number(node?.y) || 0,
    width: Math.max(80, Number(node?.layoutWidth ?? node?.width) || (node?.root ? 330 : 220)),
    height: Math.max(60, Number(node?.layoutHeight ?? node?.height) || (node?.root ? 76 : 88))
  }));
  const nodeById = new Map(normalizedNodes.map(node => [node.id, node]));
  const result = (Array.isArray(links) ? links : []).map(link => ({ ...link }));
  const usedOrders = new Set();
  const resetRoutingIdentity = new Set();
  let nextOrder = Math.max(-1, ...result.map(link => {
    const value = Number(link?.routeOrder);
    return link?.routeOrder !== null && link?.routeOrder !== ''
      && Number.isFinite(value) && value >= 0 ? Math.floor(value) : -1;
  })) + 1;

  result.forEach(link => {
    const requested = Number(link.routeOrder);
    if (link.routeOrder !== null && link.routeOrder !== ''
      && Number.isFinite(requested) && requested >= 0 && !usedOrders.has(Math.floor(requested))) {
      link.routeOrder = Math.floor(requested);
    } else {
      while (usedOrders.has(nextOrder)) nextOrder += 1;
      link.routeOrder = nextOrder;
      nextOrder += 1;
      resetRoutingIdentity.add(link);
    }
    usedOrders.add(link.routeOrder);
  });

  const counterpartCenter = id => {
    const node = nodeById.get(String(id));
    return node ? node.x + node.width / 2 : 0;
  };
  const normalizePort = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 && numeric < 1
      ? Math.max(0.04, Math.min(0.96, numeric))
      : null;
  };
  const assignPorts = (groupKey, counterpartKey, portKey) => {
    const groups = new Map();
    result.forEach(link => {
      const key = String(link[groupKey] || '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(link);
      link[portKey] = resetRoutingIdentity.has(link) ? null : normalizePort(link[portKey]);
    });
    groups.forEach(relations => {
      const ordered = [...relations].sort((left, right) =>
        counterpartCenter(left[counterpartKey]) - counterpartCenter(right[counterpartKey])
        || left.routeOrder - right.routeOrder
        || String(left.id || '').localeCompare(String(right.id || ''))
      );
      if (ordered.every(link => link[portKey] === null)) {
        ordered.forEach((link, index) => {
          link[portKey] = (index + 1) / (ordered.length + 1);
        });
        return;
      }
      const existing = ordered.filter(link => link[portKey] !== null);
      const orderedPorts = existing.map(link => link[portKey]).sort((left, right) => left - right);
      existing.forEach((link, index) => {
        link[portKey] = orderedPorts[index];
      });
      ordered.forEach((link, index) => {
        if (link[portKey] !== null) return;
        const previous = [...ordered.slice(0, index)].reverse()
          .find(candidate => candidate[portKey] !== null);
        const next = ordered.slice(index + 1)
          .find(candidate => candidate[portKey] !== null);
        if (previous && next) link[portKey] = (previous[portKey] + next[portKey]) / 2;
        else if (previous) link[portKey] = (previous[portKey] + 0.96) / 2;
        else if (next) link[portKey] = (0.04 + next[portKey]) / 2;
        else link[portKey] = 0.5;
      });
    });
  };

  assignPorts('from', 'to', 'sourcePort');
  assignPorts('to', 'from', 'targetPort');

  const normalizeSlot = value => {
    if (value === null || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null;
  };
  const { levels } = calculateEquityHierarchyLevels(normalizedNodes, result);
  const routeGeometry = new Map();
  result.forEach(link => {
    const from = nodeById.get(String(link.from));
    const to = nodeById.get(String(link.to));
    if (!from || !to) return;
    routeGeometry.set(link.id, {
      startX: from.x + from.width * link.sourcePort,
      startY: from.y + from.height,
      endX: to.x + to.width * link.targetPort,
      targetY: to.y,
      bandKey: `${levels.get(String(link.from)) || 0}:${levels.get(String(link.to)) || 0}`
    });
  });

  // Lane slots are persistent routing identities. Existing slots are seeded
  // first; only new relations search for a free slot around them.
  const linksByBand = new Map();
  result.forEach(link => {
    link.laneSlot = resetRoutingIdentity.has(link) ? null : normalizeSlot(link.laneSlot);
    const geometry = routeGeometry.get(link.id);
    if (!geometry) {
      link.laneSlot ??= 0;
      return;
    }
    if (!linksByBand.has(geometry.bandKey)) linksByBand.set(geometry.bandKey, []);
    linksByBand.get(geometry.bandKey).push(link);
  });
  linksByBand.forEach(relations => {
    const occupiedByLane = [];
    relations.filter(link => link.laneSlot !== null).forEach(link => {
      const geometry = routeGeometry.get(link.id);
      const interval = {
        left: Math.min(geometry.startX, geometry.endX),
        right: Math.max(geometry.startX, geometry.endX)
      };
      if (!occupiedByLane[link.laneSlot]) occupiedByLane[link.laneSlot] = [];
      occupiedByLane[link.laneSlot].push(interval);
    });
    relations
      .filter(link => link.laneSlot === null)
      .sort((left, right) => left.routeOrder - right.routeOrder || left.id.localeCompare(right.id))
      .forEach(link => {
        const geometry = routeGeometry.get(link.id);
        const interval = {
          left: Math.min(geometry.startX, geometry.endX),
          right: Math.max(geometry.startX, geometry.endX)
        };
        let laneSlot = 0;
        while (occupiedByLane[laneSlot]?.some(existing => routeIntervalsConflict(interval, existing))) {
          laneSlot += 1;
        }
        if (!occupiedByLane[laneSlot]) occupiedByLane[laneSlot] = [];
        occupiedByLane[laneSlot].push(interval);
        link.laneSlot = laneSlot;
      });

    const newlyRouted = relations.filter(link => resetRoutingIdentity.has(link));
    if (!newlyRouted.length) return;
    const provisionalRoutes = relations.map(link => {
      const geometry = routeGeometry.get(link.id);
      return {
        relation: link,
        startX: geometry.startX,
        endX: geometry.endX,
        startY: geometry.startY,
        endY: geometry.targetY,
        laneIndex: link.laneSlot
      };
    });
    const sourceBottom = Math.max(...provisionalRoutes.map(route => route.startY));
    const targetTop = Math.min(...provisionalRoutes.map(route => route.endY));
    const forward = targetTop > sourceBottom;
    newlyRouted.forEach(link => {
      const route = provisionalRoutes.find(candidate => candidate.relation.id === link.id);
      const maxLane = Math.max(0, ...provisionalRoutes.map(candidate => candidate.laneIndex));
      let best = null;
      for (let lane = 0; lane <= maxLane + newlyRouted.length + 2; lane += 1) {
        route.laneIndex = lane;
        const conflicts = routeLaneConflictIds(provisionalRoutes, forward).size;
        const score = [conflicts, lane];
        if (!best || compareRouteLaneScores(score, best.score) < 0) best = { lane, score };
      }
      route.laneIndex = best.lane;
      link.laneSlot = best.lane;
    });
  });

  // Long cross-layer routes must not borrow a corridor selected by whichever
  // relation happened to be processed first during the latest render.
  linksByBand.forEach(relations => {
    const usedSlots = new Set();
    relations.forEach(link => {
      link.corridorSlot = resetRoutingIdentity.has(link) ? null : normalizeSlot(link.corridorSlot);
      if (link.corridorSlot !== null && !usedSlots.has(link.corridorSlot)) {
        usedSlots.add(link.corridorSlot);
      } else {
        link.corridorSlot = null;
      }
    });
    relations
      .filter(link => link.corridorSlot === null)
      .sort((left, right) => left.routeOrder - right.routeOrder || left.id.localeCompare(right.id))
      .forEach(link => {
        let corridorSlot = 0;
        while (usedSlots.has(corridorSlot)) corridorSlot += 1;
        link.corridorSlot = corridorSlot;
        usedSlots.add(corridorSlot);
      });
  });

  // A label tier belongs to its relation just like a target port. Keeping the
  // tier stable makes the percentage move with its target stem during drag.
  const linksByTarget = new Map();
  result.forEach(link => {
    link.labelTier = resetRoutingIdentity.has(link) ? null : normalizeSlot(link.labelTier);
    const targetId = String(link.to || '');
    if (!linksByTarget.has(targetId)) linksByTarget.set(targetId, []);
    linksByTarget.get(targetId).push(link);
  });
  linksByTarget.forEach(relations => {
    const occupied = [];
    const labelBoxFor = (link, tier) => {
      const geometry = routeGeometry.get(link.id);
      if (!geometry) return null;
      return relationLabelBox(
        geometry.endX,
        geometry.targetY + (geometry.targetY >= geometry.startY ? -1 : 1) * (25 + tier * 36),
        Math.max(48, String(link.percent || '').length * 9 + 18)
      );
    };
    relations.filter(link => link.labelTier !== null).forEach(link => {
      const box = labelBoxFor(link, link.labelTier);
      if (box) occupied.push(box);
    });
    relations
      .filter(link => link.labelTier === null)
      .sort((left, right) => left.routeOrder - right.routeOrder || left.id.localeCompare(right.id))
      .forEach(link => {
        let labelTier = 0;
        let box = labelBoxFor(link, labelTier);
        while (box && occupied.some(existing => relationLabelBoxesOverlap(box, existing))) {
          labelTier += 1;
          box = labelBoxFor(link, labelTier);
        }
        link.labelTier = labelTier;
        if (box) occupied.push(box);
      });
  });
  return result;
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

function layoutOwnershipPercent(link) {
  const value = Number(String(link?.percent ?? '').replace(/[%％,，\s]/g, ''));
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function ownershipPriorityConstraints(links, levels) {
  const byTarget = new Map();
  links.forEach(link => {
    const sourceLevel = levels.get(link.from);
    const targetLevel = levels.get(link.to);
    if (sourceLevel === undefined || targetLevel === undefined || sourceLevel >= targetLevel) return;
    if (!byTarget.has(link.to)) byTarget.set(link.to, new Map());
    const shareholders = byTarget.get(link.to);
    const current = shareholders.get(link.from);
    if (!current || layoutOwnershipPercent(link) > layoutOwnershipPercent(current)) {
      shareholders.set(link.from, link);
    }
  });

  const constraints = [];
  [...byTarget.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([targetId, shareholderMap]) => {
      const shareholders = [...shareholderMap.values()].sort((left, right) =>
        layoutOwnershipPercent(right) - layoutOwnershipPercent(left)
        || left.from.localeCompare(right.from)
      );
      shareholders.forEach((higher, higherIndex) => {
        shareholders.slice(higherIndex + 1).forEach(lower => {
          const higherPercent = layoutOwnershipPercent(higher);
          const lowerPercent = layoutOwnershipPercent(lower);
          if (higherPercent <= lowerPercent || levels.get(higher.from) !== levels.get(lower.from)) return;
          constraints.push({
            level: levels.get(higher.from),
            before: higher.from,
            after: lower.from,
            gap: higherPercent - lowerPercent,
            targetId
          });
        });
      });
    });
  return constraints.sort((left, right) =>
    right.gap - left.gap
    || left.targetId.localeCompare(right.targetId)
    || left.before.localeCompare(right.before)
    || left.after.localeCompare(right.after)
  );
}

function ownershipOrderInversions(groups, links, levels) {
  const indexes = new Map();
  groups.forEach(nodeIds => nodeIds.forEach((nodeId, index) => indexes.set(nodeId, index)));
  return ownershipPriorityConstraints(links, levels).reduce((total, constraint) =>
    total + (indexes.get(constraint.before) > indexes.get(constraint.after) ? 1 : 0), 0
  );
}

function applyOwnershipPriorityOrder(groups, links, levels) {
  const constraintsByLevel = new Map();
  ownershipPriorityConstraints(links, levels).forEach(constraint => {
    if (!constraintsByLevel.has(constraint.level)) constraintsByLevel.set(constraint.level, []);
    constraintsByLevel.get(constraint.level).push(constraint);
  });

  const result = new Map([...groups].map(([level, nodeIds]) => [level, [...nodeIds]]));
  constraintsByLevel.forEach((constraints, level) => {
    const layer = result.get(level);
    if (!layer?.length) return;
    const layerIds = new Set(layer);
    const adjacency = new Map(layer.map(nodeId => [nodeId, new Set()]));
    const hasPath = (start, target) => {
      const pending = [start];
      const visited = new Set();
      while (pending.length) {
        const nodeId = pending.pop();
        if (nodeId === target) return true;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        adjacency.get(nodeId)?.forEach(nextId => pending.push(nextId));
      }
      return false;
    };
    constraints.forEach(({ before, after }) => {
      if (!layerIds.has(before) || !layerIds.has(after) || before === after) return;
      if (adjacency.get(before).has(after) || hasPath(after, before)) return;
      adjacency.get(before).add(after);
    });

    const priorIndex = new Map(layer.map((nodeId, index) => [nodeId, index]));
    const indegree = new Map(layer.map(nodeId => [nodeId, 0]));
    adjacency.forEach(targets => targets.forEach(target => indegree.set(target, indegree.get(target) + 1)));
    const ready = layer.filter(nodeId => indegree.get(nodeId) === 0);
    const ordered = [];
    while (ready.length) {
      ready.sort((left, right) => priorIndex.get(left) - priorIndex.get(right));
      const nodeId = ready.shift();
      ordered.push(nodeId);
      adjacency.get(nodeId).forEach(target => {
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) ready.push(target);
      });
    }
    if (ordered.length === layer.length) result.set(level, ordered);
  });
  return result;
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
  const ownershipInversions = ownershipOrderInversions(groups, valid, levels);
  return ownershipInversions * 1_000_000_000_000 + crossings * 1_000_000 + span;
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
  bestGroups = applyOwnershipPriorityOrder(bestGroups, validLinks, levels);
  bestScore = layoutOrderScore(bestGroups, validLinks, levels);
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

  const transitionGaps = new Map(levelNumbers.slice(1).map(level => [level, layerGap]));
  const buildLevelY = () => {
    const result = new Map();
    let y = topY;
    levelNumbers.forEach((level, index) => {
      result.set(level, y);
      const maxHeight = Math.max(...groups.get(level).map(nodeId => sizes.get(nodeId).height));
      if (index < levelNumbers.length - 1) {
        y += maxHeight + transitionGaps.get(levelNumbers[index + 1]);
      }
    });
    return result;
  };
  const buildPositions = levelY => {
    const result = new Map();
    levelNumbers.forEach(level => {
      groups.get(level).forEach((nodeId, order) => {
        result.set(nodeId, {
          x: Math.round(centers.get(nodeId) + shiftX - sizes.get(nodeId).width / 2),
          y: Math.round(levelY.get(level)),
          level,
          order,
          width: sizes.get(nodeId).width,
          height: sizes.get(nodeId).height
        });
      });
    });
    return result;
  };

  let levelY = buildLevelY();
  let positions = buildPositions(levelY);

  // A dense target needs room for both its percentage-label tiers and the
  // horizontal route lanes above them. Probe the finished x-order, then grow
  // only the affected inter-layer gaps before returning final positions.
  if (validLinks.length && levelNumbers.length > 1) {
    const probeNodes = orderedNodes.map(node => {
      const position = positions.get(String(node.id));
      return {
        ...node,
        x: position.x,
        y: position.y,
        layoutWidth: position.width,
        layoutHeight: position.height
      };
    });
    const probeRoutes = calculateEquityRelationRoutes(probeNodes, hierarchyLinks).routes;
    const reserveByTargetLevel = new Map();
    probeRoutes.forEach(route => {
      if (route.targetLevel <= route.sourceLevel) return;
      const labelDepth = route.endY - route.labelBandTop;
      const current = reserveByTargetLevel.get(route.targetLevel) || { labelDepth: 0, maxLane: 0 };
      current.labelDepth = Math.max(current.labelDepth, labelDepth);
      current.maxLane = Math.max(current.maxLane, route.laneIndex || 0);
      reserveByTargetLevel.set(route.targetLevel, current);
    });
    let expanded = false;
    reserveByTargetLevel.forEach((reserve, targetLevel) => {
      const requiredGap = reserve.labelDepth + 42 + reserve.maxLane * 12;
      if (requiredGap <= (transitionGaps.get(targetLevel) || layerGap)) return;
      transitionGaps.set(targetLevel, requiredGap);
      expanded = true;
    });
    if (expanded) {
      levelY = buildLevelY();
      positions = buildPositions(levelY);
    }
  }
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

function relationLabelWidth(route) {
  return Math.max(48, String(route.relation.percent || '').length * 9 + 18);
}

function relationLabelBox(x, y, width) {
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - 15,
    bottom: y + 13
  };
}

function relationLabelBoxesOverlap(left, right, gap = 7) {
  return !(
    left.right + gap <= right.left
    || left.left >= right.right + gap
    || left.bottom + gap <= right.top
    || left.top >= right.bottom + gap
  );
}

function assignRelationLabelAnchors(routes) {
  const routesByTarget = new Map();
  routes.forEach(route => {
    if (!routesByTarget.has(route.relation.to)) routesByTarget.set(route.relation.to, []);
    routesByTarget.get(route.relation.to).push(route);
  });

  routesByTarget.forEach(targetRoutes => {
    const occupied = [];
    const hasStableOrder = targetRoutes.every(route =>
      Number.isFinite(Number(route.relation.routeOrder))
    );
    [...targetRoutes]
      .sort((left, right) => hasStableOrder
        ? Number(left.relation.routeOrder) - Number(right.relation.routeOrder)
          || left.relation.id.localeCompare(right.relation.id)
        : left.endX - right.endX || left.relation.id.localeCompare(right.relation.id))
      .forEach(route => {
        const width = relationLabelWidth(route);
        const anchorX = route.endX;
        const labelDirection = route.endY >= route.startY ? -1 : 1;
        const baseY = route.endY + labelDirection * 25;
        const savedTier = Number(route.relation.labelTier);
        const hasSavedTier = route.relation.labelTier !== null && route.relation.labelTier !== ''
          && Number.isFinite(savedTier) && savedTier >= 0;
        let tier = hasSavedTier ? Math.floor(savedTier) : 0;

        while (true) {
          // 百分比始终属于自己的入箭头端口；拥挤时只沿该竖线向上分层。
          const anchorY = baseY + labelDirection * tier * 36;
          const box = relationLabelBox(anchorX, anchorY, width);
          if (hasSavedTier
            || occupied.every(existing => !relationLabelBoxesOverlap(box, existing))) {
            route.labelAnchor = { x: anchorX, y: anchorY, tier };
            occupied.push(box);
            return;
          }
          tier += 1;
        }
      });
    const labelBandTop = Math.min(...occupied.map(box => box.top));
    targetRoutes.forEach(route => {
      route.labelBandTop = labelBandTop;
    });
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
  return assignRouteLanesWithLocked(orderedRoutes, []);
}

function assignRouteLanesWithLocked(orderedRoutes, lockedRoutes) {
  const occupiedByLane = [];
  lockedRoutes.forEach(route => {
    const lane = Math.max(0, Math.floor(Number(route.laneIndex) || 0));
    if (!occupiedByLane[lane]) occupiedByLane[lane] = [];
    occupiedByLane[lane].push(routeHorizontalInterval(route));
  });
  orderedRoutes.forEach(route => {
    const interval = routeHorizontalInterval(route);
    let lane = 0;
    while (occupiedByLane[lane]?.some(existing => routeIntervalsConflict(interval, existing))) lane += 1;
    if (!occupiedByLane[lane]) occupiedByLane[lane] = [];
    occupiedByLane[lane].push(interval);
    route.laneIndex = lane;
  });
}

function routeLaneCrossingIds(routes, forward) {
  const crossed = new Set();
  routes.forEach(horizontalRoute => {
    routes.forEach(verticalRoute => {
      if (horizontalRoute === verticalRoute) return;
      const crossesSourceStem = horizontalRoute.laneIndex < verticalRoute.laneIndex
        && pointInsideRouteInterval(horizontalRoute, verticalRoute.startX);
      const crossesTargetStem = forward
        ? horizontalRoute.laneIndex > verticalRoute.laneIndex
          && pointInsideRouteInterval(horizontalRoute, verticalRoute.endX)
        : horizontalRoute.laneIndex < verticalRoute.laneIndex
          && pointInsideRouteInterval(horizontalRoute, verticalRoute.endX);
      if (!crossesSourceStem && !crossesTargetStem) return;
      crossed.add(horizontalRoute.relation.id);
      crossed.add(verticalRoute.relation.id);
    });
  });
  return crossed;
}

function routeLaneConflictIds(routes, forward) {
  const conflicted = routeLaneCrossingIds(routes, forward);
  routes.forEach((left, leftIndex) => {
    routes.slice(leftIndex + 1).forEach(right => {
      if (left.laneIndex !== right.laneIndex
        || !routeIntervalsConflict(routeHorizontalInterval(left), routeHorizontalInterval(right))) return;
      conflicted.add(left.relation.id);
      conflicted.add(right.relation.id);
    });
  });
  return conflicted;
}

function assignPlanarRouteLanes(routes, forward, preferredLanes = null) {
  const routeById = new Map(routes.map(route => [route.relation.id, route]));
  const adjacency = new Map(routes.map(route => [route.relation.id, new Set()]));
  const addConstraint = (shallower, deeper) => {
    if (shallower === deeper) return;
    adjacency.get(shallower)?.add(deeper);
  };
  routes.forEach(horizontalRoute => {
    routes.forEach(verticalRoute => {
      if (horizontalRoute === verticalRoute) return;
      if (pointInsideRouteInterval(horizontalRoute, verticalRoute.startX)) {
        addConstraint(verticalRoute.relation.id, horizontalRoute.relation.id);
      }
      if (!pointInsideRouteInterval(horizontalRoute, verticalRoute.endX)) return;
      if (forward) addConstraint(horizontalRoute.relation.id, verticalRoute.relation.id);
      else addConstraint(verticalRoute.relation.id, horizontalRoute.relation.id);
    });
  });
  const hasPath = (from, to) => {
    const pending = [from];
    const visited = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === to) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      adjacency.get(current)?.forEach(next => pending.push(next));
    }
    return false;
  };
  routes.forEach((left, leftIndex) => {
    routes.slice(leftIndex + 1).forEach(right => {
      if (!routeIntervalsConflict(routeHorizontalInterval(left), routeHorizontalInterval(right))) return;
      const leftId = left.relation.id;
      const rightId = right.relation.id;
      if (hasPath(leftId, rightId) || hasPath(rightId, leftId)) return;
      const leftPreferred = preferredLanes?.get(leftId);
      const rightPreferred = preferredLanes?.get(rightId);
      const leftSpan = Math.abs(left.startX - left.endX);
      const rightSpan = Math.abs(right.startX - right.endX);
      const leftFirst = Number.isFinite(leftPreferred) && Number.isFinite(rightPreferred)
        && leftPreferred !== rightPreferred
        ? leftPreferred < rightPreferred
        : leftSpan !== rightSpan
          ? leftSpan > rightSpan
          : leftId.localeCompare(rightId) < 0;
      addConstraint(leftFirst ? leftId : rightId, leftFirst ? rightId : leftId);
    });
  });
  const indegree = new Map(routes.map(route => [route.relation.id, 0]));
  adjacency.forEach(targets => targets.forEach(target => indegree.set(target, indegree.get(target) + 1)));
  const ready = [...routes]
    .filter(route => indegree.get(route.relation.id) === 0)
    .sort((left, right) => left.relation.id.localeCompare(right.relation.id));
  const order = [];
  while (ready.length) {
    const route = ready.shift();
    order.push(route);
    adjacency.get(route.relation.id).forEach(targetId => {
      indegree.set(targetId, indegree.get(targetId) - 1);
      if (indegree.get(targetId) !== 0) return;
      ready.push(routeById.get(targetId));
      ready.sort((left, right) => left.relation.id.localeCompare(right.relation.id));
    });
  }
  if (order.length !== routes.length) return false;
  const lanes = new Map(routes.map(route => {
    const preferred = preferredLanes?.get(route.relation.id);
    return [route.relation.id, Number.isFinite(preferred) && preferred >= 0 ? preferred : 0];
  }));
  order.forEach(route => {
    const lane = lanes.get(route.relation.id);
    adjacency.get(route.relation.id).forEach(targetId => {
      lanes.set(targetId, Math.max(lanes.get(targetId), lane + 1));
    });
  });
  routes.forEach(route => { route.laneIndex = lanes.get(route.relation.id); });
  return routeLaneConflictIds(routes, forward).size === 0;
}

function pointInsideRouteInterval(route, x) {
  const interval = routeHorizontalInterval(route);
  return x > interval.left && x < interval.right;
}

function routeLaneScore(routes, forward, preferredLanes = null) {
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
  const laneChanges = preferredLanes
    ? routes.reduce((total, route) =>
      total + (route.laneIndex === preferredLanes.get(route.relation.id) ? 0 : 1), 0)
    : 0;
  const maxLane = Math.max(0, ...routes.map(route => route.laneIndex));
  const totalLaneDepth = routes.reduce((total, route) => total + route.laneIndex, 0);
  return preferredLanes
    ? [crossings, laneChanges, maxLane, totalLaneDepth]
    : [crossings, maxLane, totalLaneDepth];
}

function compareRouteLaneScores(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function optimizeBandRouteLanes(bandRoutes, forward) {
  if (bandRoutes.length <= 1) {
    bandRoutes.forEach(route => {
      const savedLane = Number(route.relation.laneSlot);
      route.laneIndex = route.relation.laneSlot !== null && route.relation.laneSlot !== ''
        && Number.isFinite(savedLane) && savedLane >= 0
        ? Math.floor(savedLane)
        : 0;
    });
    return false;
  }
  const hasStableLanes = bandRoutes.every(route => route.relation.laneSlot !== null
    && route.relation.laneSlot !== ''
    && Number.isFinite(Number(route.relation.laneSlot))
    && Number(route.relation.laneSlot) >= 0);
  let preferredLanes = null;
  let routesToOptimize = bandRoutes;
  let lockedRoutes = [];
  if (hasStableLanes) {
    bandRoutes.forEach(route => {
      route.laneIndex = Math.floor(Number(route.relation.laneSlot));
    });
    const crossingIds = routeLaneConflictIds(bandRoutes, forward);
    if (!crossingIds.size) return false;
    preferredLanes = new Map(bandRoutes.map(route => [route.relation.id, route.laneIndex]));
    routesToOptimize = bandRoutes.filter(route => crossingIds.has(route.relation.id));
    lockedRoutes = bandRoutes.filter(route => !crossingIds.has(route.relation.id));
  }
  const lanesBeforePlanarRepair = new Map(bandRoutes.map(route => [route.relation.id, route.laneIndex]));
  if (assignPlanarRouteLanes(bandRoutes, forward, preferredLanes)) return true;
  bandRoutes.forEach(route => { route.laneIndex = lanesBeforePlanarRepair.get(route.relation.id); });
  let best = preferredLanes ? {
    score: routeLaneScore(bandRoutes, forward, preferredLanes),
    signature: '',
    lanes: new Map(routesToOptimize.map(route => [route.relation.id, route.laneIndex]))
  } : null;
  const evaluate = order => {
    assignRouteLanesWithLocked(order, lockedRoutes);
    const score = routeLaneScore(bandRoutes, forward, preferredLanes);
    const signature = order.map(route => route.relation.id).join('\u0000');
    if (!best || compareRouteLaneScores(score, best.score) < 0
      || (compareRouteLaneScores(score, best.score) === 0 && signature < best.signature)) {
      best = {
        score,
        signature,
        lanes: new Map(routesToOptimize.map(route => [route.relation.id, route.laneIndex]))
      };
    }
    return score;
  };
  const stable = [...routesToOptimize].sort((left, right) => left.relation.id.localeCompare(right.relation.id));

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

  routesToOptimize.forEach(route => { route.laneIndex = best.lanes.get(route.relation.id); });
  const repaired = routeLaneConflictIds(bandRoutes, forward).size === 0;
  if (!repaired && preferredLanes) {
    bandRoutes.forEach(route => { route.laneIndex = preferredLanes.get(route.relation.id); });
  }
  return repaired;
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

  const effectivePorts = (relations, portKey) => {
    const savedPorts = relations.map(relation => Number(relation[portKey]));
    const validPorts = savedPorts.every(port => Number.isFinite(port) && port > 0 && port < 1);
    const uniquePorts = validPorts && new Set(savedPorts.map(port => port.toFixed(12))).size === relations.length;
    const orderedPorts = uniquePorts
      ? [...savedPorts].sort((left, right) => left - right)
      : relations.map((_, index) => (index + 1) / (relations.length + 1));
    return new Map(relations.map((relation, index) => [relation.id, orderedPorts[index]]));
  };
  const sourcePortByRelation = new Map();
  const targetPortByRelation = new Map();
  outgoing.forEach(relations => {
    effectivePorts(relations, 'sourcePort').forEach((port, relationId) => {
      sourcePortByRelation.set(relationId, port);
    });
  });
  incoming.forEach(relations => {
    effectivePorts(relations, 'targetPort').forEach((port, relationId) => {
      targetPortByRelation.set(relationId, port);
    });
  });

  const routes = new Map();
  const bands = new Map();
  normalizedLinks.forEach(link => {
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    const outgoingRelations = outgoing.get(link.from);
    const incomingRelations = incoming.get(link.to);
    const outgoingIndex = outgoingRelations.findIndex(candidate => candidate.id === link.id);
    const incomingIndex = incomingRelations.findIndex(candidate => candidate.id === link.id);
    const sourcePort = sourcePortByRelation.get(link.id);
    const targetPort = targetPortByRelation.get(link.id);
    const startX = Number.isFinite(sourcePort) && sourcePort > 0 && sourcePort < 1
      ? from.x + from.width * sourcePort
      : outgoingRelations.length <= 1
        ? nodeCenterX(from)
        : from.x + from.width * ((outgoingIndex + 1) / (outgoingRelations.length + 1));
    const endX = Number.isFinite(targetPort) && targetPort > 0 && targetPort < 1
      ? to.x + to.width * targetPort
      : incomingRelations.length <= 1
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

  // Labels and paths share the same vertical channel above each target. Assign
  // label tiers first so route lanes can stay outside that reserved band.
  assignRelationLabelAnchors(routes);

  bands.forEach(bandRoutes => {
    const sourceLevel = bandRoutes[0].sourceLevel;
    const targetLevel = bandRoutes[0].targetLevel;
    const sourceBottom = Math.max(...bandRoutes.map(route => route.startY));
    const targetTop = Math.min(...bandRoutes.map(route => route.endY));
    const forward = targetLevel > sourceLevel && targetTop > sourceBottom;
    const availableGap = Math.max(48, targetTop - sourceBottom);
    const lanesRepaired = optimizeBandRouteLanes(bandRoutes, forward);
    const stableRouting = bandRoutes.every(route =>
      Number.isFinite(Number(route.relation.routeOrder))
      && route.relation.laneSlot !== null
      && route.relation.laneSlot !== ''
      && Number.isFinite(Number(route.relation.laneSlot))
    );
    if (stableRouting && !lanesRepaired) {
      // Stable relations use only their own geometry and earlier relations as
      // constraints. Appending a new relation can therefore never move an old
      // horizontal track; the new route yields around existing percentage pills.
      bandRoutes.forEach(route => {
        const routeForward = route.targetLevel > route.sourceLevel && route.endY > route.startY;
        if (!routeForward) {
          route.midY = Math.max(route.startY, route.endY) + 32 + route.laneIndex * laneGap;
          return;
        }
        let midY = route.startY + 32 + route.laneIndex * laneGap;
        const interval = routeHorizontalInterval(route);
        const routeOrder = Number(route.relation.routeOrder);
        const earlierLabelBoxes = bandRoutes
          .filter(candidate => Number(candidate.relation.routeOrder) <= routeOrder)
          .map(candidate => ({
            ...relationLabelBox(
              candidate.labelAnchor.x,
              candidate.labelAnchor.y,
              relationLabelWidth(candidate)
            ),
            routeOrder: Number(candidate.relation.routeOrder)
          }))
          .filter(box => box.left < interval.right && box.right > interval.left);
        for (let pass = 0; pass < earlierLabelBoxes.length + 1; pass += 1) {
          const collisions = earlierLabelBoxes.filter(box =>
            midY > box.top - 10 && midY < box.bottom + 10
          );
          if (!collisions.length) break;
          midY = Math.min(...collisions.map(box => box.top - 10));
        }
        const ownLabelBox = relationLabelBox(
          route.labelAnchor.x,
          route.labelAnchor.y,
          relationLabelWidth(route)
        );
        midY = Math.min(midY, ownLabelBox.top - 10);
        route.midY = Math.max(route.startY + 2, midY);
      });
      return;
    }
    const maxLane = Math.max(0, ...bandRoutes.map(route => route.laneIndex));
    const labelBandTop = Math.min(...bandRoutes.map(route => route.labelBandTop));
    const laneCeiling = labelBandTop - 10;
    const preferredLaneStart = sourceBottom + 32;
    const laneStart = forward && preferredLaneStart + maxLane * 12 > laneCeiling
      ? laneCeiling - maxLane * 12
      : preferredLaneStart;
    const spacing = maxLane > 0
      ? (forward
          ? Math.min(laneGap, Math.max(12, (laneCeiling - laneStart) / maxLane))
          : Math.max(12, Math.min(laneGap, (availableGap - 64) / maxLane)))
      : 0;
    bandRoutes.forEach(route => {
      route.midY = forward
        ? laneStart + route.laneIndex * spacing
        : Math.max(route.startY, route.endY) + 32 + route.laneIndex * laneGap;
    });
  });

  routes.forEach(route => {
    const directInterval = routeHorizontalInterval(route);
    route.obstacles = normalizedNodes.filter(node =>
      node.id !== route.relation.from
      && node.id !== route.relation.to
      && node.y > route.startY + obstacleGap
      && node.y + node.height < route.endY - obstacleGap
      && node.x + node.width + obstacleGap > directInterval.left
      && node.x - obstacleGap < directInterval.right
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
    const savedCorridorSlot = Number(route.relation.corridorSlot);
    const hasStableCorridor = route.relation.corridorSlot !== null
      && route.relation.corridorSlot !== ''
      && Number.isFinite(savedCorridorSlot)
      && savedCorridorSlot >= 0;
    const candidates = [route.startX, route.endX, (route.startX + route.endX) / 2];
    obstacles.forEach(box => candidates.push(box.left - obstacleGap, box.right + obstacleGap));
    if (!hasStableCorridor) usedCorridors.forEach(x => candidates.push(x - laneGap, x + laneGap));
    const clearCandidates = candidates.filter(x =>
      obstacles.every(box => x <= box.left || x >= box.right)
      && (hasStableCorridor || usedCorridors.every(existing => Math.abs(existing - x) >= laneGap))
    );
    route.corridorX = (clearCandidates.length ? clearCandidates : candidates)
      .sort((left, right) => {
        const leftCost = Math.abs(left - route.startX) + Math.abs(left - route.endX);
        const rightCost = Math.abs(right - route.startX) + Math.abs(right - route.endX);
        return leftCost - rightCost
          || (hasStableCorridor && Math.floor(savedCorridorSlot) % 2 ? right - left : left - right);
      })[0];
    if (!hasStableCorridor) usedCorridors.push(route.corridorX);
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
    const unclampedTargetLaneY = Math.min(route.endY - 2, Math.max(defaultTargetLaneY, safeTargetLaneY));
    const labelLaneCeiling = route.labelBandTop - 10;
    const canReserveLabelBand = !isLong || labelLaneCeiling >= lastObstacleBottom + 2;
    const targetLaneY = canReserveLabelBand
      ? Math.min(unclampedTargetLaneY, labelLaneCeiling)
      : unclampedTargetLaneY;
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
