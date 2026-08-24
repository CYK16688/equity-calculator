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

export function zoomInScale(scale) {
  return Number(scale) * ZOOM_STEP;
}

export function zoomOutScale(scale) {
  return Number(scale) / ZOOM_STEP;
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
