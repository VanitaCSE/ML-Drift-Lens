import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Dashboard,
  DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS,
  formatNumber,
  formatPercent,
  formatTimestamp,
  getDashboardRefreshIntervalMs,
} from './Dashboard';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getMetrics: vi.fn(),
    getDriftHistory: vi.fn(),
    getAlerts: vi.fn(),
    getModels: vi.fn(),
    getRetrainingJobs: vi.fn(),
    getPredictionHistory: vi.fn(),
    getBenchmarkData: vi.fn(),
    getDemoScenario: vi.fn(),
    labelPrediction: vi.fn(),
  },
}));

const mockedApiClient = vi.mocked(apiClient);

function resolveEmptyDashboard() {
  mockedApiClient.getMetrics.mockResolvedValue({
    total_prediction_count: 0,
    labeled_prediction_count: 0,
    accuracy: null,
    precision: null,
    recall: null,
    f1: null,
    metrics_status: 'insufficient_data',
    model_id: null,
    model_version: null,
    latest_prediction_timestamp: null,
  });
  mockedApiClient.getDriftHistory.mockResolvedValue([]);
  mockedApiClient.getAlerts.mockResolvedValue([]);
  mockedApiClient.getModels.mockResolvedValue([]);
  mockedApiClient.getRetrainingJobs.mockResolvedValue([]);
  mockedApiClient.getPredictionHistory.mockResolvedValue([]);
  mockedApiClient.getBenchmarkData.mockResolvedValue({
    benchmark_name: 'NSL-KDD Canonical Benchmark',
    dataset_source: 'CIC / UNB',
    dataset_url: 'https://www.unb.ca/cic/datasets/nsl.html',
    citation: 'Tavallaee et al. 2009',
    model_id: 'nsl-kdd-baseline',
    model_version: 'nsl-kdd-validation-20260928',
    model_type: 'xgboost',
    feature_count: 41,
    mlflow_run_id: 'e4b98d8c7484478a987bd5ce2cf35f56',
    training_timestamp: '2026-09-28T12:48:06.164429+00:00',
    test_holdout: {
      dataset_file: 'KDDTest+.txt',
      sha256: 'fa46b0935342616aa83b7c2578db355b6a7aaabbc492248172c7a1e8b7ab8f84',
      total_samples: 22544,
      class_distribution: { normal: 9711, attack: 12833, normal_pct: 43.08, attack_pct: 56.92 },
      metrics: { accuracy: 0.7953, precision: 0.9684, recall: 0.6620, f1: 0.7864, roc_auc: 0.9658 },
      confusion_matrix: { true_negatives: 9434, false_positives: 277, false_negatives: 4337, true_positives: 8496 },
      evaluation_notes: 'Evaluated on canonical KDDTest+ holdout',
    },
    validation_split: {
      dataset_file: 'KDDTrain+.txt',
      sha256: '1b86d2f957b33082081bba410fe129b475efebcc13c9014c3f447c8271aadf95',
      total_samples: 25195,
      class_distribution: { normal: 13469, attack: 11726, normal_pct: 53.46, attack_pct: 46.54 },
      metrics: { accuracy: 0.9990, precision: 0.9991, recall: 0.9988, f1: 0.9990 },
      confusion_matrix: { true_negatives: 13459, false_positives: 10, false_negatives: 14, true_positives: 11712 },
      evaluation_notes: 'Stratified validation split',
    },
    drift_baseline: {
      metric: 'Population Stability Index (PSI)',
      threshold: 0.20,
      warning_threshold: 0.10,
      minimum_samples: 100,
      reference_dataset: 'KDDTrain+.txt',
      reference_sample_count: 125973,
      monitored_features: ['duration', 'src_bytes'],
    },
  });
  mockedApiClient.getDemoScenario.mockResolvedValue({
    is_simulation: true,
    data_source: 'demo_simulation',
    scenario_name: 'NSL-KDD Feature Drift',
    description: 'Simulated drift scenario',
    notice: 'DEMONSTRATION DATA ONLY',
    metrics: {
      total_prediction_count: 2450,
      labeled_prediction_count: 500,
      accuracy: 0.7953,
      precision: 0.9684,
      recall: 0.6620,
      f1: 0.7864,
      metrics_status: 'available',
      model_id: 'nsl-kdd-baseline',
      model_version: 'nsl-kdd-validation-20260928',
      latest_prediction_timestamp: '2026-10-26T12:00:00Z',
    },
    drift_history: [
      { id: 101, timestamp: '2026-10-26T11:00:00Z', score: 0.04, threshold: 0.20, status: 'normal', metric_type: 'PSI', model_id: 'nsl-kdd-baseline' },
      { id: 102, timestamp: '2026-10-26T11:30:00Z', score: 0.25, threshold: 0.20, status: 'significant_drift', metric_type: 'PSI', model_id: 'nsl-kdd-baseline' },
    ],
    alerts: [
      { id: 201, model_id: 'nsl-kdd-baseline', message: 'Simulated drift alert', status: 'resolved', timestamp: '2026-10-26T11:30:00Z', drift_score_id: 102 },
    ],
    retraining_jobs: [
      {
        id: 301,
        model_id: 'nsl-kdd-baseline',
        old_model_version: '0.1.0',
        new_model_version: '0.2.0',
        triggered_by: 'system',
        status: 'deployed',
        promoted: true,
        candidate_f1: 0.8124,
        incumbent_f1: 0.7864,
        reload_status: 'success',
        start_time: '2026-10-26T11:35:00Z',
        end_time: '2026-10-26T11:45:00Z',
      },
    ],
    latency_distribution: { min_ms: 2.1, median_ms: 4.3, p95_ms: 7.8, p99_ms: 12.4, max_ms: 18.2 },
    class_distribution: { total: 2450, normal_count: 1380, normal_pct: 56.3, attack_count: 1070, attack_pct: 43.7 },
  });
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEmptyDashboard();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the default interval and validates configured intervals', () => {
    expect(getDashboardRefreshIntervalMs()).toBe(DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS);
    expect(getDashboardRefreshIntervalMs('45000')).toBe(45000);
    expect(getDashboardRefreshIntervalMs('not-a-number')).toBe(DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS);
    expect(getDashboardRefreshIntervalMs('4999')).toBe(DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS);
    expect(getDashboardRefreshIntervalMs('-1')).toBe(DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS);
  });

  it('shows loading state before read APIs settle', () => {
    mockedApiClient.getMetrics.mockReturnValue(new Promise(() => undefined));
    render(<Dashboard />);
    expect(screen.getByText('Loading monitoring metrics...')).toBeTruthy();
  });

  it('shows empty states when read APIs return no records', async () => {
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('No alerts available')).toBeTruthy());
    expect(screen.getByText('No drift history available')).toBeTruthy();
    expect(screen.getByText('No model versions available')).toBeTruthy();
    expect(screen.getByText('No retraining jobs available')).toBeTruthy();
    expect(screen.getByText('No predictions available')).toBeTruthy();
  });

  it('formats metrics, timestamps, and invalid values safely', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatPercent(0.875)).toBe('87.5%');
    expect(formatNumber('invalid')).toBe('N/A');
    expect(formatPercent(Number.NaN)).toBe('N/A');
    expect(formatTimestamp('invalid timestamp')).toBe('N/A');
  });

  it('presents live metric, drift, alert, model, retraining, and safe prediction fields', async () => {
    mockedApiClient.getMetrics.mockResolvedValue({
      total_prediction_count: 1234,
      labeled_prediction_count: 1200,
      accuracy: 0.91,
      precision: 0.88,
      recall: 0.84,
      f1: 0.86,
      metrics_status: 'available',
      model_id: 'detector',
      model_version: '2.0.0',
      latest_prediction_timestamp: '2026-09-07T00:00:00Z',
    });
    mockedApiClient.getDriftHistory.mockResolvedValue([{
      id: 1, model_id: 'detector', metric_type: 'PSI', score: 0.4, threshold: 0.2, status: 'drift', timestamp: '2026-09-07T00:00:00Z',
    }]);
    mockedApiClient.getAlerts.mockResolvedValue([{
      id: 1, model_id: 'detector', message: 'Drift detected', status: 'open', timestamp: '2026-09-07T00:00:00Z', drift_score_id: 1,
    }]);
    mockedApiClient.getModels.mockResolvedValue([{
      id: 1, model_id: 'detector', model_version: '2.0.0', mlflow_run_id: null, timestamp: '2026-09-07T00:00:00Z', accuracy: 0.91, precision: 0.88, recall: 0.84, f1: 0.86, is_active: true,
    }]);
    mockedApiClient.getRetrainingJobs.mockResolvedValue([{
      id: 7, model_id: 'detector', triggered_by: 'auto', start_time: '2026-09-07T00:00:00Z', end_time: null, old_model_version: '1.0.0', new_model_version: '2.0.0', promoted: true, reload_status: null,
    }]);
    mockedApiClient.getPredictionHistory.mockResolvedValue([{
      id: 9, model_id: 'detector', model_version: '2.0.0', preprocessing_version: 'v1', input_features: '{secret}', prediction: 'attack', prediction_class: 1, confidence: 0.975, request_id: 'request-1', timestamp: '2026-09-07T00:00:00Z', actual_label: undefined,
    }]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('1,234')).toBeTruthy());
    expect(screen.getAllByText('91.0%').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Drift detected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Active model')).toBeTruthy();
    expect(screen.getByText('Promoted')).toBeTruthy();
    expect(screen.getByText('Auto')).toBeTruthy();
    expect(screen.getByText('request-1')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('97.5%')).toBeTruthy();
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    expect(screen.queryByText('{secret}')).toBeNull();
  });

  it('keeps manual refresh available and updates the success timestamp', async () => {
    let resolveMetrics: ((value: Awaited<ReturnType<typeof apiClient.getMetrics>>) => void) | undefined;
    mockedApiClient.getMetrics.mockImplementationOnce(() => new Promise((resolve) => { resolveMetrics = resolve; }));
    render(<Dashboard />);
    await waitFor(() => expect(mockedApiClient.getMetrics).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Last successful refresh/).textContent).toContain('N/A');

    resolveMetrics?.({
      total_prediction_count: 0,
      labeled_prediction_count: 0,
      accuracy: null,
      precision: null,
      recall: null,
      f1: null,
      metrics_status: 'insufficient_data',
      model_id: null,
      model_version: null,
      latest_prediction_timestamp: null,
    });
    await waitFor(() => expect(screen.getByText(/Last successful refresh/).textContent).not.toContain('N/A'));
    await act(async () => {
      screen.getByRole('button', { name: 'Refresh dashboard' }).click();
    });
    await waitFor(() => expect(mockedApiClient.getMetrics).toHaveBeenCalledTimes(2));
  });

  it('automatically refreshes all read APIs at the configured default interval', async () => {
    vi.useFakeTimers();
    render(<Dashboard />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockedApiClient.getMetrics).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS);
    });
    expect(mockedApiClient.getMetrics).toHaveBeenCalledTimes(2);
    expect(mockedApiClient.getDriftHistory).toHaveBeenCalledTimes(2);
    expect(mockedApiClient.getAlerts).toHaveBeenCalledTimes(2);
    expect(mockedApiClient.getModels).toHaveBeenCalledTimes(2);
    expect(mockedApiClient.getRetrainingJobs).toHaveBeenCalledTimes(2);
    expect(mockedApiClient.getPredictionHistory).toHaveBeenCalledTimes(2);
  });

  it('prevents overlapping refreshes and clears the timer on unmount', async () => {
    vi.useFakeTimers();
    let resolveMetrics: ((value: Awaited<ReturnType<typeof apiClient.getMetrics>>) => void) | undefined;
    mockedApiClient.getMetrics.mockImplementation(() => new Promise((resolve) => { resolveMetrics = resolve; }));
    const { unmount } = render(<Dashboard />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS);
    });
    expect(mockedApiClient.getMetrics).toHaveBeenCalledTimes(1);

    resolveMetrics?.({
      total_prediction_count: 0,
      labeled_prediction_count: 0,
      accuracy: null,
      precision: null,
      recall: null,
      f1: null,
      metrics_status: 'insufficient_data',
      model_id: null,
      model_version: null,
      latest_prediction_timestamp: null,
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS * 2);
    });
    expect(mockedApiClient.getMetrics).toHaveBeenCalledTimes(1);
  });

  it('renders valid drift score and threshold history', async () => {
    mockedApiClient.getDriftHistory.mockResolvedValue([{
      id: 1,
      model_id: 'detector',
      metric_type: 'PSI',
      score: 0.3,
      threshold: 0.2,
      status: 'drift',
      timestamp: '2026-09-07T00:00:00Z',
    }]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByLabelText(/Drift history chart showing score and configured threshold/i)).toBeTruthy());
    expect(screen.getByText(/1 valid drift reading/)).toBeTruthy();
    expect(screen.getByText('0.3')).toBeTruthy();
    expect(screen.getByText('0.2')).toBeTruthy();
  });

  it('does not plot invalid drift records', async () => {
    mockedApiClient.getDriftHistory.mockResolvedValue([{
      id: 2,
      model_id: 'detector',
      metric_type: 'PSI',
      score: Number.NaN,
      threshold: 0.2,
      status: 'normal',
      timestamp: 'not-a-date',
    }]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('No valid drift records available')).toBeTruthy());
  });

  it('shows a retry action when drift history fails', async () => {
    mockedApiClient.getDriftHistory.mockRejectedValue(new Error('drift unavailable'));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Unable to load this section.')).toBeTruthy());
    expect(screen.getByText('drift unavailable')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });

  it('explains the binary prediction class mapping with legend and descriptive label', async () => {
    mockedApiClient.getPredictionHistory.mockResolvedValue([
      {
        id: 101,
        model_id: 'nsl-kdd-baseline',
        model_version: 'v1.0',
        preprocessing_version: 'v1',
        input_features: '{}',
        prediction: 'normal',
        prediction_class: 0,
        confidence: 0.99,
        request_id: 'req-normal',
        timestamp: '2026-10-25T12:00:00Z',
        actual_label: undefined,
      },
    ]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('req-normal')).toBeTruthy());
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('(normal)')).toBeTruthy();
    expect(screen.getByText(/Class mapping legend:/)).toBeTruthy();
  });

  it('keeps other sections available when one read API fails', async () => {
    mockedApiClient.getAlerts.mockRejectedValue(new Error('alerts unavailable'));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Unable to load this section.')).toBeTruthy());
    expect(screen.getByText('No model versions available')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('renders benchmark comparison card and allows toggling to demo mode', async () => {
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('NSL-KDD Canonical Test Benchmark')).toBeTruthy());
    expect(screen.getByText(/Evaluated on full/)).toBeTruthy();
    expect(screen.getByText('Live Evaluation Readiness')).toBeTruthy();

    // Toggle to Demo mode
    const demoButton = screen.getByRole('button', { name: /Benchmark & Simulation/ });
    act(() => {
      demoButton.click();
    });

    expect(screen.getByText(/Demonstration Environment Active/)).toBeTruthy();
    expect(screen.getByText(/Confusion Matrix/)).toBeTruthy();
    expect(screen.getByText('9,434')).toBeTruthy(); // True Negatives
    expect(screen.getByText('8,496')).toBeTruthy(); // True Positives
  });

  it('renders inference latency profile and traffic class balance', async () => {
    mockedApiClient.getPredictionHistory.mockResolvedValue([
      {
        id: 1,
        model_id: 'nsl-kdd-baseline',
        model_version: 'v1.0',
        preprocessing_version: 'v1',
        input_features: '{}',
        prediction: 'normal',
        prediction_class: 0,
        confidence: 0.99,
        inference_latency_ms: 4.2,
        request_id: 'req-1',
        timestamp: '2026-10-25T12:00:00Z',
      },
    ]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Inference Latency Distribution')).toBeTruthy());
    expect(screen.getByText('Predicted Traffic Class Balance')).toBeTruthy();
    expect(screen.getAllByText(/4.2 ms/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders clean metric section headings and separates demo telemetry from live inference', async () => {
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Operational Model Metrics')).toBeTruthy());
    expect(screen.getByText(/Live telemetry and ground-truth evaluation/)).toBeTruthy();

    // In live production mode, metric cards do not repeat redundant "Production" badges
    const metricSection = screen.getByLabelText('Model performance metrics');
    expect(metricSection.querySelectorAll('.metric-card-badge').length).toBe(0);

    // Switch to Demo mode
    const demoButton = screen.getByRole('button', { name: /Benchmark & Simulation/ });
    act(() => {
      demoButton.click();
    });

    expect(screen.getByText('Benchmark & Simulation Overview')).toBeTruthy();
    expect(screen.getByText(/Canonical NSL-KDD test holdout evaluation/)).toBeTruthy();
    expect(screen.getByText(/Synthetic Demonstration Inferences/)).toBeTruthy();
    expect(screen.getAllByText('sim-req-901').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('sim-req-904').length).toBeGreaterThanOrEqual(1);
  });
});
