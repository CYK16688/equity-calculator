const TOTAL_PERCENT = 100;
// Match the editor's ownership-validation tolerance so a cap table accepted
// as 100% because of display rounding is also financeable.
const TOTAL_TOLERANCE = 0.005;
const OUTPUT_DECIMAL_PLACES = 12;
const OUTPUT_SCALE = 10 ** OUTPUT_DECIMAL_PLACES;

function assertFiniteNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }
}

function roundOutput(value) {
  return Math.round((value + Number.EPSILON) * OUTPUT_SCALE) / OUTPUT_SCALE;
}

function sumPercentages(shareholders) {
  return shareholders.reduce((total, shareholder) => total + shareholder.percent, 0);
}

function normalizeShareholders(shareholders) {
  if (!Array.isArray(shareholders) || shareholders.length === 0) {
    throw new TypeError('shareholders must be a non-empty array');
  }

  const seenIds = new Set();
  const normalized = shareholders.map((shareholder, index) => {
    if (!shareholder || typeof shareholder !== 'object' || Array.isArray(shareholder)) {
      throw new TypeError(`shareholders[${index}] must be an object`);
    }

    const id = shareholder.id;
    if (id === undefined || id === null || String(id).trim() === '') {
      throw new TypeError(`shareholders[${index}].id is required`);
    }

    const comparableId = String(id);
    if (seenIds.has(comparableId)) {
      throw new RangeError(`duplicate shareholder id: ${comparableId}`);
    }
    seenIds.add(comparableId);

    assertFiniteNumber(shareholder.percent, `shareholders[${index}].percent`);
    if (shareholder.percent <= 0 || shareholder.percent > TOTAL_PERCENT) {
      throw new RangeError(`shareholders[${index}].percent must be greater than 0 and at most 100`);
    }

    return { ...shareholder, percent: shareholder.percent };
  });

  const total = sumPercentages(normalized);
  if (Math.abs(total - TOTAL_PERCENT) > TOTAL_TOLERANCE) {
    throw new RangeError(`original shareholder percentages must total 100; received ${total}`);
  }

  return normalized;
}

function stabilizeTotal(entries, protectedId) {
  const rounded = entries.map(entry => ({ ...entry, percent: roundOutput(entry.percent) }));
  const roundedTotal = sumPercentages(rounded);
  const residual = roundOutput(TOTAL_PERCENT - roundedTotal);

  if (residual !== 0) {
    const correctionCandidates = rounded
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => String(entry.id) !== protectedId)
      .sort((left, right) => right.entry.percent - left.entry.percent);
    const correctionIndex = correctionCandidates[0]?.index;

    if (correctionIndex === undefined) {
      throw new RangeError('a pure capital increase requires at least one shareholder other than the investor');
    }

    rounded[correctionIndex] = {
      ...rounded[correctionIndex],
      percent: roundOutput(rounded[correctionIndex].percent + residual)
    };
  }

  return rounded;
}

/**
 * Calculate the newly issued interest as a percentage of the post-money
 * capitalization. Both inputs must use the same positive currency unit.
 */
export function calculateNewIssuePercentFromValuation({
  preMoneyValuation,
  investmentAmount
} = {}) {
  assertFiniteNumber(preMoneyValuation, 'preMoneyValuation');
  assertFiniteNumber(investmentAmount, 'investmentAmount');

  if (preMoneyValuation <= 0) {
    throw new RangeError('preMoneyValuation must be greater than 0');
  }
  if (investmentAmount <= 0) {
    throw new RangeError('investmentAmount must be greater than 0');
  }

  // This branch avoids overflow when two very large finite values are added.
  const rawPercent = investmentAmount >= preMoneyValuation
    ? TOTAL_PERCENT / (1 + preMoneyValuation / investmentAmount)
    : TOTAL_PERCENT * (investmentAmount / preMoneyValuation)
      / (1 + investmentAmount / preMoneyValuation);

  return roundOutput(rawPercent);
}

// Kept as an API alias for saved integrations created by the first prototype.
export const calculatePostMoneyPercentFromValuation = calculateNewIssuePercentFromValuation;

function buildPlanFromNewIssuePercent(beforeInput, investorId, newIssuePercent) {
  assertFiniteNumber(newIssuePercent, 'newIssuePercent');
  if (newIssuePercent <= 0 || newIssuePercent >= TOTAL_PERCENT) {
    throw new RangeError('newIssuePercent must be greater than 0 and less than 100');
  }

  const comparableInvestorId = String(investorId);
  const existingInvestor = beforeInput.find(
    shareholder => String(shareholder.id) === comparableInvestorId
  );
  const dilutionFactor = (TOTAL_PERCENT - newIssuePercent) / TOTAL_PERCENT;
  const finalInvestorPercent = existingInvestor
    ? existingInvestor.percent * dilutionFactor + newIssuePercent
    : newIssuePercent;

  const before = beforeInput.map(shareholder => ({
    ...shareholder,
    percent: roundOutput(shareholder.percent),
    isNewInvestor: false
  }));
  const diluted = beforeInput.map(shareholder => ({
    ...shareholder,
    percent: String(shareholder.id) === comparableInvestorId
      ? finalInvestorPercent
      : shareholder.percent * dilutionFactor,
    isNewInvestor: false
  }));

  if (!existingInvestor) {
    diluted.push({
      id: investorId,
      percent: finalInvestorPercent,
      isNewInvestor: true
    });
  }

  return {
    before,
    after: stabilizeTotal(diluted, comparableInvestorId),
    dilutionFactor: roundOutput(dilutionFactor),
    newIssuePercent: roundOutput(newIssuePercent),
    postMoneyPercent: roundOutput(finalInvestorPercent)
  };
}

/**
 * Build a pure-capital-increase plan when the input is the newly issued
 * interest as a percentage of the post-money capitalization. This is the
 * correct input for a pre-money valuation + investment amount calculation.
 */
export function calculateDilutionPlanFromNewIssuePercent({
  shareholders,
  investorId,
  newIssuePercent
} = {}) {
  const beforeInput = normalizeShareholders(shareholders);
  if (investorId === undefined || investorId === null || String(investorId).trim() === '') {
    throw new TypeError('investorId is required');
  }
  return buildPlanFromNewIssuePercent(beforeInput, investorId, newIssuePercent);
}

/**
 * Build the post-money cap table for a pure capital increase.
 *
 * postMoneyPercent is the investor's final ownership percentage. If the
 * investor already exists, its diluted old holding and newly issued interest
 * are merged into the existing shareholder row.
 */
export function calculateDilutionPlan({
  shareholders,
  investorId,
  postMoneyPercent
} = {}) {
  const beforeInput = normalizeShareholders(shareholders);
  if (investorId === undefined || investorId === null || String(investorId).trim() === '') {
    throw new TypeError('investorId is required');
  }

  assertFiniteNumber(postMoneyPercent, 'postMoneyPercent');
  if (postMoneyPercent <= 0 || postMoneyPercent >= TOTAL_PERCENT) {
    throw new RangeError('postMoneyPercent must be greater than 0 and less than 100');
  }

  const comparableInvestorId = String(investorId);
  const existingInvestor = beforeInput.find(
    shareholder => String(shareholder.id) === comparableInvestorId
  );
  const existingPercent = existingInvestor?.percent ?? 0;

  if (existingInvestor && postMoneyPercent <= existingPercent + TOTAL_TOLERANCE) {
    throw new RangeError(
      'postMoneyPercent must exceed the existing investor percentage for a positive pure capital increase'
    );
  }

  const dilutionFactor = (TOTAL_PERCENT - postMoneyPercent)
    / (TOTAL_PERCENT - existingPercent);
  if (!Number.isFinite(dilutionFactor) || dilutionFactor <= 0 || dilutionFactor >= 1) {
    throw new RangeError('the requested postMoneyPercent cannot be produced by a pure capital increase');
  }
  const newIssuePercent = TOTAL_PERCENT * (1 - dilutionFactor);
  return buildPlanFromNewIssuePercent(beforeInput, investorId, newIssuePercent);
}
