import React, { useState, useEffect } from 'react';
import { configAPI } from '../services/api';
import { Plus, CreditCard as Edit, Trash2, Globe, Settings } from 'lucide-react';

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

  useEffect(() => {
    fetchConfigurations();
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

  const handleEdit = (config: TestConfig) => {
    setEditingConfig(config);
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
    </div>
  );
}