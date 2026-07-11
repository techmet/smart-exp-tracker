import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveExpenses, deleteExpense, Expense } from '../db/database';
import { findPotentialDuplicates, DuplicateGroup } from '../services/duplicateDetector';

interface DuplicateResolutionScreenProps {
  onBack: () => void;
  onRefreshParent: () => void;
}

export default function DuplicateResolutionScreen({
  onBack,
  onRefreshParent,
}: DuplicateResolutionScreenProps) {
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);

  useEffect(() => {
    loadDuplicates();
  }, []);

  const loadDuplicates = () => {
    const expenses = getActiveExpenses();
    const groups = findPotentialDuplicates(expenses);
    setDuplicateGroups(groups);
  };

  const handleKeepBoth = (groupIndex: number) => {
    // To dismiss, we could assign a flag or just remove from local list for this session
    const updated = [...duplicateGroups];
    updated.splice(groupIndex, 1);
    setDuplicateGroups(updated);
  };

  const handleMerge = (
    groupIndex: number,
    keepExpense: Expense,
    discardExpenses: Expense[]
  ) => {
    try {
      // Soft-delete the discarded ones
      discardExpenses.forEach((exp) => {
        deleteExpense(exp.id);
      });

      Alert.alert('Success', 'Transactions merged successfully.');
      
      // Update UI list
      const updated = [...duplicateGroups];
      updated.splice(groupIndex, 1);
      setDuplicateGroups(updated);

      onRefreshParent();
    } catch (err) {
      Alert.alert('Error', 'Failed to merge transactions.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Resolve Duplicates</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.subtitle}>
          We found {duplicateGroups.length} groups of potential duplicate transactions. Choose which one to keep.
        </Text>

        {duplicateGroups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>🎉 No duplicate transactions found!</Text>
          </View>
        ) : (
          duplicateGroups.map((group, index) => {
            const allItems = [group.primary, ...group.duplicates];

            return (
              <View key={group.primary.id} style={styles.groupCard}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupHeaderTitle}>Potential Duplicate Group</Text>
                  <Text style={styles.duplicateAmount}>
                    {group.primary.currency} {group.primary.amount.toFixed(2)}
                  </Text>
                </View>

                {/* Display items side-by-side or stacked */}
                {allItems.map((item) => {
                  const isGmail = item.id.startsWith('gmail_');
                  const isSMS = item.id.startsWith('sms_');
                  const sourceLabel = isGmail
                    ? 'Gmail Auto-Read'
                    : isSMS
                    ? 'SMS Auto-Read'
                    : `Manual (${item.createdBy.split('@')[0]})`;

                  return (
                    <View key={item.id} style={styles.itemRow}>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemDescription}>{item.description}</Text>
                        <Text style={styles.itemMeta}>
                          {new Date(item.date).toLocaleDateString()} at{' '}
                          {new Date(item.date).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                        <View
                          style={[
                            styles.badge,
                            isGmail
                              ? styles.gmailBadge
                              : isSMS
                              ? styles.smsBadge
                              : styles.manualBadge,
                          ]}
                        >
                          <Text style={styles.badgeText}>{sourceLabel}</Text>
                        </View>
                      </View>

                      {/* Merge Action */}
                      <TouchableOpacity
                        style={styles.keepButton}
                        onPress={() => {
                          const discards = allItems.filter((x) => x.id !== item.id);
                          handleMerge(index, item, discards);
                        }}
                      >
                        <Text style={styles.keepButtonText}>Keep This</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}

                <View style={styles.groupFooter}>
                  <TouchableOpacity
                    style={styles.ignoreButton}
                    onPress={() => handleKeepBoth(index)}
                  >
                    <Text style={styles.ignoreButtonText}>Keep All (No Duplicate)</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A', // Slate 900
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B', // Slate 800
  },
  backButton: {
    marginRight: 16,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  backButtonText: {
    color: '#94A3B8', // Slate 400
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC', // Slate 50
  },
  scrollContent: {
    padding: 16,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 20,
    lineHeight: 20,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  emptyText: {
    fontSize: 16,
    color: '#38BDF8', // Sky 400
    fontWeight: '600',
  },
  groupCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
    padding: 16,
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 10,
    marginBottom: 10,
  },
  groupHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#38BDF8',
  },
  duplicateAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemDescription: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  itemMeta: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gmailBadge: {
    backgroundColor: '#EF444430',
  },
  smsBadge: {
    backgroundColor: '#F59E0B30',
  },
  manualBadge: {
    backgroundColor: '#10B98130',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  keepButton: {
    backgroundColor: '#38BDF8',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  keepButtonText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 12,
  },
  groupFooter: {
    alignItems: 'flex-end',
    marginTop: 12,
  },
  ignoreButton: {
    paddingVertical: 4,
  },
  ignoreButtonText: {
    color: '#94A3B8',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
