import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, ActivityIndicator, Text, ScrollView } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import DuplicateResolutionScreen from './src/screens/DuplicateResolutionScreen';
import { initDatabase } from './src/db/database';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', padding: 20 }}>
          <Text style={{ color: '#EF4444', fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
            Something went wrong:
          </Text>
          <Text style={{ color: '#E2E8F0', fontSize: 14, fontFamily: 'monospace', marginBottom: 10 }}>
            {this.state.error?.toString() || 'Unknown Error'}
          </Text>
          <ScrollView style={{ maxHeight: 300, backgroundColor: '#1E293B', padding: 10, borderRadius: 8 }}>
            <Text style={{ color: '#94A3B8', fontSize: 11, fontFamily: 'monospace' }}>
              {this.state.error?.stack || ''}
            </Text>
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'Home' | 'Duplicates'>('Home');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    try {
      initDatabase();
    } catch (e) {
      console.error('Failed to initialize database:', e);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <View style={styles.container}>
        <StatusBar style="light" />
        {currentScreen === 'Home' ? (
          <HomeScreen
            onNavigateToDuplicates={() => setCurrentScreen('Duplicates')}
            shouldRefreshKey={refreshKey}
          />
        ) : (
          <DuplicateResolutionScreen
            onBack={() => setCurrentScreen('Home')}
            onRefreshParent={handleRefresh}
          />
        )}
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
