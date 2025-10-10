import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { testAPI } from '../services/api';
import { Play, Clock, CheckCircle, XCircle, AlertTriangle, Eye } from 'lucide-react';

interface TestRun {
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
}

export default function TestRuns() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTestRuns();
  }, []);

  const fetchTestRuns = async () => {
    try {
      const response = await testAPI.getRuns();
      setRuns(response.data);
    } catch (error) {
      console.error('Error fetching test runs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'cancelled':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const baseClasses = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";
    switch (status) {
      case 'running':
        return `${baseClasses} bg-blue-100 text-blue-800`;
      case 'completed':
        return `${baseClasses} bg-green-100 text-green-800`;
      case 'failed':
        return `${baseClasses} bg-red-100 text-red-800`;
      case 'cancelled':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
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
        <h1 className="text-2xl font-bold text-gray-900">Test Runs</h1>
        <Link to="/configurations" className="btn-primary">
          <Play className="h-4 w-4 mr-2" />
          Start New Run
        </Link>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Configuration</th>
                <th>Status</th>
                <th>Target URL</th>
                <th>Progress</th>
                <th>Results</th>
                <th>Coverage</th>
                <th>Duration</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <div className="font-medium text-gray-900">{run.config_name}</div>
                    <div className="text-sm text-gray-500">Run #{run.id}</div>
                  </td>
                  <td>
                    <div className="flex items-center">
                      {getStatusIcon(run.status)}
                      <span className={`ml-2 ${getStatusBadge(run.status)}`}>
                        {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="text-sm text-gray-900 max-w-xs truncate">
                      {run.target_url}
                    </div>
                  </td>
                  <td>
                    <div className="text-sm text-gray-900">
                      {run.total_pages_discovered} pages
                    </div>
                    <div className="text-sm text-gray-500">
                      {run.total_test_cases} test cases
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center space-x-2 text-sm">
                      <span className="text-green-600">{run.passed_tests} passed</span>
                      <span className="text-red-600">{run.failed_tests} failed</span>
                      {run.flaky_tests > 0 && (
                        <span className="text-yellow-600">{run.flaky_tests} flaky</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center">
                      <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${Math.min(run.coverage_percentage, 100)}%` }}
                        ></div>
                      </div>
                      <span className="text-sm text-gray-900">
                        {Math.round(run.coverage_percentage)}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="text-sm text-gray-900">
                      {run.end_time ? (
                        `${Math.round(
                          (new Date(run.end_time).getTime() - new Date(run.start_time).getTime()) / 60000
                        )}m`
                      ) : (
                        'Running...'
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(run.start_time).toLocaleDateString()}
                    </div>
                  </td>
                  <td>
                    <Link
                      to={`/test-runs/${run.id}`}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {runs.length === 0 && (
        <div className="text-center py-12">
          <Play className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No test runs</h3>
          <p className="mt-1 text-sm text-gray-500">
            Start your first test run by creating a configuration.
          </p>
          <div className="mt-6">
            <Link to="/configurations" className="btn-primary">
              <Play className="h-4 w-4 mr-2" />
              Create Configuration
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}