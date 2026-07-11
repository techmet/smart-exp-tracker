import { Expense } from '../db/database';

/**
 * Calculates a deduplication hash for an expense.
 * Focuses on date (YYYY-MM-DD), amount, and cleaned description/merchant.
 */
export const calculateExpenseHash = (amount: number, dateStr: string, description: string): string => {
  const datePart = dateStr.split('T')[0]; // Extract YYYY-MM-DD
  const cleanedDesc = description
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // remove special characters
    .trim();
  return `${amount.toFixed(2)}_${datePart}_${cleanedDesc}`;
};

/**
 * Calculates the Levenshtein distance between two strings to measure similarity.
 */
export const getLevenshteinDistance = (a: string, b: string): number => {
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

/**
 * Measures similarity between 0.0 (completely different) and 1.0 (identical).
 */
export const getStringSimilarity = (str1: string, str2: string): number => {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  // Substring match shortcut
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    if (minLen / maxLen > 0.4) {
      return 0.8; // High similarity if it's a significant substring
    }
  }

  const maxLength = Math.max(s1.length, s2.length);
  const distance = getLevenshteinDistance(s1, s2);
  return (maxLength - distance) / maxLength;
};

export interface DuplicateGroup {
  primary: Expense;
  duplicates: Expense[];
}

/**
 * Scan a list of active expenses and detect potential duplicates.
 * Two expenses are considered potential duplicates if:
 * 1. Their amounts match exactly.
 * 2. Their dates are within a specified window (default 12 hours).
 * 3. Their descriptions/merchants have a high similarity (> 0.6).
 */
export const findPotentialDuplicates = (
  expenses: Expense[],
  dateWindowMs: number = 12 * 60 * 60 * 1000 // 12 hours
): DuplicateGroup[] => {
  const groups: DuplicateGroup[] = [];
  const processedIds = new Set<string>();

  for (let i = 0; i < expenses.length; i++) {
    const primary = expenses[i];
    if (processedIds.has(primary.id)) continue;

    const duplicates: Expense[] = [];
    const primaryTime = new Date(primary.date).getTime();

    for (let j = i + 1; j < expenses.length; j++) {
      const candidate = expenses[j];
      if (processedIds.has(candidate.id)) continue;

      // Rule 1: Amounts must match
      if (Math.abs(primary.amount - candidate.amount) > 0.009) continue;

      // Rule 2: Dates must be within window
      const candidateTime = new Date(candidate.date).getTime();
      if (Math.abs(primaryTime - candidateTime) > dateWindowMs) continue;

      // Rule 3: Description similarity must be high
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
