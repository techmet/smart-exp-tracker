import { Platform } from 'react-native';
import { addExpense, existsByExternalIdOrHash } from '../db/database';
import { calculateExpenseHash, getStringSimilarity } from './duplicateDetector';
import { cleanMerchantName, categorizeMerchant } from './gmailReader';

export interface ParsedSMSTransaction {
  amount: number;
  currency: string;
  merchant: string;
  date: string;
  externalSourceId: string;
}

const SMS_PATTERNS = [
  // Pattern 1: "[Currency] [Amount] debited/spent from [Account] for/at [Merchant]"
  {
    regex: /(?:rs\.?|inr|usd|\$)\s*([0-9,]+\.[0-9]{2})\s+(?:debited|spent|charged)\s+(?:.*?\s+)?(?:for|at|to|from)\s+([A-Za-z0-9\s\-\.\*\/]+?)(?:\s+on|\.|\n|$)/i,
    amountIdx: 1,
    merchantIdx: 2,
    defaultCurrency: 'INR',
  },
  // Pattern 2: "debited/spent [Currency] [Amount] for/at [Merchant]"
  {
    regex: /(?:debited|spent|charged)\s+(?:rs\.?|inr|usd|\$)\s*([0-9,]+\.[0-9]{2})\s+(?:.*?\s+)?(?:for|at|to|from)\s+([A-Za-z0-9\s\-\.\*\/]+?)(?:\s+on|\.|\n|$)/i,
    amountIdx: 1,
    merchantIdx: 2,
    defaultCurrency: 'INR',
  },
  // Pattern 3: "Txn of [Currency] [Amount] at [Merchant]"
  {
    regex: /(?:txn|transaction|charge)\s+of\s+(?:([a-z0-9\$]+)\s*)?([0-9,]+\.[0-9]{2})\s+(?:.*?\s+)?(?:at|to|on)\s+([A-Za-z0-9\s\-\.\*\/]+)/i,
    amountIdx: 2,
    merchantIdx: 3,
    currencyIdx: 1,
    defaultCurrency: 'USD',
  },
  // Pattern 4: "Rs [Amount] spent on [Card] at [Merchant]"
  {
    regex: /(?:rs\.?|inr|usd|\$)\s*([0-9,]+\.[0-9]{2})\s+(?:spent|used)\s+on\s+.*?\s+at\s+([A-Za-z0-9\s\-\.\*\/]+)/i,
    amountIdx: 1,
    merchantIdx: 2,
    defaultCurrency: 'INR',
  }
];

/**
 * Parses raw SMS body to extract transaction details.
 */
export const parseSMSMessage = (body: string, id: string, dateStr: string): ParsedSMSTransaction | null => {
  for (const pattern of SMS_PATTERNS) {
    const match = body.match(pattern.regex);
    if (match) {
      const amountStr = match[pattern.amountIdx].replace(/,/g, '');
      const amount = parseFloat(amountStr);
      
      const currency = 'INR';

      let rawMerchant = match[pattern.merchantIdx] || 'Unknown Merchant';
      // Clean merchant name
      const merchant = cleanMerchantName(rawMerchant);

      return {
        amount,
        currency,
        merchant,
        date: new Date(dateStr).toISOString(),
        externalSourceId: id,
      };
    }
  }
  return null;
};

/**
 * Request SMS permissions (for Android).
 * Since we are inside an Expo Go or custom dev client, we explain iOS vs Android.
 */
export const requestSMSPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return false;
  }
  // In native Android, we would request android.permission.READ_SMS.
  // For Expo, we simulate approval or check device compatibility.
  return true;
};

/**
 * Simulates a set of incoming SMS messages for demonstration and testing.
 * Perfect for iOS simulator testing and showcasing the feature.
 */
export const MOCK_SMS_DATA = [
  {
    id: 'mock_sms_1',
    body: 'Alert: Rs 450.00 debited from Acct 9921 for Swiggy food delivery.',
    date: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 mins ago
  },
  {
    id: 'mock_sms_2',
    body: 'Txn of INR 1000.00 at STARBUCKS using Visa Card ending in 4421.',
    date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2 hours ago
  },
  {
    id: 'mock_sms_3',
    body: 'Spent Rs 12000.00 on mutual fund investment in Vanguard via Groww.',
    date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), // 1 day ago
  },
  {
    id: 'mock_sms_4',
    body: 'Transaction of Rs 599.00 at Netflix subscriptions charge.',
    date: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(), // 3 days ago
  }
];

/**
 * Processes mock/real SMS data to extract transaction details and save them to SQLite.
 */
export const syncSMSExpenses = (
  smsList: Array<{ id: string; body: string; date: string }>,
  userEmail: string
): { importedCount: number; duplicatesSkipped: number } => {
  let importedCount = 0;
  let duplicatesSkipped = 0;

  for (const sms of smsList) {
    if (existsByExternalIdOrHash(sms.id)) {
      duplicatesSkipped++;
      continue;
    }

    const parsed = parseSMSMessage(sms.body, sms.id, sms.date);
    if (parsed) {
      const hash = calculateExpenseHash(parsed.amount, parsed.date, parsed.merchant);
      
      if (existsByExternalIdOrHash(undefined, hash)) {
        duplicatesSkipped++;
        continue;
      }

      const now = new Date().toISOString();
      const catInfo = categorizeMerchant(parsed.merchant);

      addExpense({
        id: `sms_${parsed.externalSourceId}`,
        amount: parsed.amount,
        currency: parsed.currency,
        date: parsed.date,
        category: catInfo.category,
        subCategory: catInfo.subCategory,
        description: parsed.merchant,
        paymentMode: 'Auto-Read (SMS)',
        createdBy: userEmail,
        createdAt: now,
        updatedAt: now,
        externalSourceId: parsed.externalSourceId,
        hash: hash,
      });

      importedCount++;
    }
  }

  return { importedCount, duplicatesSkipped };
};
