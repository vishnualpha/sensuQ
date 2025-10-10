import React, { useState, useEffect } from 'react';
import { configAPI } from '../services/api';
import { Plus, CreditCard as Edit, Trash2, Brain, Key, Settings } from 'lucide-react';

interface LLMConfig {
  id: number;
  name: string;
  provider: string;
  api_url?: string;
  model_name?: string;
  max_tokens: number;
  temperature: number;
  is_active: boolean;
  created_at: string;
}

export default function LLMConfiguration() {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    provider: 'openai',
    apiKey: '',
    apiUrl: '',
    modelName: '',
    maxTokens: 4000,
    temperature: 0.7,
    isActive: false
  });

  useEffect(() => {
    fetchConfigurations();
  }, []);

  const fetchConfigurations = async () => {
    try {
      const response = await configAPI.getLLMConfigs();
      setConfigs(response.data);
    } catch (error) {
      console.error('Error fetching LLM configurations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingConfig) {
        await configAPI.updateLLMConfig(editingConfig.id, formData);
      } else {
        await configAPI.createLLMConfig(formData);
      }
      setShowModal(false);
      setEditingConfig(null);
      resetForm();
      fetchConfigurations();
    } catch (error) {
      console.error('Error saving LLM configuration:', error);
    }
  };

  const handleEdit = (config: LLMConfig) => {
    setEditingConfig(config);
    setFormData({
      name: config.name,
      provider: config.provider,
      apiKey: '',
      apiUrl: config.api_url || '',
      modelName: config.model_name || '',
      maxTokens: config.max_tokens,
      temperature: config.temperature,
      isActive: config.is_active
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this LLM configuration?')) {
      try {
        await configAPI.deleteLLMConfig(id);
        fetchConfigurations();
      } catch (error) {
        console.error('Error deleting LLM configuration:', error);
      }
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      provider: 'openai',
      apiKey: '',
      apiUrl: '',
      modelName: '',
      maxTokens: 4000,
      temperature: 0.7,
      isActive: false
    });
  };

  const providers = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'azure', label: 'Azure OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'bedrock', label: 'AWS Bedrock' },
    { value: 'local', label: 'Local/Self-hosted' }
  ];

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
        <h1 className="text-2xl font-bold text-gray-900">LLM Configuration</h1>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add LLM Provider
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {configs.map((config) => (
          <div key={config.id} className="card">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center">
                    <Brain className="h-5 w-5 text-blue-500 mr-2" />
                    <h3 className="text-lg font-medium text-gray-900">{config.name}</h3>
                    {config.is_active && (
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-4 text-sm text-gray-500">
                    <div>
                      <span className="font-medium">Provider:</span> {config.provider}
                    </div>
                    <div>
                      <span className="font-medium">Model:</span> {config.model_name || 'Default'}
                    </div>
                    <div>
                      <span className="font-medium">Max Tokens:</span> {config.max_tokens}
                    </div>
                    <div>
                      <span className="font-medium">Temperature:</span> {config.temperature}
                    </div>
                  </div>
                  {config.api_url && (
                    <div className="mt-2 text-sm text-gray-500">
                      <span className="font-medium">API URL:</span> {config.api_url}
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
          <Brain className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No LLM configurations</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by adding your first LLM provider configuration.
          </p>
          <div className="mt-6">
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add LLM Provider
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
                {editingConfig ? 'Edit LLM Configuration' : 'Add LLM Configuration'}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingConfig(null);
                  resetForm();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  required
                  className="form-input mt-1"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., OpenAI GPT-4"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Provider</label>
                <select
                  className="form-select mt-1"
                  value={formData.provider}
                  onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                >
                  {providers.map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">API Key</label>
                <input
                  type="password"
                  className="form-input mt-1"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder="Enter API key"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">API URL (Optional)</label>
                <input
                  type="url"
                  className="form-input mt-1"
                  value={formData.apiUrl}
                  onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1/chat/completions"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Model Name</label>
                <input
                  type="text"
                  className="form-input mt-1"
                  value={formData.modelName}
                  onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
                  placeholder="gpt-4, claude-3-sonnet, etc."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Max Tokens</label>
                  <input
                    type="number"
                    min="1"
                    max="32000"
                    className="form-input mt-1"
                    value={formData.maxTokens}
                    onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Temperature</label>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    className="form-input mt-1"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                  />
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                />
                <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
                  Set as active configuration
                </label>
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