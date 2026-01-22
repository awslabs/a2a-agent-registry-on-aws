// Agent Registration Modal component with JSON file upload
import React, { useState } from 'react';
import {
  Modal,
  Box,
  SpaceBetween,
  Button,
  FormField,
  FileUpload,
  Alert,
  Textarea,
  Header,
  Container,
} from '@cloudscape-design/components';
import { AgentCard } from '../types/AgentCard';
import { useAgentRegistry } from '../contexts/AgentRegistryContext';
import { validateAgentCard, getSkillCount } from '../utils/agentCardValidation';

interface AgentRegistrationModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess?: (agentId: string) => void;
}

const AgentRegistrationModal: React.FC<AgentRegistrationModalProps> = ({
  visible,
  onDismiss,
  onSuccess,
}) => {
  const { client } = useAgentRegistry();
  
  // State management
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [jsonContent, setJsonContent] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState(false);
  const [parsedAgentCard, setParsedAgentCard] = useState<AgentCard | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Sample AgentCard for reference (A2A protocol compliant)
  const sampleAgentCard = {
    name: "Recipe Assistant Agent",
    description: "An AI agent that helps users find and prepare recipes based on available ingredients",
    version: "1.2.0",
    url: "https://recipe-agent.example.com/api/v1",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    skills: [
      {
        id: "recipe-search",
        name: "Recipe Search",
        description: "Search for recipes by ingredients or cuisine",
        tags: ["recipes", "search", "cooking"]
      },
      {
        id: "nutrition-info",
        name: "Nutrition Information",
        description: "Get nutritional information for recipes",
        tags: ["nutrition", "health", "food"]
      }
    ],
    capabilities: {
      streaming: false,
      pushNotifications: true
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"]
  };

  // Handle file upload
  const handleFileUpload = (files: File[]) => {
    setUploadedFiles(files);
    setValidationError(null);
    setValidationSuccess(false);
    setParsedAgentCard(null);

    if (files.length > 0) {
      const file = files[0];
      
      // Check file type
      if (!file.name.endsWith('.json')) {
        setValidationError('Please upload a JSON file');
        return;
      }

      // Read file content
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setJsonContent(content);
        
        // Validate the content
        const validation = validateAgentCard(content);
        if (validation.isValid && validation.agentCard) {
          setValidationSuccess(true);
          setParsedAgentCard(validation.agentCard);
        } else {
          setValidationError(validation.error || 'Invalid AgentCard format');
        }
      };
      
      reader.onerror = () => {
        setValidationError('Failed to read file');
      };
      
      reader.readAsText(file);
    }
  };

  // Handle manual JSON input
  const handleJsonContentChange = (content: string) => {
    setJsonContent(content);
    setValidationError(null);
    setValidationSuccess(false);
    setParsedAgentCard(null);

    if (content.trim()) {
      const validation = validateAgentCard(content);
      if (validation.isValid && validation.agentCard) {
        setValidationSuccess(true);
        setParsedAgentCard(validation.agentCard);
      } else {
        setValidationError(validation.error || 'Invalid AgentCard format');
      }
    }
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!parsedAgentCard) {
      setSubmitError('Please provide a valid AgentCard');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      
      if (!client) {
        setSubmitError('API client not available');
        return;
      }
      
      const result = await client.createAgent(parsedAgentCard);
      
      // Success - close modal and notify parent
      onDismiss();
      if (onSuccess) {
        onSuccess(result);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to register agent');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle modal dismiss
  const handleDismiss = () => {
    // Reset all state
    setUploadedFiles([]);
    setJsonContent('');
    setValidationError(null);
    setValidationSuccess(false);
    setParsedAgentCard(null);
    setSubmitting(false);
    setSubmitError(null);
    
    onDismiss();
  };

  // Load sample AgentCard
  const loadSample = () => {
    const sampleJson = JSON.stringify(sampleAgentCard, null, 2);
    setJsonContent(sampleJson);
    handleJsonContentChange(sampleJson);
  };

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
              disabled={!validationSuccess || submitting}
              loading={submitting}
            >
              Register Agent
            </Button>
          </SpaceBetween>
        </Box>
      }
      header="Register New Agent"
    >
      <SpaceBetween direction="vertical" size="l">
        {submitError && (
          <Alert type="error" header="Registration Failed">
            {submitError}
          </Alert>
        )}

        <Container
          header={
            <Header
              variant="h2"
              description="Upload an AgentCard JSON file or paste the JSON content directly"
              actions={
                <Button variant="link" onClick={loadSample}>
                  Load Sample
                </Button>
              }
            >
              Agent Card
            </Header>
          }
        >
          <SpaceBetween direction="vertical" size="m">
            <FormField
              label="Upload JSON File"
              description="Select a JSON file containing the AgentCard data"
            >
              <FileUpload
                onChange={({ detail }) => handleFileUpload(detail.value)}
                value={uploadedFiles}
                i18nStrings={{
                  uploadButtonText: e => e ? "Choose files" : "Choose file",
                  dropzoneText: e => e ? "Drop files to upload" : "Drop file to upload",
                  removeFileAriaLabel: e => `Remove file ${e + 1}`,
                  limitShowFewer: "Show fewer files",
                  limitShowMore: "Show more files",
                  errorIconAriaLabel: "Error"
                }}
                accept=".json"
                showFileLastModified
                showFileSize
                showFileThumbnail
                constraintText="JSON files only"
              />
            </FormField>

            <FormField
              label="Or Paste JSON Content"
              description="Paste the AgentCard JSON content directly"
            >
              <Textarea
                onChange={({ detail }) => handleJsonContentChange(detail.value)}
                value={jsonContent}
                placeholder="Paste your AgentCard JSON here..."
                rows={12}
              />
            </FormField>

            {validationError && (
              <Alert type="error" header="Validation Error">
                {validationError}
              </Alert>
            )}

            {validationSuccess && parsedAgentCard && (
              <Alert type="success" header="Valid AgentCard">
                <SpaceBetween direction="vertical" size="xs">
                  <div><strong>Name:</strong> {parsedAgentCard.name}</div>
                  <div><strong>Version:</strong> {parsedAgentCard.version}</div>
                  <div><strong>Skills:</strong> {getSkillCount(parsedAgentCard.skills)} skill(s)</div>
                  <div><strong>Description:</strong> {parsedAgentCard.description}</div>
                </SpaceBetween>
              </Alert>
            )}
          </SpaceBetween>
        </Container>

        <Container
          header={
            <Header variant="h3">
              AgentCard Format Requirements (A2A Protocol)
            </Header>
          }
        >
          <SpaceBetween direction="vertical" size="xs">
            <div><strong>Required Fields:</strong></div>
            <ul style={{ marginLeft: '20px' }}>
              <li>name, description, version, url</li>
              <li>capabilities (object)</li>
              <li>defaultInputModes, defaultOutputModes (arrays of MIME types)</li>
              <li>skills (array of AgentSkill objects)</li>
            </ul>
            <div><strong>AgentSkill Object:</strong></div>
            <ul style={{ marginLeft: '20px' }}>
              <li>id (string) - unique identifier</li>
              <li>name (string) - human-readable name</li>
              <li>description (string) - what the skill does</li>
              <li>tags (array of strings) - keywords for the skill</li>
            </ul>
            <div><strong>Optional Fields:</strong> protocolVersion, preferredTransport, provider, iconUrl, documentationUrl</div>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </Modal>
  );
};

export default AgentRegistrationModal;