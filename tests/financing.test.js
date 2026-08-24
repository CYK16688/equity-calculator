import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDilutionPlan,
  calculateDilutionPlanFromNewIssuePercent,
  calculateNewIssuePercentFromValuation,
  calculatePostMoneyPercentFromValuation
} from '../src/financing.js';

const totalPercent = shareholders => shareholders.reduce(
  (total, shareholder) => total + shareholder.percent,
  0
);

test('calculates the new investor post-money percentage from valuation and investment', () => {
  assert.equal(calculatePostMoneyPercentFromValuation({
    preMoneyValuation: 80_000_000,
    investmentAmount: 20_000_000
  }), 20);

  assert.equal(calculatePostMoneyPercentFromValuation({
    preMoneyValuation: 200,
    investmentAmount: 50
  }), 20);
});

test('calculates the newly issued post-money interest from valuation and investment', () => {
  assert.equal(calculateNewIssuePercentFromValuation({
    preMoneyValuation: 80,
    investmentAmount: 20
  }), 20);
});

test('rejects non-positive or non-finite valuation inputs', () => {
  for (const preMoneyValuation of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => calculatePostMoneyPercentFromValuation({ preMoneyValuation, investmentAmount: 10 }),
      /preMoneyValuation/
    );
  }

  for (const investmentAmount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => calculatePostMoneyPercentFromValuation({ preMoneyValuation: 100, investmentAmount }),
      /investmentAmount/
    );
  }
});

test('dilutes all old shareholders proportionally for a new investor', () => {
  const shareholders = [
    { id: 'founder-a', name: 'Founder A', percent: 60 },
    { id: 'founder-b', name: 'Founder B', percent: 40 }
  ];
  const originalSnapshot = structuredClone(shareholders);

  const result = calculateDilutionPlan({
    shareholders,
    investorId: 'investor-c',
    postMoneyPercent: 20
  });

  assert.deepEqual(result.before, [
    { id: 'founder-a', name: 'Founder A', percent: 60, isNewInvestor: false },
    { id: 'founder-b', name: 'Founder B', percent: 40, isNewInvestor: false }
  ]);
  assert.deepEqual(result.after, [
    { id: 'founder-a', name: 'Founder A', percent: 48, isNewInvestor: false },
    { id: 'founder-b', name: 'Founder B', percent: 32, isNewInvestor: false },
    { id: 'investor-c', percent: 20, isNewInvestor: true }
  ]);
  assert.equal(result.dilutionFactor, 0.8);
  assert.equal(result.postMoneyPercent, 20);
  assert.deepEqual(shareholders, originalSnapshot, 'input shareholders must not be mutated');
});

test('merges new shares when the investor is already an existing shareholder', () => {
  const result = calculateDilutionPlan({
    shareholders: [
      { id: 'founder', percent: 60 },
      { id: 'investor', percent: 40 }
    ],
    investorId: 'investor',
    postMoneyPercent: 50
  });

  assert.equal(result.after.length, 2);
  assert.deepEqual(result.after, [
    { id: 'founder', percent: 50, isNewInvestor: false },
    { id: 'investor', percent: 50, isNewInvestor: false }
  ]);
  assert.equal(result.dilutionFactor, 0.833333333333);
  assert.equal(result.newIssuePercent, 16.666666666667);
  assert.equal(result.after.filter(item => item.id === 'investor').length, 1);
});

test('adds the new issue to an existing investor in valuation mode', () => {
  const result = calculateDilutionPlanFromNewIssuePercent({
    shareholders: [
      { id: 'founder', percent: 60 },
      { id: 'investor', percent: 40 }
    ],
    investorId: 'investor',
    newIssuePercent: 20
  });

  assert.deepEqual(result.after, [
    { id: 'founder', percent: 48, isNewInvestor: false },
    { id: 'investor', percent: 52, isNewInvestor: false }
  ]);
  assert.equal(result.dilutionFactor, 0.8);
  assert.equal(result.newIssuePercent, 20);
  assert.equal(result.postMoneyPercent, 52);
});

test('keeps decimal output stable and the post-money total at 100%', () => {
  const result = calculateDilutionPlan({
    shareholders: [
      { id: 'a', percent: 33.33333333 },
      { id: 'b', percent: 33.33333333 },
      { id: 'c', percent: 33.33333334 }
    ],
    investorId: 'new-investor',
    postMoneyPercent: 17.345678901234
  });

  assert.ok(Math.abs(totalPercent(result.after) - 100) <= 1e-10);
  assert.equal(result.after.at(-1).percent, 17.345678901234);
  for (const shareholder of result.after) {
    assert.match(String(shareholder.percent), /^\d+(?:\.\d{1,12})?$/);
  }
});

test('rejects an original cap table whose total is not 100%', () => {
  for (const shareholders of [
    [{ id: 'a', percent: 60 }, { id: 'b', percent: 30 }],
    [{ id: 'a', percent: 70 }, { id: 'b', percent: 40 }]
  ]) {
    assert.throws(
      () => calculateDilutionPlan({ shareholders, investorId: 'c', postMoneyPercent: 10 }),
      /must total 100/
    );
  }
});

test('accepts the same small rounding tolerance as the ownership validator', () => {
  const result = calculateDilutionPlan({
    shareholders: [
      { id: 'a', percent: 60 },
      { id: 'b', percent: 39.9999 }
    ],
    investorId: 'c',
    postMoneyPercent: 20
  });

  assert.ok(Math.abs(totalPercent(result.after) - 100) <= 1e-10);
});

test('rejects zero, 100%, and out-of-range financing percentages', () => {
  const shareholders = [{ id: 'founder', percent: 100 }];

  for (const postMoneyPercent of [0, 100, -1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => calculateDilutionPlan({ shareholders, investorId: 'investor', postMoneyPercent }),
      /postMoneyPercent/
    );
  }
});

test('rejects invalid cap-table rows and duplicate shareholder ids', () => {
  assert.throws(
    () => calculateDilutionPlan({
      shareholders: [{ id: 'a', percent: 100 }, { id: 'a', percent: 0 }],
      investorId: 'investor',
      postMoneyPercent: 10
    }),
    /duplicate shareholder id/
  );

  assert.throws(
    () => calculateDilutionPlan({
      shareholders: [{ id: 'a', percent: 100 }, { id: 'b', percent: 0 }],
      investorId: 'investor',
      postMoneyPercent: 10
    }),
    /greater than 0/
  );
});

test('an existing investor must increase its percentage in a positive pure capital increase', () => {
  const shareholders = [
    { id: 'founder', percent: 60 },
    { id: 'investor', percent: 40 }
  ];

  for (const postMoneyPercent of [30, 40]) {
    assert.throws(
      () => calculateDilutionPlan({ shareholders, investorId: 'investor', postMoneyPercent }),
      /must exceed the existing investor percentage/
    );
  }
});
