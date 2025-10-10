import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { testAPI, reportsAPI } from '../services/api';
import { 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Download,
  Globe,
  FileText,
  Activity,
  Shield,
  Zap,
  Calendar
} from 'lucide-react';

interface TestRunDetails {
  id: number;
  config_name: string;
  target_url: string;
  status: string;
  start_time: string;
  end_time?: string;
  total_pages_discovered: number;
  total_test_cases: number;
  passed_tests: number;
  failed_tests: number;
  flaky_tests: number;
  coverage_percentage: number;
  discoveredPages: any[];
  testCases: any[];
}

export default function TestRunDetails() {
  const { id } = useParams<{ id: string }>();
  const [testRun, setTestRun] = useState<TestRunDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (id) {
      fetchTestRunDetails(parseInt(id));
    }
  }, [id]);

  const fetchTestRunDetails = async (runId: number) => {
    try {
      const response = await testAPI.getRunDetails(runId);
      setTestRun(response.data);
    } catch (error) {
      console.error('Error fetching test run details:', error);
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = async (format: 'pdf' | 'json') => {
    if (!testRun) return;
    
    try {
      const response = format === 'pdf' 
        ? await reportsAPI.downloadPDF(testRun.id)
        : await reportsAPI.downloadJSON(testRun.id);
      
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `test-report-${testRun.id}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error(`Error downloading ${format} report:`, error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Clock className="h-5 w-5 text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'cancelled':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-500" />;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="card">
                <div className="card-body">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!testRun) {
    return (
      <div className="text-center py-12">
        <XCircle className="mx-auto h-12 w-12 text-red-400" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">Test run not found</h3>
        <p className="mt-1 text-sm text-gray-500">
          The requested test run could not be found.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{testRun.config_name}</h1>
          <p className="text-sm text-gray-500">Test Run #{testRun.id}</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => downloadReport('pdf')}
            className="btn-secondary"
          >
            <Download className="h-4 w-4 mr-2" />
            PDF Report
          </button>
          <button
            onClick={() => downloadReport('json')}
            className="btn-secondary"
          >
            <Download className="h-4 w-4 mr-2" />
            JSON Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Status Card */}
          <div className="card">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {getStatusIcon(testRun.status)}
                  <div className="ml-3">
                    <h3 className="text-lg font-medium text-gray-900">
                      {testRun.status.charAt(0).toUpperCase() + testRun.status.slice(1)}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Started: {new Date(testRun.start_time).toLocaleString()}
                    </p>
                    {testRun.end_time && (
                      <p className="text-sm text-gray-500">
                        Completed: {new Date(testRun.end_time).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center text-sm text-gray-500">
                    <Globe className="h-4 w-4 mr-1" />
                    {testRun.target_url}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="card">
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8 px-6">
                {[
                  { id: 'overview', name: 'Overview', icon: Activity },
                  { id: 'pages', name: 'Discovered Pages', icon: Globe },
                  { id: 'tests', name: 'Test Cases', icon: FileText },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <tab.icon className="h-4 w-4 mr-2" />
                    {tab.name}
                  </button>
                ))}
              </nav>
            </div>

            <div className="card-body">
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">Pages Discovered</h4>
                      <p className="text-2xl font-semibold text-gray-900">
                        {testRun.total_pages_discovered}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-500">Test Cases</h4>
                      <p className="text-2xl font-semibold text-gray-900">
                        {testRun.total_test_cases}
                      </p>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Coverage</h4>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-blue-600 h-3 rounded-full"
                        style={{ width: `${Math.min(testRun.coverage_percentage, 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {Math.round(testRun.coverage_percentage)}% coverage achieved
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'pages' && (
                <div className="space-y-4">
                  {testRun.discoveredPages.map((page, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-start space-x-4">
                        {/* Screenshot */}
                        <div className="flex-shrink-0">
                          {page.screenshot_path ? (
                            <img
                              src={`/api/screenshots/${page.screenshot_path.split('/').pop()}`}
                              alt={`Screenshot of ${page.title || page.url}`}
                              className="w-32 h-24 object-cover rounded border"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="w-32 h-24 bg-gray-100 rounded border flex items-center justify-center">
                              <Globe className="h-8 w-8 text-gray-400" />
                            </div>
                          )}
                        </div>
                        
                        {/* Page Details */}
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{page.title || 'Untitled Page'}</h4>
                          <p className="text-sm text-gray-500 break-all">{page.url}</p>
                          
                          {/* Page Statistics */}
                          <div className="mt-3 grid grid-cols-2 gap-4">
                            <div className="bg-blue-50 rounded-lg p-3">
                              <div className="flex items-center">
                                <div className="p-1 bg-blue-100 rounded">
                                  <FileText className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="ml-2">
                                  <p className="text-sm font-medium text-blue-900">Elements</p>
                                  <p className="text-lg font-semibold text-blue-700">{page.elements_count || 0}</p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="bg-purple-50 rounded-lg p-3">
                              <div className="flex items-center">
                                <div className="p-1 bg-purple-100 rounded">
                                  <Activity className="h-4 w-4 text-purple-600" />
                                </div>
                                <div className="ml-2">
                                  <p className="text-sm font-medium text-purple-900">Depth</p>
                                  <p className="text-lg font-semibold text-purple-700">{page.crawl_depth || 0}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="mt-2 text-xs text-gray-500">
                            <span>Discovered: {new Date(page.discovered_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'tests' && (
                <div className="space-y-4">
                  {/* Test Type Filter */}
                  <div className="flex items-center space-x-4 mb-6">
                    <span className="text-sm font-medium text-gray-700">Filter by type:</span>
                    <div className="flex space-x-2">
                      <button className="px-3 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                        All Tests
                      </button>
                      <button className="px-3 py-1 text-xs rounded-full bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-800">
                        Functional
                      </button>
                      <button className="px-3 py-1 text-xs rounded-full bg-gray-100 text-gray-600 hover:bg-purple-100 hover:text-purple-800">
                        Accessibility
                      </button>
                      <button className="px-3 py-1 text-xs rounded-full bg-gray-100 text-gray-600 hover:bg-orange-100 hover:text-orange-800">
                        Performance
                      </button>
                    </div>
                  </div>
                  
                  {testRun.testCases.map((testCase, index) => (
                    <div key={index} className={`border-l-4 border rounded-lg p-4 ${
                      testCase.status === 'passed' ? 'border-green-200 bg-green-50' :
                      testCase.status === 'failed' ? 'border-red-200 bg-red-50' :
                      'border-yellow-200 bg-yellow-50'
                    }`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Test Type Badge */}
                          <div className="flex items-center space-x-2 mb-2">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              testCase.test_type === 'functional' ? 'bg-green-100 text-green-800' :
                              testCase.test_type === 'accessibility' ? 'bg-purple-100 text-purple-800' :
                              testCase.test_type === 'performance' ? 'bg-orange-100 text-orange-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {testCase.test_type === 'functional' && <CheckCircle className="h-3 w-3 mr-1" />}
                              {testCase.test_type === 'accessibility' && <Shield className="h-3 w-3 mr-1" />}
                              {testCase.test_type === 'performance' && <Zap className="h-3 w-3 mr-1" />}
                              {testCase.test_type?.charAt(0).toUpperCase() + testCase.test_type?.slice(1) || 'Unknown'}
                            </span>
                          </div>
                          
                          <h4 className="font-medium text-gray-900 mb-1">{testCase.test_name}</h4>
                          <p className="text-sm text-gray-600 mb-3">{testCase.test_description}</p>
                          
                          {/* Test Steps */}
                          {testCase.test_steps && (
                            <div className="mb-3">
                              <details className="group">
                                <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                                  View Test Steps ({JSON.parse(testCase.test_steps || '[]').length} steps)
                                </summary>
                                <div className="mt-2 pl-4 border-l-2 border-gray-200">
                                  {JSON.parse(testCase.test_steps || '[]').map((step, stepIndex) => (
                                    <div key={stepIndex} className="mb-2 text-sm">
                                      <span className="font-medium text-gray-600">{stepIndex + 1}.</span>
                                      <span className="ml-2 text-gray-700">{step.description || step.action}</span>
                                      {step.selector && (
                                        <code className="ml-2 px-1 py-0.5 bg-gray-100 rounded text-xs">{step.selector}</code>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </div>
                          )}
                        </div>
                        
                        {/* Status and Actions */}
                        <div className="flex flex-col items-end space-y-2">
                          {testCase.status === 'passed' && <CheckCircle className="h-4 w-4 text-green-500" />}
                          {testCase.status === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
                          {testCase.status === 'flaky' && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            testCase.status === 'passed' ? 'bg-green-100 text-green-800' :
                            testCase.status === 'failed' ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {testCase.status?.charAt(0).toUpperCase() + testCase.status?.slice(1)}
                          </span>
                        </div>
                      </div>
                      
                      {/* Test Metadata */}
                      <div className="mt-4 flex items-center justify-between text-xs text-gray-500 bg-white bg-opacity-50 rounded p-2">
                        <div className="flex items-center space-x-4">
                          <span className="flex items-center">
                            <Clock className="h-3 w-3 mr-1" />
                            {testCase.execution_time}ms
                          </span>
                          <span className="flex items-center">
                            <Calendar className="h-3 w-3 mr-1" />
                            {new Date(testCase.executed_at).toLocaleString()}
                          </span>
                        </div>
                        {testCase.self_healed && <span className="text-blue-600">Self-healed</span>}
                      </div>
                      
                      {/* Error Details */}
                      {testCase.error_details && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                          <p className="text-sm font-medium text-red-800 mb-1">Error Details:</p>
                          <p className="text-sm text-red-700">{testCase.error_details}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card">
            <div className="card-header">
              <h3 className="text-lg font-medium text-gray-900">Test Results</h3>
            </div>
            <div className="card-body">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                    <span className="text-sm font-medium">Passed</span>
                  </div>
                  <span className="text-sm font-semibold">{testRun.passed_tests}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <XCircle className="h-5 w-5 text-red-500 mr-2" />
                    <span className="text-sm font-medium">Failed</span>
                  </div>
                  <span className="text-sm font-semibold">{testRun.failed_tests}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2" />
                    <span className="text-sm font-medium">Flaky</span>
                  </div>
                  <span className="text-sm font-semibold">{testRun.flaky_tests}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}