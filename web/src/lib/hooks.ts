import { useQuery } from '@tanstack/react-query';
import { get } from './api';

export interface ConnectedAccount {
  id: string;
  phoneNumber: string;
  warmupDay: number;
  msgsSentToday: number;
}

/** Connected accounts usable as a "from" selector across pages. */
export function useConnectedAccounts() {
  return useQuery({
    queryKey: ['send-accounts'],
    queryFn: () => get<ConnectedAccount[]>('/api/send/accounts'),
    staleTime: 8_000,
  });
}
