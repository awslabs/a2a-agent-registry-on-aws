/**
 * AgentCard validation utilities
 * 
 * Note: The authoritative validation is done by the backend using a2a-sdk AgentCard types.
 * This frontend validation provides quick feedback before submission.
 */
import type { AgentCard, AgentSkill } from '@a2a-js/sdk';

export interface ValidationResult {
  isValid: boolean;
  agentCard?: AgentCard;
  error?: string;
  errors?: string[];
}

/**
 * Validates an AgentCard JSON string.
 * Performs basic structural validation for quick UI feedback.
 * The backend performs authoritative validation using a2a.types.AgentCard.
 */
export function validateAgentCard(jsonString: string): ValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON format',
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      isValid: false,
      error: 'AgentCard must be a JSON object',
    };
  }

  const data = parsed as Record<string, unknown>;
  const errors: string[] = [];

  // Basic required field checks per A2A AgentCard schema
  // Full validation is done by backend using a2a.types.AgentCard
  if (typeof data.name !== 'string' || !data.name.trim()) {
    errors.push('name is required');
  }

  if (typeof data.description !== 'string' || !data.description.trim()) {
    errors.push('description is required');
  }

  if (typeof data.url !== 'string' || !data.url.trim()) {
    errors.push('url is required');
  }

  if (typeof data.protocolVersion !== 'string' || !data.protocolVersion.trim()) {
    errors.push('protocolVersion is required');
  }

  if (data.capabilities === undefined || typeof data.capabilities !== 'object') {
    errors.push('capabilities is required');
  }

  if (!Array.isArray(data.defaultInputModes) || data.defaultInputModes.length === 0) {
    errors.push('defaultInputModes is required');
  }

  if (!Array.isArray(data.defaultOutputModes) || data.defaultOutputModes.length === 0) {
    errors.push('defaultOutputModes is required');
  }

  if (!Array.isArray(data.skills)) {
    errors.push('skills is required');
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      error: errors[0],
      errors,
    };
  }

  return {
    isValid: true,
    agentCard: parsed as AgentCard,
  };
}

/**
 * Gets the skill count from an AgentCard
 */
export function getSkillCount(skills: AgentSkill[] | undefined): number {
  return skills?.length ?? 0;
}

/**
 * Gets skill names from an AgentCard
 */
export function getSkillNames(skills: AgentSkill[] | undefined): string[] {
  return skills?.map(skill => skill.name) ?? [];
}
