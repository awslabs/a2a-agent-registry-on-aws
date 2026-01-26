"""
Input validation utilities using a2a-sdk AgentCard type validation
"""
import re
import uuid
from typing import Dict, Any, List, Optional, Union
from a2a.types import AgentCard, AgentCapabilities, AgentSkill
from pydantic import ValidationError as PydanticValidationError


class ValidationError(Exception):
    """Custom validation error"""
    def __init__(self, field: str, message: str, details: Optional[Dict] = None):
        self.field = field
        self.message = message
        self.details = details or {}
        super().__init__(f"Validation error in field '{field}': {message}")


def validate_uuid(value: str, field_name: str) -> str:
    """
    Validate UUID format
    
    Args:
        value: UUID string to validate
        field_name: Field name for error reporting
        
    Returns:
        Validated UUID string
        
    Raises:
        ValidationError: If UUID is invalid
    """
    if not value:
        raise ValidationError(field_name, "UUID is required")
    
    try:
        uuid.UUID(value)
        return value
    except ValueError:
        raise ValidationError(field_name, "Invalid UUID format")


def _convert_skills_to_agent_skills(skills: List[Any]) -> List[Dict[str, Any]]:
    """
    Convert skills input to AgentSkill format expected by a2a-sdk.
    
    Handles both string skills (legacy format) and dict skills (a2a format).
    
    Args:
        skills: List of skills (strings or dicts)
        
    Returns:
        List of AgentSkill-compatible dicts
    """
    converted_skills = []
    for i, skill in enumerate(skills):
        if isinstance(skill, str):
            # Convert string skill to AgentSkill format
            skill_str = skill.strip()
            if skill_str:
                converted_skills.append({
                    "id": f"skill-{i}",
                    "name": skill_str,
                    "description": skill_str,
                    "tags": [skill_str.lower()]
                })
        elif isinstance(skill, dict):
            # Ensure required fields for AgentSkill
            skill_dict = {
                "id": skill.get("id", f"skill-{i}"),
                "name": skill.get("name", ""),
                "description": skill.get("description", skill.get("name", "")),
                "tags": skill.get("tags", [])
            }
            # Add optional fields if present
            if "examples" in skill:
                skill_dict["examples"] = skill["examples"]
            if "inputModes" in skill:
                skill_dict["inputModes"] = skill["inputModes"]
            if "outputModes" in skill:
                skill_dict["outputModes"] = skill["outputModes"]
            converted_skills.append(skill_dict)
    return converted_skills


def validate_agent_card(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate agent card data using a2a-sdk AgentCard type.
    
    Args:
        data: Raw input data
        
    Returns:
        Validated agent card data as dict
        
    Raises:
        ValidationError: If validation fails
    """
    if not isinstance(data, dict):
        raise ValidationError("agent_card", "Agent card data must be a dictionary")
    
    # Prepare data for AgentCard validation
    agent_card_data = dict(data)
    
    # Set defaults for optional fields
    if "capabilities" not in agent_card_data:
        agent_card_data["capabilities"] = {}
    
    if "defaultInputModes" not in agent_card_data:
        agent_card_data["defaultInputModes"] = ["text"]
    
    if "defaultOutputModes" not in agent_card_data:
        agent_card_data["defaultOutputModes"] = ["text"]
    
    if "skills" not in agent_card_data:
        agent_card_data["skills"] = []
    
    # Convert skills to AgentSkill format
    agent_card_data["skills"] = _convert_skills_to_agent_skills(agent_card_data["skills"])
    
    try:
        # Validate using a2a-sdk AgentCard
        agent_card = AgentCard.model_validate(agent_card_data)
        
        # Convert back to dict for storage, preserving the validated structure
        validated_data = agent_card.model_dump(exclude_none=True)
        
        return validated_data
        
    except PydanticValidationError as e:
        # Extract first error for user-friendly message
        errors = e.errors()
        if errors:
            first_error = errors[0]
            field = ".".join(str(loc) for loc in first_error.get("loc", ["agent_card"]))
            message = first_error.get("msg", "Validation failed")
            raise ValidationError(field, message, {"all_errors": [
                {"field": ".".join(str(loc) for loc in err.get("loc", [])), "message": err.get("msg", "")}
                for err in errors
            ]})
        raise ValidationError("agent_card", f"AgentCard validation failed: {str(e)}")


def validate_search_params(text_query: Optional[str] = None, skills: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Validate search parameters
    
    Args:
        text_query: Search query text
        skills: Optional list of skills
        
    Returns:
        Validated parameters
        
    Raises:
        ValidationError: If validation fails
    """
    validated_params = {}
    
    # Validate text query
    if text_query is not None:
        text_query = text_query.strip()
        if len(text_query) < 2:
            raise ValidationError("text", "Search text must be at least 2 characters long")
        
        if len(text_query) > 500:
            raise ValidationError("text", "Search text must be less than 500 characters")
        
        validated_params["text"] = text_query
    
    # Validate skills
    if skills is not None:
        if not isinstance(skills, list):
            raise ValidationError("skills", "Skills must be a list")
        
        validated_skills = []
        for i, skill in enumerate(skills):
            if not isinstance(skill, str):
                raise ValidationError("skills", f"Skill at index {i} must be a string")
            
            skill = skill.strip()
            if not skill:
                raise ValidationError("skills", f"Skill at index {i} cannot be empty")
            
            if len(skill) > 50:
                raise ValidationError("skills", f"Skill at index {i} must be less than 50 characters")
            
            validated_skills.append(skill)
        
        if len(validated_skills) > 10:
            raise ValidationError("skills", "Maximum 10 skills allowed in search")
        
        validated_params["skills"] = validated_skills
    
    # Ensure at least one search parameter is provided
    if not validated_params:
        raise ValidationError("search", "Either text or skills parameter must be provided")
    
    return validated_params


def validate_agent_card_update(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate agent card update data (partial updates allowed).
    
    For partial updates, we validate individual fields without requiring
    all AgentCard fields to be present.
    
    Args:
        data: Raw update data (can be partial)
        
    Returns:
        Validated update data
        
    Raises:
        ValidationError: If validation fails
    """
    if not isinstance(data, dict):
        raise ValidationError("agent_card", "Agent card update data must be a dictionary")
    
    if not data:
        raise ValidationError("agent_card", "Update data cannot be empty")
    
    validated_data = {}
    
    # Validate name (if provided)
    if "name" in data:
        name = data.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValidationError("name", "Name must be a non-empty string")
        validated_data["name"] = name.strip()
    
    # Validate description (if provided)
    if "description" in data:
        description = data.get("description")
        if not isinstance(description, str) or not description.strip():
            raise ValidationError("description", "Description must be a non-empty string")
        validated_data["description"] = description.strip()
    
    # Validate URL (if provided)
    if "url" in data:
        url = data.get("url")
        if not isinstance(url, str) or not url.strip():
            raise ValidationError("url", "URL must be a non-empty string")
        url = url.strip()
        url_pattern = r'^https?://[^\s/$.?#].[^\s]*$'
        if not re.match(url_pattern, url):
            raise ValidationError("url", "URL must be a valid HTTP/HTTPS URL")
        validated_data["url"] = url
    
    # Validate protocolVersion (if provided)
    if "protocolVersion" in data:
        protocol_version = data.get("protocolVersion")
        if not isinstance(protocol_version, str) or not protocol_version.strip():
            raise ValidationError("protocolVersion", "Protocol version must be a non-empty string")
        validated_data["protocolVersion"] = protocol_version.strip()
    
    # Validate preferredTransport (if provided)
    if "preferredTransport" in data:
        preferred_transport = data.get("preferredTransport")
        if not isinstance(preferred_transport, str):
            raise ValidationError("preferredTransport", "Preferred transport must be a string")
        validated_data["preferredTransport"] = preferred_transport
    
    # Validate capabilities (if provided)
    if "capabilities" in data:
        capabilities = data.get("capabilities")
        if not isinstance(capabilities, dict):
            raise ValidationError("capabilities", "Capabilities must be a dictionary")
        # Validate using AgentCapabilities
        try:
            AgentCapabilities.model_validate(capabilities)
            validated_data["capabilities"] = capabilities
        except PydanticValidationError as e:
            errors = e.errors()
            if errors:
                first_error = errors[0]
                field = "capabilities." + ".".join(str(loc) for loc in first_error.get("loc", []))
                raise ValidationError(field, first_error.get("msg", "Invalid capabilities"))
            raise ValidationError("capabilities", "Invalid capabilities format")
    
    # Validate defaultInputModes (if provided)
    if "defaultInputModes" in data:
        default_input_modes = data.get("defaultInputModes")
        if not isinstance(default_input_modes, list):
            raise ValidationError("defaultInputModes", "Default input modes must be a list")
        for i, mode in enumerate(default_input_modes):
            if not isinstance(mode, str):
                raise ValidationError("defaultInputModes", f"Input mode at index {i} must be a string")
        validated_data["defaultInputModes"] = default_input_modes
    
    # Validate defaultOutputModes (if provided)
    if "defaultOutputModes" in data:
        default_output_modes = data.get("defaultOutputModes")
        if not isinstance(default_output_modes, list):
            raise ValidationError("defaultOutputModes", "Default output modes must be a list")
        for i, mode in enumerate(default_output_modes):
            if not isinstance(mode, str):
                raise ValidationError("defaultOutputModes", f"Output mode at index {i} must be a string")
        validated_data["defaultOutputModes"] = default_output_modes
    
    # Validate skills (if provided)
    if "skills" in data:
        skills = data.get("skills")
        if not isinstance(skills, list):
            raise ValidationError("skills", "Skills must be a list")
        # Convert and validate skills
        validated_data["skills"] = _convert_skills_to_agent_skills(skills)
    
    return validated_data


def validate_pagination_params(limit: Optional[int] = None, offset: Optional[int] = None) -> Dict[str, int]:
    """
    Validate pagination parameters
    
    Args:
        limit: Number of items to return
        offset: Number of items to skip
        
    Returns:
        Validated pagination parameters
        
    Raises:
        ValidationError: If validation fails
    """
    validated_params = {}
    
    # Validate limit
    if limit is not None:
        if not isinstance(limit, int) or limit < 1:
            raise ValidationError("limit", "Limit must be a positive integer")
        
        if limit > 100:
            raise ValidationError("limit", "Limit cannot exceed 100")
        
        validated_params["limit"] = limit
    else:
        validated_params["limit"] = 50  # Default limit
    
    # Validate offset
    if offset is not None:
        if not isinstance(offset, int) or offset < 0:
            raise ValidationError("offset", "Offset must be a non-negative integer")
        
        validated_params["offset"] = offset
    else:
        validated_params["offset"] = 0  # Default offset
    
    return validated_params
