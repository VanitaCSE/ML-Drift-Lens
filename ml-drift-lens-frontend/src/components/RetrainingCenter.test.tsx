import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RetrainingCenter } from './RetrainingCenter';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getRetrainingJobs: vi.fn(),
  },
}));

describe('RetrainingCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders retraining jobs and lifecycle stages correctly', async () => {
    vi.mocked(apiClient.getRetrainingJobs).mockResolvedValue([
      {
        id: 1,
        model_id: 'nsl-kdd-baseline',
        triggered_by: 'auto',
        trigger_reason: 'drift_threshold_exceeded',
        status: 'deployed',
        start_time: '2026-10-09T06:00:00Z',
        end_time: '2026-10-09T06:12:00Z',
        old_model_version: '0.1.0',
        new_model_version: 'candidate-20261009T061233Z-7e4ec984',
        promoted: true,
        promotion_reason: 'candidate_f1_superior',
        sample_count: 200,
        evaluation_sample_count: 50,
        min_samples: 150,
        candidate_f1: 0.7143,
        incumbent_f1: 0.5000,
        reload_status: 'reloaded',
      },
      {
        id: 2,
        model_id: 'nsl-kdd-baseline',
        triggered_by: 'auto',
        trigger_reason: 'drift_threshold_exceeded',
        status: 'waiting_for_labelled_data',
        start_time: '2026-10-24T12:00:00Z',
        end_time: null,
        old_model_version: 'candidate-20261009T061233Z-7e4ec984',
        new_model_version: null,
        promoted: false,
        sample_count: 0,
        evaluation_sample_count: 0,
        min_samples: 150,
        candidate_f1: null,
        incumbent_f1: null,
        reload_status: null,
      },
    ]);

    render(<RetrainingCenter />);

    await waitFor(() => {
      expect(screen.getAllByText(/#1/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/#2/).length).toBeGreaterThan(0);
      expect(screen.getByText('Promoted')).toBeTruthy();
      expect(screen.getByText(/waiting for labelled data/i)).toBeTruthy();
    });

    expect(screen.getByText(/Job #2 Waiting:/i)).toBeTruthy();
    expect(screen.getByText(/Retraining enqueuing and promotion endpoints/i)).toBeTruthy();
  });

  it('truthfully renders empty state when no jobs exist', async () => {
    vi.mocked(apiClient.getRetrainingJobs).mockResolvedValue([]);

    render(<RetrainingCenter />);

    await waitFor(() => {
      expect(screen.getByText('No retraining jobs recorded.')).toBeTruthy();
    });
  });

  it('provides retry button when fetching retraining jobs fails', async () => {
    vi.mocked(apiClient.getRetrainingJobs).mockRejectedValueOnce(new Error('Network error'));

    render(<RetrainingCenter />);

    await waitFor(() => {
      expect(screen.getByText('Retraining center is unavailable.')).toBeTruthy();
    });

    vi.mocked(apiClient.getRetrainingJobs).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry retraining jobs' }));

    await waitFor(() => {
      expect(apiClient.getRetrainingJobs).toHaveBeenCalledTimes(2);
    });
  });
});
