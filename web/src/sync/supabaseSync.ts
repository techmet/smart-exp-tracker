import type { Expense } from '../db/indexedDb';
import { getAllExpensesForSync, syncUpsertExpenses } from '../db/indexedDb';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

// Key names in LocalStorage
const STORAGE_KEYS = {
  URL: 'supabase_project_url',
  KEY: 'supabase_anon_key',
};

// Retrieve configuration from LocalStorage
export function getSupabaseConfig(): SupabaseConfig | null {
  const url = localStorage.getItem(STORAGE_KEYS.URL);
  const anonKey = localStorage.getItem(STORAGE_KEYS.KEY);

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

// Clean and save configuration
export function saveSupabaseConfig(url: string, anonKey: string): void {
  // Sanitize URL: strip trailing slash and '/rest/v1' path if pasted
  let sanitizedUrl = url.trim().replace(/\/+$/, '');
  if (sanitizedUrl.endsWith('/rest/v1')) {
    sanitizedUrl = sanitizedUrl.substring(0, sanitizedUrl.length - 8);
  }
  sanitizedUrl = sanitizedUrl.replace(/\/+$/, '');

  localStorage.setItem(STORAGE_KEYS.URL, sanitizedUrl);
  localStorage.setItem(STORAGE_KEYS.KEY, anonKey.trim());
}

// Clear configuration
export function clearSupabaseConfig(): void {
  localStorage.removeItem(STORAGE_KEYS.URL);
  localStorage.removeItem(STORAGE_KEYS.KEY);
}

// Test connection by fetching a single row
export async function testSupabaseConnection(url: string, anonKey: string): Promise<{ success: boolean; message: string }> {
  try {
    // Sanitize test URL
    let sanitizedUrl = url.trim().replace(/\/+$/, '');
    if (sanitizedUrl.endsWith('/rest/v1')) {
      sanitizedUrl = sanitizedUrl.substring(0, sanitizedUrl.length - 8);
    }
    sanitizedUrl = sanitizedUrl.replace(/\/+$/, '');

    const endpoint = `${sanitizedUrl}/rest/v1/expenses?limit=1`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apikey': anonKey.trim(),
        'Authorization': `Bearer ${anonKey.trim()}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `HTTP Error ${response.status}: ${errorText || response.statusText}. Please verify the URL, Anon Key, and that you ran the SQL table creation query in the Supabase editor.`,
      };
    }

    return {
      success: true,
      message: 'Connection successful! Database table found.',
    };
  } catch (err) {
    return {
      success: false,
      message: `Network Error: ${err instanceof Error ? err.message : String(err)}. Please check your internet connection and Supabase URL.`,
    };
  }
}

// Sync Local IndexedDB with Supabase Database
export async function syncWithSupabase(): Promise<{
  success: boolean;
  message: string;
  addedLocally: number;
  updatedLocally: number;
  uploadedRemotely: number;
}> {
  const result = {
    success: false,
    message: '',
    addedLocally: 0,
    updatedLocally: 0,
    uploadedRemotely: 0,
  };

  const config = getSupabaseConfig();
  if (!config) {
    result.message = 'Supabase sync is not configured yet.';
    return result;
  }

  const { url, anonKey } = config;

  try {
    // Fetch ALL local records (including soft-deleted ones)
    const localExpenses = await getAllExpensesForSync();

    // 1. Fetch remote expenses
    const endpoint = `${url}/rest/v1/expenses`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      result.message = `Sync failed. Remote error (${response.status}): ${errorText || response.statusText}`;
      return result;
    }

    const remoteExpenses: Expense[] = await response.json();

    // Map remote records by id for instant lookups
    const remoteMap = new Map<string, Expense>();
    remoteExpenses.forEach((exp) => remoteMap.set(exp.id, exp));

    // Map local records by id
    const localMap = new Map<string, Expense>();
    localExpenses.forEach((exp) => localMap.set(exp.id, exp));

    const localUpdatesToSave: Expense[] = [];
    const remoteUpdatesToUpload: Expense[] = [];

    // Check remote records vs local records
    for (const remoteExp of remoteExpenses) {
      const localExp = localMap.get(remoteExp.id);

      if (!localExp) {
        // Exists remotely but not locally -> write it locally
        localUpdatesToSave.push(remoteExp);
        result.addedLocally++;
      } else {
        // Exists in both -> compare timestamps
        const localTime = new Date(localExp.updatedAt).getTime();
        const remoteTime = new Date(remoteExp.updatedAt).getTime();

        if (remoteTime > localTime) {
          // Remote is newer -> update local
          localUpdatesToSave.push(remoteExp);
          result.updatedLocally++;
        } else if (localTime > remoteTime) {
          // Local is newer -> prepare for upload to remote
          remoteUpdatesToUpload.push(localExp);
          result.uploadedRemotely++;
        }
      }
    }

    // Check local records not present remotely
    for (const localExp of localExpenses) {
      if (!remoteMap.has(localExp.id)) {
        // Exists locally but not remotely -> upload to remote
        remoteUpdatesToUpload.push(localExp);
        result.uploadedRemotely++;
      }
    }

    // Write all required local updates to IndexedDB using syncUpsertExpenses
    // which handles inserts & updates via objectStore.put without corrupting updatedAt timestamps
    if (localUpdatesToSave.length > 0) {
      await syncUpsertExpenses(localUpdatesToSave);
    }

    // 2. Upload any local updates back to Supabase
    if (remoteUpdatesToUpload.length > 0) {
      // Upsert using standard PostgREST endpoint
      // We append ?on_conflict=id and pass Prefer: resolution=merge-duplicates
      const uploadResponse = await fetch(`${url}/rest/v1/expenses?on_conflict=id`, {
        method: 'POST',
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(remoteUpdatesToUpload),
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        result.message = `Sync partially completed. Local updates saved, but remote upload failed: ${errorText}`;
        return result;
      }
    }

    result.success = true;
    result.message = `Sync completed! Downloaded ${result.addedLocally + result.updatedLocally} updates, uploaded ${result.uploadedRemotely} updates.`;
    return result;
  } catch (err) {
    result.message = `Sync network error: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
}
