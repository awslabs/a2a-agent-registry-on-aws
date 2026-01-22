/**
 * Agent Registry Client for Web UI
 * Provides interface to the Agent Registry API with AWS authentication
 */

import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { AgentCard, SearchResult, PaginatedResponse } from "../types/AgentCard";

export interface AgentRegistryClientConfig {
  apiGatewayUrl: string;
  region?: string;
  identityPoolId?: string;
  maxRetries?: number;
  retryBackoffFactor?: number;
}

export interface CreateAgentResponse {
  agent_id: string;
  message: string;
}

export interface ListAgentsResponse {
  agents: AgentCard[];
  pagination: {
    total: number;
    has_more: boolean;
    limit: number;
    offset: number;
  };
}

export interface SearchAgentsResponse {
  results: Array<{
    agent_id: string;
    agent_card: AgentCard;
    similarity_score: number;
    matched_skills: string[];
  }>;
}

export interface UpdateAgentResponse {
  agent_id: string;
  message: string;
}

export interface HealthUpdateResponse {
  message: string;
  timestamp: string;
}

export class AgentRegistryError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = "AgentRegistryError";
  }
}

export class ValidationError extends AgentRegistryError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AgentRegistryError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class AuthenticationError extends AgentRegistryError {
  constructor(message: string) {
    super(message, 401, "AUTHENTICATION_ERROR");
    this.name = "AuthenticationError";
  }
}

export class ServerError extends AgentRegistryError {
  constructor(message: string) {
    super(message, 500, "SERVER_ERROR");
    this.name = "ServerError";
  }
}

export class AgentRegistryClient {
  private apiGatewayUrl: string;
  private region: string;
  private maxRetries: number;
  private retryBackoffFactor: number;
  private signer?: SignatureV4;

  constructor(config: AgentRegistryClientConfig) {
    this.apiGatewayUrl = config.apiGatewayUrl.replace(/\/$/, "");
    this.region = config.region || "us-east-1";
    this.maxRetries = config.maxRetries || 3;
    this.retryBackoffFactor = config.retryBackoffFactor || 0.5;

    // Initialize AWS credentials and signer
    this.initializeAWSAuth(config.identityPoolId);
  }

  private async initializeAWSAuth(identityPoolId?: string): Promise<void> {
    try {
      if (identityPoolId) {
        // Use Cognito Identity Pool for web applications
        const credentials = fromCognitoIdentityPool({
          identityPoolId,
          clientConfig: { region: this.region },
        });

        this.signer = new SignatureV4({
          credentials,
          region: this.region,
          service: "execute-api",
          sha256: Sha256,
        });
      }
      // If no identity pool ID, don't initialize signer (proxy server will handle auth)
    } catch (error) {
      console.warn("Failed to initialize AWS authentication:", error);
      // Continue without AWS auth - proxy server will handle it
    }
  }

  /**
   * Update credentials for authenticated user
   * Call this method after user signs in to refresh credentials
   */
  public async updateCredentials(credentials?: any): Promise<void> {
    try {
      if (credentials) {
        this.signer = new SignatureV4({
          credentials: () => Promise.resolve(credentials),
          region: this.region,
          service: "execute-api",
          sha256: Sha256,
        });
      }
    } catch (error) {
      console.error("Failed to update credentials:", error);
      throw error;
    }
  }

  private isRetryableError(error: any): boolean {
    // Retry on server errors, timeouts, and connection errors
    if (error instanceof ServerError) return true;
    if (error.name === "NetworkError" || error.name === "TimeoutError")
      return true;
    if (error.statusCode && error.statusCode >= 500) return true;
    return false;
  }

  private calculateRetryDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const delay = baseDelay * Math.pow(2, attempt) * this.retryBackoffFactor;
    const jitter = Math.random() * 0.1 * delay;
    return delay + jitter;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async makeRequest<T>(
    method: string,
    path: string,
    body?: any,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.apiGatewayUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    let requestInit: RequestInit = {
      method,
      headers,
    };

    if (body) {
      requestInit.body = JSON.stringify(body);
    }

    // Only sign requests if using direct AWS API (not proxy server)
    // If URL is localhost, assume we're using proxy server and don't sign
    const isUsingProxy =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";

    if (this.signer && !isUsingProxy) {
      try {
        const parsedUrl = new URL(url.toString());

        // Construct headers with Host header explicitly set
        const headers = {
          ...((requestInit.headers as Record<string, string>) || {}),
          host: parsedUrl.hostname, // Use lowercase 'host' as per HTTP/2 spec
        };

        const httpRequest = new HttpRequest({
          method: requestInit.method || "GET",
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port ? parseInt(parsedUrl.port) : undefined,
          path: parsedUrl.pathname,
          query: Object.fromEntries(parsedUrl.searchParams),
          headers: headers,
          body: requestInit.body,
        });

        // Ensure Host header is included in signed headers
        const signedRequest = await this.signer.sign(httpRequest, {
          signingDate: new Date(),
          signingRegion: this.region,
          signingService: "execute-api",
          unsignableHeaders: new Set(), // Don't exclude any headers from signing
        });

        requestInit = {
          method: signedRequest.method,
          headers: signedRequest.headers,
          body: signedRequest.body,
        };
      } catch (error) {
        console.error("Failed to sign request with AWS credentials:", error);
        throw new AgentRegistryError(
          "Failed to sign request: " +
            (error instanceof Error ? error.message : "Unknown error")
        );
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url.toString(), requestInit);

        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            return await response.json();
          } else {
            // Handle non-JSON responses
            const text = await response.text();
            return { message: text } as T;
          }
        }

        // Handle error responses
        let errorMessage = `Request failed with status ${response.status}`;
        let errorCode = "UNKNOWN_ERROR";

        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error.message || errorMessage;
            errorCode = errorData.error.code || errorCode;
          }
        } catch {
          // If we can't parse error JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }

        switch (response.status) {
          case 400:
            if (errorCode === "VALIDATION_ERROR") {
              throw new ValidationError(errorMessage);
            }
            throw new AgentRegistryError(errorMessage, 400, errorCode);
          case 401:
            throw new AuthenticationError(
              "Authentication failed. Please check your credentials."
            );
          case 403:
            throw new AuthenticationError(
              "Access denied. Check your permissions."
            );
          case 404:
            throw new NotFoundError(errorMessage);
          case 500:
          case 502:
          case 503:
          case 504:
            const serverError = new ServerError(errorMessage);
            if (
              attempt < this.maxRetries &&
              this.isRetryableError(serverError)
            ) {
              lastError = serverError;
              const delay = this.calculateRetryDelay(attempt);
              await this.sleep(delay);
              continue;
            }
            throw serverError;
          default:
            throw new AgentRegistryError(
              errorMessage,
              response.status,
              errorCode
            );
        }
      } catch (error) {
        if (error instanceof AgentRegistryError) {
          throw error;
        }

        // Handle network errors
        if (attempt < this.maxRetries && this.isRetryableError(error)) {
          lastError = error as Error;
          const delay = this.calculateRetryDelay(attempt);
          await this.sleep(delay);
          continue;
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AgentRegistryError(
            "Network error. Please check your connection and API URL."
          );
        }

        throw new AgentRegistryError(
          `Request failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    // If we get here, all retries failed
    if (lastError) {
      throw new AgentRegistryError(
        `Request failed after ${this.maxRetries} retries: ${lastError.message}`
      );
    }

    throw new AgentRegistryError("Request failed after all retry attempts");
  }

  /**
   * Create a new agent card
   */
  async createAgent(agentCard: AgentCard): Promise<string> {
    const response = await this.makeRequest<CreateAgentResponse>(
      "POST",
      "/agents",
      agentCard
    );

    if (!response.agent_id) {
      throw new AgentRegistryError("Invalid response: missing agent_id");
    }

    return response.agent_id;
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<AgentCard> {
    if (!agentId || !agentId.trim()) {
      throw new ValidationError("Agent ID is required");
    }

    const response = await this.makeRequest<{ agent: AgentCard }>(
      "GET",
      `/agents/${agentId}`
    );

    if (!response.agent) {
      throw new AgentRegistryError("Invalid response: missing agent data");
    }

    return response.agent;
  }

  /**
   * List agents with pagination
   */
  async listAgents(
    limit: number = 50,
    offset: number = 0
  ): Promise<PaginatedResponse<AgentCard>> {
    if (limit < 1 || limit > 100) {
      throw new ValidationError("Limit must be between 1 and 100");
    }

    if (offset < 0) {
      throw new ValidationError("Offset must be non-negative");
    }

    const params = {
      limit: limit.toString(),
      offset: offset.toString(),
    };

    const response = await this.makeRequest<ListAgentsResponse>(
      "GET",
      "/agents",
      undefined,
      params
    );

    return {
      items: response.agents || [],
      total: response.pagination?.total || 0,
      limit,
      offset,
      has_more: response.pagination?.has_more || false,
    };
  }

  /**
   * Search agents using text and skills
   */
  async searchAgents(
    query?: string,
    skills?: string[],
    topK: number = 10
  ): Promise<SearchResult[]> {
    if (!query && (!skills || skills.length === 0)) {
      throw new ValidationError("Either query text or skills must be provided");
    }

    if (topK < 1 || topK > 30) {
      throw new ValidationError("topK must be between 1 and 30");
    }

    const params: Record<string, string> = {
      top_k: topK.toString(),
    };

    if (query) {
      params.text = query;
    }

    if (skills && skills.length > 0) {
      params.skills = skills.join(",");
    }

    // The API returns a direct list, not wrapped in a 'results' key
    const response = await this.makeRequest<
      SearchResult[] | SearchAgentsResponse
    >("GET", "/agents/search", undefined, params);

    // Handle both formats: direct list (actual API) and wrapped format (legacy)
    let results: SearchResult[];
    if (Array.isArray(response)) {
      results = response;
    } else {
      results = (response as SearchAgentsResponse).results || [];
    }

    return results.map((result) => ({
      agent_id: result.agent_id || "",
      agent_card: result.agent_card,
      similarity_score: result.similarity_score || 0,
      matched_skills: result.matched_skills || [],
    }));
  }

  /**
   * Update an existing agent card (partial updates supported)
   */
  async updateAgent(
    agentId: string,
    updateData: Partial<AgentCard>
  ): Promise<boolean> {
    if (!agentId || !agentId.trim()) {
      throw new ValidationError("Agent ID is required");
    }

    if (!updateData || Object.keys(updateData).length === 0) {
      throw new ValidationError("Update data is required");
    }

    const response = await this.makeRequest<{ message: string }>(
      "PUT",
      `/agents/${agentId}`,
      updateData
    );

    return response.message?.toLowerCase().includes("success") || false;
  }

  /**
   * Delete agent by ID
   */
  async deleteAgent(agentId: string): Promise<boolean> {
    if (!agentId || !agentId.trim()) {
      throw new ValidationError("Agent ID is required");
    }

    const response = await this.makeRequest<{ message: string }>(
      "DELETE",
      `/agents/${agentId}`
    );

    return response.message?.toLowerCase().includes("success") || false;
  }

  /**
   * Update agent health status
   */
  async updateHealth(agentId: string): Promise<boolean> {
    if (!agentId || !agentId.trim()) {
      throw new ValidationError("Agent ID is required");
    }

    const response = await this.makeRequest<HealthUpdateResponse>(
      "POST",
      `/agents/${agentId}/health`
    );

    return response.message?.toLowerCase().includes("success") || false;
  }

  /**
   * Register agent (alias for createAgent for consistency)
   */
  async registerAgent(agentCard: AgentCard): Promise<string> {
    return this.createAgent(agentCard);
  }
}
