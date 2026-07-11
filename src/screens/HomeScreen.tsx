import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  initDatabase,
  getActiveExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  Expense,
} from '../db/database';
import { exportSyncFile, importSyncFile } from '../sync/driveSync';
import { fetchAndParseGmailExpenses } from '../services/gmailReader';
import { syncSMSExpenses, MOCK_SMS_DATA } from '../services/smsReader';
import { calculateExpenseHash, findPotentialDuplicates } from '../services/duplicateDetector';

interface HomeScreenProps {
  onNavigateToDuplicates: () => void;
  shouldRefreshKey: number;
}

export default function HomeScreen({
  onNavigateToDuplicates,
  shouldRefreshKey,
}: HomeScreenProps) {
  // DB & State
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [activeTab, setActiveTab] = useState<'All' | 'Investments' | 'Bills'>('All');

  // Stats
  const [reportRange, setReportRange] = useState<'weekly' | 'monthly'>('monthly');

  // Authentication & Family Settings
  const [memberName, setMemberName] = useState('Dad');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncModalVisible, setIsSyncModalVisible] = useState(false);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);

  // Expense Form
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('Groceries');
  const [formSubCategory, setFormSubCategory] = useState('');
  const [formPaymentMode, setFormPaymentMode] = useState('Cash');
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

  // Share Family Member
  const [shareEmail, setShareEmail] = useState('');

  // Duplicates badge
  const [duplicateCount, setDuplicateCount] = useState(0);

  useEffect(() => {
    initDatabase();
    refreshExpenses();
  }, [shouldRefreshKey]);

  const refreshExpenses = () => {
    const list = getActiveExpenses();
    setExpenses(list);

    // Calculate potential duplicates
    const duplicates = findPotentialDuplicates(list);
    setDuplicateCount(duplicates.length);
  };

  const handleSaveExpense = () => {
    if (!formAmount || isNaN(parseFloat(formAmount)) || parseFloat(formAmount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid positive number for amount.');
      return;
    }
    if (!formDescription.trim()) {
      Alert.alert('Invalid Description', 'Please enter a description/merchant.');
      return;
    }

    const amount = parseFloat(formAmount);

    if (editingExpenseId) {
      try {
        updateExpense(editingExpenseId, {
          amount,
          category: formCategory,
          subCategory: formCategory === 'Investments' ? formSubCategory || 'Stocks' : undefined,
          description: formDescription.trim(),
          paymentMode: formPaymentMode,
        });
        setIsAddModalVisible(false);
        setEditingExpenseId(null);
        resetForm();
        refreshExpenses();
        Alert.alert('Success', 'Expense updated successfully!');
      } catch (err) {
        Alert.alert('Error', 'Failed to update transaction.');
      }
    } else {
      const date = new Date().toISOString();
      const hash = calculateExpenseHash(amount, date, formDescription);

      const newExpense = {
        id: `manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        amount,
        currency: 'INR',
        date,
        category: formCategory,
        subCategory: formCategory === 'Investments' ? formSubCategory || 'Stocks' : formSubCategory || undefined,
        description: formDescription.trim(),
        paymentMode: formPaymentMode,
        createdBy: memberName,
        createdAt: date,
        updatedAt: date,
        hash,
      };

      try {
        addExpense(newExpense);
        setIsAddModalVisible(false);
        resetForm();
        refreshExpenses();
        Alert.alert('Success', 'Expense logged successfully!');
      } catch (err) {
        Alert.alert('Error', 'Failed to save transaction. A duplicate might exist.');
      }
    }
  };

  const handleEditPress = (expense: Expense) => {
    setEditingExpenseId(expense.id);
    setFormAmount(expense.amount.toString());
    setFormDescription(expense.description);
    setFormCategory(expense.category);
    setFormSubCategory(expense.subCategory || '');
    setFormPaymentMode(expense.paymentMode);
    setIsAddModalVisible(true);
  };

  const resetForm = () => {
    setFormAmount('');
    setFormDescription('');
    setFormCategory('Groceries');
    setFormSubCategory('');
    setFormPaymentMode('Cash');
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      'Delete Expense',
      'Are you sure you want to delete this expense? This action can be synced across devices.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteExpense(id);
            refreshExpenses();
          },
        },
      ]
    );
  };

  const handleBackupToDrive = async () => {
    setIsSyncing(true);
    const res = await exportSyncFile();
    setIsSyncing(false);
    Alert.alert(res.success ? 'Success' : 'Error', res.message);
  };

  const handleImportFromDrive = async () => {
    setIsSyncing(true);
    const res = await importSyncFile();
    setIsSyncing(false);
    refreshExpenses();
    Alert.alert(res.success ? 'Success' : 'Error', res.message);
  };

  // Trigger Gmail Scans
  const triggerGmailImport = async () => {
    // Mock Gmail scanning (Runs locally without cloud projects)
    const now = new Date().toISOString();
    const mockGmailLogs = [
      {
        id: 'gmail_mock_1',
        snippet: 'Your card XX9281 was charged INR 85.00 at TARGET stores.',
        date: now,
      },
    ];
    let imported = 0;
    mockGmailLogs.forEach((log) => {
      const hash = calculateExpenseHash(85, now, 'TARGET');
      try {
        addExpense({
          id: log.id,
          amount: 85,
          currency: 'INR',
          date: now,
          category: 'Groceries',
          description: 'TARGET',
          paymentMode: 'Auto-Read (Gmail)',
          createdBy: memberName,
          createdAt: now,
          updatedAt: now,
          hash,
        });
        imported++;
      } catch (e) { }
    });
    refreshExpenses();
    Alert.alert(
      'Gmail Scan (Simulated)',
      `Scan completed. Imported ${imported} new transaction from simulated emails.`
    );
  };

  // Trigger SMS scan
  const triggerSMSImport = () => {
    // Process Mock SMS
    const res = syncSMSExpenses(MOCK_SMS_DATA, memberName);
    refreshExpenses();
    Alert.alert(
      'SMS Import Complete',
      `Imported: ${res.importedCount} transactions. Skipped duplicates: ${res.duplicatesSkipped}.`
    );
  };

  // Filter list by selected active tab
  const filteredExpenses = expenses.filter((item) => {
    if (activeTab === 'Investments') return item.category === 'Investments';
    if (activeTab === 'Bills') return item.category === 'Utilities';
    return true;
  });

  // Calculate total spent and investments dynamically based on report range
  const { totalSpent, totalInvestments } = React.useMemo(() => {
    const now = Date.now();
    const rangeMs = reportRange === 'weekly' ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
    const cutoff = now - rangeMs;

    let spent = 0;
    let investments = 0;

    expenses.forEach((item) => {
      const itemTime = new Date(item.date).getTime();
      if (itemTime >= cutoff) {
        if (item.category === 'Investments') {
          investments += item.amount;
        } else {
          spent += item.amount;
        }
      }
    });

    return { totalSpent: spent, totalInvestments: investments };
  }, [expenses, reportRange]);

  // Calculate simple categories chart data (Top categories by amount within range)
  const categoryChartData = React.useMemo(() => {
    const now = Date.now();
    const rangeMs = reportRange === 'weekly' ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
    const cutoff = now - rangeMs;

    const map: Record<string, number> = {};
    expenses.forEach((item) => {
      const itemTime = new Date(item.date).getTime();
      if (itemTime >= cutoff) {
        map[item.category] = (map[item.category] || 0) + item.amount;
      }
    });
    return Object.keys(map).map((key) => ({
      name: key,
      value: map[key],
    }));
  }, [expenses, reportRange]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Banner (User Email & Settings) */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.appTitle}>Smart Expense Tracker</Text>
          <Text style={styles.userEmailText}>Member: {memberName}</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => setIsSyncModalVisible(true)}
        >
          <Text style={styles.settingsBtnText}>⚙️ Sync Config</Text>
        </TouchableOpacity>
      </View>

      {/* Main Scroll Content */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Report Range Selector */}
        <View style={styles.rangeSelectorContainer}>
          <View style={styles.rangeButtons}>
            <TouchableOpacity
              style={[styles.rangeBtn, reportRange === 'weekly' && styles.activeRangeBtn]}
              onPress={() => setReportRange('weekly')}
            >
              <Text style={[styles.rangeBtnText, reportRange === 'weekly' && styles.activeRangeBtnText]}>
                Weekly Report (7D)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.rangeBtn, reportRange === 'monthly' && styles.activeRangeBtn]}
              onPress={() => setReportRange('monthly')}
            >
              <Text style={[styles.rangeBtnText, reportRange === 'monthly' && styles.activeRangeBtnText]}>
                Monthly Report (30D)
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Total balance cards */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>
              {reportRange === 'weekly' ? 'Weekly Spent' : 'Monthly Spent'}
            </Text>
            <Text style={styles.statValue}>₹{totalSpent.toFixed(2)}</Text>
          </View>
          <View style={[styles.statCard, styles.investmentCard]}>
            <Text style={[styles.statLabel, styles.investmentText]}>
              {reportRange === 'weekly' ? 'Weekly Investments' : 'Total Investments'}
            </Text>
            <Text style={[styles.statValue, styles.investmentText]}>
              ₹{totalInvestments.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Cloud Sync & Import/Export Bar */}
        <View style={styles.quickSyncBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleBackupToDrive} disabled={isSyncing}>
            {isSyncing ? (
              <ActivityIndicator size="small" color="#0F172A" />
            ) : (
              <Text style={styles.actionBtnText}>📤 Backup to Drive</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.syncBtn]} onPress={handleImportFromDrive} disabled={isSyncing}>
            {isSyncing ? (
              <ActivityIndicator size="small" color="#0F172A" />
            ) : (
              <Text style={styles.actionBtnText}>📥 Sync from Drive</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.quickSyncBar}>
          <TouchableOpacity style={[styles.actionBtn, styles.gmailBtn]} onPress={triggerGmailImport}>
            <Text style={styles.actionBtnText}>📨 Scan Gmail</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.smsBtn]} onPress={triggerSMSImport}>
            <Text style={styles.actionBtnText}>💬 Scan SMS</Text>
          </TouchableOpacity>
        </View>

        {/* Duplicate warning bar */}
        {duplicateCount > 0 && (
          <TouchableOpacity style={styles.duplicateWarning} onPress={onNavigateToDuplicates}>
            <Text style={styles.duplicateWarningText}>
              ⚠️ {duplicateCount} potential duplicate transactions detected! Tap to resolve.
            </Text>
          </TouchableOpacity>
        )}

        {/* Categories Bar Chart (Custom pure React Native implementation) */}
        {categoryChartData.length > 0 && (
          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Spending by Category</Text>
            <View style={styles.chartRow}>
              {categoryChartData.map((data) => {
                // Find percentage
                const max = Math.max(...categoryChartData.map((x) => x.value));
                const heightPercentage = max > 0 ? (data.value / max) * 100 : 0;

                return (
                  <View key={data.name} style={styles.chartColumn}>
                    <View style={styles.chartBarWrapper}>
                      <View
                        style={[
                          styles.chartBar,
                          { height: `${heightPercentage}%` },
                          data.name === 'Investments'
                            ? { backgroundColor: '#10B981' }
                            : { backgroundColor: '#38BDF8' },
                        ]}
                      />
                    </View>
                    <Text style={styles.chartBarValue}>₹{data.value.toFixed(0)}</Text>
                    <Text style={styles.chartBarLabel} numberOfLines={1}>
                      {data.name}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Feed tabs */}
        <View style={styles.tabContainer}>
          {(['All', 'Investments', 'Bills'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, activeTab === tab && styles.activeTabButton]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[styles.tabButtonText, activeTab === tab && styles.activeTabButtonText]}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Transactions List */}
        <Text style={styles.sectionTitle}>Transactions</Text>
        {filteredExpenses.length === 0 ? (
          <View style={styles.emptyView}>
            <Text style={styles.emptyText}>No transactions found.</Text>
          </View>
        ) : (
          filteredExpenses.map((item) => (
            <View key={item.id} style={styles.transactionCard}>
              <View style={styles.transactionRow}>
                <View style={styles.transactionLeft}>
                  <Text style={styles.transactionDesc}>{item.description}</Text>
                  <Text style={styles.transactionMeta}>
                    {item.category}{' '}
                    {item.subCategory ? `› ${item.subCategory}` : ''} •{' '}
                    {new Date(item.date).toLocaleDateString()}
                  </Text>
                  <Text style={styles.creatorTag}>
                    Added by: {item.createdBy} ({item.paymentMode})
                  </Text>
                </View>
                <View style={styles.transactionRight}>
                  <Text
                    style={[
                      styles.transactionAmount,
                      item.category === 'Investments'
                        ? styles.investmentValueText
                        : styles.expenseValueText,
                    ]}
                  >
                    {item.category === 'Investments' ? '+' : '-'}₹{item.amount.toFixed(2)}
                  </Text>
                </View>
              </View>
              <View style={styles.transactionActionsRow}>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => handleEditPress(item)}
                >
                  <Text style={styles.editBtnText}>✏️ Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(item.id)}
                >
                  <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Floating Add Button */}
      <TouchableOpacity
        style={styles.floatingAddBtn}
        onPress={() => {
          setEditingExpenseId(null);
          resetForm();
          setIsAddModalVisible(true);
        }}
      >
        <Text style={styles.floatingAddBtnText}>+</Text>
      </TouchableOpacity>

      {/* MODAL 1: Add Expense Form */}
      <Modal visible={isAddModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingExpenseId ? 'Edit Transaction' : 'Add Transaction'}</Text>

            <Text style={styles.inputLabel}>Amount (₹)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 29.99"
              placeholderTextColor="#64748B"
              keyboardType="decimal-pad"
              value={formAmount}
              onChangeText={setFormAmount}
            />

            <Text style={styles.inputLabel}>Merchant / Description</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Walmart, Swiggy, Robinhood"
              placeholderTextColor="#64748B"
              value={formDescription}
              onChangeText={setFormDescription}
            />

            <Text style={styles.inputLabel}>Category</Text>
            <View style={styles.categoryPickerRow}>
              {['Groceries', 'Food & Dining', 'Utilities', 'Investments', 'Shopping', 'Entertainment'].map(
                (cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.pickerChip,
                      formCategory === cat && styles.activePickerChip,
                    ]}
                    onPress={() => {
                      setFormCategory(cat);
                      if (cat !== 'Investments') setFormSubCategory('');
                    }}
                  >
                    <Text
                      style={[
                        styles.pickerChipText,
                        formCategory === cat && styles.activePickerChipText,
                      ]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>

            {formCategory === 'Investments' && (
              <>
                <Text style={styles.inputLabel}>Investment Type</Text>
                <View style={styles.categoryPickerRow}>
                  {['Stocks', 'Mutual Funds', 'Crypto', 'Real Estate'].map((sub) => (
                    <TouchableOpacity
                      key={sub}
                      style={[
                        styles.pickerChip,
                        formSubCategory === sub && styles.activePickerChip,
                      ]}
                      onPress={() => setFormSubCategory(sub)}
                    >
                      <Text
                        style={[
                          styles.pickerChipText,
                          formSubCategory === sub && styles.activePickerChipText,
                        ]}
                      >
                        {sub}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.inputLabel}>Payment Mode</Text>
            <View style={styles.categoryPickerRow}>
              {['Cash', 'Credit Card', 'Debit Card', 'UPI / Bank Transfer'].map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.pickerChip,
                    formPaymentMode === mode && styles.activePickerChip,
                  ]}
                  onPress={() => setFormPaymentMode(mode)}
                >
                  <Text
                    style={[
                      styles.pickerChipText,
                      formPaymentMode === mode && styles.activePickerChipText,
                    ]}
                  >
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelModalBtn]}
                onPress={() => {
                  setIsAddModalVisible(false);
                  setEditingExpenseId(null);
                  resetForm();
                }}
              >
                <Text style={styles.cancelModalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveModalBtn]}
                onPress={handleSaveExpense}
              >
                <Text style={styles.saveModalBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL 2: Sync and Family Configuration */}
      <Modal visible={isSyncModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Sync & Family Settings</Text>

            <Text style={styles.inputLabel}>Your Name (for auditing/feed)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Dad, Mom, Vamsi"
              placeholderTextColor="#64748B"
              autoCapitalize="words"
              value={memberName}
              onChangeText={setMemberName}
            />

            <View style={styles.divider} />

            {/* Option A: Create a Family */}
            <Text style={styles.shareTitle}>Option A: Create a New Family Ledger</Text>
            <Text style={styles.shareSubtitle}>
              Export your current local database to create the family's master sync file. Save it in Google Drive.
            </Text>
            <TouchableOpacity
              style={[styles.shareSubmitBtn, { backgroundColor: '#38BDF8', marginTop: 0, marginBottom: 12 }]}
              onPress={async () => {
                const res = await exportSyncFile();
                if (res.success) {
                  Alert.alert('Success', 'Ledger created! Natively share this file inside Google Drive with other members.');
                } else {
                  Alert.alert('Export Failed', res.message);
                }
              }}
            >
              <Text style={[styles.shareSubmitBtnText, { color: '#0F172A' }]}>✨ Create & Share Family Ledger</Text>
            </TouchableOpacity>

            {/* Option B: Import / Join Shared Family */}
            <Text style={styles.shareTitle}>Option B: Import / Join Shared Family</Text>
            <Text style={styles.shareSubtitle}>
              Select the family ledger file shared with you by another family member on Google Drive.
            </Text>
            <TouchableOpacity
              style={[styles.shareSubmitBtn, { backgroundColor: '#6366F1', marginTop: 0, marginBottom: 16 }]}
              onPress={async () => {
                const res = await importSyncFile();
                if (res.success) {
                  refreshExpenses();
                  Alert.alert('Success', 'Joined family database successfully!');
                } else {
                  Alert.alert('Import Failed', res.message);
                }
              }}
            >
              <Text style={styles.shareSubmitBtnText}>🔗 Import & Use Shared Ledger</Text>
            </TouchableOpacity>

            {/* Help / Guidelines */}
            <View style={styles.divider} />
            <Text style={styles.shareTitle}>Quick Setup Guide:</Text>
            <Text style={styles.shareSubtitle}>
              • Owner shares the sync file natively in the Google Drive App with members' Google emails.
            </Text>
            <Text style={styles.shareSubtitle}>
              • Members navigate to "Shared with me" in their file picker to select and import the ledger.
            </Text>

            <TouchableOpacity
              style={styles.closeSettingsBtn}
              onPress={() => setIsSyncModalVisible(false)}
            >
              <Text style={styles.closeSettingsBtnText}>Close Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A', // Slate 900 (Dark Mode)
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  userEmailText: {
    fontSize: 12,
    color: '#38BDF8',
    marginTop: 2,
  },
  settingsBtn: {
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  settingsBtnText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100, // Space for floating button
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginRight: 8,
  },
  investmentCard: {
    marginRight: 0,
    marginLeft: 8,
    backgroundColor: '#064E3B', // Deep Green
    borderColor: '#065F46',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
  investmentText: {
    color: '#A7F3D0',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  quickSyncBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#38BDF8',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  gmailBtn: {
    backgroundColor: '#EF4444',
  },
  smsBtn: {
    backgroundColor: '#F59E0B',
  },
  syncBtn: {
    backgroundColor: '#6366F1',
  },
  actionBtnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 11,
  },
  duplicateWarning: {
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  duplicateWarningText: {
    color: '#FEE2E2',
    fontWeight: '600',
    fontSize: 12,
    textAlign: 'center',
  },
  chartContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 14,
  },
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 100,
  },
  chartColumn: {
    alignItems: 'center',
    width: 60,
  },
  chartBarWrapper: {
    height: 60,
    width: 24,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  chartBar: {
    width: '100%',
    borderRadius: 12,
  },
  chartBarValue: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F8FAFC',
    marginTop: 4,
  },
  chartBarLabel: {
    fontSize: 9,
    color: '#94A3B8',
    marginTop: 2,
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  activeTabButton: {
    backgroundColor: '#0F172A',
  },
  tabButtonText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 13,
  },
  activeTabButtonText: {
    color: '#38BDF8',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 12,
  },
  emptyView: {
    padding: 30,
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
  },
  emptyText: {
    color: '#64748B',
  },
  transactionCard: {
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 10,
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  transactionLeft: {
    flex: 1,
    marginRight: 10,
  },
  transactionDesc: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  transactionMeta: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  creatorTag: {
    fontSize: 10,
    color: '#38BDF8',
    marginTop: 4,
    fontWeight: '600',
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
  },
  expenseValueText: {
    color: '#F8FAFC',
  },
  investmentValueText: {
    color: '#10B981',
  },
  transactionActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 10,
  },
  editBtn: {
    marginRight: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#38BDF815',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF830',
  },
  editBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
  deleteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#EF444415',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF444430',
  },
  deleteBtnText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
  },
  floatingAddBtn: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: '#38BDF8',
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 8,
  },
  floatingAddBtnText: {
    fontSize: 32,
    color: '#0F172A',
    lineHeight: 36,
    fontWeight: '300',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 20,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 16,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    color: '#F8FAFC',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  categoryPickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  pickerChip: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 6,
    marginBottom: 6,
  },
  activePickerChip: {
    borderColor: '#38BDF8',
    backgroundColor: '#38BDF830',
  },
  pickerChipText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  activePickerChipText: {
    color: '#38BDF8',
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  cancelModalBtn: {
    backgroundColor: '#334155',
  },
  cancelModalBtnText: {
    color: '#94A3B8',
    fontWeight: '600',
  },
  saveModalBtn: {
    backgroundColor: '#38BDF8',
  },
  saveModalBtnText: {
    color: '#0F172A',
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 10,
  },
  switchLabel: {
    color: '#94A3B8',
    fontSize: 13,
  },
  tokenHelpText: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 16,
  },
  shareTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  shareSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 10,
  },
  shareSubmitBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  shareSubmitBtnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  closeSettingsBtn: {
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  closeSettingsBtnText: {
    color: '#F8FAFC',
    fontWeight: '600',
  },
  rangeSelectorContainer: {
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  rangeButtons: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: '#334155',
  },
  rangeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeRangeBtn: {
    backgroundColor: '#38BDF8',
  },
  rangeBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  activeRangeBtnText: {
    color: '#0F172A',
    fontWeight: '700',
  },
});
