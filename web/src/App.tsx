import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  initDb,
  getActiveExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
} from './db/indexedDb';
import type { Expense } from './db/indexedDb';
import { exportSyncFile, importSyncFile } from './sync/webSync';
import {
  getSupabaseConfig,
  saveSupabaseConfig,
  clearSupabaseConfig,
  testSupabaseConnection,
  syncWithSupabase,
} from './sync/supabaseSync';
import { calculateExpenseHash, findPotentialDuplicates } from './services/duplicateDetector';
import type { DuplicateGroup } from './services/duplicateDetector';

// Helper to determine if a date belongs to the current calendar month
const isCurrentCalendarMonth = (dateStr: string) => {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

// Helper to determine if a date is today (local time)
const isToday = (dateStr: string) => {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
};

// Helper to get current YYYY-MM format
const getCurrentMonthStr = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// Helper to get current YYYY-MM-DD format for date input defaults
const getTodayInputStr = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function App() {
  // Navigation / Screen Views
  const [currentView, setCurrentView] = useState<'home' | 'duplicates'>('home');
  const [activeNavTab, setActiveNavTab] = useState<'dashboard' | 'investments' | 'transactions'>('dashboard');

  // DB & State
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // Audit Member State
  const [memberName, setMemberName] = useState(() => {
    return localStorage.getItem('family_member_name') || 'Dad';
  });

  // UI Modals
  const [isSyncModalVisible, setIsSyncModalVisible] = useState(false);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Transaction Form fields
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('Groceries');
  const [formSubCategory, setFormSubCategory] = useState('');
  const [formPaymentMode, setFormPaymentMode] = useState('Cash');
  const [formDate, setFormDate] = useState(() => getTodayInputStr());

  // Dynamic categories list
  const [categories, setCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem('family_categories');
    return saved ? JSON.parse(saved) : ['Groceries', 'Food & Dining', 'Utilities', 'Investments', 'Shopping', 'Entertainment'];
  });
  const [newCategoryName, setNewCategoryName] = useState('');

  // Transactions Tab Filtering (defaults to Current Month)
  const [filterMonth, setFilterMonth] = useState<string>(() => getCurrentMonthStr());
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterPaymentMode, setFilterPaymentMode] = useState('All');

  // Duplicate Resolution State
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);

  // Hidden File input ref for upload syncing
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Supabase Connection Settings States
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseAnonKeyInput, setSupabaseAnonKeyInput] = useState('');
  const [showSupabaseSetup, setShowSupabaseSetup] = useState(() => getSupabaseConfig() === null);
  const [supabaseSyncStatus, setSupabaseSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [supabaseSyncMessage, setSupabaseSyncMessage] = useState('');

  // Load pre-configured details on mount
  useEffect(() => {
    const config = getSupabaseConfig();
    if (config) {
      setSupabaseUrlInput(config.url);
      setSupabaseAnonKeyInput(config.anonKey);
    }
  }, []);

  // Initialize DB and load logs
  useEffect(() => {
    const start = async () => {
      try {
        await initDb();
        await refreshExpenses();

        // Trigger automated sync on launch if credentials exist
        const config = getSupabaseConfig();
        if (config) {
          triggerSupabaseSync(true);
        }
      } catch (err) {
        alert('Failed to initialize local IndexedDB database.');
      }
    };
    start();
  }, []);

  const refreshExpenses = async () => {
    try {
      const list = await getActiveExpenses();
      setExpenses(list);

      // Auto-extract and append any categories in active expenses
      const uniqueCats = Array.from(new Set(list.map(x => x.category)));
      setCategories(prev => {
        const merged = Array.from(new Set([...prev, ...uniqueCats]));
        localStorage.setItem('family_categories', JSON.stringify(merged));
        return merged;
      });

      // Analyze duplicates
      const groups = findPotentialDuplicates(list);
      setDuplicateGroups(groups);
    } catch (e) {
      console.error('Failed to load logs:', e);
    }
  };

  // Perform background sync with Supabase
  const triggerSupabaseSync = async (silent = false) => {
    const config = getSupabaseConfig();
    if (!config) return;

    setSupabaseSyncStatus('syncing');
    try {
      const res = await syncWithSupabase();
      if (res.success) {
        setSupabaseSyncStatus('success');
        setSupabaseSyncMessage(res.message);
        await refreshExpenses();
      } else {
        setSupabaseSyncStatus('error');
        setSupabaseSyncMessage(res.message);
        if (!silent) {
          alert(`Sync error: ${res.message}`);
        }
      }
    } catch (e) {
      setSupabaseSyncStatus('error');
      setSupabaseSyncMessage('Network connection error.');
    }
  };

  // Setup connection action
  const handleConnectSupabase = async () => {
    if (!supabaseUrlInput.trim() || !supabaseAnonKeyInput.trim()) {
      alert('Please enter both your Supabase URL and Anon Key.');
      return;
    }

    setIsSyncing(true);
    const test = await testSupabaseConnection(supabaseUrlInput, supabaseAnonKeyInput);
    setIsSyncing(false);

    if (test.success) {
      saveSupabaseConfig(supabaseUrlInput, supabaseAnonKeyInput);
      setShowSupabaseSetup(false);
      alert('Connected successfully! Supabase Cloud Sync is now active.');
      await triggerSupabaseSync(false);
    } else {
      alert(`Connection failed: ${test.message}`);
    }
  };

  // Persist member name change
  const handleSaveMemberName = (val: string) => {
    setMemberName(val);
    localStorage.setItem('family_member_name', val);
  };

  const handleAddCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;

    const capitalized = name.charAt(0).toUpperCase() + name.slice(1);

    if (categories.includes(capitalized)) {
      alert('This category already exists.');
      return;
    }

    const updated = [...categories, capitalized];
    setCategories(updated);
    localStorage.setItem('family_categories', JSON.stringify(updated));
    setFormCategory(capitalized);
    setNewCategoryName('');
  };

  // Reset form inputs
  const resetForm = () => {
    setFormAmount('');
    setFormDescription('');
    setFormCategory('Groceries');
    setFormSubCategory('');
    setFormPaymentMode('Cash');
    setFormDate(getTodayInputStr());
    setEditingExpenseId(null);
  };

  // Add / Update handler
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formAmount || isNaN(parseFloat(formAmount)) || parseFloat(formAmount) <= 0) {
      alert('Please enter a valid positive number for amount.');
      return;
    }
    if (!formDescription.trim()) {
      alert('Please enter a merchant / description.');
      return;
    }
    if (!formDate) {
      alert('Please select a transaction date.');
      return;
    }

    const amount = parseFloat(formAmount);
    const selectedDateISO = new Date(`${formDate}T12:00:00`).toISOString();

    if (editingExpenseId) {
      try {
        await updateExpense(editingExpenseId, {
          amount,
          date: selectedDateISO,
          category: formCategory,
          subCategory: formCategory === 'Investments' ? formSubCategory || 'Stocks' : undefined,
          description: formDescription.trim(),
          paymentMode: formPaymentMode,
        });
        setIsAddModalVisible(false);
        resetForm();
        await refreshExpenses();
        // Background sync
        triggerSupabaseSync(true);
      } catch (err) {
        alert('Failed to update transaction.');
      }
    } else {
      const dateNowStr = new Date().toISOString();
      const hash = calculateExpenseHash(amount, selectedDateISO, formDescription);

      const newExpense: Expense = {
        id: `manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        amount,
        currency: 'INR',
        date: selectedDateISO,
        category: formCategory,
        subCategory: formCategory === 'Investments' ? formSubCategory || 'Stocks' : undefined,
        description: formDescription.trim(),
        paymentMode: formPaymentMode,
        createdBy: memberName,
        createdAt: dateNowStr,
        updatedAt: dateNowStr,
        isDeleted: 0,
        hash,
      };

      try {
        await addExpense(newExpense);
        setIsAddModalVisible(false);
        resetForm();
        await refreshExpenses();
        // Background sync
        triggerSupabaseSync(true);
      } catch (err) {
        alert('Failed to log expense. A duplicate entry might exist.');
      }
    }
  };

  // Edit click
  const handleEditPress = (item: Expense) => {
    setEditingExpenseId(item.id);
    setFormAmount(item.amount.toString());
    setFormDescription(item.description);
    setFormCategory(item.category);
    setFormSubCategory(item.subCategory || '');
    setFormPaymentMode(item.paymentMode);
    setFormDate(item.date.substring(0, 10)); // Extract YYYY-MM-DD
    setIsAddModalVisible(true);
  };

  // Delete click
  const handleDeletePress = async (id: string) => {
    if (confirm('Are you sure you want to delete this transaction?')) {
      try {
        await deleteExpense(id);
        await refreshExpenses();
        // Background sync
        triggerSupabaseSync(true);
      } catch (err) {
        alert('Failed to delete transaction.');
      }
    }
  };

  // Backup Export
  const handleExportBackup = async () => {
    setIsSyncing(true);
    const res = await exportSyncFile();
    setIsSyncing(false);
    if (!res.success) {
      alert(res.message);
    }
  };

  // Sync Import Trigger
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setIsSyncing(true);
    const res = await importSyncFile(fileList[0]);
    setIsSyncing(false);

    // Clear selection
    e.target.value = '';

    if (res.success) {
      await refreshExpenses();
      alert(res.message);
      // Upload local merges
      triggerSupabaseSync(true);
    } else {
      alert(res.message);
    }
  };

  // Merge Duplicates resolution handler
  const resolveMergeGroup = async (
    groupIndex: number,
    _keepExpense: Expense,
    discardExpenses: Expense[]
  ) => {
    try {
      for (const disc of discardExpenses) {
        await deleteExpense(disc.id);
      }
      alert('Transactions merged successfully.');

      // Update local groups
      const updated = [...duplicateGroups];
      updated.splice(groupIndex, 1);
      setDuplicateGroups(updated);

      await refreshExpenses();
      // Background sync
      triggerSupabaseSync(true);
    } catch (e) {
      alert('Failed to complete transaction merge.');
    }
  };

  const handleKeepBoth = (groupIndex: number) => {
    const updated = [...duplicateGroups];
    updated.splice(groupIndex, 1);
    setDuplicateGroups(updated);
  };

  // Memoized stats calculation for Total vs Current Calendar Month vs Today
  const {
    totalSpent,
    currentMonthSpent,
    todaySpent,
    totalInvestments,
    currentMonthInvestments,
    todayInvestments,
  } = useMemo(() => {
    let tSpent = 0;
    let cmSpent = 0;
    let tdSpent = 0;
    let tInvest = 0;
    let cmInvest = 0;
    let tdInvest = 0;

    expenses.forEach((item) => {
      const isCurrentMonth = isCurrentCalendarMonth(item.date);
      const isTd = isToday(item.date);
      if (item.category === 'Investments') {
        tInvest += item.amount;
        if (isCurrentMonth) {
          cmInvest += item.amount;
        }
        if (isTd) {
          tdInvest += item.amount;
        }
      } else {
        tSpent += item.amount;
        if (isCurrentMonth) {
          cmSpent += item.amount;
        }
        if (isTd) {
          tdSpent += item.amount;
        }
      }
    });

    return {
      totalSpent: tSpent,
      currentMonthSpent: cmSpent,
      todaySpent: tdSpent,
      totalInvestments: tInvest,
      currentMonthInvestments: cmInvest,
      todayInvestments: tdInvest,
    };
  }, [expenses]);

  // Memoized category chart data (based on the current month's expenses)
  const categoryChartData = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach((item) => {
      if (isCurrentCalendarMonth(item.date)) {
        map[item.category] = (map[item.category] || 0) + item.amount;
      }
    });

    return Object.keys(map)
      .map((key) => ({
        name: key,
        value: map[key],
      }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  // Memoized list of months represented in the database (chronological desc)
  const uniqueMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    expenses.forEach((item) => {
      const d = new Date(item.date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      monthsSet.add(`${year}-${month}`);
    });
    return Array.from(monthsSet).sort().reverse();
  }, [expenses]);

  // Helper to format YYYY-MM into readable month names (e.g. July 2026)
  const formatMonthLabel = (yearMonthStr: string) => {
    const [year, month] = yearMonthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Filtered expenses logs feed based on active selects & date ranges
  const filteredExpenses = useMemo(() => {
    return expenses.filter((item) => {
      const itemDate = item.date.substring(0, 10); // YYYY-MM-DD

      // Date range filtering
      if (filterStartDate) {
        if (itemDate < filterStartDate) return false;
      }
      if (filterEndDate) {
        if (itemDate > filterEndDate) return false;
      }

      // Fallback to month selector only if date range is unset
      if (!filterStartDate && !filterEndDate) {
        if (filterMonth !== 'All') {
          const d = new Date(item.date);
          const itemYearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (itemYearMonth !== filterMonth) return false;
        }
      }

      // Category filtering
      if (filterCategory !== 'All') {
        if (item.category !== filterCategory) return false;
      }

      // Payment Mode filtering
      if (filterPaymentMode !== 'All') {
        if (item.paymentMode !== filterPaymentMode) return false;
      }
      return true;
    });
  }, [expenses, filterMonth, filterCategory, filterStartDate, filterEndDate, filterPaymentMode]);
 
  // Memoized total of filtered expenses
  const filteredTotal = useMemo(() => {
    return filteredExpenses.reduce((sum, item) => sum + item.amount, 0);
  }, [filteredExpenses]);

  // If Supabase Credentials setup screen is active
  if (showSupabaseSetup) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
        <div className="modal-content" style={{ maxWidth: '500px', width: '100%', position: 'static', transform: 'none' }}>
          <h2 className="modal-title" style={{ textAlign: 'center', marginBottom: '8px' }}>☁️ Supabase Cloud Sync</h2>
          <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', marginBottom: '20px' }}>
            Configure your free Supabase database to enable automatic real-time sync with your family.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label className="input-label">Supabase Project URL</label>
              <input
                type="text"
                className="form-input"
                style={{ marginBottom: 0 }}
                placeholder="https://your-project.supabase.co"
                value={supabaseUrlInput}
                onChange={(e) => setSupabaseUrlInput(e.target.value)}
              />
            </div>

            <div>
              <label className="input-label">API Key (Anon Public)</label>
              <input
                type="password"
                className="form-input"
                style={{ marginBottom: 0 }}
                placeholder="eyJhbGciOi..."
                value={supabaseAnonKeyInput}
                onChange={(e) => setSupabaseAnonKeyInput(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button
                type="button"
                className="modal-action-btn submit"
                style={{ flex: 1 }}
                onClick={handleConnectSupabase}
                disabled={isSyncing}
              >
                {isSyncing ? 'Connecting...' : 'Connect Database'}
              </button>
              <button
                type="button"
                className="modal-action-btn cancel"
                style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}
                onClick={() => setShowSupabaseSetup(false)}
              >
                Use Offline Mode
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Hidden input for picking family backup file */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="application/json"
        onChange={handleFileChange}
      />

      {currentView === 'home' ? (
        <>
          {/* Header Bar */}
          <div className="top-bar">
            <div>
              <h1 className="app-title">Smart Expense Tracker</h1>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <p className="member-label" style={{ margin: 0 }}>
                  User: <span className="member-name-highlight">{memberName}</span>
                </p>
                <span
                  style={{
                    fontSize: '9px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: supabaseSyncStatus === 'success' ? 'rgba(16, 185, 129, 0.1)' : supabaseSyncStatus === 'syncing' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: supabaseSyncStatus === 'success' ? '#10b981' : supabaseSyncStatus === 'syncing' ? '#38bdf8' : '#f87171',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                  title={supabaseSyncMessage}
                >
                  {supabaseSyncStatus === 'success' ? '☁️ Synced' : supabaseSyncStatus === 'syncing' ? '🔄 Syncing' : '⚠️ Offline'}
                </span>
              </div>
            </div>
            <button className="settings-btn" onClick={() => setIsSyncModalVisible(true)}>
              ⚙️ Sync Config
            </button>
          </div>

          {activeNavTab === 'dashboard' ? (
            /* TAB 1: Dashboard View (Scrollable) */
            <div className="scroll-content">
              {/* Duplicate Warnings Banner */}
              {duplicateGroups.length > 0 && (
                <div className="warning-banner" onClick={() => setCurrentView('duplicates')}>
                  <p className="warning-text">
                    ⚠️ {duplicateGroups.length} potential duplicate transactions detected! Tap to resolve.
                  </p>
                </div>
              )}

              <h4 className="section-title">Spent Ledger</h4>
              <div className="stats-row">
                <div className="stat-card">
                  <p className="stat-title">Today</p>
                  <h3 className="stat-value" style={{ fontSize: '18px' }}>₹{todaySpent.toFixed(2)}</h3>
                </div>
                <div className="stat-card">
                  <p className="stat-title">This Month</p>
                  <h3 className="stat-value" style={{ fontSize: '18px' }}>₹{currentMonthSpent.toFixed(2)}</h3>
                </div>
                <div className="stat-card">
                  <p className="stat-title">Lifetime</p>
                  <h3 className="stat-value" style={{ fontSize: '18px' }}>₹{totalSpent.toFixed(2)}</h3>
                </div>
              </div>

              {/* spending by category graph */}
              <div className="chart-card">
                <h4 className="chart-title">Current Month Chart</h4>
                {categoryChartData.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 13 }}>
                    No expenses logged in this calendar month.
                  </div>
                ) : (
                  <div className="chart-row">
                    {categoryChartData.map((data) => {
                      const maxVal = Math.max(...categoryChartData.map((x) => x.value));
                      const heightPercent = maxVal > 0 ? (data.value / maxVal) * 100 : 0;
                      return (
                        <div key={data.name} className="chart-column">
                          <div className="chart-bar-wrapper">
                            <div
                              className="chart-bar"
                              style={{
                                height: `${heightPercent}%`,
                                backgroundColor: data.name === 'Investments' ? '#10b981' : '#38bdf8',
                              }}
                            />
                          </div>
                          <span className="chart-bar-value">₹{data.value.toFixed(0)}</span>
                          <span className="chart-bar-label" title={data.name}>
                            {data.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : activeNavTab === 'investments' ? (
            /* TAB 2: Investments View (Scrollable) */
            <div className="scroll-content">
              {/* Investments Statistics Cards */}
              <h4 className="section-title">Investments Ledger</h4>
              <div className="stats-row">
                <div className="stat-card investments">
                  <p className="stat-title">Today</p>
                  <h3 className="stat-value" style={{ fontSize: '18px', color: '#10b981' }}>₹{todayInvestments.toFixed(2)}</h3>
                </div>
                <div className="stat-card investments">
                  <p className="stat-title">This Month</p>
                  <h3 className="stat-value" style={{ fontSize: '18px', color: '#10b981' }}>₹{currentMonthInvestments.toFixed(2)}</h3>
                </div>
                <div className="stat-card investments">
                  <p className="stat-title">Lifetime</p>
                  <h3 className="stat-value" style={{ fontSize: '18px', color: '#10b981' }}>₹{totalInvestments.toFixed(2)}</h3>
                </div>
              </div>

              {/* Feed of Investment Logs */}
              <h4 className="section-title" style={{ marginTop: '20px' }}>Investments Feed</h4>
              {expenses.filter(x => x.category === 'Investments').length === 0 ? (
                <div className="empty-view">
                  <span className="empty-text">No investment logs.</span>
                </div>
              ) : (
                expenses.filter(x => x.category === 'Investments').map((item) => (
                  <div key={item.id} className="transaction-card">
                    <div className="transaction-row">
                      <div>
                        <h5 className="transaction-desc">{item.description}</h5>
                        <p className="transaction-meta">
                          {item.subCategory ? `${item.category} › ${item.subCategory}` : item.category} •{' '}
                          {new Date(item.date).toLocaleDateString()}
                        </p>
                        <p className="auditor-tag">
                          Logged by: {item.createdBy} ({item.paymentMode})
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className="transaction-amount investment">
                          +₹{item.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="card-actions">
                      <button className="card-btn edit" onClick={() => handleEditPress(item)}>
                        ✏️ Edit
                      </button>
                      <button className="card-btn delete" onClick={() => handleDeletePress(item.id)}>
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* TAB 3: Transactions View (Sticky filters, scrollable list) */
            <div className="fixed-content">
              <h4 className="section-title" style={{ marginBottom: 12 }}>Filter Transactions</h4>

              {/* Filter Controls Card */}
              <div className="filter-card" style={{ padding: '12px' }}>
                <div className="filter-select-group" style={{ marginBottom: '8px' }}>
                  {/* Month Picker dropdown */}
                  <div className="filter-select-wrapper">
                    <span className="input-label" style={{ fontSize: 10, marginBottom: 4 }}>Month</span>
                    <select
                      className="filter-select"
                      value={filterMonth}
                      onChange={(e) => {
                        setFilterMonth(e.target.value);
                        setFilterStartDate('');
                        setFilterEndDate('');
                      }}
                    >
                      <option value="All">All Months</option>
                      {uniqueMonths.map((m) => (
                        <option key={m} value={m}>
                          {formatMonthLabel(m)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Category Picker dropdown */}
                  <div className="filter-select-wrapper">
                    <span className="input-label" style={{ fontSize: 10, marginBottom: 4 }}>Category</span>
                    <select
                      className="filter-select"
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                    >
                      <option value="All">All Categories</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Payment Mode Picker dropdown */}
                  <div className="filter-select-wrapper">
                    <span className="input-label" style={{ fontSize: 10, marginBottom: 4 }}>Mode</span>
                    <select
                      className="filter-select"
                      value={filterPaymentMode}
                      onChange={(e) => setFilterPaymentMode(e.target.value)}
                    >
                      <option value="All">All Modes</option>
                      {['Cash', 'Credit Card', 'Debit Card', 'UPI / Bank Transfer'].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Date range filter row */}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div className="filter-select-wrapper" style={{ flex: 1 }}>
                    <span className="input-label" style={{ fontSize: 10, marginBottom: 4 }}>Start Date</span>
                    <input
                      type="date"
                      className="filter-select"
                      style={{ fontSize: '11px' }}
                      value={filterStartDate}
                      onChange={(e) => {
                        setFilterStartDate(e.target.value);
                        if (e.target.value) setFilterMonth('All');
                      }}
                    />
                  </div>
                  <div className="filter-select-wrapper" style={{ flex: 1 }}>
                    <span className="input-label" style={{ fontSize: 10, marginBottom: 4 }}>End Date</span>
                    <input
                      type="date"
                      className="filter-select"
                      style={{ fontSize: '11px' }}
                      value={filterEndDate}
                      onChange={(e) => {
                        setFilterEndDate(e.target.value);
                        if (e.target.value) setFilterMonth('All');
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Feed Logs Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                 <h4 className="section-title" style={{ margin: 0 }}>
                   Results ({filteredExpenses.length}) • Total: <span style={{ color: '#38bdf8' }}>₹{filteredTotal.toFixed(2)}</span>
                 </h4>
                {(filterMonth !== 'All' || filterCategory !== 'All' || filterStartDate || filterEndDate || filterPaymentMode !== 'All') && (
                  <button
                    className="settings-btn"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => {
                      setFilterMonth('All');
                      setFilterCategory('All');
                      setFilterStartDate('');
                      setFilterEndDate('');
                      setFilterPaymentMode('All');
                    }}
                  >
                    Clear Filters
                  </button>
                )}
              </div>

              {/* Scrollable list of transactions */}
              <div className="transactions-list-scroll">
                {filteredExpenses.length === 0 ? (
                  <div className="empty-view">
                    <span className="empty-text">No transactions match filters.</span>
                  </div>
                ) : (
                  filteredExpenses.map((item) => (
                    <div key={item.id} className="transaction-card">
                      <div className="transaction-row">
                        <div>
                          <h5 className="transaction-desc">{item.description}</h5>
                          <p className="transaction-meta">
                            {item.category}{' '}
                            {item.subCategory ? `› ${item.subCategory}` : ''} •{' '}
                            {new Date(item.date).toLocaleDateString()}
                          </p>
                          <p className="auditor-tag">
                            Logged by: {item.createdBy} ({item.paymentMode})
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span
                            className={`transaction-amount ${item.category === 'Investments' ? 'investment' : ''
                              }`}
                          >
                            {item.category === 'Investments' ? '+' : '-'}₹{item.amount.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <div className="card-actions">
                        <button className="card-btn edit" onClick={() => handleEditPress(item)}>
                          ✏️ Edit
                        </button>
                        <button className="card-btn delete" onClick={() => handleDeletePress(item.id)}>
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Floating Action Button visible on all tabs on top of content */}
          <button
            className="fab"
            onClick={() => setIsAddModalVisible(true)}
             style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))', right: '24px', zIndex: 15 }}
          >
            +
          </button>

          {/* Navigation Bottom Bar */}
          <div className="bottom-nav">
            <button
              className={`nav-tab-btn ${activeNavTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveNavTab('dashboard')}
            >
              <span className="nav-tab-icon">📊</span>
              <span>Dashboard</span>
            </button>
            <button
              className={`nav-tab-btn ${activeNavTab === 'investments' ? 'active' : ''}`}
              onClick={() => setActiveNavTab('investments')}
            >
              <span className="nav-tab-icon">📈</span>
              <span>Investments</span>
            </button>
            <button
              className={`nav-tab-btn ${activeNavTab === 'transactions' ? 'active' : ''}`}
              onClick={() => setActiveNavTab('transactions')}
            >
              <span className="nav-tab-icon">🧾</span>
              <span>Transactions</span>
            </button>
          </div>
        </>
      ) : (
        /* Duplicate Warning Review View */
        <div className="scroll-content">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
            <button
              className="settings-btn"
              onClick={() => {
                setCurrentView('home');
                refreshExpenses();
              }}
              style={{ marginRight: 12 }}
            >
              ⬅️ Back
            </button>
            <h3 style={{ margin: 0 }}>Resolve Duplicates</h3>
          </div>

          {duplicateGroups.length === 0 ? (
            <div className="empty-view">
              <span className="empty-text">All duplicates resolved!</span>
            </div>
          ) : (
            duplicateGroups.map((group, idx) => (
              <div key={group.primary.id} className="split-card">
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>
                  Potential duplicate group:
                </p>
                <div className="split-row">
                  {/* Primary Option */}
                  <div
                    className="split-item"
                    onClick={() => resolveMergeGroup(idx, group.primary, group.duplicates)}
                  >
                    <span className="split-item-title">Keep This One</span>
                    <h5 className="transaction-desc">{group.primary.description}</h5>
                    <p className="transaction-meta" style={{ fontSize: 11 }}>
                      {new Date(group.primary.date).toLocaleDateString()} • {group.primary.paymentMode}
                    </p>
                    <p className="auditor-tag">Added by: {group.primary.createdBy}</p>
                    <h4 className="transaction-amount" style={{ marginTop: 6, fontSize: 15 }}>
                      ₹{group.primary.amount.toFixed(2)}
                    </h4>
                  </div>

                  {/* Duplicate Option */}
                  <div
                    className="split-item"
                    onClick={() => resolveMergeGroup(idx, group.duplicates[0], [group.primary, ...group.duplicates.slice(1)])}
                  >
                    <span className="split-item-title">Keep This One</span>
                    <h5 className="transaction-desc">{group.duplicates[0].description}</h5>
                    <p className="transaction-meta" style={{ fontSize: 11 }}>
                      {new Date(group.duplicates[0].date).toLocaleDateString()} • {group.duplicates[0].paymentMode}
                    </p>
                    <p className="auditor-tag">Added by: {group.duplicates[0].createdBy}</p>
                    <h4 className="transaction-amount" style={{ marginTop: 6, fontSize: 15 }}>
                      ₹{group.duplicates[0].amount.toFixed(2)}
                    </h4>
                  </div>
                </div>

                <button className="split-btn" onClick={() => handleKeepBoth(idx)}>
                  Keep Both (Dismiss Warning)
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* MODAL 1: Add/Edit Expense Form */}
      {isAddModalVisible && (
        <div className="modal-overlay">
          <form className="modal-content" onSubmit={handleSaveExpense}>
            <h3 className="modal-title">{editingExpenseId ? 'Edit Transaction' : 'Add Transaction'}</h3>

            <label className="input-label">Amount (₹)</label>
            <input
              type="number"
              step="any"
              className="form-input"
              placeholder="e.g. 450.00"
              required
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
            />

            <label className="input-label">Description / Merchant</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Swiggy, Groww, Zomato"
              required
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />

            <label className="input-label">Transaction Date</label>
            <input
              type="date"
              className="form-input"
              required
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
            />

            <label className="input-label">Category</label>
            <div className="chip-row">
              {categories.map((cat) => (
                <button
                  type="button"
                  key={cat}
                  className={`chip-btn ${formCategory === cat ? 'active' : ''}`}
                  onClick={() => {
                    setFormCategory(cat);
                    if (cat !== 'Investments') setFormSubCategory('');
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <input
                type="text"
                className="form-input"
                style={{ marginBottom: 0, flex: 1 }}
                placeholder="Add custom category (e.g. Fuel)..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
              <button
                type="button"
                className="settings-btn"
                onClick={handleAddCategory}
                style={{ padding: '0 16px', height: '40px' }}
              >
                ➕ Add
              </button>
            </div>

            {formCategory === 'Investments' && (
              <>
                <label className="input-label">Investment Type</label>
                <div className="chip-row">
                  {['Stocks', 'Mutual Funds', 'Crypto', 'Real Estate'].map((sub) => (
                    <button
                      type="button"
                      key={sub}
                      className={`chip-btn ${formSubCategory === sub ? 'active' : ''}`}
                      onClick={() => setFormSubCategory(sub)}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label className="input-label">Payment Mode</label>
            <div className="chip-row">
              {['Cash', 'Credit Card', 'Debit Card', 'UPI / Bank Transfer'].map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={`chip-btn ${formPaymentMode === mode ? 'active' : ''}`}
                  onClick={() => setFormPaymentMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="modal-actions">
              <button type="button" className="modal-action-btn cancel" onClick={() => {
                setIsAddModalVisible(false);
                resetForm();
              }}>
                Cancel
              </button>
              <button type="submit" className="modal-action-btn submit">
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: Sync and Family Settings */}
      {isSyncModalVisible && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Sync & Family Settings</h3>

            <label className="input-label">Your Name (for auditing/feed)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Dad, Mom, Vamsi"
              value={memberName}
              onChange={(e) => handleSaveMemberName(e.target.value)}
            />

            <div className="divider" />

            {/* Supabase Cloud Sync Section */}
            <h4 style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
              ☁️ Supabase Cloud Sync Settings
            </h4>
            <p style={{ margin: '0 0 10px 0', fontSize: 11, color: '#94a3b8' }}>
              Sync status: <strong>{supabaseSyncStatus === 'success' ? '✅ Connected & Synced' : supabaseSyncStatus === 'syncing' ? '🔄 Syncing...' : supabaseSyncStatus === 'error' ? '⚠️ Sync Failed' : '⚠️ Offline Mode'}</strong>
            </p>
            {supabaseSyncMessage && (
              <p style={{ margin: '0 0 10px 0', fontSize: 10, color: supabaseSyncStatus === 'success' ? '#10b981' : '#f87171' }}>
                {supabaseSyncMessage}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 12 }}>
              <input
                type="text"
                className="form-input"
                style={{ marginBottom: 0 }}
                placeholder="Supabase Project URL"
                value={supabaseUrlInput}
                onChange={(e) => setSupabaseUrlInput(e.target.value)}
              />
              <input
                type="password"
                className="form-input"
                style={{ marginBottom: 0 }}
                placeholder="Anon API Key"
                value={supabaseAnonKeyInput}
                onChange={(e) => setSupabaseAnonKeyInput(e.target.value)}
              />

              <div style={{ display: 'flex', gap: '8px', marginTop: 4 }}>
                <button
                  type="button"
                  className="settings-btn"
                  style={{ flex: 1, backgroundColor: '#38bdf8', color: '#020617', borderColor: '#38bdf8' }}
                  onClick={handleConnectSupabase}
                  disabled={isSyncing}
                >
                  Save & Connect
                </button>
                <button
                  type="button"
                  className="settings-btn"
                  style={{ flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderColor: '#ef4444' }}
                  onClick={() => {
                    clearSupabaseConfig();
                    setSupabaseUrlInput('');
                    setSupabaseAnonKeyInput('');
                    setSupabaseSyncStatus('idle');
                    setSupabaseSyncMessage('');
                    alert('Supabase credentials cleared.');
                  }}
                >
                  Disconnect
                </button>
              </div>

              <button
                type="button"
                className="settings-btn"
                style={{ width: '100%' }}
                onClick={() => triggerSupabaseSync(false)}
                disabled={isSyncing || getSupabaseConfig() === null}
              >
                🔄 Force Sync Now
              </button>
            </div>

            <div className="divider" />

            {/* Manual Backups Fallback */}
            <h4 style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 700 }}>
              Backup Option A: Export Local Backup
            </h4>
            <p style={{ margin: '0 0 10px 0', fontSize: 11, color: '#94a3b8' }}>
              Export your current local database as a family master sync JSON file.
            </p>
            <button
              className="modal-action-btn submit"
              style={{ width: '100%', marginBottom: 16 }}
              disabled={isSyncing}
              onClick={handleExportBackup}
            >
              {isSyncing ? 'Exporting...' : '✨ Export Local Backup JSON'}
            </button>

            <h4 style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 700 }}>
              Backup Option B: Import Shared Backup
            </h4>
            <p style={{ margin: '0 0 10px 0', fontSize: 11, color: '#94a3b8' }}>
              Select a family ledger sync JSON file to merge manually.
            </p>
            <button
              className="modal-action-btn"
              style={{
                width: '100%',
                backgroundColor: '#6366f1',
                color: '#f8fafc',
                marginBottom: 8,
              }}
              disabled={isSyncing}
              onClick={() => fileInputRef.current?.click()}
            >
              {isSyncing ? 'Syncing...' : '🔗 Import & Merge Backup JSON'}
            </button>

            <button
              className="modal-action-btn cancel"
              style={{ width: '100%', marginTop: 16 }}
              onClick={() => setIsSyncModalVisible(false)}
            >
              Close Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
