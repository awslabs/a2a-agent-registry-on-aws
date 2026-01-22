// Re-export A2A Protocol types from @a2a-js/sdk as the source of truth
export type {
  AgentCard,
  AgentSkill,
  AgentCapabilities,
  AgentProvider,
  AgentInterface,
  AgentCardSignature,
  SecurityScheme,
} from '@a2a-js/sdk';

// Import types for use in local interfaces
import type { AgentCard } from '@a2a-js/sdk';

// Application-specific types that extend the A2A protocol types

export interface Agent {
  agent_id: string;
  agent_card: AgentCard;
  is_online: boolean;
  last_seen: string;
}

export interface StoredAgentCard {
  id: string;
  agent_card: AgentCard;
  created_at: string;
  updated_at: string;
  last_online?: string;
}

export interface SearchResult {
  agent_id: string;
  agent_card: AgentCard;
  similarity_score?: number;
  matched_skills?: string[];
  matched_text?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

// Backend response type that includes agent_id with the agent card
export interface AgentWithId extends AgentCard {
  agent_id: string;
}
