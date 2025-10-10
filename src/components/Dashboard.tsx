import React, { useState, useEffect } from 'react';
import { testAPI } from '../services/api';
import { 
  BarChart3, 
  Activity, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  TrendingUp,
  Clock,
  Globe
} from 'lucide-react';

interface DashboardStats {
  total_runs: number;
  active_runs: number;
  completed_runs: number;
  failed_runs: number;
  avg_coverage: number;
  total_test_cases: number;
  total_passed: number;
  total_failed: number;
  total_flaky: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      const response = await testAPI.getDashboardStats();
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card">
                <div className="card-body">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: 'Total Test Runs',
      value: stats?.total_runs || 0,
      icon: BarChart3,
      color: 'blue',
      change: '+12%',
    },
    {
      title: 'Active Runs',
      value: stats?.active_runs || 0,
      icon: Activity,
      color: 'green',
      change: null,
    },
    {
      title: 'Average Coverage',
      value: `${Math.round(stats?.avg_coverage || 0)}%`,
      icon: TrendingUp,
      color: 'purple',
      change: '+5%',
    },
    {
      title: 'Total Test Cases',
      value: stats?.total_test_cases || 0,
      icon: Globe,
      color: 'indigo',
      change: '+23%',
    },
  ];

  const testResultsData = [
    {
      title: 'Passed Tests',
      value: stats?.total_passed || 0,
      icon: CheckCircle,
      color: 'green',
      percentage: stats?.total_test_cases ? 
        Math.round(((stats?.total_passed || 0) / stats.total_test_cases) * 100) : 0,
    },
    {
      title: 'Failed Tests',
      value: stats?.total_failed || 0,
      icon: XCircle,
      color: 'red',
      percentage: stats?.total_test_cases ? 
        Math.round(((stats?.total_failed || 0) / stats.total_test_cases) * 100) : 0,
    },
    {
      title: 'Flaky Tests',
      value: stats?.total_flaky || 0,
      icon: AlertTriangle,
      color: 'yellow',
      percentage: stats?.total_test_cases ? 
        Math.round(((stats?.total_flaky || 0) / stats.total_test_cases) * 100) : 0,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center text-sm text-gray-500">
          <Clock className="h-4 w-4 mr-1" />
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => (
          <div key={index} className="card">
            <div className="card-body">
              <div className="flex items-center">
                <div className={`p-2 rounded-md bg-${stat.color}-100`}>
                  <stat.icon className={`h-6 w-6 text-${stat.color}-600`} />
                </div>
                <div className="ml-4 flex-1">
                  <p className="text-sm font-medium text-gray-500">{stat.title}</p>
                  <div className="flex items-baseline">
                    <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
                    {stat.change && (
                      <p className="ml-2 text-sm font-medium text-green-600">{stat.change}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Test Results Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900">Test Results Overview</h3>
          </div>
          <div className="card-body">
            <div className="space-y-4">
              {testResultsData.map((result, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <result.icon className={`h-5 w-5 text-${result.color}-500 mr-3`} />
                    <span className="text-sm font-medium text-gray-900">{result.title}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-sm font-semibold text-gray-900 mr-2">{result.value}</span>
                    <span className="text-xs text-gray-500">({result.percentage}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900">Recent Activity</h3>
          </div>
          <div className="card-body">
            <div className="space-y-4">
              <div className="flex items-center">
                <div className="h-2 w-2 bg-green-400 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm text-gray-900">Test run completed successfully</p>
                  <p className="text-xs text-gray-500">2 minutes ago</p>
                </div>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-blue-400 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm text-gray-900">New test configuration created</p>
                  <p className="text-xs text-gray-500">15 minutes ago</p>
                </div>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-yellow-400 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm text-gray-900">Flaky test detected and self-healed</p>
                  <p className="text-xs text-gray-500">1 hour ago</p>
                </div>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-red-400 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm text-gray-900">Test run failed - investigating</p>
                  <p className="text-xs text-gray-500">2 hours ago</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-medium text-gray-900">Quick Actions</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button className="btn-primary">
              <Play className="h-4 w-4 mr-2" />
              Start New Test Run
            </button>
            <button className="btn-secondary">
              <FileText className="h-4 w-4 mr-2" />
              Create Configuration
            </button>
            <button className="btn-secondary">
              <BarChart3 className="h-4 w-4 mr-2" />
              View Reports
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}