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
});
