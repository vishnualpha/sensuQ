import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';
import { Settings as SettingsIcon, User, Shield, Key, Save } from 'lucide-react';

export default function Settings() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    role: 'user'
  });

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      await authAPI.register(newUser.email, newUser.password, newUser.role);
      setMessage('User created successfully');
      setNewUser({ email: '', password: '', role: 'user' });
    } catch (error: any) {
      setMessage(error.response?.data?.error || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'profile', name: 'Profile', icon: User },
    { id: 'users', name: 'User Management', icon: Shield },
    { id: 'security', name: 'Security', icon: Key },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <SettingsIcon className="h-8 w-8 text-gray-400 mr-3" />
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </div>

      <div className="flex space-x-8">
        {/* Sidebar */}
        <div className="w-64">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <tab.icon className="h-5 w-5 mr-3" />
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          {activeTab === 'profile' && (
            <div className="card">
              <div className="card-header">
                <h3 className="text-lg font-medium text-gray-900">Profile Information</h3>
              </div>
              <div className="card-body">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input
                      type="email"
                      className="form-input mt-1"
                      value={user?.email || ''}
                      disabled
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Role</label>
                    <input
                      type="text"
                      className="form-input mt-1"
                      value={user?.role || ''}
                      disabled
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">User ID</label>
                    <input
                      type="text"
                      className="form-input mt-1"
                      value={user?.id || ''}
                      disabled
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && user?.role === 'admin' && (
            <div className="space-y-6">
              <div className="card">
                <div className="card-header">
                  <h3 className="text-lg font-medium text-gray-900">Create New User</h3>
                </div>
                <div className="card-body">
                  {message && (
                    <div className={`mb-4 p-3 rounded-md ${
                      message.includes('successfully') 
                        ? 'bg-green-50 text-green-800 border border-green-200'
                        : 'bg-red-50 text-red-800 border border-red-200'
                    }`}>
                      {message}
                    </div>
                  )}
                  
                  <form onSubmit={handleCreateUser} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Email</label>
                      <input
                        type="email"
                        required
                        className="form-input mt-1"
                        value={newUser.email}
                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                        placeholder="user@example.com"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Password</label>
                      <input
                        type="password"
                        required
                        className="form-input mt-1"
                        value={newUser.password}
                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        placeholder="Enter password"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Role</label>
                      <select
                        className="form-select mt-1"
                        value={newUser.role}
                        onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary"
                    >
                      {loading ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {loading ? 'Creating...' : 'Create User'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="card">
              <div className="card-header">
                <h3 className="text-lg font-medium text-gray-900">Security Settings</h3>
              </div>
              <div className="card-body">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">Data Encryption</h4>
                      <p className="text-sm text-gray-500">All sensitive data is encrypted at rest</p>
                    </div>
                    <div className="flex items-center">
                      <Shield className="h-5 w-5 text-green-500" />
                      <span className="ml-2 text-sm text-green-600">Enabled</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">JWT Authentication</h4>
                      <p className="text-sm text-gray-500">Secure token-based authentication</p>
                    </div>
                    <div className="flex items-center">
                      <Shield className="h-5 w-5 text-green-500" />
                      <span className="ml-2 text-sm text-green-600">Active</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">API Key Protection</h4>
                      <p className="text-sm text-gray-500">LLM API keys are encrypted in database</p>
                    </div>
                    <div className="flex items-center">
                      <Shield className="h-5 w-5 text-green-500" />
                      <span className="ml-2 text-sm text-green-600">Protected</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && user?.role !== 'admin' && (
            <div className="card">
              <div className="card-body">
                <div className="text-center py-8">
                  <Shield className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">Admin Access Required</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    You need administrator privileges to manage users.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}