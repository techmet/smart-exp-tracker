import { Paths } from 'expo-file-system';
import { writeAsStringAsync, readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { getAllExpensesForSync, syncUpsertExpenses, Expense } from '../db/database';

const LOCAL_SYNC_FILENAME = 'family_expenses_sync.json';

/**
 * Exports all local expenses (including deleted logs) to a JSON file
 * and triggers the native Share Sheet so the user can save it directly
 * to Google Drive, iCloud, or share it with family members.
 */
export const exportSyncFile = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const expenses = getAllExpensesForSync();
    const jsonString = JSON.stringify(expenses, null, 2);
    
    // Create temporary file path in the app cache using modern Paths API
    const tempPath = `${Paths.cache.uri}${LOCAL_SYNC_FILENAME}`;
    
    // Write JSON string to file
    await writeAsStringAsync(tempPath, jsonString, {
      encoding: EncodingType.UTF8,
    });
    
    // Check if sharing is supported on the platform
    const isSharingAvailable = await Sharing.isAvailableAsync();
    if (!isSharingAvailable) {
      throw new Error('Sharing is not supported on this device.');
    }
    
    // Open standard native share dialog
    await Sharing.shareAsync(tempPath, {
      mimeType: 'application/json',
      dialogTitle: 'Backup Expense Database to Google Drive / Files',
      UTI: 'public.json', // iOS identifier
    });
    
    return {
      success: true,
      message: 'Database backup file shared successfully.',
    };
  } catch (error: any) {
    console.error('Failed to export backup file:', error);
    return {
      success: false,
      message: error.message || 'Failed to export backup file.',
    };
  }
};

/**
 * Triggers the native document picker for the user to select their
 * backed-up `family_expenses_sync.json` file from Google Drive (or other cloud folders).
 * Reads, parses, and merges the remote records into the local SQLite database.
 */
export const importSyncFile = async (): Promise<{ success: boolean; message: string }> => {
  try {
    // 1. Open document picker
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    
    if (result.canceled || !result.assets || result.assets.length === 0) {
      return {
        success: false,
        message: 'Sync import cancelled by user.',
      };
    }
    
    const selectedFile = result.assets[0];
    
    // 2. Read selected JSON file content
    const fileContent = await readAsStringAsync(selectedFile.uri, {
      encoding: EncodingType.UTF8,
    });
    
    // 3. Parse JSON data
    let incomingExpenses: Expense[] = [];
    try {
      incomingExpenses = JSON.parse(fileContent);
      
      // Perform structural validation
      if (!Array.isArray(incomingExpenses)) {
        throw new Error('Invalid database format. Expected JSON array of expenses.');
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
    
    // 4. Merge incoming logs into local SQLite database
    const localBefore = getAllExpensesForSync().length;
    syncUpsertExpenses(incomingExpenses);
    const localAfter = getAllExpensesForSync().length;
    
    return {
      success: true,
      message: `Sync complete! Successfully parsed ${incomingExpenses.length} transactions. Database updated.`,
    };
  } catch (error: any) {
    console.error('Failed to import and sync file:', error);
    return {
      success: false,
      message: error.message || 'Failed to sync selected file.',
    };
  }
};
