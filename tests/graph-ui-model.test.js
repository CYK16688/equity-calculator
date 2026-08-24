import test from 'node:test';
import assert from 'node:assert/strict';
import * as graphUiModel from '../src/graph-ui-model.js';
import {
  assignEquityRoutingHints,
  buildOwnershipTree,
  calculateEquityHierarchyLevels,
  graphLayerOrder,
  isGraphInteractionTarget,
  nodeIdsInSelectionRectangle,
  nodeCanvasLabel,
  nodeDisplayLabel,
  nodeTypePresentation,
  normalizeSelectionRectangle,
  suggestUniqueNodeName,
  zoomInScale,
  zoomOutScale
} from '../src/graph-ui-model.js';

test('selection rectangles normalize reverse drags and include intersecting nodes', () => {
  const rectangle = normalizeSelectionRectangle({ x: 360, y: 300 }, { x: 100, y: 80 });
  assert.deepEqual(rectangle, { x: 100, y: 80, width: 260, height: 220 });
  assert.deepEqual(
    nodeIdsInSelectionRectangle([
      { id: 'inside', x: 140, y: 110, width: 100, height: 80 },
      { id: 'edge', x: 350, y: 250, width: 80, height: 80 },
      { id: 'outside', x: 500, y: 400, width: 100, height: 80 }
    ], rectangle),
    ['inside', 'edge'],
    'touching or partially enclosed nodes should be selected, distant nodes should not'
  );
});

function calculateEquityAutoLayout(...args) {
  assert.equal(
    typeof graphUiModel.calculateEquityAutoLayout,
    'function',
    'graph-ui-model should export calculateEquityAutoLayout(nodes, links, options?)'
  );
  return graphUiModel.calculateEquityAutoLayout(...args);
}

function calculateEquityRelationRoutes(...args) {
  assert.equal(
    typeof graphUiModel.calculateEquityRelationRoutes,
    'function',
    'graph-ui-model should export calculateEquityRelationRoutes(nodes, links, options?)'
  );
  return graphUiModel.calculateEquityRelationRoutes(...args);
}

function relationRoute(result, linkId) {
  assert.ok(result?.routes instanceof Map, 'routing result.routes should be a Map keyed by link id');
  const route = result.routes.get(linkId);
  assert.ok(route, `missing relation route for ${linkId}`);
  assert.ok(Number.isFinite(route.startX), `${linkId}.startX should be finite`);
  assert.ok(Number.isFinite(route.endX), `${linkId}.endX should be finite`);
  assert.equal(typeof route.pathData, 'string', `${linkId}.pathData should be an SVG path string`);
  assert.ok(route.pathData.length > 0, `${linkId}.pathData should not be empty`);
  assert.ok(Array.isArray(route.segments), `${linkId}.segments should be an array`);
  assert.ok(route.segments.length > 0, `${linkId}.segments should not be empty`);
  assert.ok(Number.isFinite(route.labelAnchor?.x), `${linkId}.labelAnchor.x should be finite`);
  assert.ok(Number.isFinite(route.labelAnchor?.y), `${linkId}.labelAnchor.y should be finite`);

  route.segments.forEach((segment, index) => {
    ['x1', 'y1', 'x2', 'y2'].forEach(key => {
      assert.ok(Number.isFinite(segment?.[key]), `${linkId}.segments[${index}].${key} should be finite`);
    });
    assert.ok(
      segment.x1 === segment.x2 || segment.y1 === segment.y2,
      `${linkId}.segments[${index}] should be orthogonal`
    );
  });
  return route;
}

function horizontalSegments(route) {
  return route.segments.filter(segment => segment.y1 === segment.y2 && segment.x1 !== segment.x2);
}

function routeSegmentsCross(left, right) {
  const horizontal = left.orientation === 'horizontal' ? left : right;
  const vertical = left.orientation === 'vertical' ? left : right;
  if (horizontal.orientation !== 'horizontal' || vertical.orientation !== 'vertical') return false;
  return vertical.x1 > Math.min(horizontal.x1, horizontal.x2)
    && vertical.x1 < Math.max(horizontal.x1, horizontal.x2)
    && horizontal.y1 > Math.min(vertical.y1, vertical.y2)
    && horizontal.y1 < Math.max(vertical.y1, vertical.y2);
}

function horizontalSegmentsOverlap(left, right) {
  if (left.y1 !== right.y1) return false;
  const leftStart = Math.min(left.x1, left.x2);
  const leftEnd = Math.max(left.x1, left.x2);
  const rightStart = Math.min(right.x1, right.x2);
  const rightEnd = Math.max(right.x1, right.x2);
  return Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) > 0;
}

function segmentIntersectsRectangleInterior(segment, rectangle) {
  const left = rectangle.x;
  const right = rectangle.x + rectangle.width;
  const top = rectangle.y;
  const bottom = rectangle.y + rectangle.height;

  if (segment.x1 === segment.x2) {
    const segmentTop = Math.min(segment.y1, segment.y2);
    const segmentBottom = Math.max(segment.y1, segment.y2);
    return segment.x1 > left
      && segment.x1 < right
      && Math.min(segmentBottom, bottom) - Math.max(segmentTop, top) > 0;
  }

  const segmentLeft = Math.min(segment.x1, segment.x2);
  const segmentRight = Math.max(segment.x1, segment.x2);
  return segment.y1 > top
    && segment.y1 < bottom
    && Math.min(segmentRight, right) - Math.max(segmentLeft, left) > 0;
}

function relationLabelRectangle(route) {
  const width = Math.max(48, String(route.relation.percent || '').length * 9 + 18);
  return {
    x: route.labelAnchor.x - width / 2,
    y: route.labelAnchor.y - 15,
    width,
    height: 28
  };
}

function layoutPosition(layout, nodeId) {
  assert.ok(layout?.positions instanceof Map, 'layout.positions should be a Map keyed by node id');
  const position = layout.positions.get(nodeId);
  assert.ok(position, `missing layout position for ${nodeId}`);
  assert.ok(Number.isFinite(position.x), `${nodeId}.x should be finite`);
  assert.ok(Number.isFinite(position.y), `${nodeId}.y should be finite`);
  assert.ok(Number.isFinite(position.level), `${nodeId}.level should be finite`);
  return position;
}

function idsOrderedByX(layout, ids) {
  return [...ids].sort((left, right) => {
    const leftPosition = layoutPosition(layout, left);
    const rightPosition = layoutPosition(layout, right);
    return leftPosition.x - rightPosition.x || left.localeCompare(right);
  });
}

function normalizedPositions(layout) {
  return [...layout.positions.entries()]
    .map(([id, position]) => [id, {
      x: position.x,
      y: position.y,
      level: position.level,
      width: position.width,
      height: position.height
    }])
    .sort(([left], [right]) => left.localeCompare(right));
}

function edgeCrossingCount(layout, links) {
  const edges = links.map(link => {
    const from = layoutPosition(layout, link.from);
    const to = layoutPosition(layout, link.to);
    return {
      fromX: from.x + from.width / 2,
      toX: to.x + to.width / 2,
      fromLevel: from.level,
      toLevel: to.level
    };
  });
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
      const left = edges[leftIndex];
      const right = edges[rightIndex];
      if (left.fromLevel !== right.fromLevel || left.toLevel !== right.toLevel) continue;
      if ((left.fromX - right.fromX) * (left.toX - right.toX) < 0) crossings += 1;
    }
  }
  return crossings;
}

test('quick-add names remain unique and duplicate labels expose an identity', () => {
  const nodes = [
    { id: 'node-first-abc123', name: '新子公司', code: '' },
    { id: 'node-second-def456', name: '新子公司', code: '9133' }
  ];
  assert.equal(suggestUniqueNodeName(nodes, '新子公司'), '新子公司 2');
  assert.equal(nodeDisplayLabel(nodes, nodes[0]), '新子公司 · #abc123');
  assert.equal(nodeDisplayLabel(nodes, nodes[1]), '新子公司 · #9133');
});

test('canvas labels preserve explicit line breaks while list labels stay single-line', () => {
  const node = { id: 'node-multiline', name: '第一行公司\n第二行名称', code: '' };
  assert.equal(nodeCanvasLabel([node], node), '第一行公司\n第二行名称');
  assert.equal(nodeDisplayLabel([node], node), '第一行公司 第二行名称');
});

test('subject type badges describe entity type instead of upstream or downstream position', () => {
  assert.deepEqual(nodeTypePresentation({ type: '自然人股东', root: true }), {
    icon: '人', label: '自然人', tone: 'person'
  });
  assert.equal(nodeTypePresentation({ type: '企业股东' }).icon, '企');
  assert.equal(nodeTypePresentation({ type: '控股子公司' }).icon, '企');
  assert.equal(nodeTypePresentation({ type: '控股平台' }).icon, '平');
  assert.equal(nodeTypePresentation({ type: '基金 / 合伙企业' }).icon, '基');
  assert.equal(nodeTypePresentation({ type: '目标企业' }).icon, '标');
});

test('zoom in and out are reciprocal', () => {
  const initial = 0.82;
  assert.ok(Math.abs(zoomOutScale(zoomInScale(initial)) - initial) < 1e-12);
});

test('relation labels render above nodes so ownership percentages remain clickable', () => {
  const paths = { id: 'paths' };
  const nodes = { id: 'nodes' };
  const labels = { id: 'labels' };
  assert.deepEqual(graphLayerOrder(paths, nodes, labels), [paths, nodes, labels]);
});

test('ownership percentage labels do not start canvas panning', () => {
  const target = matchingSelector => ({
    closest: selector => selector.split(', ').includes(matchingSelector) ? {} : null
  });

  assert.equal(isGraphInteractionTarget(target('.graph-node')), true);
  assert.equal(isGraphInteractionTarget(target('.graph-relation')), true);
  assert.equal(isGraphInteractionTarget(target('.relation-label-group')), true);
  assert.equal(isGraphInteractionTarget(target('.canvas-background')), false);
});

test('ownership tree preserves parent-child branches and marks cycles', () => {
  const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id }));
  const links = [
    { id: 'ab', from: 'a', to: 'b', percent: '60%' },
    { id: 'ac', from: 'a', to: 'c', percent: '40%' },
    { id: 'bd', from: 'b', to: 'd', percent: '100%' },
    { id: 'cd', from: 'c', to: 'd', percent: '20%' }
  ];
  const tree = buildOwnershipTree(nodes, links);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.roots[0].nodeId, 'a');
  assert.deepEqual(tree.roots[0].children.map(child => child.nodeId), ['b', 'c']);
  assert.equal(tree.roots[0].children[0].children[0].nodeId, 'd');
  assert.equal(tree.roots[0].children[1].children[0].nodeId, 'd');
  assert.equal(tree.roots[0].children[1].children[0].shared, true);
  assert.deepEqual(tree.roots[0].children[1].children[0].children, []);
  assert.deepEqual(tree.unresolvedIds, []);

  const cycle = buildOwnershipTree(nodes.slice(0, 2), [
    { id: 'ab', from: 'a', to: 'b', percent: '50%' },
    { id: 'ba', from: 'b', to: 'a', percent: '50%' }
  ]);
  assert.deepEqual(cycle.roots, []);
  assert.deepEqual(cycle.unresolvedIds, ['a', 'b']);
});

test('equity hierarchy aligns co-investors with the deepest direct shareholder', () => {
  const nodes = ['top', 'gp', 'new1', 'new2', 'fund'].map(id => ({ id, name: id }));
  const links = [
    { id: 'top-gp', from: 'top', to: 'gp' },
    { id: 'gp-fund', from: 'gp', to: 'fund' },
    { id: 'new1-fund', from: 'new1', to: 'fund' },
    { id: 'new2-fund', from: 'new2', to: 'fund' }
  ];

  const { levels, unresolved } = calculateEquityHierarchyLevels(nodes, links);

  assert.equal(levels.get('top'), 0);
  assert.equal(levels.get('gp'), 1);
  assert.equal(levels.get('new1'), 1);
  assert.equal(levels.get('new2'), 1);
  assert.equal(levels.get('fund'), 2);
  assert.deepEqual([...unresolved], []);
});

test('equity hierarchy keeps a direct-and-indirect shareholder above its holding company', () => {
  const nodes = ['jack', 'tom', 'fund', 'holdco', 'sam', 'target'].map(id => ({ id, name: id }));
  const links = [
    { id: 'jack-holdco', from: 'jack', to: 'holdco' },
    { id: 'tom-holdco', from: 'tom', to: 'holdco' },
    { id: 'fund-holdco', from: 'fund', to: 'holdco' },
    { id: 'holdco-target', from: 'holdco', to: 'target' },
    { id: 'sam-target', from: 'sam', to: 'target' },
    { id: 'jack-target', from: 'jack', to: 'target' }
  ];

  const { levels, unresolved } = calculateEquityHierarchyLevels(nodes, links);

  assert.equal(levels.get('jack'), 0);
  assert.equal(levels.get('tom'), 0);
  assert.equal(levels.get('fund'), 0);
  assert.equal(levels.get('holdco'), 1);
  assert.equal(levels.get('sam'), 1);
  assert.equal(levels.get('target'), 2);
  assert.deepEqual([...unresolved], []);
});

test('equity hierarchy preserves ordinary branch depth', () => {
  const nodes = ['A', 'B', 'C', 'D'].map(id => ({ id, name: id }));
  const links = [
    { id: 'A-B', from: 'A', to: 'B' },
    { id: 'A-C', from: 'A', to: 'C' },
    { id: 'C-D', from: 'C', to: 'D' }
  ];

  const { levels, unresolved } = calculateEquityHierarchyLevels(nodes, links);

  assert.equal(levels.get('A'), 0);
  assert.equal(levels.get('B'), 1);
  assert.equal(levels.get('C'), 1);
  assert.equal(levels.get('D'), 2);
  assert.deepEqual([...unresolved], []);
});

test('equity hierarchy isolates cycle members without marking unrelated nodes unresolved', () => {
  const nodes = ['cycle-a', 'cycle-b', 'standalone', 'root', 'child'].map(id => ({ id, name: id }));
  const links = [
    { id: 'cycle-a-b', from: 'cycle-a', to: 'cycle-b' },
    { id: 'cycle-b-a', from: 'cycle-b', to: 'cycle-a' },
    { id: 'root-child', from: 'root', to: 'child' }
  ];

  const { levels, unresolved } = calculateEquityHierarchyLevels(nodes, links);

  assert.deepEqual([...unresolved].sort(), ['cycle-a', 'cycle-b']);
  assert.equal(unresolved.has('standalone'), false);
  assert.equal(unresolved.has('root'), false);
  assert.equal(unresolved.has('child'), false);
  assert.equal(levels.get('standalone'), 0);
  assert.equal(levels.get('root'), 0);
  assert.equal(levels.get('child'), 1);
});

test('equity hierarchy handles very deep ownership chains without overflowing the call stack', () => {
  const nodeCount = 3000;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({ id: `deep-${index}`, name: `deep-${index}` }));
  const links = Array.from({ length: nodeCount - 1 }, (_, index) => ({
    id: `deep-link-${index}`,
    from: `deep-${index}`,
    to: `deep-${index + 1}`
  }));

  const { levels, unresolved } = calculateEquityHierarchyLevels(nodes, links);

  assert.equal(levels.get('deep-0'), 0);
  assert.equal(levels.get(`deep-${nodeCount - 1}`), nodeCount - 1);
  assert.equal(unresolved.size, 0);
});

function commonTargetLayoutFixture() {
  const nodes = [
    { id: 'top-a', name: '李总', width: 220, height: 80 },
    { id: 'top-b', name: '卢总', width: 220, height: 80 },
    { id: 'top-c', name: '承', width: 220, height: 80 },
    { id: 'gp', name: 'GP', width: 260, height: 100 },
    { id: 'new-1', name: '新股东', width: 220, height: 80 },
    { id: 'new-2', name: '新股东 2', width: 220, height: 80 },
    { id: 'new-3', name: '新股东 3', width: 220, height: 80 },
    { id: 'fund', name: 'GP+LP 有限合伙公司', width: 280, height: 110 },
    { id: 'side-root', name: '独立上游', width: 180, height: 80 },
    { id: 'side-holdco', name: '独立平台', width: 180, height: 80 },
    { id: 'side-target', name: '独立目标', width: 180, height: 80 }
  ];
  const links = [
    { id: 'top-a-gp', from: 'top-a', to: 'gp' },
    { id: 'top-b-gp', from: 'top-b', to: 'gp' },
    { id: 'top-c-gp', from: 'top-c', to: 'gp' },
    { id: 'gp-fund', from: 'gp', to: 'fund' },
    { id: 'new-1-fund', from: 'new-1', to: 'fund' },
    { id: 'new-2-fund', from: 'new-2', to: 'fund' },
    { id: 'new-3-fund', from: 'new-3', to: 'fund' },
    { id: 'side-root-holdco', from: 'side-root', to: 'side-holdco' },
    { id: 'side-holdco-target', from: 'side-holdco', to: 'side-target' }
  ];
  return { nodes, links };
}

test('auto layout keeps second-level co-investors clustered around their common target', () => {
  const { nodes, links } = commonTargetLayoutFixture();
  const layout = calculateEquityAutoLayout(nodes, links);
  const coInvestorIds = ['gp', 'new-1', 'new-2', 'new-3'];

  coInvestorIds.forEach(id => assert.equal(layoutPosition(layout, id).level, 1));
  assert.equal(layoutPosition(layout, 'fund').level, 2);

  const secondLevelOrder = idsOrderedByX(layout, [...coInvestorIds, 'side-holdco']);
  const coInvestorIndexes = coInvestorIds.map(id => secondLevelOrder.indexOf(id)).sort((a, b) => a - b);
  assert.equal(
    coInvestorIndexes.at(-1) - coInvestorIndexes[0],
    coInvestorIds.length - 1,
    'nodes investing in the same target should form one contiguous horizontal cluster'
  );
  assert.deepEqual(
    secondLevelOrder.filter(id => id.startsWith('new-')),
    ['new-1', 'new-2', 'new-3'],
    'otherwise equivalent co-investors should retain a stable node-id order'
  );

  const investorCenters = coInvestorIds.map(id => {
    const position = layoutPosition(layout, id);
    return position.x + position.width / 2;
  });
  const fund = layoutPosition(layout, 'fund');
  const fundCenter = fund.x + fund.width / 2;
  assert.ok(
    fundCenter >= Math.min(...investorCenters) && fundCenter <= Math.max(...investorCenters),
    'the common target should be centered below the span of its direct investors'
  );
});

test('auto layout is deterministic when node and link input order changes', () => {
  const { nodes, links } = commonTargetLayoutFixture();
  const original = calculateEquityAutoLayout(nodes, links, { nodeGap: 44, layerGap: 180 });
  const shuffled = calculateEquityAutoLayout(
    [nodes[7], nodes[2], nodes[9], nodes[0], nodes[5], nodes[10], nodes[3], nodes[1], nodes[8], nodes[6], nodes[4]],
    [links[7], links[3], links[0], links[8], links[5], links[1], links[6], links[2], links[4]],
    { nodeGap: 44, layerGap: 180 }
  );

  assert.deepEqual(normalizedPositions(shuffled), normalizedPositions(original));
});

test('auto layout reorders adjacent layers to avoid avoidable branch crossings', () => {
  const nodes = [
    { id: 'root-a', name: 'A', width: 160, height: 80 },
    { id: 'root-b', name: 'B', width: 160, height: 80 },
    { id: 'root-c', name: 'C', width: 160, height: 80 },
    { id: 'child-x', name: 'X', width: 160, height: 80 },
    { id: 'child-y', name: 'Y', width: 160, height: 80 },
    { id: 'child-z', name: 'Z', width: 160, height: 80 }
  ];
  const links = [
    { id: 'a-z', from: 'root-a', to: 'child-z' },
    { id: 'b-x', from: 'root-b', to: 'child-x' },
    { id: 'c-y', from: 'root-c', to: 'child-y' }
  ];

  const layout = calculateEquityAutoLayout(nodes, links);

  assert.equal(edgeCrossingCount(layout, links), 0, 'a crossing-free ordering exists for these branches');
});

test('auto layout escapes barycentric local minima in fan-out structures', () => {
  const nodes = ['a', 'b', 'c', 'd', 'w', 'x', 'y', 'z']
    .map(id => ({ id, name: id, width: 100, height: 60 }));
  const links = [
    ['a', 'w'], ['a', 'x'], ['a', 'y'], ['a', 'z'], ['b', 'z'], ['d', 'x']
  ].map(([from, to]) => ({ id: `${from}-${to}`, from, to }));

  const layout = calculateEquityAutoLayout(nodes, links);

  assert.equal(edgeCrossingCount(layout, links), 0, 'deterministic restarts should find the available zero-crossing order');
});

test('auto layout respects variable node widths and keeps same-level boxes apart', () => {
  const nodeGap = 48;
  const nodes = [
    { id: 'wide', name: '宽节点', width: 420, height: 90 },
    { id: 'narrow', name: '窄节点', width: 140, height: 70 },
    { id: 'medium', name: '中节点', width: 300, height: 100 },
    { id: 'target', name: '共同目标', width: 260, height: 90 }
  ];
  const links = [
    { id: 'wide-target', from: 'wide', to: 'target' },
    { id: 'narrow-target', from: 'narrow', to: 'target' },
    { id: 'medium-target', from: 'medium', to: 'target' }
  ];
  const layout = calculateEquityAutoLayout(nodes, links, { nodeGap });
  const ordered = idsOrderedByX(layout, ['wide', 'narrow', 'medium']);

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = layoutPosition(layout, ordered[index - 1]);
    const current = layoutPosition(layout, ordered[index]);
    assert.ok(
      previous.x + previous.width + nodeGap <= current.x,
      `${ordered[index - 1]} and ${ordered[index]} should not overlap`
    );
  }
});

test('auto layout preserves self-loop cycle warnings while still placing the node', () => {
  const nodes = [{ id: 'self-owned', name: '自持股主体', width: 220, height: 88 }];
  const links = [{ id: 'self-loop', from: 'self-owned', to: 'self-owned' }];

  const layout = calculateEquityAutoLayout(nodes, links);

  assert.equal(layout.positions.has('self-owned'), true);
  assert.equal(layout.unresolved.has('self-owned'), true);
});

test('relation routing keeps horizontal tracks distinct for same-level sources with different heights', () => {
  const nodes = [
    { id: 'short-source', x: 0, y: 0, width: 180, height: 72 },
    { id: 'tall-source', x: 260, y: 0, width: 180, height: 148 },
    { id: 'target', x: 110, y: 340, width: 220, height: 96 }
  ];
  const links = [
    { id: 'short-target', from: 'short-source', to: 'target' },
    { id: 'tall-target', from: 'tall-source', to: 'target' }
  ];

  const result = calculateEquityRelationRoutes(nodes, links, { routeGap: 18, nodeClearance: 12 });
  const shortRoute = relationRoute(result, 'short-target');
  const tallRoute = relationRoute(result, 'tall-target');
  const overlaps = horizontalSegments(shortRoute).flatMap(left =>
    horizontalSegments(tallRoute).filter(right => horizontalSegmentsOverlap(left, right))
  );

  assert.deepEqual(
    overlaps,
    [],
    'relations from the same business layer must not share any positive-length horizontal segment'
  );
});

test('relation routing assigns distinct source ports when one shareholder points to multiple targets', () => {
  const source = { id: 'shareholder', x: 260, y: 0, width: 240, height: 90 };
  const nodes = [
    source,
    { id: 'target-left', x: 0, y: 300, width: 180, height: 84 },
    { id: 'target-middle', x: 290, y: 300, width: 180, height: 84 },
    { id: 'target-right', x: 580, y: 300, width: 180, height: 84 }
  ];
  const links = [
    { id: 'source-left', from: 'shareholder', to: 'target-left' },
    { id: 'source-middle', from: 'shareholder', to: 'target-middle' },
    { id: 'source-right', from: 'shareholder', to: 'target-right' }
  ];

  const result = calculateEquityRelationRoutes(nodes, links);
  const routes = links.map(link => relationRoute(result, link.id));
  const startPorts = routes.map(route => route.startX);

  assert.equal(new Set(startPorts).size, links.length, 'each outgoing relation should use a distinct source port');
  startPorts.forEach(startX => {
    assert.ok(
      startX > source.x && startX < source.x + source.width,
      `source port ${startX} should lie inside the shareholder bottom edge`
    );
  });
  assert.ok(
    routes[0].startX < routes[1].startX && routes[1].startX < routes[2].startX,
    'source ports should follow target left-to-right order'
  );
});

test('relation routing assigns target ports monotonically by source x position', () => {
  const target = { id: 'fund', x: 180, y: 340, width: 420, height: 100 };
  const nodes = [
    { id: 'source-left', x: 0, y: 0, width: 140, height: 80 },
    { id: 'source-middle', x: 320, y: 0, width: 140, height: 128 },
    { id: 'source-right', x: 640, y: 0, width: 140, height: 68 },
    target
  ];
  const links = [
    { id: 'left-fund', from: 'source-left', to: 'fund' },
    { id: 'middle-fund', from: 'source-middle', to: 'fund' },
    { id: 'right-fund', from: 'source-right', to: 'fund' }
  ];

  const result = calculateEquityRelationRoutes(nodes, links);
  const endPorts = links.map(link => relationRoute(result, link.id).endX);

  assert.ok(
    endPorts[0] < endPorts[1] && endPorts[1] < endPorts[2],
    'target ports should increase strictly with source x position'
  );
  endPorts.forEach(endX => {
    assert.ok(
      endX > target.x && endX < target.x + target.width,
      `target port ${endX} should lie inside the fund top edge`
    );
  });
});

test('adding one relation preserves every existing routing hint', () => {
  const target = { id: 'fund', x: 300, y: 360, width: 220, height: 100 };
  const nodes = [
    target,
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `shareholder-${index}`,
      x: index * 140,
      y: 0,
      width: 100,
      height: 90
    }))
  ];
  const existing = assignEquityRoutingHints(nodes, Array.from({ length: 6 }, (_, index) => ({
    id: `relation-${index}`,
    from: `shareholder-${index}`,
    to: 'fund',
    percent: index === 0 ? '100%' : '0%'
  })));
  const extended = assignEquityRoutingHints(nodes, [
    ...existing,
    { id: 'relation-6', from: 'shareholder-6', to: 'fund', percent: '0%' }
  ]);

  existing.forEach(link => {
    const after = extended.find(candidate => candidate.id === link.id);
    assert.deepEqual(
      {
        routeOrder: after.routeOrder,
        sourcePort: after.sourcePort,
        targetPort: after.targetPort
      },
      {
        routeOrder: link.routeOrder,
        sourcePort: link.sourcePort,
        targetPort: link.targetPort
      },
      `${link.id} should keep its persisted routing identity`
    );
  });
});

test('adding one relation does not move any existing route or percentage label', () => {
  const target = { id: 'fund', x: 300, y: 360, width: 220, height: 100 };
  const nodes = [
    target,
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `shareholder-${index}`,
      x: index * 140,
      y: 0,
      width: 100,
      height: 90
    }))
  ];
  const existing = assignEquityRoutingHints(nodes, Array.from({ length: 6 }, (_, index) => ({
    id: `relation-${index}`,
    from: `shareholder-${index}`,
    to: 'fund',
    percent: index === 0 ? '100%' : '0%'
  })));
  const before = calculateEquityRelationRoutes(nodes, existing);
  const extended = assignEquityRoutingHints(nodes, [
    ...existing,
    { id: 'relation-6', from: 'shareholder-6', to: 'fund', percent: '0%' }
  ]);
  const after = calculateEquityRelationRoutes(nodes, extended);

  existing.forEach(link => {
    const beforeRoute = relationRoute(before, link.id);
    const afterRoute = relationRoute(after, link.id);
    assert.equal(afterRoute.pathData, beforeRoute.pathData, `${link.id} path should remain fixed`);
    assert.deepEqual(
      afterRoute.labelAnchor,
      beforeRoute.labelAnchor,
      `${link.id} percentage label should remain fixed`
    );
  });
});

test('a new relation in a tight shared layer does not squeeze older tracks upward', () => {
  const nodes = [
    { id: 'holding-company', x: 802, y: 873, width: 220, height: 88 },
    { id: 'new-shareholder', x: 1193, y: 873, width: 220, height: 88 },
    { id: 'subsidiary-left', x: 629, y: 1078, width: 220, height: 88 },
    { id: 'subsidiary-middle', x: 913, y: 1078, width: 220, height: 88 },
    { id: 'subsidiary-right', x: 1197, y: 1078, width: 220, height: 88 }
  ];
  const existing = assignEquityRoutingHints(nodes, [
    { id: 'holding-left', from: 'holding-company', to: 'subsidiary-left', percent: '100%' },
    { id: 'holding-middle', from: 'holding-company', to: 'subsidiary-middle', percent: '100%' },
    { id: 'holding-right', from: 'holding-company', to: 'subsidiary-right', percent: '100%' },
    { id: 'shareholder-right', from: 'new-shareholder', to: 'subsidiary-right', percent: '0%' }
  ]);
  const before = calculateEquityRelationRoutes(nodes, existing);
  const extended = assignEquityRoutingHints(nodes, [
    ...existing,
    { id: 'shareholder-left', from: 'new-shareholder', to: 'subsidiary-left', percent: '0%' }
  ]);
  const after = calculateEquityRelationRoutes(nodes, extended);

  existing.forEach(link => {
    assert.equal(
      relationRoute(after, link.id).pathData,
      relationRoute(before, link.id).pathData,
      `${link.id} should not be squeezed by the newly created label tier`
    );
  });
});

test('routing hints persist lane and label identities for later node drags', () => {
  const nodes = [
    { id: 'source-left', x: 0, y: 0, width: 160, height: 88 },
    { id: 'source-right', x: 220, y: 0, width: 160, height: 88 },
    { id: 'target', x: 150, y: 340, width: 220, height: 100 }
  ];
  const links = assignEquityRoutingHints(nodes, [
    { id: 'left-target', from: 'source-left', to: 'target', percent: '50%' },
    { id: 'right-target', from: 'source-right', to: 'target', percent: '50%' }
  ]);

  links.forEach(link => {
    assert.ok(Number.isInteger(link.laneSlot) && link.laneSlot >= 0, `${link.id} should persist a lane slot`);
    assert.ok(Number.isInteger(link.labelTier) && link.labelTier >= 0, `${link.id} should persist a label tier`);
  });
});

test('dragging one node leaves routes outside its shared source and target bundles unchanged', () => {
  const nodes = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `source-${index}`,
      x: index * 220,
      y: 0,
      width: 160,
      height: 88
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `target-${index}`,
      x: 150 + index * 420,
      y: 340,
      width: 220,
      height: 100
    }))
  ];
  const links = assignEquityRoutingHints(nodes, [
    { id: 'source-0-target-0', from: 'source-0', to: 'target-0', percent: '20%' },
    { id: 'source-0-target-1', from: 'source-0', to: 'target-1', percent: '30%' },
    { id: 'source-0-target-2', from: 'source-0', to: 'target-2', percent: '50%' },
    { id: 'source-1-target-0', from: 'source-1', to: 'target-0', percent: '40%' },
    { id: 'source-1-target-1', from: 'source-1', to: 'target-1', percent: '60%' },
    { id: 'source-5-target-3', from: 'source-5', to: 'target-3', percent: '100%' }
  ]);
  const before = calculateEquityRelationRoutes(nodes, links);
  const movedNodes = nodes.map(node => node.id === 'source-0' ? { ...node, x: 1150 } : node);
  const after = calculateEquityRelationRoutes(movedNodes, links);

  ['source-5-target-3'].forEach(linkId => {
    const beforeRoute = relationRoute(before, linkId);
    const afterRoute = relationRoute(after, linkId);
    assert.equal(afterRoute.pathData, beforeRoute.pathData, `${linkId} is unrelated to the dragged node`);
    assert.deepEqual(afterRoute.labelAnchor, beforeRoute.labelAnchor, `${linkId} label should stay with its route`);
  });
});

test('dragging a target keeps each percentage label on its own final stem', () => {
  const nodes = [
    { id: 'holding-company', x: 802, y: 873, width: 220, height: 88 },
    { id: 'new-shareholder', x: 1193, y: 873, width: 220, height: 88 },
    { id: 'target-left', x: 629, y: 1078, width: 220, height: 88 },
    { id: 'target-middle', x: 913, y: 1078, width: 220, height: 88 },
    { id: 'target-right', x: 1197, y: 1078, width: 220, height: 88 }
  ];
  const links = assignEquityRoutingHints(nodes, [
    { id: 'holding-left', from: 'holding-company', to: 'target-left', percent: '100%' },
    { id: 'holding-middle', from: 'holding-company', to: 'target-middle', percent: '100%' },
    { id: 'holding-right', from: 'holding-company', to: 'target-right', percent: '100%' },
    { id: 'shareholder-right', from: 'new-shareholder', to: 'target-right', percent: '0%' }
  ]);
  const before = calculateEquityRelationRoutes(nodes, links);
  const movedNodes = nodes.map(node => node.id === 'target-right'
    ? { ...node, x: 1420, y: 960 }
    : node);
  const routes = calculateEquityRelationRoutes(movedNodes, links);

  ['holding-right', 'shareholder-right'].forEach(linkId => {
    const link = links.find(candidate => candidate.id === linkId);
    const route = relationRoute(routes, link.id);
    assert.equal(route.labelAnchor.x, route.endX, `${link.id} label should follow the final target stem`);
    assert.ok(
      route.segments.some(segment => segment.x1 === route.labelAnchor.x
        && segment.x2 === route.labelAnchor.x
        && route.labelAnchor.y >= Math.min(segment.y1, segment.y2)
        && route.labelAnchor.y <= Math.max(segment.y1, segment.y2)),
      `${link.id} label should lie on its own visible vertical segment`
    );
  });
  ['holding-left', 'holding-middle'].forEach(linkId => {
    assert.equal(
      relationRoute(routes, linkId).pathData,
      relationRoute(before, linkId).pathData,
      `${linkId} should ignore a distant dragged target`
    );
    assert.deepEqual(
      relationRoute(routes, linkId).labelAnchor,
      relationRoute(before, linkId).labelAnchor,
      `${linkId} label should not move with another target`
    );
  });
});

test('reordering sibling targets repairs only their shared fan-out ports and removes crossings', () => {
  const source = { id: 'parent', x: 600, y: 0, width: 440, height: 100 };
  const initialTargets = Array.from({ length: 5 }, (_, index) => ({
    id: `child-${index}`,
    x: index * 320,
    y: 360,
    width: 240,
    height: 100
  }));
  const unrelatedNodes = [
    { id: 'other-parent', x: 1700, y: 0, width: 220, height: 100 },
    { id: 'other-child', x: 1700, y: 360, width: 220, height: 100 }
  ];
  const initialNodes = [source, ...initialTargets, ...unrelatedNodes];
  const links = assignEquityRoutingHints(initialNodes, [
    ...initialTargets.map((target, index) => ({
      id: `parent-child-${index}`,
      from: 'parent',
      to: target.id,
      percent: '20%'
    })),
    { id: 'unrelated', from: 'other-parent', to: 'other-child', percent: '100%' }
  ]);
  const before = calculateEquityRelationRoutes(initialNodes, links);
  const reorderedIds = [4, 3, 2, 1, 0];
  const reorderedNodes = [
    source,
    ...reorderedIds.map((targetIndex, position) => ({
      ...initialTargets[targetIndex],
      x: position * 320
    })),
    ...unrelatedNodes
  ];
  const after = calculateEquityRelationRoutes(reorderedNodes, links);
  const fanOutRoutes = initialTargets.map((_, index) =>
    relationRoute(after, `parent-child-${index}`)
  );
  const routesByTargetX = [...fanOutRoutes].sort((left, right) => left.endX - right.endX);
  routesByTargetX.slice(1).forEach((route, index) => {
    assert.ok(
      routesByTargetX[index].startX < route.startX,
      'source ports should follow the current left-to-right target order'
    );
  });
  const crossings = [];
  fanOutRoutes.forEach((leftRoute, leftIndex) => {
    fanOutRoutes.slice(leftIndex + 1).forEach(rightRoute => {
      leftRoute.segments.forEach(leftSegment => {
        rightRoute.segments.forEach(rightSegment => {
          if (routeSegmentsCross(leftSegment, rightSegment)
            || horizontalSegmentsOverlap(leftSegment, rightSegment)) {
            crossings.push([leftRoute.relation.id, rightRoute.relation.id]);
          }
        });
      });
    });
  });

  assert.deepEqual(crossings, [], 'sibling fan-out routes should remain crossing-free after horizontal reordering');
  assert.equal(
    relationRoute(after, 'unrelated').pathData,
    relationRoute(before, 'unrelated').pathData,
    'repairing one fan-out group must not move an unrelated route'
  );
  assert.deepEqual(
    relationRoute(after, 'unrelated').labelAnchor,
    relationRoute(before, 'unrelated').labelAnchor,
    'repairing one fan-out group must not move an unrelated percentage label'
  );
});

test('fan-out lane routing ignores relation array order and minimizes geometric crossings', () => {
  const nodes = [
    { id: 'parent', x: 600, y: 0, width: 440, height: 100 },
    { id: 'foshan', x: 0, y: 360, width: 240, height: 100 },
    { id: 'hangzhou', x: 320, y: 360, width: 240, height: 100 },
    { id: 'research', x: 640, y: 360, width: 240, height: 100 },
    { id: 'shanghai', x: 960, y: 360, width: 240, height: 100 },
    { id: 'regional-sales', x: 1280, y: 360, width: 240, height: 100 }
  ];
  const links = assignEquityRoutingHints(nodes, [
    { id: 'parent-shanghai', from: 'parent', to: 'shanghai', percent: '20%' },
    { id: 'parent-hangzhou', from: 'parent', to: 'hangzhou', percent: '20%' },
    { id: 'parent-regional-sales', from: 'parent', to: 'regional-sales', percent: '20%' },
    { id: 'parent-research', from: 'parent', to: 'research', percent: '20%' },
    { id: 'parent-foshan', from: 'parent', to: 'foshan', percent: '20%' }
  ]);
  const result = calculateEquityRelationRoutes(nodes, links);
  const routes = links.map(link => relationRoute(result, link.id));
  const crossings = [];
  routes.forEach((leftRoute, leftIndex) => {
    routes.slice(leftIndex + 1).forEach(rightRoute => {
      leftRoute.segments.forEach(leftSegment => {
        rightRoute.segments.forEach(rightSegment => {
          if (routeSegmentsCross(leftSegment, rightSegment)
            || horizontalSegmentsOverlap(leftSegment, rightSegment)) {
            crossings.push([leftRoute.relation.id, rightRoute.relation.id]);
          }
        });
      });
    });
  });

  assert.deepEqual(crossings, [], 'geometry, not relation insertion order, should determine fan-out lanes');
});

test('dragging one long relation source does not reassign another long route corridor', () => {
  const nodes = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `source-${index}`, x: index * 280, y: 0, width: 140, height: 80
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `middle-${index}`, x: 80 + index * 280, y: 230, width: 180, height: 100
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `target-${index}`, x: index * 280, y: 500, width: 180, height: 90
    }))
  ];
  const relation = id => {
    const [, from, to] = id.match(/^long-(\d)-(\d)$/) || [];
    return { id, from: `source-${from}`, to: `target-${to}`, percent: '10%' };
  };
  const links = assignEquityRoutingHints(nodes, [
    ...['long-0-2', 'long-1-2', 'long-2-0', 'long-2-3', 'long-3-0', 'long-3-1', 'long-3-3']
      .map(relation),
    { id: 'source-middle-0', from: 'source-0', to: 'middle-0', percent: '50%' },
    { id: 'middle-target-1', from: 'middle-1', to: 'target-1', percent: '50%' },
    { id: 'middle-target-2', from: 'middle-2', to: 'target-2', percent: '50%' },
    { id: 'middle-target-3', from: 'middle-3', to: 'target-3', percent: '50%' }
  ]);
  const before = calculateEquityRelationRoutes(nodes, links);
  const movedNodes = nodes.map(node => node.id === 'source-0' ? { ...node, x: 900 } : node);
  const after = calculateEquityRelationRoutes(movedNodes, links);

  assert.equal(
    relationRoute(after, 'long-3-0').pathData,
    relationRoute(before, 'long-3-0').pathData,
    'an unrelated long route must keep its persisted corridor'
  );
});

test('dense percentage labels remain on their own visible target stems', () => {
  const target = { id: 'fund', x: 300, y: 360, width: 220, height: 100 };
  const nodes = [
    target,
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `shareholder-${index}`, x: index * 100, y: 0, width: 80, height: 90
    }))
  ];
  const links = assignEquityRoutingHints(nodes, Array.from({ length: 12 }, (_, index) => ({
    id: `shareholder-fund-${index}`,
    from: `shareholder-${index}`,
    to: 'fund',
    percent: '0%'
  })));
  const routes = calculateEquityRelationRoutes(nodes, links);

  links.forEach(link => {
    const route = relationRoute(routes, link.id);
    assert.ok(
      route.segments.some(segment => segment.x1 === route.labelAnchor.x
        && segment.x2 === route.labelAnchor.x
        && route.labelAnchor.y >= Math.min(segment.y1, segment.y2)
        && route.labelAnchor.y <= Math.max(segment.y1, segment.y2)),
      `${link.id} label must remain on its own final vertical stem even in a dense target`
    );
  });
});

test('relation labels stay on their own target stems while dense labels stack vertically', () => {
  const target = { id: 'fund', x: 300, y: 360, width: 180, height: 100 };
  const nodes = [
    { id: 'source-left', x: 0, y: 0, width: 180, height: 90 },
    { id: 'source-middle', x: 300, y: 0, width: 180, height: 90 },
    { id: 'source-right', x: 600, y: 0, width: 180, height: 90 },
    target
  ];
  const links = [
    { id: 'left-fund', from: 'source-left', to: 'fund', percent: '100.0000%' },
    { id: 'middle-fund', from: 'source-middle', to: 'fund', percent: '100.0000%' },
    { id: 'right-fund', from: 'source-right', to: 'fund', percent: '100.0000%' }
  ];

  const result = calculateEquityRelationRoutes(nodes, links);
  const routes = links.map(link => relationRoute(result, link.id));
  const labelBoxes = routes.map(route => {
    const width = Math.max(48, route.relation.percent.length * 9 + 18);
    assert.equal(
      route.labelAnchor.x,
      route.endX,
      `${route.relation.id} label must remain centered on its own final target stem`
    );
    return {
      left: route.labelAnchor.x - width / 2,
      right: route.labelAnchor.x + width / 2,
      top: route.labelAnchor.y - 15,
      bottom: route.labelAnchor.y + 13
    };
  });

  for (let leftIndex = 0; leftIndex < labelBoxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < labelBoxes.length; rightIndex += 1) {
      const left = labelBoxes[leftIndex];
      const right = labelBoxes[rightIndex];
      const overlap = !(
        left.right + 7 <= right.left
        || left.left >= right.right + 7
        || left.bottom + 7 <= right.top
        || left.top >= right.bottom + 7
      );
      assert.equal(overlap, false, 'dense labels should use vertical tiers instead of horizontal drift');
    }
  }
  assert.ok(
    new Set(routes.map(route => route.labelAnchor.y)).size > 1,
    'overlapping labels should be separated into vertical tiers'
  );
  assert.deepEqual(
    routes.map(route => route.labelAnchor.tier),
    [0, 1, 2],
    'three mutually overlapping labels should use the three nearest available tiers'
  );
});

test('relation label anchors are stable when relation input order changes', () => {
  const nodes = [
    { id: 'source-left', x: 0, y: 0, width: 180, height: 90 },
    { id: 'source-middle', x: 300, y: 0, width: 180, height: 90 },
    { id: 'source-right', x: 600, y: 0, width: 180, height: 90 },
    { id: 'fund', x: 300, y: 360, width: 180, height: 100 }
  ];
  const links = [
    { id: 'left-fund', from: 'source-left', to: 'fund', percent: '0%' },
    { id: 'middle-fund', from: 'source-middle', to: 'fund', percent: '100.0000%' },
    { id: 'right-fund', from: 'source-right', to: 'fund', percent: '21.5%' }
  ];
  const original = calculateEquityRelationRoutes(nodes, links);
  const shuffled = calculateEquityRelationRoutes(nodes, [links[2], links[0], links[1]]);

  links.forEach(link => {
    assert.deepEqual(
      relationRoute(shuffled, link.id).labelAnchor,
      relationRoute(original, link.id).labelAnchor,
      `${link.id} label position should not depend on relation insertion order`
    );
  });
});

test('relation routing reserves a clear label band above a dense common target', () => {
  const target = { id: 'fund', x: 300, y: 300, width: 220, height: 100 };
  const nodes = [target];
  const links = [];
  for (let index = 0; index < 7; index += 1) {
    nodes.push({ id: `shareholder-${index}`, x: index * 140, y: 0, width: 100, height: 150 });
    links.push({
      id: `shareholder-fund-${index}`,
      from: `shareholder-${index}`,
      to: 'fund',
      percent: index === 0 ? '100%' : '0%'
    });
  }

  const result = calculateEquityRelationRoutes(nodes, links);
  const routes = links.map(link => relationRoute(result, link.id));

  routes.forEach(labelRoute => {
    const labelRectangle = relationLabelRectangle(labelRoute);
    routes.forEach(pathRoute => {
      pathRoute.segments
        .filter(segment => segment.orientation === 'horizontal')
        .forEach((segment, index) => {
          assert.equal(
            segmentIntersectsRectangleInterior(segment, labelRectangle),
            false,
            `${pathRoute.relation.id} horizontal segment ${index} must not cross ${labelRoute.relation.id} label`
          );
        });
    });
  });
});

test('auto layout increases the layer gap for a dense target label band', () => {
  const nodes = [];
  const links = [];
  for (let index = 0; index < 7; index += 1) {
    nodes.push({ id: `shareholder-${index}`, name: `股东 ${index + 1}`, width: 100, height: 88 });
    links.push({
      id: `shareholder-fund-${index}`,
      from: `shareholder-${index}`,
      to: 'fund',
      percent: index === 0 ? '100%' : '0%'
    });
  }
  nodes.push({ id: 'fund', name: 'GP+LP 有限合伙公司', width: 220, height: 100 });

  const layout = calculateEquityAutoLayout(nodes, links);
  const routedNodes = nodes.map(node => {
    const position = layoutPosition(layout, node.id);
    return {
      ...node,
      x: position.x,
      y: position.y,
      layoutWidth: position.width,
      layoutHeight: position.height
    };
  });
  const routes = [...calculateEquityRelationRoutes(routedNodes, links).routes.values()];

  routes.forEach(route => {
    assert.ok(
      route.midY >= route.startY + 32,
      `${route.relation.id} should preserve a clear downward outlet after automatic layout`
    );
    assert.ok(
      route.midY < route.labelBandTop,
      `${route.relation.id} horizontal track should remain above the target label band`
    );
  });
});

test('relation routing nests long common-target routes without crossing inner source stems', () => {
  const nodes = [
    { id: 'gp', x: 0, y: 0, width: 220, height: 100 },
    { id: 'new-shareholder', x: 300, y: 0, width: 220, height: 100 },
    { id: 'right-shareholder', x: 700, y: 0, width: 220, height: 100 },
    { id: 'fund', x: 360, y: 340, width: 400, height: 100 }
  ];
  const links = [
    { id: 'gp-fund', from: 'gp', to: 'fund', percent: '51%' },
    { id: 'new-fund', from: 'new-shareholder', to: 'fund', percent: '29%' },
    { id: 'right-fund', from: 'right-shareholder', to: 'fund', percent: '20%' }
  ];
  const verify = scenarioNodes => {
    const result = calculateEquityRelationRoutes(scenarioNodes, links);
    const routes = links.map(link => relationRoute(result, link.id));
    const crossings = [];

    for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
        routes[leftIndex].segments.forEach(leftSegment => {
          routes[rightIndex].segments.forEach(rightSegment => {
            if (routeSegmentsCross(leftSegment, rightSegment)) {
              crossings.push([links[leftIndex].id, links[rightIndex].id]);
            }
          });
        });
      }
    }

    assert.deepEqual(crossings, [], 'a longer outer route should not cut across a shorter inner route');
    return result;
  };
  const result = verify(nodes);
  const mirrored = nodes.map(node => ({ ...node, x: 920 - node.x - node.width }));
  verify(mirrored);
  const shuffled = calculateEquityRelationRoutes(
    [nodes[3], nodes[1], nodes[0], nodes[2]],
    [links[2], links[0], links[1]]
  );

  links.forEach(link => {
    assert.equal(
      relationRoute(shuffled, link.id).pathData,
      relationRoute(result, link.id).pathData,
      'route output should not depend on node or relation input order'
    );
  });
  assert.ok(
    relationRoute(result, 'gp-fund').laneIndex > relationRoute(result, 'new-fund').laneIndex,
    'the wider GP route should wrap below the shorter new-shareholder route'
  );
});

test('relation routing detours long cross-layer edges around intermediate node rectangles', () => {
  const blocker = { id: 'middle-company', x: 220, y: 210, width: 240, height: 120 };
  const nodes = [
    { id: 'top-shareholder', x: 270, y: 0, width: 140, height: 80 },
    blocker,
    { id: 'bottom-target', x: 250, y: 480, width: 180, height: 90 }
  ];
  const links = [
    { id: 'long-edge', from: 'top-shareholder', to: 'bottom-target' }
  ];

  const result = calculateEquityRelationRoutes(nodes, links, { nodeClearance: 16 });
  const route = relationRoute(result, 'long-edge');

  assert.ok(route.segments.length >= 3, 'a blocked long edge should contain a visible orthogonal detour');
  route.segments.forEach((segment, index) => {
    assert.equal(
      segmentIntersectsRectangleInterior(segment, blocker),
      false,
      `long-edge segment ${index} must not pass through the intermediate company rectangle`
    );
  });
});

test('relation routing keeps the final target approach below a nearby obstacle', () => {
  const blocker = { id: 'near-target-blocker', x: 220, y: 400, width: 240, height: 70 };
  const nodes = [
    { id: 'source', x: 270, y: 0, width: 140, height: 80 },
    blocker,
    { id: 'target', x: 250, y: 500, width: 180, height: 90 }
  ];
  const route = relationRoute(calculateEquityRelationRoutes(nodes, [
    { id: 'source-target', from: 'source', to: 'target' }
  ], { nodeClearance: 16 }), 'source-target');

  route.segments.forEach((segment, index) => {
    assert.equal(
      segmentIntersectsRectangleInterior(segment, blocker),
      false,
      `near-target segment ${index} must stay outside the nearby obstacle`
    );
  });
});
