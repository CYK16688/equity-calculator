import test from 'node:test';
import assert from 'node:assert/strict';
import { assessOwnership, relationHasOwnershipError } from '../src/ownership-validation.js';

const company = (overrides = {}) => ({ id: 'target', type: '目标企业', ownershipScope: 'partial', ...overrides });
const link = (from, percent, overrides = {}) => ({ from, to: 'target', percent, ...overrides });
const codes = entries => entries.map(entry => entry.code);

test('partial disclosure accepts one minority shareholder', () => {
  const result = assessOwnership(company(), [link('shareholder-a', '21.5%')]);
  assert.equal(result.error, false);
  assert.equal(result.total, 21.5);
  assert.deepEqual(codes(result.notices), ['PARTIAL_CAP_TABLE']);
});

test('partial disclosure accepts multiple known shareholders below 100%', () => {
  const result = assessOwnership(company(), [link('shareholder-a', '20%'), link('shareholder-b', '10%')]);
  assert.equal(result.error, false);
  assert.equal(result.total, 30);
  assert.equal(result.undisclosed, 70);
});

test('complete cap table must equal 100%', () => {
  const incomplete = assessOwnership(company({ ownershipScope: 'complete' }), [link('a', '60%'), link('b', '30%')]);
  const complete = assessOwnership(company({ ownershipScope: 'complete' }), [link('a', '60%'), link('b', '40%')]);
  assert.ok(codes(incomplete.errors).includes('COMPLETE_CAP_TABLE_UNDER_100'));
  assert.equal(complete.error, false);
  assert.equal(complete.complete, true);
});

test('complete scope also rejects an empty or single-minority cap table', () => {
  const empty = assessOwnership(company({ ownershipScope: 'complete' }), []);
  const minority = assessOwnership(company({ ownershipScope: 'complete' }), [link('a', '21.5%')]);
  assert.ok(codes(empty.errors).includes('COMPLETE_CAP_TABLE_UNDER_100'));
  assert.ok(codes(minority.errors).includes('COMPLETE_CAP_TABLE_UNDER_100'));
});

test('zero, negative, individual over-limit, and aggregate over-allocation are errors', () => {
  assert.ok(codes(assessOwnership(company(), [link('a', '0%')]).errors).includes('NON_POSITIVE_PERCENT'));
  assert.ok(codes(assessOwnership(company(), [link('a', '-1%')]).errors).includes('NON_POSITIVE_PERCENT'));
  assert.ok(codes(assessOwnership(company(), [link('a', '101%')]).errors).includes('RELATION_PERCENT_OVER_100'));
  assert.ok(codes(assessOwnership(company(), [link('a', '60%'), link('b', '50%')]).errors).includes('TOTAL_OVER_100'));
});

test('invalid percentage text is distinguished from a real zero', () => {
  const result = assessOwnership(company(), [link('a', '待填写')]);
  assert.ok(codes(result.errors).includes('INVALID_PERCENT_FORMAT'));
  assert.equal(result.invalidFormatIncoming.length, 1);
});

test('small rounding differences produce a notice instead of a red error', () => {
  const result = assessOwnership(company({ ownershipScope: 'complete' }), [link('a', '99.9999%')]);
  assert.equal(result.error, false);
  assert.equal(result.complete, true);
  assert.ok(codes(result.notices).includes('ROUNDING_TOLERANCE_APPLIED'));
});

test('natural person cannot be the investee of an equity relation', () => {
  const result = assessOwnership(company({ type: '自然人股东' }), [link('company-a', '10%')]);
  assert.ok(codes(result.errors).includes('NATURAL_PERSON_AS_INVESTEE'));
});

test('cap-table completeness does not apply to a natural person without incoming relations', () => {
  const result = assessOwnership(company({ type: '自然人股东', ownershipScope: 'complete' }), []);
  assert.equal(result.error, false);
});

test('duplicate shareholder and self-ownership are rejected', () => {
  const duplicate = assessOwnership(company(), [link('a', '20%'), link('a', '30%')]);
  const self = assessOwnership(company(), [link('target', '20%')]);
  assert.ok(codes(duplicate.errors).includes('DUPLICATE_SHAREHOLDER'));
  assert.ok(codes(self.errors).includes('SELF_OWNERSHIP'));
});

test('entity role mismatches are warnings, not percentage errors', () => {
  const whollyOwned = assessOwnership(company({ type: '全资子公司' }), [link('a', '21.5%')]);
  const controlled = assessOwnership(company({ type: '控股子公司' }), [link('a', '40%')]);
  const minority = assessOwnership(company({ type: '参股企业' }), [link('a', '60%')]);
  assert.equal(whollyOwned.error, false);
  assert.ok(codes(whollyOwned.warnings).includes('WHOLLY_OWNED_TYPE_MISMATCH'));
  assert.ok(codes(controlled.warnings).includes('CONTROLLED_TYPE_NEEDS_BASIS'));
  assert.ok(codes(minority.warnings).includes('MINORITY_TYPE_MISMATCH'));
});

test('100% plus 0% remains invalid even though the arithmetic total is 100%', () => {
  const result = assessOwnership(company(), [link('a', '100%'), link('b', '0%')]);
  assert.equal(result.total, 100);
  assert.ok(codes(result.errors).includes('NON_POSITIVE_PERCENT'));
  assert.equal(relationHasOwnershipError(result, link('a', '100%'), company()), false);
  assert.equal(relationHasOwnershipError(result, link('b', '0%'), company()), true);
});
