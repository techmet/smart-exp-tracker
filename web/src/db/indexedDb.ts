export interface Expense {
  id: string;
  amount: number;
  currency: string;
  date: string;
  category: string;
  subCategory?: string;
  description: string;
  paymentMode: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: number; // 0 or 1
  externalSourceId?: string;
  hash: string;
}

const DB_NAME = 'SmartExpenseTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'expenses';

let dbInstance: IDBDatabase | null = null;

/**
 * Initializes the IndexedDB database and opens the expenses object store.
 */
export const initDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };
  });
};

/**
 * Retrieves a read-write transaction transaction store helper.
 */
const getStore = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
  const db = await initDb();
  const tx = db.transaction(STORE_NAME, mode);
  return tx.objectStore(STORE_NAME);
};

/**
 * Adds a new expense to the IndexedDB store.
 */
export const addExpense = async (expense: Expense): Promise<void> => {
  const store = await getStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.add(expense);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Add transaction failed: ${request.error?.message}`));
  });
};

/**
 * Updates an existing expense in the IndexedDB store.
 */
export const updateExpense = async (id: string, updates: Partial<Expense>): Promise<void> => {
  const store = await getStore('readwrite');
  
  return new Promise((resolve, reject) => {
    const getReq = store.get(id);
    
    getReq.onsuccess = () => {
      const data: Expense | undefined = getReq.result;
      if (!data) {
        reject(new Error(`Transaction with ID ${id} not found.`));
        return;
      }
      
      const updatedData: Expense = {
        ...data,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      
      const putReq = store.put(updatedData);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(new Error(`Update failed: ${putReq.error?.message}`));
    };
    
    getReq.onerror = () => reject(new Error(`Fetch failed for update: ${getReq.error?.message}`));
  });
};

/**
 * Performs a soft delete on an expense (sets isDeleted = 1 and updates timestamp).
 */
export const deleteExpense = async (id: string): Promise<void> => {
  await updateExpense(id, { isDeleted: 1 });
};

/**
 * Returns all active expenses (where isDeleted === 0) sorted by date descending.
 */
export const getActiveExpenses = async (): Promise<Expense[]> => {
  const store = await getStore('readonly');
  
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    
    request.onsuccess = () => {
      const list: Expense[] = request.result || [];
      const active = list.filter((item) => item.isDeleted === 0);
      
      // Sort by date descending, fall back to createdAt
      active.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      resolve(active);
    };
    
    request.onerror = () => {
      reject(new Error(`Failed to load active expenses: ${request.error?.message}`));
    };
  });
};

/**
 * Returns all expenses in the store, including deleted logs, for sync purposes.
 */
export const getAllExpensesForSync = async (): Promise<Expense[]> => {
  const store = await getStore('readonly');
  
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(new Error(`Failed to export database: ${request.error?.message}`));
  });
};

/**
 * Performs a master-master conflict resolution merge of incoming sync records.
 * For each incoming item, it compares the updatedAt timestamp with the local record.
 * Newer records overwrite older ones.
 */
export const syncUpsertExpenses = async (incomingList: Expense[]): Promise<void> => {
  const store = await getStore('readwrite');
  
  for (const incoming of incomingList) {
    await new Promise<void>((resolve, reject) => {
      const getReq = store.get(incoming.id);
      
      getReq.onsuccess = () => {
        const local: Expense | undefined = getReq.result;
        
        if (!local) {
          // If it doesn't exist locally, save it
          const addReq = store.put(incoming);
          addReq.onsuccess = () => resolve();
          addReq.onerror = () => reject(addReq.error);
        } else {
          // If it exists, compare timestamps
          const incomingTime = new Date(incoming.updatedAt).getTime();
          const localTime = new Date(local.updatedAt).getTime();
          
          if (incomingTime > localTime) {
            // Incoming is newer, overwrite local
            const putReq = store.put(incoming);
            putReq.onsuccess = () => resolve();
            putReq.onerror = () => reject(putReq.error);
          } else {
            // Local is newer or equal, skip
            resolve();
          }
        }
      };
      
      getReq.onerror = () => reject(getReq.error);
    });
  }
};
