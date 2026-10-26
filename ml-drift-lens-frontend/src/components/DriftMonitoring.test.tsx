import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriftMonitoring } from './DriftMonitoring';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getDriftHistory: vi.fn(),
  },
}));

describe('DriftMonitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders persisted drift records and does not present insufficient data as a zero score', async () => {
    vi.mocked(apiClient.getDriftHistory).mockResolvedValue([
      { id: 2, model_id: 'model-a', metric_type: 'PSI', score: 0, threshold: 0.2, status: 'insufficient_data', timestamp: '2026-10-09T09:30:04Z' },
      { id: 1, model_id: 'model-a', metric_type: 'PSI', score: 3.92, threshold: 0.2, status: 'significant_drift', timestamp: '2026-10-09T09:29:04Z' },
    ]);

    render(<DriftMonitoring />);

    expect(await screen.findByText('Significant Drift')).toBeTruthy();
    expect(screen.getByText('Insufficient Data')).toBeTruthy();
    expect(screen.getByText('Awaiting min 100 samples')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Persisted drift history' })).toBeTruthy();
  });

  it('distinguishes an empty history and retries an unavailable request', async () => {
    vi.mocked(apiClient.getDriftHistory)
      .mockRejectedValueOnce(new Error('Backend unavailable'))
      .mockResolvedValueOnce([]);

    render(<DriftMonitoring />);

    expect((await screen.findByRole('alert')).textContent).toContain('Drift history is unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry drift history' }));

    expect(await screen.findByText('No drift records have been recorded.')).toBeTruthy();
    expect(screen.getByText(/not a finding that drift is absent/i)).toBeTruthy();
    expect(apiClient.getDriftHistory).toHaveBeenCalledTimes(2);
  });

  it('requests the next backend page only when records indicate one exists', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      model_id: 'model-a',
      metric_type: 'PSI',
      score: 0.4,
      threshold: 0.2,
      status: 'significant_drift',
      timestamp: '2026-10-09T09:30:04Z',
    }));
    vi.mocked(apiClient.getDriftHistory).mockResolvedValueOnce(rows).mockResolvedValueOnce([]);

    render(<DriftMonitoring />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(apiClient.getDriftHistory).toHaveBeenLastCalledWith({ limit: 21, offset: 20 }));
    expect(await screen.findByText('No drift records have been recorded.')).toBeTruthy();
  });
});
