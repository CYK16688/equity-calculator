import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOwnershipTree,
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

test('zoom in and out are reciprocal', () => {
  const initial = 0.82;
  assert.ok(Math.abs(zoomOutScale(zoomInScale(initial)) - initial) < 1e-12);
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
