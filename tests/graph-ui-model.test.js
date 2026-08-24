import test from 'node:test';
import assert from 'node:assert/strict';
import * as graphUiModel from '../src/graph-ui-model.js';
import {
  buildOwnershipTree,
  calculateEquityHierarchyLevels,
  graphLayerOrder,
  nodeCanvasLabel,
  nodeDisplayLabel,
  suggestUniqueNodeName,
  zoomInScale,
  zoomOutScale
} from '../src/graph-ui-model.js';

function calculateEquityAutoLayout(...args) {
  assert.equal(
    typeof graphUiModel.calculateEquityAutoLayout,
    'function',
    'graph-ui-model should export calculateEquityAutoLayout(nodes, links, options?)'
  );
  return graphUiModel.calculateEquityAutoLayout(...args);
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
