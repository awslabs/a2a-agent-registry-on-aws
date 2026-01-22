import React, { createContext, useContext, useEffect, useState } from 'react';
import { AgentRegistryClient, AgentRegistryClientConfig } from '../services/AgentRegistryClient';
import { useAuth } from '../hooks/useAuth';

interface AgentRegistryContextType {
  client: AgentRegistryClient | null;
  isReady: boolean;
  error: string | null;
}

const AgentRegistryContext = createContext<AgentRegistryContextType>({
  client: null,
  isReady: false,
  error: null,
});

export const useAgentRegistry = () => {
  const context = useContext(AgentRegistryContext);
  if (!context) {
    throw new Error('useAgentRegistry must be used within an AgentRegistryProvider');
  }
  return context;
};

interface AgentRegistryProviderProps {
  children: React.ReactNode;
}

// Get configuration from global window object or environment
const getClientConfig = (): AgentRegistryClientConfig => {
  // Check if running in CloudFront deployment (aws-config.js loaded)
  if (typeof window !== 'undefined' && (window as any).AWS_CONFIG) {
    const config = (window as any).AWS_CONFIG;
    return {
      apiGatewayUrl: config.apiGatewayUrl,
      region: config.region,
      identityPoolId: config.identityPoolId,
    };
  }
  
  // Check if running in Docker deployment (config.js loaded)
  if (typeof window !== 'undefined' && (window as any).APP_CONFIG?.aws) {
    const config = (window as any).APP_CONFIG.aws;
    return {
      apiGatewayUrl: config.apiGatewayUrl,
      region: config.region,
      identityPoolId: config.identityPoolId,
    };
  }
  
  // Fallback to environment variables for local development
  return {
    apiGatewayUrl: process.env.REACT_APP_API_GATEWAY_URL || 'http://localhost:3001',
    region: process.env.REACT_APP_AWS_REGION || 'us-east-1',
    identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID,
  };
};

export const AgentRegistryProvider: React.FC<AgentRegistryProviderProps> = ({ children }) => {
  const { isAuthenticated, getCredentials, loading: authLoading } = useAuth();
  const [client, setClient] = useState<AgentRegistryClient | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeClient = async () => {
      try {
        setError(null);
        setIsReady(false);

        // Don't initialize client until authentication is complete
        if (authLoading) {
          return;
        }

        const config = getClientConfig();
        const newClient = new AgentRegistryClient(config);

        // If user is authenticated, update client credentials
        if (isAuthenticated) {
          try {
            const credentials = await getCredentials();
            await newClient.updateCredentials(credentials);
          } catch (credError) {
            console.error('Failed to get credentials for API client:', credError);
            setError('Failed to get AWS credentials. Please try refreshing the page.');
            setIsReady(true);
            return;
          }
        }

        setClient(newClient);
        setIsReady(true);
      } catch (initError: any) {
        console.error('Failed to initialize Agent Registry client:', initError);
        setError(initError.message || 'Failed to initialize API client');
        setIsReady(true); // Set ready even on error so UI can show error state
      }
    };

    initializeClient();
  }, [isAuthenticated, authLoading]);

  const contextValue: AgentRegistryContextType = {
    client,
    isReady,
    error,
  };

  return (
    <AgentRegistryContext.Provider value={contextValue}>
      {children}
    </AgentRegistryContext.Provider>
  );
};