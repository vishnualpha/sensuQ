import React, { useState, useEffect } from 'react';
import { configAPI } from '../services/api';
import { Plus, CreditCard as Edit, Trash2, Globe, Settings, X } from 'lucide-react';

interface TestConfig {
  id: number;
  name: string;
  target_url: string;
  max_depth: number;
  max_pages: number;
  include_accessibility: boolean;
  include_performance: boolean;
  llm_name?: string;
  created_at: string;
}

export default function TestConfigurations() {
  const [configs, setConfigs] = useState<TestConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<TestConfig | null>(null);
  const [llmConfigs, setLlmConfigs] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    targetUrl: '',
    maxDepth: 3,
    maxPages: 50,
    includeAccessibility: true,
    includePerformance: true,
    llmConfigId: '',
    credentials: {
      username: '',
      password: ''
    }
  });

  useEffect(() => {
    fetchConfigurations();
    fetchLLMConfigs();
  }, []);

  const fetchConfigurations = async () => {
    try {
      const response = await configAPI.getTestConfigs();
      setConfigs(response.data);
    } catch (error) {
      console.error('Error fetching configurations:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLLMConfigs = async () => {
    try {
      const response = await configAPI.getLLMConfigs();
      setLlmConfigs(response.data);
    } catch (error) {
      console.error('Error fetching LLM configs:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingConfig) {
        await configAPI.updateTestConfig(editingConfig.id, formData);
      } else {
        await configAPI.createTestConfig(formData);
      }
      setShowModal(false);
      setEditingConfig(null);
      resetForm();
      fetchConfigurations();
    } catch (error) {
      console.error('Error saving test configuration:', error);
    }
  };

  const handleEdit = (config: TestConfig) => {
    setEditingConfig(config);
    setFormData({
      name: config.name,
      targetUrl: config.target_url,
      maxDepth: config.max_depth,
      maxPages: config.max_pages,
      includeAccessibility: config.include_accessibility,
      includePerformance: config.include_performance,
      llmConfigId: config.llm_config_id?.toString() || '',
      credentials: {
        username: '',
        password: ''
      }
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this configuration?')) {
      try {
        await configAPI.deleteTestConfig(id);
        fetchConfigurations();
      } catch (error) {
        console.error('Error deleting configuration:', error);
      }
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      targetUrl: '',
      maxDepth: 3,
      maxPages: 50,
      includeAccessibility: true,
      includePerformance: true,
      llmConfigId: '',
      credentials: {
        username: '',
        password: ''
      }
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card">
                <div className="card-body">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Test Configurations</h1>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Configuration
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {configs.map((config) => (
          <div key={config.id} className="card">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-gray-900">{config.name}</h3>
                  <div className="mt-2 flex items-center text-sm text-gray-500">
                    <Globe className="h-4 w-4 mr-1" />
                    {config.target_url}
                  </div>
                  <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                    <span>Max Depth: {config.max_depth}</span>
                    <span>Max Pages: {config.max_pages}</span>
                    {config.include_accessibility && <span>Accessibility ✓</span>}
                    {config.include_performance && <span>Performance ✓</span>}
                  </div>
                  {config.llm_name && (
                    <div className="mt-2 text-sm text-gray-500">
                      LLM: {config.llm_name}
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleEdit(config)}
                    className="p-2 text-gray-400 hover:text-gray-600"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(config.id)}
                    className="p-2 text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {configs.length === 0 && (
        <div className="text-center py-12">
          <Settings className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No configurations</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by creating a new test configuration.
          </p>
          <div className="mt-6">
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Configuration
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {editingConfig ? 'Edit Test Configuration' : 'New Test Configuration'}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingConfig(null);
                  resetForm();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Configuration Name</label>
                <input
                  type="text"
                  required
                  className="form-input mt-1"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Production Website Test"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Target URL</label>
                <input
                  type="url"
                  required
                  className="form-input mt-1"
                  value={formData.targetUrl}
                  onChange={(e) => setFormData({ ...formData, targetUrl: e.target.value })}
                  placeholder="https://example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Max Crawl Depth</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    className="form-input mt-1"
                    value={formData.maxDepth}
                    onChange={(e) => setFormData({ ...formData, maxDepth: parseInt(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Max Pages</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    className="form-input mt-1"
                    value={formData.maxPages}
                    onChange={(e) => setFormData({ ...formData, maxPages: parseInt(e.target.value) })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">LLM Configuration</label>
                <select
                  className="form-select mt-1"
                  value={formData.llmConfigId}
                  onChange={(e) => setFormData({ ...formData, llmConfigId: e.target.value })}
                >
                  <option value="">Select LLM Configuration (Optional)</option>
                  {llmConfigs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name} ({config.provider})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Authentication (Optional)</label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.credentials.username}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        credentials: { ...formData.credentials, username: e.target.value }
                      })}
                      placeholder="Username"
                    />
                  </div>
                  <div>
                    <input
                      type="password"
                      className="form-input"
                      value={formData.credentials.password}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        credentials: { ...formData.credentials, password: e.target.value }
                      })}
                      placeholder="Password"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="includeAccessibility"
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    checked={formData.includeAccessibility}
                    onChange={(e) => setFormData({ ...formData, includeAccessibility: e.target.checked })}
                  />
                  <label htmlFor="includeAccessibility" className="ml-2 block text-sm text-gray-900">
                    Include Accessibility Testing
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="includePerformance"
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    checked={formData.includePerformance}
                    onChange={(e) => setFormData({ ...formData, includePerformance: e.target.checked })}
                  />
                  <label htmlFor="includePerformance" className="ml-2 block text-sm text-gray-900">
                    Include Performance Testing
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingConfig(null);
                    resetForm();
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingConfig ? 'Update' : 'Create'} Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}