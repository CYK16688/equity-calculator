import test from 'node:test';
import assert from 'node:assert/strict';
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
