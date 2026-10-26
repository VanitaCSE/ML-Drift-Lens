import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ModelEvaluation } from './ModelEvaluation';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getModels: vi.fn(),
    getRetrainingJobs: vi.fn(),
  },
}));

describe('ModelEvaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders comparative evaluation metrics between candidate and incumbent', async () => {
    vi.mocked(apiClient.getModels).mockResolvedValue([
      {
        id: 1,
        model_id: 'nsl-kdd-baseline',
        model_version: 'candidate-20261009T061233Z-7e4ec984',
        mlflow_run_id: 'run-1',
        timestamp: '2026-10-09T06:15:00Z',
        accuracy: 0.725,
        precision: 0.731,
        recall: 0.718,
        f1: 0.7143,
        is_active: true,
      },
    ]);

    vi.mocked(apiClient.getRetrainingJobs).mockResolvedValue([
      {
        id: 1,
        model_id: 'nsl-kdd-baseline',
        triggered_by: 'auto',
        status: 'deployed',
        start_time: '2026-10-09T06:00:00Z',
        end_time: '2026-10-09T06:12:00Z',
        old_model_version: '0.1.0',
        new_model_version: 'candidate-20261009T061233Z-7e4ec984',
        promoted: true,
        promotion_reason: 'candidate_f1_superior',
        evaluation_sample_count: 50,
        candidate_f1: 0.7143,
        incumbent_f1: 0.5000,
        reload_status: 'reloaded',
      },
    ]);

    render(<ModelEvaluation />);

    await waitFor(() => {
      expect(screen.getByText('Latest Head-to-Head Comparison')).toBeTruthy();
      expect(screen.getAllByText('candidate-20261009T061233Z-7e4ec984').length).toBeGreaterThan(0);
      expect(screen.getByText('Promoted (Superior F1)')).toBeTruthy();
    });

    expect(screen.getByText(/Strict F1 superiority/i)).toBeTruthy();
    expect(screen.getByText('Canonical NSL-KDD Holdout Benchmark (22,544 Samples)')).toBeTruthy();
    expect(screen.getByText('Holdout Confusion Matrix')).toBeTruthy();
    expect(screen.getByText('9,434')).toBeTruthy();
  });

  it('renders empty evaluation state when no candidate jobs have evaluation data', async () => {
    vi.mocked(apiClient.getModels).mockResolvedValue([]);
    vi.mocked(apiClient.getRetrainingJobs).mockResolvedValue([]);

    render(<ModelEvaluation />);

    await waitFor(() => {
      expect(screen.getByText('No evaluation records available.')).toBeTruthy();
      expect(screen.getByText('No candidate under review')).toBeTruthy();
    });
  });

  it('allows retry on failure', async () => {
    vi.mocked(apiClient.getModels).mockRejectedValueOnce(new Error('Evaluation load failed'));

    render(<ModelEvaluation />);

    await waitFor(() => {
      expect(screen.getByText('Evaluation data is unavailable.')).toBeTruthy();
    });

    vi.mocked(apiClient.getModels).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry evaluation' }));

    await waitFor(() => {
      expect(apiClient.getModels).toHaveBeenCalledTimes(2);
    });
  });
});
