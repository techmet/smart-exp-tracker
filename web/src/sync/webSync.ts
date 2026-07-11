import { getAllExpensesForSync, syncUpsertExpenses } from '../db/indexedDb';
import type { Expense } from '../db/indexedDb';

/**
 * Exports all local IndexedDB expenses to a JSON file and triggers
 * a browser download for the user.
 */
export const exportSyncFile = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const expenses = await getAllExpensesForSync();
    const jsonString = JSON.stringify(expenses, null, 2);
    
    // Create a blob representing the JSON file
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Trigger standard browser download
    const link = document.createElement('a');
    link.href = url;
    link.download = 'family_expenses_sync.json';
    document.body.appendChild(link);
    link.click();
    
    // Clean up
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    return {
      success: true,
      message: 'Ledger exported successfully. Check your browser downloads!',
    };
  } catch (error: any) {
    console.error('Failed to export sync file:', error);
    return {
      success: false,
      message: error.message || 'Failed to export backup file.',
    };
  }
};

/**
 * Reads, parses, and merges a selected JSON backup file into IndexedDB.
 */
export const importSyncFile = async (file: File): Promise<{ success: boolean; message: string }> => {
  try {
    const fileContent = await file.text();
    
    let incomingExpenses: Expense[] = [];
    try {
      incomingExpenses = JSON.parse(fileContent);
      
      // Structural validations
      if (!Array.isArray(incomingExpenses)) {
        throw new Error('Invalid file format. Expected a JSON array of transactions.');
      }
      
      if (incomingExpenses.length > 0) {
        const sample = incomingExpenses[0];
        if (!sample.id || !sample.amount || !sample.category) {
          throw new Error('Database elements missing typical transaction fields.');
        }
      }
    } catch (parseError: any) {
      throw new Error(`File parsing failed: ${parseError.message}`);
    }
    
    // Merge incoming logs into local IndexedDB
    await syncUpsertExpenses(incomingExpenses);
    
    return {
      success: true,
      message: `Sync complete! Successfully parsed and merged ${incomingExpenses.length} transactions.`,
    };
  } catch (error: any) {
    console.error('Failed to import sync file:', error);
    return {
      success: false,
      message: error.message || 'Failed to sync selected file.',
    };
  }
};
