import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ModelRegistry } from './ModelRegistry';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getModels: vi.fn(),
    getModelInfo: vi.fn(),
  },
}));

describe('ModelRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders active model metadata and registered versions correctly', async () => {
    vi.mocked(apiClient.getModelInfo).mockResolvedValue({
      model_id: 'nsl-kdd-baseline',
      model_version: 'candidate-20261009T061233Z-7e4ec984',
      model_type: 'xgboost',
      num_features: 41,
      dataset: 'NSL-KDD Upstream',
      training_timestamp: '2026-10-09T06:12:33Z',
      preprocessing_version: 'preprocessing-v1',
    });

    vi.mocked(apiClient.getModels).mockResolvedValue([
      {
        id: 1,
        model_id: 'nsl-kdd-baseline',
        model_version: 'candidate-20261009T061233Z-7e4ec984',
        mlflow_run_id: 'run-abc-123',
        timestamp: '2026-10-09T06:15:00Z',
        accuracy: 0.725,
        precision: 0.731,
        recall: 0.718,
        f1: 0.7143,
        is_active: true,
      },
      {
        id: 2,
        model_id: 'nsl-kdd-baseline',
        model_version: '0.1.0',
        mlflow_run_id: null,
        timestamp: '2026-09-01T00:00:00Z',
        accuracy: 0.65,
        precision: 0.60,
        recall: 0.55,
        f1: 0.0851,
        is_active: false,
      },
    ]);

    render(<ModelRegistry />);

    await waitFor(() => {
      expect(screen.getByText('Active & Serving')).toBeTruthy();
      expect(screen.getAllByText('candidate-20261009T061233Z-7e4ec984').length).toBeGreaterThan(0);
      expect(screen.getByText('Active Incumbent')).toBeTruthy();
      expect(screen.getByText('0.1.0')).toBeTruthy();
      expect(screen.getByText('Inactive')).toBeTruthy();
    });

    expect(screen.getByText(/Model registration, active state assignment/i)).toBeTruthy();
    expect(screen.getByText('Benchmark Provenance & Holdout Verification')).toBeTruthy();
    expect(screen.getByText(/Tavallaee et al\. 2009/i)).toBeTruthy();
    expect(screen.getByText('99.90% F1 Score')).toBeTruthy();
  });

  it('truthfully renders empty state when no model versions are registered', async () => {
    vi.mocked(apiClient.getModelInfo).mockResolvedValue({
      model_version: '0.1.0',
      model_type: 'xgboost',
      num_features: 41,
      preprocessing_version: 'v1',
      training_timestamp: '2026-01-01',
    });
    vi.mocked(apiClient.getModels).mockResolvedValue([]);

    render(<ModelRegistry />);

    await waitFor(() => {
      expect(screen.getByText('No registered model versions found.')).toBeTruthy();
    });
  });

  it('provides retry action when fetching model registry fails', async () => {
    vi.mocked(apiClient.getModels).mockRejectedValueOnce(new Error('Backend error'));

    render(<ModelRegistry />);

    await waitFor(() => {
      expect(screen.getByText('Model registry is unavailable.')).toBeTruthy();
    });

    vi.mocked(apiClient.getModels).mockResolvedValueOnce([]);
    const retryBtn = screen.getByRole('button', { name: 'Retry registry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(apiClient.getModels).toHaveBeenCalledTimes(2);
    });
  });
});
