import { AgentRegistryClient } from "./AgentRegistryClient";
import { AgentCard } from "../types/AgentCard";

// Mock AWS SDK v3 modules
const mockCredentials = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  sessionToken: "test-session-token",
};

jest.mock("@aws-sdk/credential-providers", () => ({
  fromCognitoIdentityPool: jest.fn(() => () => Promise.resolve(mockCredentials)),
}));

// Mock signature v4
jest.mock("@aws-sdk/signature-v4", () => ({
  SignatureV4: jest.fn().mockImplementation(() => ({
    sign: jest.fn().mockResolvedValue({
      method: "GET",
      headers: {
        Authorization: "AWS4-HMAC-SHA256 test-signature",
        "X-Amz-Date": "20240115T120000Z",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: undefined,
    }),
  })),
}));

describe("AgentRegistryClient", () => {
  const mockConfig = {
    region: "us-east-1",
    apiGatewayUrl: "https://api.example.com",
    cognitoIdentityPoolId: "us-east-1:test-pool-id",
  };

  const mockAgent: AgentCard = {
    name: "Test Agent",
    description: "A test agent",
    version: "1.0.0",
    url: "https://api.example.com/agent",
    protocolVersion: "1.0.0",
    capabilities: {},
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [{ id: "test-skill", name: "test", description: "Test skill", tags: ["test"] }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Constructor", () => {
    test("initializes with valid config", () => {
      expect(() => new AgentRegistryClient(mockConfig)).not.toThrow();
    });

    test("initializes with minimal config", () => {
      const minimalConfig = { apiGatewayUrl: "https://api.example.com" };
      expect(() => new AgentRegistryClient(minimalConfig)).not.toThrow();
    });

    test("strips trailing slash from API Gateway URL", () => {
      const configWithSlash = {
        ...mockConfig,
        apiGatewayUrl: "https://api.example.com/",
      };
      const client = new AgentRegistryClient(configWithSlash);
      expect(client).toBeDefined();
    });

    test("uses default values for optional config", () => {
      const minimalConfig = { apiGatewayUrl: "https://api.example.com" };
      const client = new AgentRegistryClient(minimalConfig);
      expect(client).toBeDefined();
    });
  });

  describe("listAgents", () => {
    test("returns agents list successfully", async () => {
      const mockResponse = {
        agents: [mockAgent],
        pagination: {
          total: 1,
          has_more: false,
          limit: 10,
          offset: 0,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve(mockResponse),
      });

      const client = new AgentRegistryClient(mockConfig);
      const result = await client.listAgents(10, 0);

      expect(result).toEqual({
        items: [mockAgent],
        total: 1,
        limit: 10,
        offset: 0,
        has_more: false,
      });
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents?limit=10&offset=0",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Accept: "application/json",
          }),
        })
      );
    });

    test("uses default parameters when not provided", async () => {
      const mockResponse = {
        agents: [],
        pagination: {
          total: 0,
          has_more: false,
          limit: 50,
          offset: 0,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve(mockResponse),
      });

      const client = new AgentRegistryClient(mockConfig);
      await client.listAgents();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents?limit=50&offset=0",
        expect.any(Object)
      );
    });

    test("handles API error response", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            error: { message: "Server error", code: "SERVER_ERROR" },
          }),
      });

      const client = new AgentRegistryClient(mockConfig);

      await expect(client.listAgents()).rejects.toThrow("Server error");
    });

    test("handles network error", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

      const client = new AgentRegistryClient(mockConfig);

      await expect(client.listAgents()).rejects.toThrow("Network error");
    });
  });

  describe("createAgent", () => {
    test("creates agent successfully", async () => {
      const agentId = "new-agent-id";

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            agent_id: agentId,
            message: "Agent created successfully",
          }),
      });

      const client = new AgentRegistryClient(mockConfig);
      const result = await client.createAgent(mockAgent);

      expect(result).toBe(agentId);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Accept: "application/json",
          }),
          body: JSON.stringify(mockAgent),
        })
      );
    });

    test("handles validation error", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            error: { message: "Validation failed", code: "VALIDATION_ERROR" },
          }),
      });

      const client = new AgentRegistryClient(mockConfig);

      await expect(client.createAgent(mockAgent)).rejects.toThrow(
        "Validation failed"
      );
    });
  });

  describe("getAgent", () => {
    test("retrieves agent successfully", async () => {
      const mockResponse = {
        agent: mockAgent,
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve(mockResponse),
      });

      const client = new AgentRegistryClient(mockConfig);
      const result = await client.getAgent("test-id");

      expect(result).toEqual(mockAgent);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents/test-id",
        expect.objectContaining({
          method: "GET",
        })
      );
    });

    test("handles agent not found", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            error: { message: "Agent not found", code: "NOT_FOUND" },
          }),
      });

      const client = new AgentRegistryClient(mockConfig);

      await expect(client.getAgent("nonexistent-id")).rejects.toThrow(
        "Agent not found"
      );
    });
  });

  describe("searchAgents", () => {
    test("searches agents successfully with direct list response", async () => {
      // API returns a direct list, not wrapped in 'results'
      const mockResponse = [
        {
          agent_id: "test-agent-id",
          agent_card: mockAgent,
          similarity_score: 0.95,
          matched_skills: ["skill1"],
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve(mockResponse),
      });

      const client = new AgentRegistryClient(mockConfig);
      const result = await client.searchAgents("test query", ["skill1"]);

      expect(result).toEqual([
        {
          agent_id: "test-agent-id",
          agent_card: mockAgent,
          similarity_score: 0.95,
          matched_skills: ["skill1"],
        },
      ]);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents/search?top_k=10&text=test+query&skills=skill1",
        expect.objectContaining({
          method: "GET",
        })
      );
    });

    test("searches agents successfully with legacy wrapped response", async () => {
      // Support legacy format for backward compatibility
      const mockResponse = {
        results: [
          {
            agent_id: "test-agent-id",
            agent_card: mockAgent,
            similarity_score: 0.95,
            matched_skills: ["skill1"],
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve(mockResponse),
      });

      const client = new AgentRegistryClient(mockConfig);
      const result = await client.searchAgents("test query", ["skill1"]);

      expect(result).toEqual([
        {
          agent_id: "test-agent-id",
          agent_card: mockAgent,
          similarity_score: 0.95,
          matched_skills: ["skill1"],
        },
      ]);
    });

    test("throws validation error for empty search parameters", async () => {
      const client = new AgentRegistryClient(mockConfig);

      await expect(client.searchAgents("", [])).rejects.toThrow(
        "Either query text or skills must be provided"
      );
    });

    test("handles multiple skills", async () => {
      const mockResponse = {
        results: [
          {
            agent_card: mockAgent,
            similarity_score: 0.85,
            matched_skills: ["skill1", "skill2"],
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve(mockResponse),
      });

      const client = new AgentRegistryClient(mockConfig);
      await client.searchAgents("test", ["skill1", "skill2", "skill3"]);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents/search?top_k=10&text=test&skills=skill1%2Cskill2%2Cskill3",
        expect.any(Object)
      );
    });
  });

  describe("updateAgent", () => {
    test("updates agent successfully", async () => {
      const updateData = {
        name: "Updated Agent Name",
        skills: [
          { id: "skill-0", name: "python", description: "Python programming", tags: ["python"] },
          { id: "skill-1", name: "testing", description: "Software testing", tags: ["testing"] },
          { id: "skill-2", name: "new-skill", description: "New skill", tags: ["new"] }
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            agent_id: "test-id",
            message: "Agent updated successfully",
          }),
      });

      const client = new AgentRegistryClient(mockConfig);
      const result = await client.updateAgent("test-id", updateData);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents/test-id",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Accept: "application/json",
          }),
          body: JSON.stringify(updateData),
        })
      );
    });

    test("handles agent not found during update", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            error: { message: "Agent not found", code: "AGENT_NOT_FOUND" },
          }),
      });

      const client = new AgentRegistryClient(mockConfig);

      await expect(
        client.updateAgent("nonexistent-id", { name: "New Name" })
      ).rejects.toThrow("Agent not found");
    });

    test("validates update parameters", async () => {
      const client = new AgentRegistryClient(mockConfig);

      // Test empty agent ID
      await expect(
        client.updateAgent("", { name: "New Name" })
      ).rejects.toThrow("Agent ID is required");

      // Test empty update data
      await expect(client.updateAgent("test-id", {})).rejects.toThrow(
        "Update data is required"
      );
    });
  });

  describe("updateHealth", () => {
    test("updates health successfully", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            message: "Health updated successfully",
            timestamp: "2024-01-15T12:00:00Z",
          }),
      });

      const client = new AgentRegistryClient(mockConfig);
      const result = await client.updateHealth("test-id");

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents/test-id/health",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    test("handles health update failure", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            error: { message: "Update failed", code: "SERVER_ERROR" },
          }),
      });

      const client = new AgentRegistryClient(mockConfig);

      await expect(client.updateHealth("test-id")).rejects.toThrow(
        "Update failed"
      );
    });
  });

  describe("Authentication", () => {
    test("includes standard headers in requests", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            agents: [],
            pagination: { total: 0, has_more: false, limit: 50, offset: 0 },
          }),
      });

      const client = new AgentRegistryClient(mockConfig);
      await client.listAgents();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Accept: "application/json",
          }),
        })
      );
    });

    test("handles authentication failure", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Map([["content-type", "application/json"]]),
        json: () =>
          Promise.resolve({
            error: { message: "Invalid credentials", code: "AUTH_ERROR" },
          }),
      });

      const client = new AgentRegistryClient(mockConfig);

      await expect(client.listAgents()).rejects.toThrow(
        "Authentication failed. Please check your credentials."
      );
    });
  });

  describe("Error handling", () => {
    test("handles malformed JSON response", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      const client = new AgentRegistryClient(mockConfig);

      await expect(client.listAgents()).rejects.toThrow(
        "Request failed: Invalid JSON"
      );
    });

    test("handles timeout errors", async () => {
      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Request timeout")), 100)
          )
      );

      const client = new AgentRegistryClient(mockConfig);

      await expect(client.listAgents()).rejects.toThrow("Request timeout");
    });

    test("preserves error details from API responses", async () => {
      const errorResponse = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid agent data",
          details: { field: "name", reason: "Required" },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve(errorResponse),
      });

      const client = new AgentRegistryClient(mockConfig);

      try {
        await client.createAgent(mockAgent);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Invalid agent data");
      }
    });
  });

  describe("URL construction", () => {
    test("properly encodes query parameters", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ results: [] }),
      });

      const client = new AgentRegistryClient(mockConfig);
      await client.searchAgents("test query with spaces", [
        "skill with spaces",
      ]);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents/search?top_k=10&text=test+query+with+spaces&skills=skill+with+spaces",
        expect.any(Object)
      );
    });

    test("handles special characters in agent IDs", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ agent: mockAgent }),
      });

      const client = new AgentRegistryClient(mockConfig);
      await client.getAgent("agent-id-with-special-chars-123");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/agents/agent-id-with-special-chars-123",
        expect.any(Object)
      );
    });
  });
});
