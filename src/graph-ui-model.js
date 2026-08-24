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

  // Collapse cycles, then calculate an earliest valid hierarchy on the resulting DAG.
  let traversalIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const visit = nodeId => {
    indices.set(nodeId, traversalIndex);
    lowLinks.set(nodeId, traversalIndex);
    traversalIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);
    adjacency.get(nodeId).forEach(nextId => {
      if (!indices.has(nextId)) {
        visit(nextId);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId), lowLinks.get(nextId)));
      } else if (onStack.has(nextId)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId), indices.get(nextId)));
      }
    });
    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== nodeId);
    components.push(component);
  };
  nodeIds.forEach(nodeId => {
    if (!indices.has(nodeId)) visit(nodeId);
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
