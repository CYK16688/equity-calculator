const ROUNDING_TOLERANCE = 0.005;
const EXACT_TOLERANCE = 0.0000001;

export function parseOwnershipPercent(value) {
  const parsed = Number(String(value ?? '').replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStrictPercent(value) {
  const normalized = String(value ?? '').replace('%', '').trim();
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

function hasType(node, text) {
  return String(node?.type || '').includes(text);
}

export function assessOwnership(node, incomingLinks = []) {
  const scope = node?.ownershipScope === 'complete' ? 'complete' : 'partial';
  const incoming = [...incomingLinks];
  const rawPercentages = incoming.map(link => parseStrictPercent(link.percent));
  const invalidFormatIncoming = incoming.filter((link, index) => !Number.isFinite(rawPercentages[index]));
  const percentages = rawPercentages.map(percent => Number.isFinite(percent) ? percent : 0);
  const total = percentages.reduce((sum, percent) => sum + percent, 0);
  const nonPositiveIncoming = incoming.filter((link, index) => percentages[index] <= 0);
  const overLimitIncoming = incoming.filter((link, index) => percentages[index] > 100);
  const selfIncoming = incoming.filter(link => String(link.from) === String(node?.id));
  const shareholderCounts = new Map();

  incoming.forEach(link => {
    const shareholderId = String(link.from);
    shareholderCounts.set(shareholderId, (shareholderCounts.get(shareholderId) || 0) + 1);
  });

  const duplicateShareholderIds = [...shareholderCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([shareholderId]) => shareholderId);
  const errors = [];
  const warnings = [];
  const notices = [];
  const add = (collection, code, details = {}) => collection.push({ code, ...details });
  const isNaturalPerson = hasType(node, '自然人');

  if (isNaturalPerson && incoming.length) {
    add(errors, 'NATURAL_PERSON_AS_INVESTEE');
  }
  if (invalidFormatIncoming.length) {
    add(errors, 'INVALID_PERCENT_FORMAT', { count: invalidFormatIncoming.length });
  }
  if (nonPositiveIncoming.length) {
    add(errors, 'NON_POSITIVE_PERCENT', { count: nonPositiveIncoming.length });
  }
  if (overLimitIncoming.length) {
    add(errors, 'RELATION_PERCENT_OVER_100', { count: overLimitIncoming.length });
  }
  if (selfIncoming.length) {
    add(errors, 'SELF_OWNERSHIP', { count: selfIncoming.length });
  }
  if (duplicateShareholderIds.length) {
    add(errors, 'DUPLICATE_SHAREHOLDER', { shareholderIds: duplicateShareholderIds });
  }
  if (total > 100 + ROUNDING_TOLERANCE) {
    add(errors, 'TOTAL_OVER_100', { excess: total - 100 });
  } else if (!isNaturalPerson && scope === 'complete' && total < 100 - ROUNDING_TOLERANCE) {
    add(errors, 'COMPLETE_CAP_TABLE_UNDER_100', { missing: 100 - total });
  }

  const positiveIncoming = incoming.filter((link, index) => percentages[index] > 0 && percentages[index] <= 100);
  const positivePercentages = percentages.filter(percent => percent > 0 && percent <= 100);
  const exactlyWhollyOwned = positiveIncoming.length === 1
    && Math.abs(positivePercentages[0] - 100) <= ROUNDING_TOLERANCE
    && incoming.length === 1;

  if (hasType(node, '全资子公司') && !exactlyWhollyOwned) {
    add(warnings, 'WHOLLY_OWNED_TYPE_MISMATCH');
  }
  if (hasType(node, '控股子公司') && positiveIncoming.length && !positivePercentages.some(percent => percent > 50)) {
    add(warnings, 'CONTROLLED_TYPE_NEEDS_BASIS');
  }
  if (hasType(node, '参股企业') && positivePercentages.some(percent => percent > 50)) {
    add(warnings, 'MINORITY_TYPE_MISMATCH');
  }

  if (!isNaturalPerson && !incoming.length && scope === 'partial') {
    add(notices, 'NO_SHAREHOLDERS_DISCLOSED');
  } else if (!isNaturalPerson && total > EXACT_TOLERANCE && total < 100 - ROUNDING_TOLERANCE && scope === 'partial') {
    add(notices, 'PARTIAL_CAP_TABLE', { undisclosed: 100 - total });
  }
  if (Math.abs(total - 100) > EXACT_TOLERANCE && Math.abs(total - 100) <= ROUNDING_TOLERANCE) {
    add(notices, 'ROUNDING_TOLERANCE_APPLIED', { difference: total - 100 });
  }

  return {
    incoming,
    total,
    scope,
    undisclosed: total < 100 ? 100 - total : 0,
    invalidFormatIncoming,
    nonPositiveIncoming,
    overLimitIncoming,
    selfIncoming,
    duplicateShareholderIds,
    errors,
    warnings,
    notices,
    error: errors.length > 0,
    warning: warnings.length > 0,
    complete: !errors.length && Math.abs(total - 100) <= ROUNDING_TOLERANCE
  };
}

export function relationHasOwnershipError(ownership, relation, targetNode) {
  const errorCodes = new Set(ownership.errors.map(entry => entry.code));
  const strictPercent = parseStrictPercent(relation.percent);
  if (errorCodes.has('NATURAL_PERSON_AS_INVESTEE')) return true;
  if (errorCodes.has('TOTAL_OVER_100') || errorCodes.has('COMPLETE_CAP_TABLE_UNDER_100')) return true;
  if (!Number.isFinite(strictPercent) || strictPercent <= 0 || strictPercent > 100) return true;
  if (String(relation.from) === String(targetNode?.id)) return true;
  return ownership.duplicateShareholderIds.includes(String(relation.from));
}
