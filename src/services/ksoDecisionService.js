const DEFAULT_KSO_NORMS = [
  {
    experience: 'до 1 мес',
    kso: 30,
    checkout: 25,
    online: 3,
    staff: 35,
    weights: { kso: 1.169, checkout: 1.395, online: 11.357, staff: 1 }
  },
  {
    experience: '1-3 мес',
    kso: 30,
    checkout: 25,
    online: 3,
    staff: 35,
    weights: { kso: 1.169, checkout: 1.395, online: 11.357, staff: 1 }
  },
  {
    experience: '3-6 мес',
    kso: 42,
    checkout: 30,
    online: 5,
    staff: 45,
    weights: { kso: 1.073, checkout: 1.507, online: 8.913, staff: 1 }
  },
  {
    experience: '6+ мес',
    kso: 58,
    checkout: 45,
    online: 8,
    staff: 56,
    weights: { kso: 1, checkout: 1.288, online: 7.333, staff: 1.035 }
  }
];

const EVENT_POINT_WEIGHTS = {
  kso: 2,
  checkout: 3,
  online: 4,
  staff: 2
};

const EMPLOYEE_ASSIGNMENT_COEFFICIENTS = {
  strong: 0.9,
  standard: 1,
  trainee: 1.1,
  restricted: 0.1
};

function toNumber(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, precision = 3) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function findNorm(experience) {
  const text = String(experience || '').toLowerCase();

  if (text.includes('3') && text.includes('6')) {
    return DEFAULT_KSO_NORMS[2];
  }
  if (text.includes('6') || text.includes('стар')) {
    return DEFAULT_KSO_NORMS[3];
  }
  if (text.includes('1') && text.includes('3')) {
    return DEFAULT_KSO_NORMS[1];
  }

  return DEFAULT_KSO_NORMS[0];
}

function calculateStoreComplexity({ flow, cashRegisters, thefts }) {
  return round(
    toNumber(flow, 1) * 0.4
      + toNumber(cashRegisters, 1) * 0.3
      + toNumber(thefts, 1) * 0.3,
    2
  );
}

function calculateEmployeeKpi(input) {
  const hours = Math.max(1, toNumber(input.hours));
  const norm = findNorm(input.experience);
  const facts = {
    kso: toNumber(input.kso),
    checkout: toNumber(input.checkout),
    online: toNumber(input.online),
    staff: toNumber(input.staff)
  };
  const points = Object.entries(facts).reduce((sum, [key, value]) => sum + value * EVENT_POINT_WEIGHTS[key], 0);
  const perHour = {
    kso: round(facts.kso / hours),
    checkout: round(facts.checkout / hours),
    online: round(facts.online / hours),
    staff: round(facts.staff / hours)
  };
  const weightedKpi = round(
    perHour.kso * norm.weights.kso
      + perHour.checkout * norm.weights.checkout
      + perHour.online * norm.weights.online
      + perHour.staff * norm.weights.staff
  );

  return {
    experience: norm.experience,
    hours,
    facts,
    points,
    perHour,
    weightedKpi,
    rs: input.shiftsCount && toNumber(input.shiftsCount) < 5 ? 1 : Math.max(0.1, weightedKpi)
  };
}

function calculateAssignmentPriority(input) {
  const rs = toNumber(input.rs, 1);
  const employeeCoefficient = toNumber(input.employeeCoefficient, 1);
  const daysWithoutHardStore = Math.max(1, toNumber(input.daysWithoutHardStore, 1));
  const consecutiveHardStoreDays = toNumber(input.consecutiveHardStoreDays);
  const overtimePenalty = toNumber(input.overtimePenalty);
  const restrictionPenalty = toNumber(input.restrictionPenalty);

  return round(
    rs * employeeCoefficient * daysWithoutHardStore
      - consecutiveHardStoreDays
      - overtimePenalty
      - restrictionPenalty,
    3
  );
}

function getKsoDecisionModel() {
  return {
    storeComplexity: {
      formula: 'Ks = Поток * 0.4 + Кассы * 0.3 + Кражи * 0.3',
      min: 1,
      max: 3
    },
    employeeKpi: {
      eventPointWeights: EVENT_POINT_WEIGHTS,
      norms: DEFAULT_KSO_NORMS
    },
    assignment: {
      formula: 'Ps = Rs * коэффициент сотрудника * дней без сложного магазина - дни подряд - переработка - ограничения',
      employeeCoefficients: EMPLOYEE_ASSIGNMENT_COEFFICIENTS
    }
  };
}

module.exports = {
  calculateAssignmentPriority,
  calculateEmployeeKpi,
  calculateStoreComplexity,
  getKsoDecisionModel
};
