import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock Cloudscape components before importing App
jest.mock('@cloudscape-design/components', () => ({
  BreadcrumbGroup: ({ items }: any) => <div data-testid="breadcrumbs">{items?.length} items</div>,
  Alert: ({ children }: any) => <div data-testid="alert">{children}</div>,
  Container: ({ children }: any) => <div data-testid="container">{children}</div>,
  Box: ({ children }: any) => <div data-testid="box">{children}</div>,
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

// Mock the pages to avoid complex dependencies
jest.mock('./pages/AgentsPage', () => {
  return function MockAgentsPage() {
    return <div data-testid="agents-page">Agents Page</div>;
  };
});

jest.mock('./pages/RegisterPage', () => {
  return function MockRegisterPage() {
    return <div data-testid="register-page">Register Page</div>;
  };
});

// Mock the ProtectedRoute to bypass authentication
jest.mock('./components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock the AgentRegistryContext
jest.mock('./contexts/AgentRegistryContext', () => ({
  AgentRegistryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAgentRegistry: () => ({
    client: null,
    isReady: true,
    error: null,
  }),
}));

// Mock the Layout component
jest.mock('./components/Layout', () => {
  return function MockLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="layout">{children}</div>;
  };
});

// Mock the router
jest.mock('./utils/router', () => ({
  router: {
    getCurrentPath: () => '/',
    subscribe: (callback: (path: string) => void) => {
      return () => {}; // unsubscribe function
    },
    navigate: jest.fn(),
  },
}));

// Import App after all mocks are set up
import App from './App';

test('renders app with agents page by default', () => {
  render(<App />);
  
  expect(screen.getByTestId('layout')).toBeInTheDocument();
  expect(screen.getByTestId('agents-page')).toBeInTheDocument();
});

test('app component renders without crashing', () => {
  const { container } = render(<App />);
  expect(container).toBeInTheDocument();
});
