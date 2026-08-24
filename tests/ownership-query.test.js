import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOwnershipQuery } from '../src/ownership-query.js';

const node = id => ({ id, name: id.toUpperCase() });
const relation = (id, from, to, percent) => ({ id, from, to, percent });
const codes = entries => entries.map(entry => entry.code);

test('calculates a direct economic ownership path', () => {
  const result = calculateOwnershipQuery({
    nodes: [node('a'), node('b')],
    links: [relation('ab', 'a', 'b', '25%')],
    sourceId: 'a',
    targetId: 'b'
  });

  assert.equal(result.found, true);
  assert.equal(result.invalid, false);
  assert.equal(result.directPercent, 25);
  assert.equal(result.indirectPercent, 0);
  assert.equal(result.totalPercent, 25);
  assert.deepEqual(result.paths, [{
    nodeIds: ['a', 'b'],
    relationIds: ['ab'],
    segments: [{ relationId: 'ab', from: 'a', to: 'b', percent: 25 }],
    pathPercent: 25
  }]);
});

test('multiplies every segment on an indirect path', () => {
  const result = calculateOwnershipQuery({
    nodes: [node('person'), node('holding'), node('target')],
    links: [
      relation('person-holding', 'person', 'holding', '60%'),
      relation('holding-target', 'holding', 'target', '80%')
    ],
    sourceId: 'person',
    targetId: 'target'
  });

  assert.equal(result.directPercent, 0);
  assert.equal(result.indirectPercent, 48);
  assert.equal(result.totalPercent, 48);
  assert.equal(result.paths[0].pathPercent, 48);
  assert.deepEqual(result.paths[0].nodeIds, ['person', 'holding', 'target']);
});

test('sums direct and all indirect paths without omitting parallel routes', () => {
  const result = calculateOwnershipQuery({
    nodes: ['s', 'a', 'b', 'c', 't'].map(node),
    links: [
      relation('direct', 's', 't', '5%'),
      relation('sa', 's', 'a', '60%'),
      relation('at', 'a', 't', '80%'),
      relation('sb', 's', 'b', '20%'),
      relation('bc', 'b', 'c', '50%'),
      relation('ct', 'c', 't', '30%')
    ],
    sourceId: 's',
    targetId: 't'
  });

  assert.equal(result.paths.length, 3);
  assert.deepEqual(result.paths.map(path => path.pathPercent), [5, 48, 3]);
  assert.equal(result.directPercent, 5);
  assert.equal(result.indirectPercent, 51);
  assert.equal(result.totalPercent, 56);
});

test('enumerates distinct simple paths when routes share intermediate nodes', () => {
  const result = calculateOwnershipQuery({
    nodes: ['s', 'a', 'b', 'c', 't'].map(node),
    links: [
      relation('sa', 's', 'a', 50),
      relation('sb', 's', 'b', 40),
      relation('ac', 'a', 'c', 60),
      relation('bc', 'b', 'c', 25),
      relation('ct', 'c', 't', 50)
    ],
    sourceId: 's',
    targetId: 't'
  });

  assert.deepEqual(result.paths.map(path => path.nodeIds), [
    ['s', 'a', 'c', 't'],
    ['s', 'b', 'c', 't']
  ]);
  assert.deepEqual(result.paths.map(path => path.pathPercent), [15, 5]);
  assert.equal(result.totalPercent, 20);
});

test('detects a reachable cycle, ignores only the cycle edge, and keeps valid paths', () => {
  const result = calculateOwnershipQuery({
    nodes: ['s', 'a', 'b', 't'].map(node),
    links: [
      relation('sa', 's', 'a', '50%'),
      relation('ab', 'a', 'b', '40%'),
      relation('ba', 'b', 'a', '10%'),
      relation('bt', 'b', 't', '50%')
    ],
    sourceId: 's',
    targetId: 't'
  });

  assert.equal(result.hasCycle, true);
  assert.equal(result.incomplete, true);
  assert.equal(result.totalPercent, 10);
  assert.deepEqual(result.paths[0].relationIds, ['sa', 'ab', 'bt']);
  assert.ok(codes(result.warnings).includes('CYCLE_EDGE_IGNORED'));
});

test('marks reachable invalid percentages and excludes them from known ownership', () => {
  for (const [percent, expectedCode] of [
    ['待填写', 'INVALID_PERCENT_FORMAT'],
    ['0%', 'NON_POSITIVE_PERCENT'],
    ['-1%', 'NON_POSITIVE_PERCENT'],
    ['101%', 'PERCENT_OVER_100']
  ]) {
    const result = calculateOwnershipQuery({
      nodes: ['s', 'a', 't'].map(node),
      links: [
        relation('invalid', 's', 't', percent),
        relation('sa', 's', 'a', '50%'),
        relation('at', 'a', 't', '40%')
      ],
      sourceId: 's',
      targetId: 't'
    });

    assert.equal(result.invalid, true);
    assert.equal(result.incomplete, true);
    assert.equal(result.totalPercent, 20);
    assert.ok(codes(result.invalidReasons).includes(expectedCode));
    assert.ok(codes(result.warnings).includes('INVALID_RELATIONS_EXCLUDED'));
  }
});

test('does not let unrelated malformed links invalidate a point-to-point query', () => {
  const result = calculateOwnershipQuery({
    nodes: ['s', 't', 'x', 'y'].map(node),
    links: [
      relation('st', 's', 't', '25%'),
      relation('xy', 'x', 'y', 'not-a-percent')
    ],
    sourceId: 's',
    targetId: 't'
  });

  assert.equal(result.invalid, false);
  assert.equal(result.totalPercent, 25);
});

test('returns UI-friendly invalid results for missing nodes and source equals target', () => {
  const missing = calculateOwnershipQuery({
    nodes: [node('a')],
    links: [],
    sourceId: 'a',
    targetId: 'missing'
  });
  assert.equal(missing.invalid, true);
  assert.ok(codes(missing.invalidReasons).includes('TARGET_NODE_NOT_FOUND'));

  const same = calculateOwnershipQuery({
    nodes: [node('a')],
    links: [],
    sourceId: 'a',
    targetId: 'a'
  });
  assert.equal(same.invalid, true);
  assert.ok(codes(same.invalidReasons).includes('SAME_SOURCE_TARGET'));
});

test('reports no path as a warning rather than fabricating ownership', () => {
  const result = calculateOwnershipQuery({
    nodes: [node('a'), node('b')],
    links: [],
    sourceId: 'a',
    targetId: 'b'
  });

  assert.equal(result.found, false);
  assert.equal(result.invalid, false);
  assert.equal(result.totalPercent, 0);
  assert.deepEqual(codes(result.warnings), ['NO_OWNERSHIP_PATH']);
});

test('uses stable precision for deep decimal paths', () => {
  const result = calculateOwnershipQuery({
    nodes: ['s', 'a', 'b', 't'].map(node),
    links: [
      relation('sa', 's', 'a', '33.333333333333%'),
      relation('ab', 'a', 'b', '33.333333333333%'),
      relation('bt', 'b', 't', '33.333333333333%')
    ],
    sourceId: 's',
    targetId: 't'
  });

  assert.equal(result.totalPercent, 3.703703703704);
  assert.match(String(result.totalPercent), /^\d+(?:\.\d{1,12})?$/);
});

test('does not mutate nodes or links and creates stable fallback relation ids', () => {
  const nodes = [node('a'), node('b')];
  const links = [{ from: 'a', to: 'b', percent: '50%' }];
  const originalNodes = structuredClone(nodes);
  const originalLinks = structuredClone(links);

  const result = calculateOwnershipQuery({ nodes, links, sourceId: 'a', targetId: 'b' });

  assert.deepEqual(result.paths[0].relationIds, ['link-0']);
  assert.deepEqual(nodes, originalNodes);
  assert.deepEqual(links, originalLinks);
});
