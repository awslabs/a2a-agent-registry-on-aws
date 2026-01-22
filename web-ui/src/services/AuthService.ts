import { Amplify, Auth } from 'aws-amplify';

// AWS Configuration interface
interface AWSConfig {
  region: string;
  userPoolId: string;
  userPoolWebClientId: string;
  identityPoolId: string;
  apiGatewayUrl: string;
  cognitoDomain: string;
}

// Get AWS configuration from global window object or environment
const getAWSConfig = (): AWSConfig => {
  // Check if running in CloudFront deployment (aws-config.js loaded)
  if (typeof window !== 'undefined' && (window as any).AWS_CONFIG) {
    const config = (window as any).AWS_CONFIG;
    // Validate that we don't have placeholder values
    if (config.userPoolId && !config.userPoolId.includes('PLACEHOLDER')) {
      return config;
    }
  }
  
  // Check if running in Docker deployment (config.js loaded)
  if (typeof window !== 'undefined' && (window as any).APP_CONFIG?.aws) {
    return (window as any).APP_CONFIG.aws;
  }
  
  // Fallback to environment variables for local development
  const envConfig = {
    region: process.env.REACT_APP_AWS_REGION || 'us-east-1',
    userPoolId: process.env.REACT_APP_USER_POOL_ID || '',
    userPoolWebClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID || '',
    identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID || '',
    apiGatewayUrl: process.env.REACT_APP_API_GATEWAY_URL || '',
    cognitoDomain: process.env.REACT_APP_COGNITO_DOMAIN || '',
  };

  // Validate that we have required configuration
  if (!envConfig.userPoolId || !envConfig.userPoolWebClientId) {
    console.error('AWS configuration is missing or contains placeholder values. Please check deployment.');
  }

  return envConfig;
};

// Initialize Amplify configuration
const initializeAmplify = () => {
  const config = getAWSConfig();
  
  Amplify.configure({
    Auth: {
      region: config.region,
      userPoolId: config.userPoolId,
      userPoolWebClientId: config.userPoolWebClientId,
      identityPoolId: config.identityPoolId,
      oauth: {
        domain: config.cognitoDomain,
        scope: ['email', 'openid', 'profile'],
        redirectSignIn: window.location.origin,
        redirectSignOut: window.location.origin,
        responseType: 'code',
      },
    },
  });
};

export interface AuthState {
  isAuthenticated: boolean;
  user: any | null;
  loading: boolean;
  error: string | null;
}

export class AuthService {
  private static instance: AuthService;
  private authState: AuthState = {
    isAuthenticated: false,
    user: null,
    loading: true,
    error: null,
  };
  private listeners: ((state: AuthState) => void)[] = [];

  private constructor() {
    this.initialize();
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private async initialize() {
    try {
      initializeAmplify();
      
      // Handle OAuth callback if present
      await this.handleOAuthCallback();
      
      await this.checkAuthState();
    } catch (error) {
      console.error('Failed to initialize auth service:', error);
      this.updateAuthState({
        isAuthenticated: false,
        user: null,
        loading: false,
        error: 'Failed to initialize authentication',
      });
    }
  }

  private async handleOAuthCallback() {
    // Check if we're returning from OAuth flow
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
      try {
        // Clear the URL parameters after handling OAuth callback
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (error) {
        console.error('Error handling OAuth callback:', error);
      }
    }
  }

  private async checkAuthState() {
    try {
      this.updateAuthState({ ...this.authState, loading: true, error: null });
      
      const user = await Auth.currentAuthenticatedUser();
      this.updateAuthState({
        isAuthenticated: true,
        user,
        loading: false,
        error: null,
      });
    } catch (error) {
      this.updateAuthState({
        isAuthenticated: false,
        user: null,
        loading: false,
        error: null,
      });
    }
  }

  private updateAuthState(newState: Partial<AuthState>) {
    this.authState = { ...this.authState, ...newState };
    this.listeners.forEach(listener => listener(this.authState));
  }

  public subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.push(listener);
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  public getAuthState(): AuthState {
    return { ...this.authState };
  }

  public async signIn(username: string, password: string): Promise<void> {
    try {
      this.updateAuthState({ ...this.authState, loading: true, error: null });
      
      await Auth.signIn(username, password);
      await this.checkAuthState();
    } catch (error: any) {
      console.error('Sign in error:', error);
      this.updateAuthState({
        ...this.authState,
        loading: false,
        error: error.message || 'Sign in failed',
      });
      throw error;
    }
  }

  public async signOut(): Promise<void> {
    try {
      this.updateAuthState({ ...this.authState, loading: true, error: null });
      
      await Auth.signOut();
      
      // Redirect to hosted UI logout to ensure complete logout
      window.location.href = this.getHostedUILogoutUrl();
    } catch (error: any) {
      console.error('Sign out error:', error);
      this.updateAuthState({
        ...this.authState,
        loading: false,
        error: error.message || 'Sign out failed',
      });
      throw error;
    }
  }

  public async getAuthSession() {
    try {
      const session = await Auth.currentSession();
      return session;
    } catch (error) {
      console.error('Failed to get auth session:', error);
      throw error;
    }
  }

  public async getAccessToken(): Promise<string | null> {
    try {
      const session = await this.getAuthSession();
      return session.getAccessToken().getJwtToken();
    } catch (error) {
      console.error('Failed to get access token:', error);
      return null;
    }
  }

  public async getIdToken(): Promise<string | null> {
    try {
      const session = await this.getAuthSession();
      return session.getIdToken().getJwtToken();
    } catch (error) {
      console.error('Failed to get ID token:', error);
      return null;
    }
  }

  public async getCredentials() {
    try {
      const credentials = await Auth.currentCredentials();
      return credentials;
    } catch (error) {
      console.error('Failed to get credentials:', error);
      throw error;
    }
  }

  public getHostedUIUrl(): string {
    const config = getAWSConfig();
    const redirectUri = encodeURIComponent(window.location.origin);
    const scopes = encodeURIComponent('email openid profile');
    return `https://${config.cognitoDomain}/login?client_id=${config.userPoolWebClientId}&response_type=code&scope=${scopes}&redirect_uri=${redirectUri}`;
  }

  public getHostedUILogoutUrl(): string {
    const config = getAWSConfig();
    const redirectUri = encodeURIComponent(window.location.origin);
    return `https://${config.cognitoDomain}/logout?client_id=${config.userPoolWebClientId}&logout_uri=${redirectUri}`;
  }

  public signInWithHostedUI(): void {
    // For Amplify v5, we need to redirect directly to the hosted UI URL
    const hostedUIUrl = this.getHostedUIUrl();
    window.location.href = hostedUIUrl;
  }
}

export default AuthService;