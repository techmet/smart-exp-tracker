import * as SQLite from 'expo-sqlite';

export interface Expense {
  id: string;
  amount: number;
  currency: string;
  date: string; // ISO 8601 Date
  category: string;
  subCategory?: string;
  description: string;
  paymentMode: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: number; // 0 for false, 1 for true (SQLite integer boolean)
  externalSourceId?: string; // e.g. Gmail Message ID or SMS ID
  hash?: string; // Used for deduplication
}

const DB_NAME = 'family_expenses.db';
let dbInstance: any = null;

export const getDB = () => {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync(DB_NAME);
  }
  return dbInstance;
};

/**
 * Initializes the SQLite Database schema.
 */
export const initDatabase = () => {
  const db = getDB();
  db.execSync(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      subCategory TEXT,
      description TEXT,
      paymentMode TEXT,
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      isDeleted INTEGER DEFAULT 0,
      externalSourceId TEXT UNIQUE,
      hash TEXT UNIQUE
    );
  `);
};

/**
 * Retrieves all active (non-deleted) expenses from database.
 */
export const getActiveExpenses = (): Expense[] => {
  const db = getDB();
  return db.getAllSync(
    'SELECT * FROM expenses WHERE isDeleted = 0 ORDER BY date DESC, createdAt DESC'
  ) as Expense[];
};

/**
 * Retrieves all expenses (including deleted) to perform Google Drive sync.
 */
export const getAllExpensesForSync = (): Expense[] => {
  const db = getDB();
  return db.getAllSync('SELECT * FROM expenses') as Expense[];
};

/**
 * Adds a new expense to local DB.
 */
export const addExpense = (expense: Omit<Expense, 'isDeleted'>): void => {
  const db = getDB();
  db.runSync(
    `INSERT INTO expenses (id, amount, currency, date, category, subCategory, description, paymentMode, createdBy, createdAt, updatedAt, isDeleted, externalSourceId, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      expense.id,
      expense.amount,
      expense.currency || 'INR',
      expense.date,
      expense.category,
      expense.subCategory || null,
      expense.description,
      expense.paymentMode,
      expense.createdBy,
      expense.createdAt,
      expense.updatedAt,
      expense.externalSourceId || null,
      expense.hash || null,
    ]
  );
};

/**
 * Updates an existing expense locally.
 */
export const updateExpense = (id: string, updates: Partial<Omit<Expense, 'id' | 'createdAt'>>): void => {
  const db = getDB();
  const current = db.getFirstSync('SELECT * FROM expenses WHERE id = ?', [id]) as Expense | null;
  if (!current) throw new Error(`Expense with ID ${id} not found.`);

  const merged = { ...current, ...updates, updatedAt: new Date().toISOString() };

  db.runSync(
    `UPDATE expenses SET 
      amount = ?, 
      currency = ?, 
      date = ?, 
      category = ?, 
      subCategory = ?, 
      description = ?, 
      paymentMode = ?, 
      updatedAt = ?, 
      isDeleted = ?,
      externalSourceId = ?,
      hash = ?
     WHERE id = ?`,
    [
      merged.amount,
      merged.currency,
      merged.date,
      merged.category,
      merged.subCategory || null,
      merged.description,
      merged.paymentMode,
      merged.updatedAt,
      merged.isDeleted,
      merged.externalSourceId || null,
      merged.hash || null,
      id,
    ]
  );
};

/**
 * Soft deletes an expense.
 */
export const deleteExpense = (id: string): void => {
  updateExpense(id, { isDeleted: 1 });
};

/**
 * Checks if a transaction with the given external ID (Gmail/SMS) or hash already exists.
 */
export const existsByExternalIdOrHash = (externalId?: string, hash?: string): boolean => {
  const db = getDB();
  if (externalId) {
    const result = db.getFirstSync('SELECT id FROM expenses WHERE externalSourceId = ?', [externalId]);
    if (result) return true;
  }
  if (hash) {
    const result = db.getFirstSync('SELECT id FROM expenses WHERE hash = ? AND isDeleted = 0', [hash]);
    if (result) return true;
  }
  return false;
};

/**
 * Upserts a list of expenses during Google Drive Sync.
 * Resolves conflicts by comparing updatedAt timestamps: if the incoming record is newer, it overrides local.
 */
export const syncUpsertExpenses = (incomingExpenses: Expense[]): void => {
  const db = getDB();
  
  db.withTransactionSync(() => {
    for (const incoming of incomingExpenses) {
      const local = db.getFirstSync('SELECT * FROM expenses WHERE id = ?', [incoming.id]) as Expense | null;
      
      if (!local) {
        // Record doesn't exist locally, insert it
        db.runSync(
          `INSERT INTO expenses (id, amount, currency, date, category, subCategory, description, paymentMode, createdBy, createdAt, updatedAt, isDeleted, externalSourceId, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            incoming.id,
            incoming.amount,
            incoming.currency,
            incoming.date,
            incoming.category,
            incoming.subCategory || null,
            incoming.description,
            incoming.paymentMode,
            incoming.createdBy,
            incoming.createdAt,
            incoming.updatedAt,
            incoming.isDeleted,
            incoming.externalSourceId || null,
            incoming.hash || null,
          ]
        );
      } else {
        // Record exists, compare updatedAt
        const localTime = new Date(local.updatedAt).getTime();
        const incomingTime = new Date(incoming.updatedAt).getTime();
        
        if (incomingTime > localTime) {
          // Incoming is newer, overwrite local
          db.runSync(
            `UPDATE expenses SET 
              amount = ?, 
              currency = ?, 
              date = ?, 
              category = ?, 
              subCategory = ?, 
              description = ?, 
              paymentMode = ?, 
              updatedAt = ?, 
              isDeleted = ?,
              externalSourceId = ?,
              hash = ?
             WHERE id = ?`,
            [
              incoming.amount,
              incoming.currency,
              incoming.date,
              incoming.category,
              incoming.subCategory || null,
              incoming.description,
              incoming.paymentMode,
              incoming.updatedAt,
              incoming.isDeleted,
              incoming.externalSourceId || null,
              incoming.hash || null,
              incoming.id,
            ]
          );
        }
      }
    }
  });
};

/**
 * Completely clears the database (useful for testing or full resets).
 */
export const clearDatabase = (): void => {
  const db = getDB();
  db.execSync('DELETE FROM expenses');
};
