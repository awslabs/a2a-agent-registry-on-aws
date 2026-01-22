/**
 * AgentCard validation utilities using @a2a-js/sdk types as source of truth
 */
import type { AgentCard, AgentSkill } from '@a2a-js/sdk';

export interface ValidationResult {
  isValid: boolean;
  agentCard?: AgentCard;
  error?: string;
  errors?: string[];
}

/**
 * Validates an AgentSkill object according to the A2A protocol
 */
function validateAgentSkill(skill: unknown, index: number): string | null {
  if (typeof skill === 'string') {
    // String skills are accepted and will be converted by the backend
    if (!skill.trim()) {
      return `Skill at index ${index} cannot be empty`;
    }
    return null;
  }

  if (typeof skill !== 'object' || skill === null) {
    return `Skill at index ${index} must be an object or string`;
  }

  const skillObj = skill as Record<string, unknown>;

  // Required fields for AgentSkill
  if (typeof skillObj.id !== 'string' || !skillObj.id.trim()) {
    return `Skill at index ${index} must have a non-empty 'id' field`;
  }

  if (typeof skillObj.name !== 'string' || !skillObj.name.trim()) {
    return `Skill at index ${index} must have a non-empty 'name' field`;
  }

  if (typeof skillObj.description !== 'string' || !skillObj.description.trim()) {
    return `Skill at index ${index} must have a non-empty 'description' field`;
  }

  if (!Array.isArray(skillObj.tags)) {
    return `Skill at index ${index} must have a 'tags' array`;
  }

  // Validate optional fields
  if (skillObj.examples !== undefined && !Array.isArray(skillObj.examples)) {
    return `Skill at index ${index} 'examples' must be an array`;
  }

  if (skillObj.inputModes !== undefined && !Array.isArray(skillObj.inputModes)) {
    return `Skill at index ${index} 'inputModes' must be an array`;
  }

  if (skillObj.outputModes !== undefined && !Array.isArray(skillObj.outputModes)) {
    return `Skill at index ${index} 'outputModes' must be an array`;
  }

  return null;
}

/**
 * Validates AgentCapabilities according to the A2A protocol
 */
function validateCapabilities(capabilities: unknown): string | null {
  if (typeof capabilities !== 'object' || capabilities === null) {
    return 'Capabilities must be an object';
  }

  const caps = capabilities as Record<string, unknown>;

  // All capability fields are optional booleans
  if (caps.streaming !== undefined && typeof caps.streaming !== 'boolean') {
    return 'capabilities.streaming must be a boolean';
  }

  if (caps.pushNotifications !== undefined && typeof caps.pushNotifications !== 'boolean') {
    return 'capabilities.pushNotifications must be a boolean';
  }

  if (caps.stateTransitionHistory !== undefined && typeof caps.stateTransitionHistory !== 'boolean') {
    return 'capabilities.stateTransitionHistory must be a boolean';
  }

  return null;
}

/**
 * Validates an AgentCard JSON object according to the A2A protocol specification.
 * Uses @a2a-js/sdk types as the source of truth.
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

  // Required fields per A2A protocol AgentCard specification
  if (typeof data.name !== 'string' || !data.name.trim()) {
    errors.push('name is required and must be a non-empty string');
  }

  if (typeof data.description !== 'string' || !data.description.trim()) {
    errors.push('description is required and must be a non-empty string');
  }

  if (typeof data.version !== 'string' || !data.version.trim()) {
    errors.push('version is required and must be a non-empty string');
  }

  if (typeof data.url !== 'string' || !data.url.trim()) {
    errors.push('url is required and must be a non-empty string');
  } else {
    // Basic URL validation
    try {
      new URL(data.url as string);
    } catch {
      errors.push('url must be a valid URL');
    }
  }

  // capabilities is required
  if (data.capabilities === undefined) {
    errors.push('capabilities is required');
  } else {
    const capError = validateCapabilities(data.capabilities);
    if (capError) {
      errors.push(capError);
    }
  }

  // defaultInputModes is required
  if (!Array.isArray(data.defaultInputModes)) {
    errors.push('defaultInputModes is required and must be an array');
  } else if (data.defaultInputModes.length === 0) {
    errors.push('defaultInputModes must have at least one mode');
  } else {
    for (let i = 0; i < data.defaultInputModes.length; i++) {
      if (typeof data.defaultInputModes[i] !== 'string') {
        errors.push(`defaultInputModes[${i}] must be a string`);
      }
    }
  }

  // defaultOutputModes is required
  if (!Array.isArray(data.defaultOutputModes)) {
    errors.push('defaultOutputModes is required and must be an array');
  } else if (data.defaultOutputModes.length === 0) {
    errors.push('defaultOutputModes must have at least one mode');
  } else {
    for (let i = 0; i < data.defaultOutputModes.length; i++) {
      if (typeof data.defaultOutputModes[i] !== 'string') {
        errors.push(`defaultOutputModes[${i}] must be a string`);
      }
    }
  }

  // skills is required
  if (!Array.isArray(data.skills)) {
    errors.push('skills is required and must be an array');
  } else {
    for (let i = 0; i < data.skills.length; i++) {
      const skillError = validateAgentSkill(data.skills[i], i);
      if (skillError) {
        errors.push(skillError);
      }
    }
  }

  // protocolVersion is required (defaults to "0.3.0" in the protocol)
  if (data.protocolVersion !== undefined && typeof data.protocolVersion !== 'string') {
    errors.push('protocolVersion must be a string');
  }

  // Optional field validations
  if (data.preferredTransport !== undefined && typeof data.preferredTransport !== 'string') {
    errors.push('preferredTransport must be a string');
  }

  if (data.documentationUrl !== undefined) {
    if (typeof data.documentationUrl !== 'string') {
      errors.push('documentationUrl must be a string');
    } else {
      try {
        new URL(data.documentationUrl);
      } catch {
        errors.push('documentationUrl must be a valid URL');
      }
    }
  }

  if (data.iconUrl !== undefined) {
    if (typeof data.iconUrl !== 'string') {
      errors.push('iconUrl must be a string');
    } else {
      try {
        new URL(data.iconUrl);
      } catch {
        errors.push('iconUrl must be a valid URL');
      }
    }
  }

  if (data.provider !== undefined) {
    if (typeof data.provider !== 'object' || data.provider === null) {
      errors.push('provider must be an object');
    }
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
 * Converts string skills to AgentSkill format for display purposes
 */
export function normalizeSkills(skills: (string | AgentSkill)[]): AgentSkill[] {
  return skills.map((skill, index) => {
    if (typeof skill === 'string') {
      return {
        id: `skill-${index}`,
        name: skill,
        description: skill,
        tags: [skill.toLowerCase()],
      };
    }
    return skill;
  });
}

/**
 * Gets the skill count from an AgentCard, handling both string and object formats
 */
export function getSkillCount(skills: (string | AgentSkill)[] | undefined): number {
  if (!skills || !Array.isArray(skills)) {
    return 0;
  }
  return skills.length;
}

/**
 * Gets skill names from an AgentCard, handling both string and object formats
 */
export function getSkillNames(skills: (string | AgentSkill)[] | undefined): string[] {
  if (!skills || !Array.isArray(skills)) {
    return [];
  }
  return skills.map((skill) => {
    if (typeof skill === 'string') {
      return skill;
    }
    return skill.name;
  });
}
