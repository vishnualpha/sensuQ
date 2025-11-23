import axios from 'axios';

// Determine API base URL dynamically
const getApiBaseUrl = () => {
  // If explicitly set in env, use that
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // In production/ngrok, use the same origin as the frontend
  // In development, use localhost:3001
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3001/api';
  }

  // For ngrok or other deployments, use the same origin with /api path
  return `${window.location.protocol}//${window.location.host}/api`;
};

const API_BASE_URL = getApiBaseUrl();

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (email: string, password: string) =>
    axios.post(`${API_BASE_URL}/auth/login`, { email, password }),
  
  register: (email: string, password: string, role?: string) =>
    api.post('/auth/register', { email, password, role }),
};

// Test Configuration API
export const configAPI = {
  // LLM Configurations
  getLLMConfigs: () => api.get('/config/llm'),
  createLLMConfig: (config: any) => api.post('/config/llm', config),
  updateLLMConfig: (id: number, config: any) => api.put(`/config/llm/${id}`, config),
  deleteLLMConfig: (id: number) => api.delete(`/config/llm/${id}`),
  
  // Test Configurations
  getTestConfigs: () => api.get('/config/test'),
  createTestConfig: (config: any) => api.post('/config/test', config),
  updateTestConfig: (id: number, config: any) => api.put(`/config/test/${id}`, config),
  deleteTestConfig: (id: number) => api.delete(`/config/test/${id}`),
};

// Test Runs API
export const testAPI = {
  getRuns: () => api.get('/tests/runs'),
  getRunDetails: (id: number) => api.get(`/tests/runs/${id}`),
  getExecutionHistory: (testRunId: number) => api.get(`/tests/runs/${testRunId}/executions`),
  getExecutionDetails: (executionId: number) => api.get(`/tests/executions/${executionId}`),
  getDashboardStats: () => api.get('/tests/dashboard/stats'),
};

// Crawler API
export const crawlerAPI = {
  startCrawling: (testConfigId: number) => 
    api.post('/crawler/start', { testConfigId }),
  
  getCrawlerStatus: (testRunId: number) => 
    api.get(`/crawler/status/${testRunId}`),
  
  pauseCrawling: (testRunId: number) =>
    api.post(`/crawler/pause/${testRunId}`),

  resumeCrawling: (testRunId: number) =>
    api.post(`/crawler/resume/${testRunId}`),

  stopCrawling: (testRunId: number) =>
    api.post(`/crawler/stop/${testRunId}`),

  executeTests: (testRunId: number, selectedTestCaseIds: number[]) =>
    api.post(`/crawler/execute/${testRunId}`, { selectedTestCaseIds }),

  executeTestsWithName: (testRunId: number, selectedTestCaseIds: number[], executionName?: string) => 
    api.post(`/crawler/execute/${testRunId}`, { selectedTestCaseIds, executionName }),
};

// Reports API
export const reportsAPI = {
  downloadPDF: (testRunId: number) => 
    api.get(`/reports/pdf/${testRunId}`, { responseType: 'blob' }),
  
  downloadJSON: (testRunId: number) => 
    api.get(`/reports/json/${testRunId}`, { responseType: 'blob' }),
};

export default api;