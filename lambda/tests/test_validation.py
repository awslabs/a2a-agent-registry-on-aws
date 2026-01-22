"""
Unit tests for validation utilities using a2a-sdk AgentCard type as source of truth
"""
import pytest

from src.utils.validation import ValidationError, validate_agent_card, validate_agent_card_update


class TestValidateAgentCard:
    """Test cases for validate_agent_card function using a2a-sdk AgentCard"""
    
    def test_validate_success(self):
        """Test successful validation of agent card data"""
        agent_data = {
            "name": "Test Agent",
            "description": "A test agent for validation",
            "version": "1.0.0",
            "url": "https://example.com/agent",
            "skills": ["python", "testing"]
        }
        
        result = validate_agent_card(agent_data)
        
        assert result["name"] == "Test Agent"
        assert result["description"] == "A test agent for validation"
        assert result["version"] == "1.0.0"
        assert result["url"] == "https://example.com/agent"
        # Skills are converted to AgentSkill format
        assert len(result["skills"]) == 2
        assert result["skills"][0]["name"] == "python"
        assert result["skills"][1]["name"] == "testing"
    
    def test_validate_with_full_skill_objects(self):
        """Test validation with full AgentSkill objects"""
        agent_data = {
            "name": "Test Agent",
            "description": "A test agent",
            "version": "1.0.0",
            "url": "https://example.com/agent",
            "skills": [
                {
                    "id": "skill-1",
                    "name": "Python Development",
                    "description": "Expert Python coding",
                    "tags": ["python", "coding"]
                }
            ]
        }
        
        result = validate_agent_card(agent_data)
        
        assert result["skills"][0]["id"] == "skill-1"
        assert result["skills"][0]["name"] == "Python Development"
        assert result["skills"][0]["tags"] == ["python", "coding"]
    
    def test_validate_missing_required_field_name(self):
        """Test validation error for missing name"""
        agent_data = {
            "description": "A test agent",
            "version": "1.0.0",
            "url": "https://example.com/agent"
        }
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card(agent_data)
        
        assert "name" in exc_info.value.field
    
    def test_validate_missing_required_field_url(self):
        """Test validation error for missing url"""
        agent_data = {
            "name": "Test Agent",
            "description": "A test agent",
            "version": "1.0.0"
        }
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card(agent_data)
        
        assert "url" in exc_info.value.field
    
    def test_validate_missing_required_field_version(self):
        """Test validation error for missing version"""
        agent_data = {
            "name": "Test Agent",
            "description": "A test agent",
            "url": "https://example.com/agent"
        }
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card(agent_data)
        
        assert "version" in exc_info.value.field
    
    def test_validate_missing_required_field_description(self):
        """Test validation error for missing description"""
        agent_data = {
            "name": "Test Agent",
            "version": "1.0.0",
            "url": "https://example.com/agent"
        }
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card(agent_data)
        
        assert "description" in exc_info.value.field
    
    def test_validate_non_dict_error(self):
        """Test validation error for non-dictionary data"""
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card("not a dict")
        
        assert exc_info.value.field == "agent_card"
        assert "must be a dictionary" in exc_info.value.message
    
    def test_validate_with_capabilities(self):
        """Test validation with capabilities"""
        agent_data = {
            "name": "Test Agent",
            "description": "A test agent",
            "version": "1.0.0",
            "url": "https://example.com/agent",
            "capabilities": {
                "streaming": True,
                "pushNotifications": False
            }
        }
        
        result = validate_agent_card(agent_data)
        
        assert result["capabilities"]["streaming"] is True
        assert result["capabilities"]["pushNotifications"] is False
    
    def test_validate_with_input_output_modes(self):
        """Test validation with input/output modes"""
        agent_data = {
            "name": "Test Agent",
            "description": "A test agent",
            "version": "1.0.0",
            "url": "https://example.com/agent",
            "defaultInputModes": ["text", "image"],
            "defaultOutputModes": ["text"]
        }
        
        result = validate_agent_card(agent_data)
        
        assert result["defaultInputModes"] == ["text", "image"]
        assert result["defaultOutputModes"] == ["text"]
    
    def test_validate_defaults_applied(self):
        """Test that defaults are applied for optional fields"""
        agent_data = {
            "name": "Test Agent",
            "description": "A test agent",
            "version": "1.0.0",
            "url": "https://example.com/agent"
        }
        
        result = validate_agent_card(agent_data)
        
        assert "capabilities" in result
        assert result["defaultInputModes"] == ["text"]
        assert result["defaultOutputModes"] == ["text"]
        assert result["skills"] == []


class TestValidateAgentCardUpdate:
    """Test cases for validate_agent_card_update function"""
    
    def test_validate_update_success(self):
        """Test successful validation of update data"""
        update_data = {
            "name": "Updated Agent Name",
            "description": "Updated description for the agent",
            "skills": ["python", "testing", "automation"]
        }
        
        result = validate_agent_card_update(update_data)
        
        assert result["name"] == "Updated Agent Name"
        assert result["description"] == "Updated description for the agent"
        # Skills are converted to AgentSkill format
        assert len(result["skills"]) == 3
        assert result["skills"][0]["name"] == "python"
    
    def test_validate_partial_update(self):
        """Test validation of partial update data"""
        update_data = {
            "name": "New Name Only"
        }
        
        result = validate_agent_card_update(update_data)
        
        assert result["name"] == "New Name Only"
        assert len(result) == 1  # Only name should be in result
    
    def test_validate_empty_data_error(self):
        """Test validation error for empty update data"""
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card_update({})
        
        assert exc_info.value.field == "agent_card"
        assert "cannot be empty" in exc_info.value.message
    
    def test_validate_non_dict_error(self):
        """Test validation error for non-dictionary data"""
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card_update("not a dict")
        
        assert exc_info.value.field == "agent_card"
        assert "must be a dictionary" in exc_info.value.message
    
    def test_validate_empty_name_error(self):
        """Test validation error for empty name"""
        update_data = {"name": ""}
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card_update(update_data)
        
        assert exc_info.value.field == "name"
    
    def test_validate_empty_description_error(self):
        """Test validation error for empty description"""
        update_data = {"description": ""}
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card_update(update_data)
        
        assert exc_info.value.field == "description"
    
    def test_validate_empty_version_error(self):
        """Test validation error for empty version"""
        update_data = {"version": ""}
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card_update(update_data)
        
        assert exc_info.value.field == "version"
    
    def test_validate_invalid_url(self):
        """Test validation error for invalid URL"""
        update_data = {"url": "not-a-url"}
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card_update(update_data)
        
        assert exc_info.value.field == "url"
        assert "valid HTTP/HTTPS URL" in exc_info.value.message
    
    def test_validate_invalid_capabilities(self):
        """Test validation error for invalid capabilities"""
        update_data = {"capabilities": "not a dict"}
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card_update(update_data)
        
        assert exc_info.value.field == "capabilities"
        assert "must be a dictionary" in exc_info.value.message
    
    def test_validate_invalid_skills(self):
        """Test validation error for invalid skills"""
        update_data = {"skills": "not a list"}
        
        with pytest.raises(ValidationError) as exc_info:
            validate_agent_card_update(update_data)
        
        assert exc_info.value.field == "skills"
        assert "must be a list" in exc_info.value.message
    
    def test_validate_valid_version_formats(self):
        """Test validation success for various valid version formats"""
        valid_versions = [
            "1.0.0",
            "2.1.3",
            "1.0.0-alpha",
            "1.0.0-beta.1",
            "10.20.30"
        ]
        
        for version in valid_versions:
            update_data = {"version": version}
            result = validate_agent_card_update(update_data)
            assert result["version"] == version
    
    def test_validate_valid_urls(self):
        """Test validation success for various valid URLs"""
        valid_urls = [
            "https://example.com",
            "http://localhost:8080",
            "https://api.example.com/v1/agent",
            "https://subdomain.example.com/path?query=value"
        ]
        
        for url in valid_urls:
            update_data = {"url": url}
            result = validate_agent_card_update(update_data)
            assert result["url"] == url
    
    def test_validate_capabilities_with_streaming(self):
        """Test validation of capabilities with streaming"""
        update_data = {
            "capabilities": {
                "streaming": True,
                "pushNotifications": False
            }
        }
        
        result = validate_agent_card_update(update_data)
        
        assert result["capabilities"]["streaming"] is True
    
    def test_validate_input_modes(self):
        """Test validation of defaultInputModes"""
        update_data = {
            "defaultInputModes": ["text", "image"]
        }
        
        result = validate_agent_card_update(update_data)
        
        assert result["defaultInputModes"] == ["text", "image"]
    
    def test_validate_output_modes(self):
        """Test validation of defaultOutputModes"""
        update_data = {
            "defaultOutputModes": ["text", "audio"]
        }
        
        result = validate_agent_card_update(update_data)
        
        assert result["defaultOutputModes"] == ["text", "audio"]
    
    def test_validate_skills_converted_to_agent_skill_format(self):
        """Test that string skills are converted to AgentSkill format"""
        update_data = {
            "skills": ["python", "javascript"]
        }
        
        result = validate_agent_card_update(update_data)
        
        assert len(result["skills"]) == 2
        assert result["skills"][0]["name"] == "python"
        assert result["skills"][0]["id"] == "skill-0"
        assert "tags" in result["skills"][0]
    
    def test_validate_full_skill_objects_preserved(self):
        """Test that full AgentSkill objects are preserved"""
        update_data = {
            "skills": [
                {
                    "id": "custom-id",
                    "name": "Custom Skill",
                    "description": "A custom skill",
                    "tags": ["custom", "skill"]
                }
            ]
        }
        
        result = validate_agent_card_update(update_data)
        
        assert result["skills"][0]["id"] == "custom-id"
        assert result["skills"][0]["name"] == "Custom Skill"
        assert result["skills"][0]["tags"] == ["custom", "skill"]
