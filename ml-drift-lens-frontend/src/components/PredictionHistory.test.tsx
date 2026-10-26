import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PredictionHistory } from './PredictionHistory';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getPredictionHistory: vi.fn(),
  },
}));

describe('PredictionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('announces an empty history distinctly from an unavailable request', async () => {
    vi.mocked(apiClient.getPredictionHistory).mockResolvedValueOnce([]);

    render(<PredictionHistory />);

    expect(await screen.findByText('No predictions yet.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('No predictions yet.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('provides a retry action after a history request fails', async () => {
    vi.mocked(apiClient.getPredictionHistory)
      .mockRejectedValueOnce(new Error('Backend unavailable'))
      .mockResolvedValueOnce([]);

    render(<PredictionHistory />);

    expect((await screen.findByRole('alert')).textContent).toContain('Backend unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry prediction history' }));

    expect(await screen.findByText('No predictions yet.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('No predictions yet.');
    expect(apiClient.getPredictionHistory).toHaveBeenCalledTimes(2);
  });
  it('allows an analyst to submit ground-truth labels for unlabeled predictions', async () => {
    vi.mocked(apiClient.getPredictionHistory).mockResolvedValueOnce([
      {
        id: 42,
        model_id: 'nsl-kdd-baseline',
        model_version: 'v1.0',
        preprocessing_version: 'v1.0',
        input_features: '{}',
        prediction: 'normal',
        prediction_class: 0,
        confidence: 0.98,
        request_id: 'req-42',
        timestamp: '2026-10-26T12:00:00Z',
        actual_label: undefined,
      },
    ]);
    (apiClient as any).labelPrediction = vi.fn().mockResolvedValueOnce({
      id: 42,
      actual_label: 'normal',
    });

    render(<PredictionHistory />);
    expect(await screen.findByText('req-42')).toBeTruthy();
    const normalBtn = screen.getByRole('button', { name: 'Label prediction 42 as normal' });
    expect(normalBtn).toBeTruthy();
    fireEvent.click(normalBtn);
    await screen.findByText('NORMAL');
    expect((apiClient as any).labelPrediction).toHaveBeenCalledWith(42, 'normal');
  });
});
