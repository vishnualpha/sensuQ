import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { testAPI, reportsAPI, crawlerAPI } from '../services/api';
import { useSocket } from '../contexts/SocketContext';
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
  Calendar,
  Square,
  PlayCircle,
  Pause,
  Play,
  ArrowLeft
} from 'lucide-react';

// Component to display test step results with pass/fail status
function TestStepResults({ testCaseId, testSteps, autoExpand = false }: { testCaseId: number; testSteps: any; autoExpand?: boolean }) {
  const [stepResults, setStepResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(autoExpand);

  useEffect(() => {
    if (testCaseId) {
      loadStepResults();
    }
  }, [testCaseId]);

  const loadStepResults = async () => {
    try {
      setLoading(true);
      const response = await fetch(`http://localhost:3001/api/tests/cases/${testCaseId}/steps`);
      if (response.ok) {
        const data = await response.json();
        setStepResults(data);
      }
    } catch (error) {
      console.error('Failed to load step results:', error);
    } finally {
      setLoading(false);
    }
  };

  const steps = React.useMemo(() => {
    try {
      return typeof testSteps === 'string' ? JSON.parse(testSteps) : testSteps || [];
    } catch {
      return [];
    }
  }, [testSteps]);

  if (!steps || steps.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="mt-2 space-y-2">
        {loading ? (
          <div className="text-sm text-gray-500">Loading step results...</div>
        ) : (
          steps.map((step: any, stepIndex: number) => {
            const stepResult = stepResults.find((r) => r.step_index === stepIndex);
            const status = stepResult?.status || 'pending';

            return (
              <div
                key={stepIndex}
                className={`flex items-start p-3 rounded-lg border-l-4 ${
                  status === 'passed'
                    ? 'bg-green-50 border-green-400'
                    : status === 'failed'
                    ? 'bg-red-50 border-red-400'
                    : 'bg-gray-50 border-gray-300'
                }`}
              >
                <div className="flex-shrink-0 mr-3">
                  <span className="font-semibold text-gray-600 text-sm">{stepIndex + 1}.</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-sm text-gray-800 font-medium">
                      {step.description || step.action}
                    </span>
                    <div className="flex items-center gap-2">
                      {stepResult?.self_healed && status === 'passed' && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                          <Activity className="h-3 w-3 mr-1" />
                          SELF-HEALED
                        </span>
                      )}
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                        status === 'passed'
                          ? 'bg-green-100 text-green-800'
                          : status === 'failed'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {status === 'passed' && <CheckCircle className="h-3 w-3 mr-1" />}
                        {status === 'failed' && <XCircle className="h-3 w-3 mr-1" />}
                        {status === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                        {status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  {step.selector && (
                    <code className="block mt-1 px-2 py-1 bg-white rounded text-xs text-gray-600 border border-gray-200">
                      {step.selector}
                    </code>
                  )}
                  {step.value && (
                    <div className="mt-1 text-xs text-gray-600">
                      <span className="font-medium">Value:</span> <code className="bg-white px-1 rounded">{step.value}</code>
                    </div>
                  )}
                  {stepResult?.error_message && (
                    <div className="mt-2 text-xs text-red-700 bg-red-100 p-2 rounded border border-red-200">
                      <strong>Error:</strong> {stepResult.error_message}
                    </div>
                  )}
                  {stepResult?.execution_time !== undefined && (
                    <div className="mt-1 text-xs text-gray-500">
                      <Clock className="h-3 w-3 inline mr-1" />
                      {stepResult.execution_time}ms
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Component to handle screenshot loading with base64 data URLs
function ScreenshotImage({ pageId, filename, alt }: { pageId?: number; filename?: string; alt: string }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadScreenshot = async () => {
      // Reset state at the beginning
      setLoading(true);
      setError(false);
      setImageSrc(null);
      
      // Validate that we have either pageId or filename
      if (!pageId && !filename) {
        console.error('ScreenshotImage: No pageId or filename provided');
        setError(true);
        setLoading(false);
        return;
      }
      
      try {
        console.log(`🔍 Loading screenshot: pageId=${pageId}, filename=${filename}`);
        
        // Try database first (by pageId), then fallback to filename
        const url = pageId 
          ? `http://localhost:3001/api/screenshots/page/${pageId}`
          : `http://localhost:3001/api/screenshots/${filename}`;
        
        console.log(`📡 Fetching screenshot from: ${url}`);
        
        const response = await fetch(url);
        
        console.log(`📊 Response status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          const data = await response.json();
          
          console.log(`✅ Screenshot data received:`, {
            hasDataUrl: !!data.dataUrl,
            dataUrlLength: data.dataUrl ? data.dataUrl.length : 0,
            pageId: data.pageId,
            url: data.url,
            size: data.size,
            format: data.format
          });
          
          // Validate that dataUrl exists and is not empty
          if (data.dataUrl && data.dataUrl.length > 0) {
            setImageSrc(data.dataUrl);
          } else {
            console.error('❌ No dataUrl in response or dataUrl is empty');
            setError(true);
          }
        } else {
          // Log response body for debugging
          const errorText = await response.text();
          console.error(`❌ Screenshot fetch failed:`, {
            status: response.status,
            statusText: response.statusText,
            body: errorText
          });
          
          // Try to parse error response
          try {
            const errorData = JSON.parse(errorText);
            console.error('Error details:', errorData);
          } catch (parseError) {
            console.error('Could not parse error response');
          }
          
          setError(true);
        }
      } catch (err) {
        console.error('❌ Failed to load screenshot:', err);
        console.error('Error details:', {
          message: err.message,
          stack: err.stack
        });
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadScreenshot();
  }, [pageId, filename]);

  if (loading) {
    return (
      <div className="w-32 h-24 bg-gray-100 rounded border flex items-center justify-center shadow-sm">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400" title="Loading screenshot..."></div>
      </div>
    );
  }

  if (error || !imageSrc) {
    return (
      <div className="w-32 h-24 bg-gray-100 rounded border flex items-center justify-center shadow-sm" title="Screenshot not available">
        <Globe className="h-8 w-8 text-gray-400" />
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className="w-32 h-24 object-cover rounded border shadow-sm"
      onLoad={() => console.log(`✅ Screenshot image loaded successfully`)}
      onError={(e) => {
        console.error('❌ Screenshot image failed to load:', e);
        setError(true);
      }}
    />
  );
}
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

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
};

export default function TestRunDetails() {
  const { id } = useParams<{ id: string }>();
  const [testRun, setTestRun] = useState<TestRunDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [testTypeFilter, setTestTypeFilter] = useState('all');
  const [crawlerProgress, setCrawlerProgress] = useState<any>(null);
  const [stoppingCrawler, setStoppingCrawler] = useState(false);
  const [selectedTestCases, setSelectedTestCases] = useState<number[]>([]);
  const [runningTests, setRunningTests] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<any[]>([]);
  const [showExecutionHistory, setShowExecutionHistory] = useState(false);
  const [executionName, setExecutionName] = useState('');
  const [expandedExecutions, setExpandedExecutions] = useState<Set<number>>(new Set());
  const [executionDetails, setExecutionDetails] = useState<Map<number, any>>(new Map());
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [showPageGrouping, setShowPageGrouping] = useState(true);
  const { socket } = useSocket();

  useEffect(() => {
    if (id) {
      fetchTestRunDetails(parseInt(id));
      fetchExecutionHistory(parseInt(id));

      // Poll for updates every 3 seconds if crawl is running or paused
      const pollInterval = setInterval(() => {
        if (testRun && (testRun.status === 'running' || testRun.status === 'paused')) {
          fetchTestRunDetails(parseInt(id));
        }
      }, 3000);

      return () => clearInterval(pollInterval);
    }
  }, [id, testRun?.status]);

  useEffect(() => {
    if (socket && id) {
      const handleCrawlerProgress = (data: any) => {
        console.log('🔔 Received crawlerProgress event:', data);
        if (data.testRunId === parseInt(id!)) {
          console.log('✅ Progress update matches current test run:', data);
          setCrawlerProgress(data);

          // Update testRun stats in real-time
          setTestRun((prevTestRun) => {
            if (!prevTestRun) return prevTestRun;

            const updatedTestRun = { ...prevTestRun };

            if (data.discoveredPagesCount !== undefined) {
              updatedTestRun.total_pages_discovered = data.discoveredPagesCount;
            }

            if (data.totalTestCases !== undefined) {
              updatedTestRun.total_test_cases = data.totalTestCases;
            }

            if (data.coveragePercentage !== undefined) {
              updatedTestRun.coverage_percentage = data.coveragePercentage;
            }

            return updatedTestRun;
          });

          // Refresh test run details when crawling/generation completes
          if (data.phase === 'ready' || data.phase === 'completed' || data.percentage === 100) {
            console.log('🎉 Crawling completed, refreshing test run details');
            setTimeout(() => fetchTestRunDetails(parseInt(id!)), 1000);
          }
        } else {
          console.log('⏭️ Progress update for different test run, ignoring');
        }
      };

      const handleTestExecutionProgress = (data: any) => {
        if (data.testRunId === parseInt(id!)) {
          // Update test execution progress
          if (data.phase === 'completed') {
            setTimeout(() => fetchTestRunDetails(parseInt(id!)), 1000);
            setRunningTests(false);
          }
        }
      };
      socket.on('crawlerProgress', handleCrawlerProgress);
      socket.on('testExecutionProgress', handleTestExecutionProgress);

      return () => {
        socket.off('crawlerProgress', handleCrawlerProgress);
        socket.off('testExecutionProgress', handleTestExecutionProgress);
      };
    }
  }, [socket, id]);
  const fetchTestRunDetails = async (runId: number) => {
    try {
      const response = await testAPI.getRunDetails(runId);
      setTestRun(response.data);

      // Initialize crawler progress if crawl is running or paused
      if (response.data.status === 'running' || response.data.status === 'paused') {
        const percentage = response.data.total_pages_discovered > 0
          ? Math.min((response.data.total_pages_discovered / 50) * 100, 100)
          : 0;

        setCrawlerProgress({
          testRunId: runId,
          phase: response.data.status === 'paused' ? 'paused' : 'crawling',
          discoveredPagesCount: response.data.total_pages_discovered || 0,
          totalTestCases: response.data.total_test_cases || 0,
          message: response.data.status === 'paused'
            ? 'Crawling is paused'
            : `Discovered ${response.data.total_pages_discovered || 0} pages`,
          percentage: percentage,
          canStopCrawling: true
        });
      }
    } catch (error) {
      console.error('Error fetching test run details:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchExecutionHistory = async (runId: number) => {
    try {
      const response = await testAPI.getExecutionHistory(runId);
      setExecutionHistory(response.data);
    } catch (error) {
      console.error('Error fetching execution history:', error);
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

  const handlePauseCrawling = async () => {
    if (!testRun) return;

    setStoppingCrawler(true);
    try {
      await crawlerAPI.pauseCrawling(testRun.id);
    } catch (error) {
      console.error('Error pausing crawler:', error);
      alert('Failed to pause crawler. Please try again.');
    } finally {
      setStoppingCrawler(false);
    }
  };

  const handleResumeCrawling = async () => {
    if (!testRun) return;

    setStoppingCrawler(true);
    try {
      await crawlerAPI.resumeCrawling(testRun.id);
    } catch (error) {
      console.error('Error resuming crawler:', error);
      alert('Failed to resume crawler. Please try again.');
    } finally {
      setStoppingCrawler(false);
    }
  };

  const handleStopCrawling = async () => {
    if (!testRun) return;

    setStoppingCrawler(true);
    try {
      await crawlerAPI.stopCrawling(testRun.id);
      alert('Crawling stopped. Test cases will be available shortly.');
    } catch (error) {
      console.error('Error stopping crawler:', error);
      alert('Failed to stop crawler. Please try again.');
    } finally {
      setStoppingCrawler(false);
    }
  };

  const handleRunTests = async () => {
    if (!testRun || selectedTestCases.length === 0) {
      alert('Please select at least one test case to run');
      return;
    }

    setRunningTests(true);
    try {
      const response = await crawlerAPI.executeTestsWithName(
        testRun.id,
        selectedTestCases,
        executionName || 'Manual Execution'
      );
      console.log('Test execution started:', response.data);
      alert(`Test execution started successfully! Running ${selectedTestCases.length} test(s).`);

      // Refresh execution history after starting new execution
      setTimeout(() => fetchExecutionHistory(testRun.id), 1000);
    } catch (error: any) {
      console.error('Error running tests:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to start test execution';
      alert(`Error: ${errorMsg}`);
    } finally {
      setRunningTests(false);
      setExecutionName('');
    }
  };

  const handleTestCaseSelection = (testCaseId: number, selected: boolean) => {
    if (selected) {
      setSelectedTestCases(prev => [...prev, testCaseId]);
    } else {
      setSelectedTestCases(prev => prev.filter(id => id !== testCaseId));
    }
  };

  const toggleExecutionExpand = async (executionId: number) => {
    const newExpanded = new Set(expandedExecutions);
    if (newExpanded.has(executionId)) {
      newExpanded.delete(executionId);
    } else {
      newExpanded.add(executionId);
      // Fetch execution details if not already loaded
      if (!executionDetails.has(executionId)) {
        try {
          const response = await testAPI.getExecutionDetails(executionId);
          const newDetails = new Map(executionDetails);
          newDetails.set(executionId, response.data);
          setExecutionDetails(newDetails);
        } catch (error) {
          console.error('Error fetching execution details:', error);
        }
      }
    }
    setExpandedExecutions(newExpanded);
  };

  // Filter test cases based on selected type
  const getFilteredTestCases = () => {
    if (!testRun?.testCases) return [];
    
    if (testTypeFilter === 'all') {
      return testRun.testCases;
    }
    
    return testRun.testCases.filter(testCase => 
      testCase.test_type === testTypeFilter
    );
  };

  const filteredTestCases = getFilteredTestCases();

  // Get test type counts for filter buttons
  const getTestTypeCounts = () => {
    if (!testRun?.testCases) return {};

    const counts = testRun.testCases.reduce((acc, testCase) => {
      const type = testCase.test_type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      all: testRun.testCases.length,
      ...counts
    };
  };

  const testTypeCounts = getTestTypeCounts();

  // Group test cases by page
  const getGroupedTestCases = () => {
    if (!showPageGrouping) return null;

    const grouped = filteredTestCases.reduce((acc, testCase) => {
      const pageKey = testCase.page_url || 'Unknown Page';
      if (!acc[pageKey]) {
        acc[pageKey] = {
          pageUrl: testCase.page_url,
          pageTitle: testCase.page_title,
          pageName: testCase.page_name || testCase.page_title || 'Unknown Page',
          tests: []
        };
      }
      acc[pageKey].tests.push(testCase);
      return acc;
    }, {} as Record<string, { pageUrl: string; pageTitle: string; pageName: string; tests: any[] }>);

    return grouped;
  };

  const groupedTestCases = getGroupedTestCases();

  const togglePageExpand = (pageKey: string) => {
    const newExpanded = new Set(expandedPages);
    if (newExpanded.has(pageKey)) {
      newExpanded.delete(pageKey);
    } else {
      newExpanded.add(pageKey);
    }
    setExpandedPages(newExpanded);
  };

  const selectAllInPage = (pageKey: string) => {
    if (!groupedTestCases) return;
    const pageTests = groupedTestCases[pageKey]?.tests || [];
    const pageTestIds = pageTests.map(tc => tc.id);
    setSelectedTestCases(prev => [...new Set([...prev, ...pageTestIds])]);
  };

  const deselectAllInPage = (pageKey: string) => {
    if (!groupedTestCases) return;
    const pageTests = groupedTestCases[pageKey]?.tests || [];
    const pageTestIds = new Set(pageTests.map(tc => tc.id));
    setSelectedTestCases(prev => prev.filter(id => !pageTestIds.has(id)));
  };

  const isPageFullySelected = (pageKey: string) => {
    if (!groupedTestCases) return false;
    const pageTests = groupedTestCases[pageKey]?.tests || [];
    return pageTests.length > 0 && pageTests.every(tc => selectedTestCases.includes(tc.id));
  };

  const isPagePartiallySelected = (pageKey: string) => {
    if (!groupedTestCases) return false;
    const pageTests = groupedTestCases[pageKey]?.tests || [];
    const selectedCount = pageTests.filter(tc => selectedTestCases.includes(tc.id)).length;
    return selectedCount > 0 && selectedCount < pageTests.length;
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
          {/* Crawler Control Buttons */}
          {testRun.status === 'running' && (
            <>
              <button
                onClick={handlePauseCrawling}
                disabled={stoppingCrawler}
                className="inline-flex items-center px-4 py-2 border border-blue-300 text-sm font-medium rounded-md shadow-sm text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </button>
              <button
                onClick={handleStopCrawling}
                disabled={stoppingCrawler}
                className="inline-flex items-center px-4 py-2 border border-orange-300 text-sm font-medium rounded-md shadow-sm text-orange-700 bg-orange-50 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
              >
                {stoppingCrawler ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
                ) : (
                  <Square className="h-4 w-4 mr-2" />
                )}
                {stoppingCrawler ? 'Stopping...' : 'Stop'}
              </button>
            </>
          )}

          {testRun.status === 'paused' && (
            <>
              <button
                onClick={handleResumeCrawling}
                disabled={stoppingCrawler}
                className="inline-flex items-center px-4 py-2 border border-green-300 text-sm font-medium rounded-md shadow-sm text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <Play className="h-4 w-4 mr-2" />
                Resume
              </button>
              <button
                onClick={handleStopCrawling}
                disabled={stoppingCrawler}
                className="inline-flex items-center px-4 py-2 border border-orange-300 text-sm font-medium rounded-md shadow-sm text-orange-700 bg-orange-50 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
              >
                {stoppingCrawler ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
                ) : (
                  <Square className="h-4 w-4 mr-2" />
                )}
                {stoppingCrawler ? 'Stopping...' : 'Stop'}
              </button>
            </>
          )}
          
          {['ready_for_execution', 'completed'].includes(testRun.status) && (
            <div className="flex items-center space-x-3">
              <input
                type="text"
                placeholder="Execution name (optional)"
                value={executionName}
                onChange={(e) => setExecutionName(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <button
                onClick={handleRunTests}
                disabled={runningTests || selectedTestCases.length === 0}
                className="inline-flex items-center px-4 py-2 border border-green-300 text-sm font-medium rounded-md shadow-sm text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                {runningTests ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
                ) : (
                  <PlayCircle className="h-4 w-4 mr-2" />
                )}
                {runningTests ? 'Running...' : 'Run Selected Tests'}
              </button>
              <button
                onClick={() => setShowExecutionHistory(!showExecutionHistory)}
                className="inline-flex items-center px-4 py-2 border border-blue-300 text-sm font-medium rounded-md shadow-sm text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <Clock className="h-4 w-4 mr-2" />
                Execution History ({executionHistory.length})
              </button>
            </div>
          )}
          
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

      {/* Crawler Progress */}
      {crawlerProgress && (testRun?.status === 'running' || testRun?.status === 'paused' || crawlerProgress.phase !== 'completed') && (
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                {crawlerProgress.phase === 'crawling' && <Activity className="h-5 w-5 text-blue-500 mr-2 animate-spin" />}
                {crawlerProgress.phase === 'paused' && <Pause className="h-5 w-5 text-yellow-500 mr-2" />}
                {crawlerProgress.phase === 'generating' && <FileText className="h-5 w-5 text-purple-500 mr-2" />}
                {crawlerProgress.phase === 'executing' && <PlayCircle className="h-5 w-5 text-green-500 mr-2" />}
                <h3 className="text-lg font-medium text-gray-900">
                  {crawlerProgress.phase === 'crawling' && 'Crawling in Progress'}
                  {crawlerProgress.phase === 'paused' && 'Crawling Paused'}
                  {crawlerProgress.phase === 'generating' && 'Generating Test Cases'}
                  {crawlerProgress.phase === 'executing' && 'Executing Tests'}
                  {crawlerProgress.phase === 'completed' && 'Process Completed'}
                </h3>
              </div>
              <div className="text-sm text-gray-500">
                {crawlerProgress.discoveredPagesCount || testRun.total_pages_discovered || 0} pages discovered
              </div>
            </div>
            
            <div className="mb-2">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>{crawlerProgress.message}</span>
                <span>{Math.round(crawlerProgress.percentage)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    crawlerProgress.phase === 'crawling' ? 'bg-blue-600' :
                    crawlerProgress.phase === 'paused' ? 'bg-yellow-600' :
                    crawlerProgress.phase === 'generating' ? 'bg-purple-600' :
                    crawlerProgress.phase === 'executing' ? 'bg-green-600' :
                    'bg-gray-600'
                  }`}
                  style={{ width: `${crawlerProgress.percentage}%` }}
                ></div>
              </div>
            </div>
            
            {crawlerProgress.phase === 'crawling' && (
              <p className="text-sm text-gray-500 mt-2">
                💡 Pause to review progress or Stop to finish. Test cases are generated automatically for each page.
              </p>
            )}

            {crawlerProgress.phase === 'paused' && (
              <p className="text-sm text-gray-500 mt-2">
                ⏸️ Crawling is paused. Click Resume to continue discovering pages or Stop to finish and run tests.
              </p>
            )}
            
            {crawlerProgress.phase === 'generating' && (
              <p className="text-sm text-gray-500 mt-2">
                🧠 AI is analyzing discovered pages and generating comprehensive test cases...
              </p>
            )}
            
            {crawlerProgress.phase === 'executing' && (
              <p className="text-sm text-gray-500 mt-2">
                ⚡ Running generated test cases across multiple browsers...
              </p>
            )}
          </div>
        </div>
      )}
      {/* Execution History */}
      {showExecutionHistory && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Execution History</h3>
            <button
              onClick={() => setShowExecutionHistory(false)}
              className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Test Selection
            </button>
          </div>
          <div className="card-body">
            {executionHistory.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No executions yet</p>
            ) : (
              <div className="space-y-4">
                {executionHistory.map((execution) => {
                  const isExpanded = expandedExecutions.has(execution.id);
                  const details = executionDetails.get(execution.id);

                  return (
                    <div key={execution.id} className="border rounded-lg">
                      <div
                        className="p-4 cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleExecutionExpand(execution.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <button className="text-gray-500">
                              {isExpanded ? '▼' : '▶'}
                            </button>
                            <div>
                              <h4 className="font-medium text-gray-900">{execution.execution_name}</h4>
                              <p className="text-sm text-gray-500">
                                {new Date(execution.start_time).toLocaleString()}
                                {execution.end_time && (
                                  <span> - {new Date(execution.end_time).toLocaleString()}</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4">
                            <div className="text-sm">
                              <span className="text-green-600">{execution.passed_tests} passed</span>
                              <span className="text-red-600 ml-2">{execution.failed_tests} failed</span>
                              {execution.flaky_tests > 0 && (
                                <span className="text-yellow-600 ml-2">{execution.flaky_tests} flaky</span>
                              )}
                            </div>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              execution.status === 'completed' ? 'bg-green-100 text-green-800' :
                              execution.status === 'failed' ? 'bg-red-100 text-red-800' :
                              execution.status === 'running' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {execution.status}
                            </span>
                          </div>
                        </div>
                      </div>

                      {isExpanded && details && (
                        <div className="border-t p-4 bg-gray-50 space-y-3">
                          <h5 className="font-medium text-gray-900 mb-3">Test Case Results:</h5>
                          {details.testCaseResults && details.testCaseResults.map((testResult: any, idx: number) => (
                            <div key={idx} className="bg-white rounded-lg p-4 border">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2">
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                      testResult.status === 'passed' ? 'bg-green-100 text-green-800' :
                                      testResult.status === 'failed' ? 'bg-red-100 text-red-800' :
                                      testResult.status === 'flaky' ? 'bg-yellow-100 text-yellow-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                      {testResult.status}
                                    </span>
                                    <span className="font-medium text-gray-900">{testResult.test_name}</span>
                                  </div>
                                  <p className="text-sm text-gray-600 mt-1">{testResult.test_description}</p>
                                </div>
                                <div className="text-sm text-gray-500">
                                  {formatDuration(testResult.execution_time)}
                                </div>
                              </div>

                              {testResult.test_steps && testResult.test_steps.length > 0 && (
                                <div className="mt-3 p-3 bg-gray-50 rounded">
                                  <p className="text-sm font-medium text-gray-700 mb-2">Test Steps:</p>
                                  <TestStepResults testCaseId={testResult.test_case_id} testSteps={testResult.test_steps} />
                                </div>
                              )}

                              {testResult.expected_result && (
                                <div className="mt-2 p-2 bg-blue-50 rounded text-sm">
                                  <strong className="text-blue-900">Expected Result:</strong>
                                  <p className="text-blue-800 mt-1">{testResult.expected_result}</p>
                                </div>
                              )}

                              {testResult.actual_result && (
                                <div className={`mt-2 p-2 rounded text-sm ${
                                  testResult.status === 'failed' ? 'bg-red-50' : 'bg-green-50'
                                }`}>
                                  <strong className={testResult.status === 'failed' ? 'text-red-900' : 'text-green-900'}>
                                    Actual Result:
                                  </strong>
                                  <p className={`mt-1 ${testResult.status === 'failed' ? 'text-red-800' : 'text-green-800'}`}>
                                    {testResult.actual_result}
                                  </p>
                                </div>
                              )}

                              {testResult.error_details && (
                                <div className="mt-2 p-2 bg-red-50 rounded text-sm text-red-800">
                                  <strong>Error:</strong> {testResult.error_details}
                                </div>
                              )}

                              {testResult.screenshots && testResult.screenshots.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-sm font-medium text-gray-700 mb-2">Screenshots ({testResult.screenshots.length}):</p>
                                  <div className="grid grid-cols-3 gap-2">
                                    {testResult.screenshots.map((screenshot: any, sIdx: number) => (
                                      <div key={sIdx} className="border rounded p-2">
                                        <img
                                          src={`data:image/png;base64,${screenshot.data}`}
                                          alt={screenshot.description}
                                          className="w-full h-32 object-cover rounded mb-1"
                                        />
                                        <p className="text-xs text-gray-600 truncate">{screenshot.description}</p>
                                        <p className="text-xs text-gray-400">{screenshot.action || screenshot.step}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!showExecutionHistory && (
        <div className="space-y-6">
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
                          {page.id ? (
                            <ScreenshotImage 
                              pageId={page.id}
                              alt={`Screenshot of ${page.title || page.url}`}
                            />
                          ) : (
                            <div className="w-32 h-24 bg-gray-100 rounded border flex items-center justify-center shadow-sm">
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
                  <div className="mb-6">
                    <span className="text-sm font-medium text-gray-700 block mb-2">Filter by type:</span>
                    <div className="flex flex-wrap gap-2">
                      <button 
                        onClick={() => setTestTypeFilter('all')}
                        className={`px-3 py-1 text-xs rounded-full ${
                          testTypeFilter === 'all' 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                        }`}
                      >
                        All Tests ({testTypeCounts.all || 0})
                      </button>
                      {testTypeCounts.functional > 0 && (
                        <button 
                          onClick={() => setTestTypeFilter('functional')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'functional' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-800'
                          }`}
                        >
                          Functional ({testTypeCounts.functional})
                        </button>
                      )}
                      {testTypeCounts.accessibility > 0 && (
                        <button 
                          onClick={() => setTestTypeFilter('accessibility')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'accessibility' 
                              ? 'bg-purple-100 text-purple-800' 
                              : 'bg-gray-100 text-gray-600 hover:bg-purple-100 hover:text-purple-800'
                          }`}
                        >
                          Accessibility ({testTypeCounts.accessibility})
                        </button>
                      )}
                      {testTypeCounts.performance > 0 && (
                        <button 
                          onClick={() => setTestTypeFilter('performance')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'performance' 
                              ? 'bg-orange-100 text-orange-800' 
                              : 'bg-gray-100 text-gray-600 hover:bg-orange-100 hover:text-orange-800'
                          }`}
                        >
                          Performance ({testTypeCounts.performance})
                        </button>
                      )}
                      {testTypeCounts.validation > 0 && (
                        <button
                          onClick={() => setTestTypeFilter('validation')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'validation'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-600 hover:bg-yellow-100 hover:text-yellow-800'
                          }`}
                        >
                          Validation ({testTypeCounts.validation})
                        </button>
                      )}
                      {testTypeCounts.security > 0 && (
                        <button
                          onClick={() => setTestTypeFilter('security')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'security'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-800'
                          }`}
                        >
                          Security ({testTypeCounts.security})
                        </button>
                      )}
                      {testTypeCounts.flow > 0 && (
                        <button
                          onClick={() => setTestTypeFilter('flow')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'flow'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-800'
                          }`}
                        >
                          Flow ({testTypeCounts.flow})
                        </button>
                      )}
                      {(testTypeCounts['page-load'] || 0) > 0 && (
                        <button
                          onClick={() => setTestTypeFilter('page-load')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'page-load'
                              ? 'bg-cyan-100 text-cyan-800'
                              : 'bg-gray-100 text-gray-600 hover:bg-cyan-100 hover:text-cyan-800'
                          }`}
                        >
                          Page Load ({testTypeCounts['page-load']})
                        </button>
                      )}
                      {(testTypeCounts['visual-regression'] || 0) > 0 && (
                        <button
                          onClick={() => setTestTypeFilter('visual-regression')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'visual-regression'
                              ? 'bg-pink-100 text-pink-800'
                              : 'bg-gray-100 text-gray-600 hover:bg-pink-100 hover:text-pink-800'
                          }`}
                        >
                          Visual ({testTypeCounts['visual-regression']})
                        </button>
                      )}
                      {(testTypeCounts['element-interaction'] || 0) > 0 && (
                        <button
                          onClick={() => setTestTypeFilter('element-interaction')}
                          className={`px-3 py-1 text-xs rounded-full ${
                            testTypeFilter === 'element-interaction'
                              ? 'bg-teal-100 text-teal-800'
                              : 'bg-gray-100 text-gray-600 hover:bg-teal-100 hover:text-teal-800'
                          }`}
                        >
                          Element ({testTypeCounts['element-interaction']})
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Test Selection Controls */}
                  {(testRun.status === 'completed' || testRun.status === 'ready_for_execution' || testRun.status === 'executing') && (
                    <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                        <div className="flex items-center space-x-4">
                          <span className="text-sm font-medium text-blue-900">
                            {selectedTestCases.length} of {filteredTestCases.length} tests selected
                            {testTypeFilter !== 'all' && (
                              <span className="text-xs text-blue-700 ml-1">
                                (filtered from {testRun.testCases.length} total)
                              </span>
                            )}
                          </span>
                          <button
                            onClick={() => setSelectedTestCases(filteredTestCases.map(tc => tc.id))}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Select All {testTypeFilter !== 'all' ? `(${testTypeFilter})` : ''}
                          </button>
                          <button
                            onClick={() => setSelectedTestCases([])}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Clear All
                          </button>
                        </div>
                        <div className="flex items-center space-x-3">
                          {showPageGrouping && groupedTestCases && (
                            <>
                              <button
                                onClick={() => {
                                  const allPages = Object.keys(groupedTestCases);
                                  setExpandedPages(new Set(allPages));
                                }}
                                className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                              >
                                Expand All
                              </button>
                              <button
                                onClick={() => setExpandedPages(new Set())}
                                className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                              >
                                Collapse All
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setShowPageGrouping(!showPageGrouping)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {showPageGrouping ? 'List View' : 'Group by Page'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Page Grouped View */}
                  {showPageGrouping && groupedTestCases && Object.keys(groupedTestCases).length > 0 ? (
                    Object.entries(groupedTestCases).map(([pageKey, pageData]) => {
                      const isExpanded = expandedPages.has(pageKey);
                      const isFullySelected = isPageFullySelected(pageKey);
                      const isPartiallySelected = isPagePartiallySelected(pageKey);

                      return (
                        <div key={pageKey} className="mb-4 border rounded-lg overflow-hidden">
                          {/* Page Header */}
                          <div className="bg-gray-100 border-b">
                            <div className="flex items-center justify-between p-4">
                              <div className="flex items-center space-x-3 flex-1">
                                <button
                                  onClick={() => togglePageExpand(pageKey)}
                                  className="text-gray-600 hover:text-gray-900"
                                >
                                  {isExpanded ? '▼' : '▶'}
                                </button>
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2">
                                    <Globe className="h-4 w-4 text-gray-500" />
                                    <span className="font-medium text-gray-900">
                                      {pageData.pageName}
                                    </span>
                                  </div>
                                  <div className="text-xs text-gray-600 mt-1">{pageData.pageUrl}</div>
                                </div>
                                <span className="text-sm text-gray-600">
                                  {pageData.tests.length} test{pageData.tests.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                              {(testRun.status === 'completed' || testRun.status === 'ready_for_execution' || testRun.status === 'executing') && (
                                <div className="flex items-center space-x-2 ml-4">
                                  <input
                                    type="checkbox"
                                    checked={isFullySelected}
                                    ref={(el) => {
                                      if (el) el.indeterminate = isPartiallySelected && !isFullySelected;
                                    }}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        selectAllInPage(pageKey);
                                      } else {
                                        deselectAllInPage(pageKey);
                                      }
                                    }}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                  />
                                  <button
                                    onClick={() => {
                                      if (isFullySelected) {
                                        deselectAllInPage(pageKey);
                                      } else {
                                        selectAllInPage(pageKey);
                                      }
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                  >
                                    {isFullySelected ? 'Deselect All' : 'Select All'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Page Tests */}
                          {isExpanded && (
                            <div className="p-2 space-y-2 bg-white">
                              {pageData.tests.map((testCase, index) => (
                                <div key={testCase.id} className={`border-l-4 border rounded-lg p-4 ${
                                  testCase.status === 'passed' ? 'border-green-200 bg-green-50' :
                                  testCase.status === 'failed' ? 'border-red-200 bg-red-50' :
                                  'border-yellow-200 bg-yellow-50'
                                }`}>
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      {/* Test Selection Checkbox */}
                                      {(testRun.status === 'completed' || testRun.status === 'ready_for_execution' || testRun.status === 'executing') && (
                                        <div className="flex items-center mb-2">
                                          <input
                                            type="checkbox"
                                            id={`test-${testCase.id}`}
                                            checked={selectedTestCases.includes(testCase.id)}
                                            onChange={(e) => handleTestCaseSelection(testCase.id, e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                          />
                                          <label htmlFor={`test-${testCase.id}`} className="ml-2 text-sm text-gray-700">
                                            Select for execution
                                          </label>
                                        </div>
                                      )}

                                      {/* Test Type Badge */}
                                      <div className="flex items-center space-x-2 mb-2">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                          testCase.test_type === 'functional' ? 'bg-green-100 text-green-800' :
                                          testCase.test_type === 'accessibility' ? 'bg-purple-100 text-purple-800' :
                                          testCase.test_type === 'performance' ? 'bg-orange-100 text-orange-800' :
                                          testCase.test_type === 'flow' ? 'bg-blue-100 text-blue-800' :
                                          'bg-gray-100 text-gray-800'
                                        }`}>
                                          {testCase.test_type === 'functional' && <CheckCircle className="h-3 w-3 mr-1" />}
                                          {testCase.test_type === 'accessibility' && <Shield className="h-3 w-3 mr-1" />}
                                          {testCase.test_type === 'performance' && <Zap className="h-3 w-3 mr-1" />}
                                          {testCase.test_type === 'flow' && <Activity className="h-3 w-3 mr-1" />}
                                          {testCase.test_type?.charAt(0).toUpperCase() + testCase.test_type?.slice(1) || 'Unknown'}
                                        </span>
                                      </div>

                                      <h4 className="font-medium text-gray-900 mb-1">{testCase.test_name}</h4>
                                      <p className="text-sm text-gray-600 mb-3">{testCase.test_description}</p>

                                      {/* Test Steps with Results */}
                                      <TestStepResults testCaseId={testCase.id} testSteps={testCase.test_steps} />
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
                      );
                    })
                  ) : (
                    /* List View */
                    filteredTestCases.map((testCase, index) => (
                    <div key={index} className={`border-l-4 border rounded-lg p-4 ${
                      testCase.status === 'passed' ? 'border-green-200 bg-green-50' :
                      testCase.status === 'failed' ? 'border-red-200 bg-red-50' :
                      'border-yellow-200 bg-yellow-50'
                    }`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Test Selection Checkbox */}
                          {(testRun.status === 'completed' || testRun.status === 'ready_for_execution' || testRun.status === 'executing') && (
                            <div className="flex items-center mb-2">
                              <input
                                type="checkbox"
                                id={`test-${testCase.id}`}
                                checked={selectedTestCases.includes(testCase.id)}
                                onChange={(e) => handleTestCaseSelection(testCase.id, e.target.checked)}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              />
                              <label htmlFor={`test-${testCase.id}`} className="ml-2 text-sm text-gray-700">
                                Select for execution
                              </label>
                            </div>
                          )}
                          
                          {/* Test Type Badge */}
                          <div className="flex items-center space-x-2 mb-2">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              testCase.test_type === 'functional' ? 'bg-green-100 text-green-800' :
                              testCase.test_type === 'accessibility' ? 'bg-purple-100 text-purple-800' :
                              testCase.test_type === 'performance' ? 'bg-orange-100 text-orange-800' :
                              testCase.test_type === 'flow' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {testCase.test_type === 'functional' && <CheckCircle className="h-3 w-3 mr-1" />}
                              {testCase.test_type === 'accessibility' && <Shield className="h-3 w-3 mr-1" />}
                              {testCase.test_type === 'performance' && <Zap className="h-3 w-3 mr-1" />}
                              {testCase.test_type === 'flow' && <Activity className="h-3 w-3 mr-1" />}
                              {testCase.test_type?.charAt(0).toUpperCase() + testCase.test_type?.slice(1) || 'Unknown'}
                            </span>
                          </div>
                          
                          <h4 className="font-medium text-gray-900 mb-1">{testCase.test_name}</h4>
                          <p className="text-sm text-gray-600 mb-3">{testCase.test_description}</p>
                          
                          {/* Test Steps with Results */}
                          <TestStepResults testCaseId={testCase.id} testSteps={testCase.test_steps} />
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
                  ))
                  )}

                  {/* No tests message when filtered */}
                  {filteredTestCases.length === 0 && testRun.testCases.length > 0 && (
                    <div className="text-center py-8">
                      <FileText className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">
                        No {testTypeFilter} tests found
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Try selecting a different test type filter.
                      </p>
                      <button
                        onClick={() => setTestTypeFilter('all')}
                        className="mt-3 text-sm text-blue-600 hover:text-blue-800"
                      >
                        Show all tests
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}