import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import TestConfigurations from './components/TestConfigurations';
import TestRuns from './components/TestRuns';
import TestRunDetails from './components/TestRunDetails';
import LLMConfiguration from './components/LLMConfiguration';
import Settings from './components/Settings';
import Layout from './components/Layout';
import './App.css';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <SocketProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/configurations" element={<TestConfigurations />} />
            <Route path="/test-runs" element={<TestRuns />} />
            <Route path="/test-runs/:id" element={<TestRunDetails />} />
            <Route path="/llm-config" element={<LLMConfiguration />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Layout>
      </Router>
    </SocketProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;