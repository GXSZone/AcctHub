import type { SetupInitializeInput } from '@shared/index';
import type { UserProfile } from '../types';
import { apiRequest } from './http';

export interface SetupStatusResponse {
  initialized: boolean;
  requires_setup: boolean;
  is_production: boolean;
  has_admin_secret: boolean;
}

export const setupApi = {
  status: () => apiRequest<SetupStatusResponse>('/api/setup/status'),

  initialize: (payload: SetupInitializeInput) =>
    apiRequest<{ ok: boolean; initialized: boolean; token: string; user: UserProfile }>(
      '/api/setup/initialize',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
};
