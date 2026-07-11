import { addExpense, existsByExternalIdOrHash } from '../db/database';
import { calculateExpenseHash } from './duplicateDetector';

export interface ParsedTransaction {
  amount: number;
  currency: string;
  merchant: string;
  date: string;
  category: string;
  externalSourceId: string;
}

/**
 * Regex patterns to extract transaction details from email snippets/bodies.
 */
const TRANSACTION_PATTERNS = [
  // Pattern 1: "debited by [Currency] [Amount] on [Date] at [Merchant]" or "[Spent/Charged] [Currency] [Amount] at [Merchant]"
  {
    regex: /(?:debited|spent|charged|payment of)\s+(?:([A-Z\$]{1,3})\s*)?([0-9,]+\.[0-9]{2})\s+(?:.*?\s+)?(?:at|to|from)\s+([A-Za-z0-9\s\-\.\*]+?)(?:\s+on|\.|\n|$)/i,
    amountIdx: 2,
    currencyIdx: 1,
    merchantIdx: 3,
  },
  // Pattern 2: "Transaction of [Currency] [Amount] at [Merchant]"
  {
    regex: /(?:transaction of|purchase of)\s+(?:([A-Z\$]{1,3})\s*)?([0-9,]+\.[0-9]{2})\s+(?:at|to|from)\s+([A-Za-z0-9\s\-\.\*]+)/i,
    amountIdx: 2,
    currencyIdx: 1,
    merchantIdx: 3,
  },
  // Pattern 3: "Rs\.?\s*([0-9,]+\.[0-9]{2})\s+spent\s+on\s+.*?\s+at\s+([A-Za-z0-9\s\-\.\*]+)/i
  {
    regex: /(?:rs\.?|inr|usd|\$)\s*([0-9,]+\.[0-9]{2})\s+(?:spent|debited|charged)\s+(?:at|on|to)\s+([A-Za-z0-9\s\-\.\*]+)/i,
    amountIdx: 1,
    currencyIdx: null,
    merchantIdx: 2,
    defaultCurrency: 'INR',
  }
];

/**
 * Clean up merchant names.
 */
export const cleanMerchantName = (merchant: string): string => {
  return merchant
    .replace(/(?:ltd|inc|co|corp|gmbh|pv|pvt|limited|llc|store|shop|online|website|food delivery|delivery|order|payment|txn|transfer)/gi, '')
    .replace(/[\*\-\.\_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Attempt to categorize based on merchant name keywords.
 */
export const categorizeMerchant = (merchant: string): { category: string; subCategory?: string } => {
  const name = merchant.toLowerCase();
  
  if (name.includes('netflix') || name.includes('spotify') || name.includes('youtube') || name.includes('hulu') || name.includes('disney')) {
    return { category: 'Entertainment', subCategory: 'Subscriptions' };
  }
  if (name.includes('uber') || name.includes('lyft') || name.includes('taxi') || name.includes('cab') || name.includes('metro') || name.includes('train') || name.includes('flight') || name.includes('airline')) {
    return { category: 'Transportation', subCategory: 'Transit' };
  }
  if (name.includes('walmart') || name.includes('target') || name.includes('grocery') || name.includes('market') || name.includes('safeway') || name.includes('kroger') || name.includes('whole foods')) {
    return { category: 'Groceries' };
  }
  if (name.includes('starbucks') || name.includes('mcdonald') || name.includes('burger') || name.includes('pizza') || name.includes('restaurant') || name.includes('cafe') || name.includes('food')) {
    return { category: 'Food & Dining', subCategory: 'Restaurants' };
  }
  if (name.includes('utility') || name.includes('electric') || name.includes('water') || name.includes('gas') || name.includes('power') || name.includes('telecom') || name.includes('internet') || name.includes('comcast') || name.includes('verizon')) {
    return { category: 'Utilities', subCategory: 'Bills' };
  }
  if (name.includes('stock') || name.includes('fidelity') || name.includes('robinhood') || name.includes('vanguard') || name.includes('mutual') || name.includes('fund') || name.includes('coinbase') || name.includes('crypto')) {
    return { category: 'Investments', subCategory: name.includes('mutual') || name.includes('fund') ? 'Mutual Funds' : 'Stocks' };
  }
  
  return { category: 'Shopping' }; // Default fallback
};

/**
 * Parses Gmail Snippet/Body to extract a transaction.
 */
export const parseGmailMessage = (snippet: string, messageId: string, dateStr: string): ParsedTransaction | null => {
  for (const pattern of TRANSACTION_PATTERNS) {
    const match = snippet.match(pattern.regex);
    if (match) {
      const amountStr = match[pattern.amountIdx].replace(/,/g, '');
      const amount = parseFloat(amountStr);
      
      const currency = 'INR';

      let rawMerchant = match[pattern.merchantIdx] || 'Unknown Merchant';
      const merchant = cleanMerchantName(rawMerchant);
      const catInfo = categorizeMerchant(merchant);

      return {
        amount,
        currency,
        merchant,
        date: new Date(dateStr).toISOString(),
        category: catInfo.category,
        externalSourceId: messageId,
      };
    }
  }
  return null;
};

/**
 * Queries Gmail API for recent transaction emails, parses them,
 * and saves new transactions into SQLite (checking for duplicates first).
 */
export const fetchAndParseGmailExpenses = async (
  accessToken: string,
  userEmail: string
): Promise<{ importedCount: number; duplicatesSkipped: number }> => {
  let importedCount = 0;
  let duplicatesSkipped = 0;

  try {
    // 1. Fetch message list from Gmail matching transaction query
    const query = encodeURIComponent('subject:(transaction OR payment OR debit OR spend) OR "debited by" OR "charged"');
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=15`;
    
    const response = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Gmail API List error: ${response.statusText}`);
    }

    const data = await response.json();
    const messages = data.messages || [];

    for (const msg of messages) {
      // Check if message is already imported (by externalSourceId)
      if (existsByExternalIdOrHash(msg.id)) {
        duplicatesSkipped++;
        continue;
      }

      // Fetch individual message details
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`;
      const detailRes = await fetch(detailUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!detailRes.ok) continue;
      const detailData = await detailRes.json();

      const snippet = detailData.snippet || '';
      // Find Date header
      const headers = detailData.payload?.headers || [];
      const dateHeader = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value;
      const messageDate = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

      const parsed = parseGmailMessage(snippet, msg.id, messageDate);
      if (parsed) {
        // Calculate hash to perform secondary exact-duplicate prevention
        const hash = calculateExpenseHash(parsed.amount, parsed.date, parsed.merchant);
        
        if (existsByExternalIdOrHash(undefined, hash)) {
          duplicatesSkipped++;
          continue;
        }

        // Add to SQLite DB
        const now = new Date().toISOString();
        addExpense({
          id: `gmail_${parsed.externalSourceId}`,
          amount: parsed.amount,
          currency: parsed.currency,
          date: parsed.date,
          category: parsed.category,
          subCategory: categorizeMerchant(parsed.merchant).subCategory,
          description: parsed.merchant,
          paymentMode: 'Auto-Read (Gmail)',
          createdBy: userEmail,
          createdAt: now,
          updatedAt: now,
          externalSourceId: parsed.externalSourceId,
          hash: hash,
        });

        importedCount++;
      }
    }
  } catch (error) {
    console.error('Failed to import from Gmail:', error);
  }

  return { importedCount, duplicatesSkipped };
};
