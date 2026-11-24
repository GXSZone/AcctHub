import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react';

const ScopeContext = createContext('guest');

export function usePrivateSessionScope(): string {
  return useContext(ScopeContext);
}

export function PrivateSession({
  scope,
  client,
  children,
}: {
  scope: string;
  client: QueryClient;
  children: ReactNode;
}) {
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        void client.cancelQueries();
        client.clear();
      });
    };
  }, [client]);

  return (
    <ScopeContext.Provider value={scope}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ScopeContext.Provider>
  );
}
