// Agent Edit Modal component for updating existing agents
import React, { useState, useEffect } from 'react';
import {
  Modal,
  Box,
  SpaceBetween,
  Button,
  FormField,
  Input,
  Textarea,
  Alert,
  Header,
  Container,
  Multiselect,
  Select,
  Toggle,
} from '@cloudscape-design/components';
import { AgentCard } from '../types/AgentCard';
import { useAgentRegistry } from '../contexts/AgentRegistryContext';

interface AgentEditModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess?: () => void;
  agentId: string;
  initialAgentCard: AgentCard;
}

const AgentEditModal: React.FC<AgentEditModalProps> = ({
  visible,
  onDismiss,
  onSuccess,
  agentId,
  initialAgentCard,
}) => {
  const { client } = useAgentRegistry();
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    version: '',
    url: '',
    skills: [] as string[],
    preferredTransport: '',
    streaming: false,
  });
  
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Initialize form data when modal opens or agent changes
  useEffect(() => {
    if (visible && initialAgentCard) {
      setFormData({
        name: initialAgentCard.name || '',
        description: initialAgentCard.description || '',
        version: initialAgentCard.version || '',
        url: initialAgentCard.url || '',
        skills: Array.isArray(initialAgentCard.skills) 
          ? initialAgentCard.skills.map(skill => skill.name || skill.id)
          : [],
        preferredTransport: initialAgentCard.preferredTransport || 'JSONRPC',
        streaming: initialAgentCard.capabilities?.streaming || false,
      });
      setValidationErrors({});
      setSubmitError(null);
    }
  }, [visible, initialAgentCard]);

  // Transport options
  const transportOptions = [
    { label: 'JSONRPC', value: 'JSONRPC' },
    { label: 'HTTP', value: 'HTTP' },
    { label: 'WebSocket', value: 'WebSocket' },
  ];

  // Validate form data
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    } else if (formData.name.length < 2) {
      errors.name = 'Name must be at least 2 characters';
    } else if (formData.name.length > 100) {
      errors.name = 'Name must be less than 100 characters';
    }

    if (!formData.description.trim()) {
      errors.description = 'Description is required';
    } else if (formData.description.length < 10) {
      errors.description = 'Description must be at least 10 characters';
    } else if (formData.description.length > 1000) {
      errors.description = 'Description must be less than 1000 characters';
    }

    if (!formData.version.trim()) {
      errors.version = 'Version is required';
    } else if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(formData.version)) {
      errors.version = 'Version must follow semantic versioning (e.g., 1.0.0)';
    }

    if (!formData.url.trim()) {
      errors.url = 'URL is required';
    } else if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/.test(formData.url)) {
      errors.url = 'URL must be a valid HTTP/HTTPS URL';
    }

    if (formData.skills.length === 0) {
      errors.skills = 'At least one skill is required';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      
      // Prepare update data - only include changed fields
      const updateData: Partial<AgentCard> = {};
      
      if (formData.name !== initialAgentCard.name) {
        updateData.name = formData.name;
      }
      
      if (formData.description !== initialAgentCard.description) {
        updateData.description = formData.description;
      }
      
      if (formData.version !== initialAgentCard.version) {
        updateData.version = formData.version;
      }
      
      if (formData.url !== initialAgentCard.url) {
        updateData.url = formData.url;
      }
      
      if (formData.preferredTransport !== initialAgentCard.preferredTransport) {
        updateData.preferredTransport = formData.preferredTransport;
      }
      
      // Compare skills arrays
      const currentSkills = Array.isArray(initialAgentCard.skills) 
        ? initialAgentCard.skills.map(skill => skill.name || skill.id)
        : [];
      
      if (JSON.stringify(formData.skills.sort()) !== JSON.stringify(currentSkills.sort())) {
        // Convert string skills to AgentSkill format for the API
        updateData.skills = formData.skills.map((skill, index) => ({
          id: `skill-${index}`,
          name: skill,
          description: skill,
          tags: [skill.toLowerCase()]
        }));
      }
      
      // Compare streaming capability
      const currentStreaming = initialAgentCard.capabilities?.streaming || false;
      if (formData.streaming !== currentStreaming) {
        updateData.capabilities = {
          ...initialAgentCard.capabilities,
          streaming: formData.streaming,
        };
      }
      
      // Only update if there are changes
      if (Object.keys(updateData).length === 0) {
        setSubmitError('No changes detected');
        return;
      }
      
      if (!client) {
        setSubmitError('API client not available');
        return;
      }
      
      const success = await client.updateAgent(agentId, updateData);
      
      if (success) {
        // Success - close modal and notify parent
        onDismiss();
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setSubmitError('Update operation returned false');
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to update agent');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle modal dismiss
  const handleDismiss = () => {
    // Reset form state
    setValidationErrors({});
    setSubmitError(null);
    setSubmitting(false);
    
    onDismiss();
  };

  // Handle skills change
  const handleSkillsChange = (selectedOptions: readonly any[]) => {
    const skills = selectedOptions.map(option => option.value || option.label);
    setFormData(prev => ({ ...prev, skills }));
  };

  // Convert skills to multiselect options
  const skillsOptions = formData.skills.map(skill => ({ label: skill, value: skill }));

  return (
    <Modal
      onDismiss={handleDismiss}
      visible={visible}
      closeAriaLabel="Close modal"
      size="large"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={submitting}
              loading={submitting}
            >
              Update Agent
            </Button>
          </SpaceBetween>
        </Box>
      }
      header={`Edit Agent - ${initialAgentCard.name}`}
    >
      <SpaceBetween direction="vertical" size="l">
        {submitError && (
          <Alert type="error" header="Update Failed">
            {submitError}
          </Alert>
        )}

        <Container
          header={
            <Header variant="h2" description="Update agent information">
              Agent Details
            </Header>
          }
        >
          <SpaceBetween direction="vertical" size="m">
            <FormField
              label="Name"
              description="Agent display name"
              errorText={validationErrors.name}
            >
              <Input
                value={formData.name}
                onChange={({ detail }) => setFormData(prev => ({ ...prev, name: detail.value }))}
                placeholder="Enter agent name"
              />
            </FormField>

            <FormField
              label="Description"
              description="Brief description of the agent's purpose and capabilities"
              errorText={validationErrors.description}
            >
              <Textarea
                value={formData.description}
                onChange={({ detail }) => setFormData(prev => ({ ...prev, description: detail.value }))}
                placeholder="Enter agent description"
                rows={3}
              />
            </FormField>

            <SpaceBetween direction="horizontal" size="m">
              <FormField
                label="Version"
                description="Semantic version (e.g., 1.0.0)"
                errorText={validationErrors.version}
              >
                <Input
                  value={formData.version}
                  onChange={({ detail }) => setFormData(prev => ({ ...prev, version: detail.value }))}
                  placeholder="1.0.0"
                />
              </FormField>

              <FormField
                label="Preferred Transport"
                description="Communication protocol"
              >
                <Select
                  selectedOption={transportOptions.find(opt => opt.value === formData.preferredTransport) || null}
                  onChange={({ detail }) => 
                    setFormData(prev => ({ ...prev, preferredTransport: detail.selectedOption.value || 'JSONRPC' }))
                  }
                  options={transportOptions}
                  placeholder="Select transport"
                />
              </FormField>
            </SpaceBetween>

            <FormField
              label="URL"
              description="Agent endpoint URL"
              errorText={validationErrors.url}
            >
              <Input
                value={formData.url}
                onChange={({ detail }) => setFormData(prev => ({ ...prev, url: detail.value }))}
                placeholder="https://example.com/api"
              />
            </FormField>

            <FormField
              label="Skills"
              description="Agent capabilities and skills (press Enter to add new skills)"
              errorText={validationErrors.skills}
            >
              <Multiselect
                selectedOptions={skillsOptions}
                onChange={({ detail }) => handleSkillsChange(detail.selectedOptions)}
                options={skillsOptions}
                placeholder="Type to add skills"
                tokenLimit={10}
                deselectAriaLabel={(option) => `Remove ${option.label}`}
                filteringType="auto"
                hideTokens={false}
                keepOpen={false}
              />
            </FormField>

            <FormField
              label="Capabilities"
              description="Agent streaming and other capabilities"
            >
              <Toggle
                onChange={({ detail }) => setFormData(prev => ({ ...prev, streaming: detail.checked }))}
                checked={formData.streaming}
              >
                Streaming support
              </Toggle>
            </FormField>
          </SpaceBetween>
        </Container>

        <Container
          header={
            <Header variant="h3">
              Update Information
            </Header>
          }
        >
          <SpaceBetween direction="vertical" size="xs">
            <div><strong>Agent ID:</strong> {agentId}</div>
            <div><strong>Current Version:</strong> {initialAgentCard.version}</div>
            <div><strong>Protocol Version:</strong> {initialAgentCard.protocolVersion}</div>
            <div style={{ fontSize: '0.875rem', color: '#666' }}>
              Only modified fields will be updated. The agent's protocol version and other core settings will remain unchanged.
            </div>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </Modal>
  );
};

export default AgentEditModal;