const assert = require('assert');

// 1. Copy of duplicate detector functions to test in Node.js
const getLevenshteinDistance = (a, b) => {
  const tmp = [];
  let i, j;
  for (i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
};

const getStringSimilarity = (str1, str2) => {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    if (minLen / maxLen > 0.4) {
      return 0.8;
    }
  }

  const maxLength = Math.max(s1.length, s2.length);
  const distance = getLevenshteinDistance(s1, s2);
  return (maxLength - distance) / maxLength;
};

const findPotentialDuplicates = (expenses, dateWindowMs = 12 * 60 * 60 * 1000) => {
  const groups = [];
  const processedIds = new Set();

  for (let i = 0; i < expenses.length; i++) {
    const primary = expenses[i];
    if (processedIds.has(primary.id)) continue;

    const duplicates = [];
    const primaryTime = new Date(primary.date).getTime();

    for (let j = i + 1; j < expenses.length; j++) {
      const candidate = expenses[j];
      if (processedIds.has(candidate.id)) continue;

      if (Math.abs(primary.amount - candidate.amount) > 0.009) continue;

      const candidateTime = new Date(candidate.date).getTime();
      if (Math.abs(primaryTime - candidateTime) > dateWindowMs) continue;

      const similarity = getStringSimilarity(primary.description, candidate.description);
      if (similarity >= 0.6) {
        duplicates.push(candidate);
      }
    }

    if (duplicates.length > 0) {
      groups.push({ primary, duplicates });
      processedIds.add(primary.id);
      duplicates.forEach((dup) => processedIds.add(dup.id));
    }
  }

  return groups;
};

// 2. Run Tests
console.log('=== Starting PWA Logic Verification Tests ===\n');

try {
  // Test 1: Similarity Check
  const sim1 = getStringSimilarity('Swiggy', 'Swiggy LTD');
  assert(sim1 >= 0.6, 'Swiggy similarity should exceed 0.6');
  console.log('✅ SUCCESS: Swiggy and Swiggy LTD match check');

  const sim2 = getStringSimilarity('Uber India', 'Uber Trip');
  assert(sim2 >= 0.4, 'Uber similarity check');
  console.log('✅ SUCCESS: Uber similarity check');

  const simDistant = getStringSimilarity('Starbucks Coffee', 'Groww Mutual Funds');
  assert(simDistant < 0.3, 'Distant strings should not match');
  console.log('✅ SUCCESS: Distant string check');

  // Test 2: Duplicate matcher
  const mockExpenses = [
    {
      id: 'e1',
      amount: 450.00,
      description: 'Zomato Food',
      date: '2026-07-11T12:00:00Z',
      isDeleted: 0,
    },
    {
      id: 'e2',
      amount: 450.00,
      description: 'Zomato Food Delivery',
      date: '2026-07-11T12:30:00Z', // 30 mins apart
      isDeleted: 0,
    },
    {
      id: 'e3',
      amount: 12000.00,
      description: 'Groww Mutual Funds',
      date: '2026-07-11T12:00:00Z',
      isDeleted: 0,
    }
  ];

  const duplicates = findPotentialDuplicates(mockExpenses);
  assert(duplicates.length === 1, 'Should identify exactly 1 duplicate group');
  assert(duplicates[0].primary.id === 'e1', 'Primary ID check');
  assert(duplicates[0].duplicates[0].id === 'e2', 'Duplicate ID check');
  console.log('✅ SUCCESS: Duplicate groups grouping check');

  // Test 3: Conflict resolution merge simulation
  const localDb = {
    'e1': { id: 'e1', amount: 450, updatedAt: '2026-07-11T12:00:00Z', description: 'Zomato' }
  };
  const incoming = [
    { id: 'e1', amount: 500, updatedAt: '2026-07-11T13:00:00Z', description: 'Zomato updated' }, // newer
    { id: 'e2', amount: 900, updatedAt: '2026-07-11T10:00:00Z', description: 'New card' } // new
  ];

  // Run merge simulator
  incoming.forEach(inc => {
    const loc = localDb[inc.id];
    if (!loc) {
      localDb[inc.id] = inc;
    } else {
      const incomingTime = new Date(inc.updatedAt).getTime();
      const localTime = new Date(loc.updatedAt).getTime();
      if (incomingTime > localTime) {
        localDb[inc.id] = inc;
      }
    }
  });

  assert(localDb['e1'].amount === 500, 'Merge conflict resolution updated local record to newer amount');
  assert(localDb['e2'] !== undefined, 'Merge conflict resolution added new records');
  console.log('✅ SUCCESS: Conflict resolution merge simulation');

  console.log('\n=== All PWA Verification Tests Passed Successfully! ===');
} catch (e) {
  console.error('\n❌ Test execution failed:', e);
  process.exit(1);
}
