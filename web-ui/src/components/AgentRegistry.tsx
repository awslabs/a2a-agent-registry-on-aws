// Agent Registry table component with search and filtering
import React, { useState } from 'react';
import {
  Table,
  Header,
  Pagination,
  TextFilter,
  SpaceBetween,
  Button,
  Badge,
  Box,
  CollectionPreferences,
  PropertyFilter,
  Modal,
  Container,
  Textarea,
} from '@cloudscape-design/components';
import { Agent } from '../types/AgentCard';
import { useAgentTable } from '../hooks/useAgentTable';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { useAgentRegistry } from '../contexts/AgentRegistryContext';
import AgentEditModal from './AgentEditModal';


interface AgentRegistryProps {
  onRegisterAgent?: () => void;
}

const AgentRegistry: React.FC<AgentRegistryProps> = ({ onRegisterAgent }) => {
  
  // Get client from context
  const { client } = useAgentRegistry();
  
  // State for JSON modal
  const [jsonModalVisible, setJsonModalVisible] = useState(false);
  const [selectedAgentCard, setSelectedAgentCard] = useState<Agent | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  
  // State for edit modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // Use the custom hook for table state management
  const {
    agents,
    loading,
    error,
    selectedItems,
    setSelectedItems,
    currentPageIndex,
    pageSize,
    totalPages,
    totalItems,
    handlePaginationChange,
    handlePageSizeChange,
    filteringText,
    propertyFilters,
    handleFilteringTextChange,
    handlePropertyFiltersChange,
    refresh,
  } = useAgentTable({ 
    initialPageSize: 20,
  });

  // Collection preferences with localStorage persistence
  const { preferences: rawPreferences, handlePreferencesChange } = useTablePreferences({
    storageKey: 'agent-registry-table-preferences',
    defaultPreferences: {
      pageSize: 20,
      visibleContent: ['name', 'version', 'skills', 'last_seen'],
      wrapLines: true,
      stripedRows: false,
      contentDensity: 'comfortable' as const,
    },
  });

  // Ensure actions column is always visible
  const preferences = {
    ...rawPreferences,
    visibleContent: [...rawPreferences.visibleContent, 'actions'].filter((item, index, arr) => arr.indexOf(item) === index)
  };

  // Handle viewing agent card JSON
  const handleViewJson = (agent: Agent) => {
    setSelectedAgentCard(agent);
    setJsonModalVisible(true);
  };

  // Handle copying JSON to clipboard
  const handleCopyJson = async (agent: Agent) => {
    try {
      const jsonString = JSON.stringify(agent.agent_card, null, 2);
      await navigator.clipboard.writeText(jsonString);
    } catch (err) {
      console.error('Failed to copy JSON:', err);
      // Fallback: create a temporary textarea and copy
      const textArea = document.createElement('textarea');
      textArea.value = JSON.stringify(agent.agent_card, null, 2);
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  // Handle editing agent
  const handleEditAgent = (agent: Agent) => {
    setEditingAgent(agent);
    setEditModalVisible(true);
  };

  // Handle edit success
  const handleEditSuccess = () => {
    // Refresh the table to reflect the changes
    refresh();
  };

  // Handle deleting agent
  const handleDeleteAgent = async (agent: Agent) => {
    if (!window.confirm(`Are you sure you want to delete agent "${agent.agent_card.name}"?`)) {
      return;
    }

    try {
      setDeleteLoading(agent.agent_id);
      
      // Call the actual delete API using the client from context
      if (!client) {
        return;
      }
      
      const success = await client.deleteAgent(agent.agent_id);
      
      if (success) {
        // Refresh the table to reflect the deletion
        refresh();
      } else {
        throw new Error('Delete operation returned false');
      }
    } catch (error) {
      // You could show an error notification here
      alert(`Failed to delete agent: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeleteLoading(null);
    }
  };

  // Column definitions for the table
  const columnDefinitions = [
    {
      id: 'name',
      header: 'Agent Name',
      cell: (item: Agent) => (
        <div style={{ minHeight: '60px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{item.agent_card.name}</div>
          <div style={{ 
            fontSize: '0.875rem', 
            color: '#666', 
            lineHeight: '1.4',
            wordWrap: 'break-word',
            maxWidth: '300px'
          }}>
            {item.agent_card.description}
          </div>
        </div>
      ),
      sortingField: 'agent_card.name',
      minWidth: 250,
    },
    {
      id: 'version',
      header: 'Version',
      cell: (item: Agent) => (
        <div style={{ minHeight: '60px', display: 'flex', alignItems: 'center' }}>
          {item.agent_card.version}
        </div>
      ),
      sortingField: 'agent_card.version',
      minWidth: 100,
    },
    {
      id: 'skills',
      header: 'Skills',
      cell: (item: Agent) => (
        <div style={{ minHeight: '60px', display: 'flex', alignItems: 'center' }}>
          <SpaceBetween direction="horizontal" size="xs">
            {(item.agent_card.skills || []).slice(0, 4).map((skill, index) => (
              <Badge key={index} color="blue">
                {skill.name}
              </Badge>
            ))}
            {(item.agent_card.skills || []).length > 4 && (
              <Badge color="grey">+{(item.agent_card.skills || []).length - 4} more</Badge>
            )}
          </SpaceBetween>
        </div>
      ),
      minWidth: 250,
    },

    {
      id: 'last_seen',
      header: 'Last Seen',
      cell: (item: Agent) => {
        const lastSeen = new Date(item.last_seen);
        const now = new Date();
        const diffMinutes = Math.floor((now.getTime() - lastSeen.getTime()) / (1000 * 60));
        
        let displayText;
        if (diffMinutes < 1) {
          displayText = 'Just now';
        } else if (diffMinutes < 60) {
          displayText = `${diffMinutes} minutes ago`;
        } else if (diffMinutes < 1440) {
          displayText = `${Math.floor(diffMinutes / 60)} hours ago`;
        } else {
          displayText = lastSeen.toLocaleDateString();
        }
        
        return (
          <div style={{ minHeight: '60px', display: 'flex', alignItems: 'center' }}>
            {displayText}
          </div>
        );
      },
      sortingField: 'last_seen',
      minWidth: 150,
    },
    {
      id: 'agent_id',
      header: 'Agent ID',
      cell: (item: Agent) => (
        <div style={{ minHeight: '60px', display: 'flex', alignItems: 'center' }}>
          <Box fontSize="body-s" color="text-body-secondary">
            {item.agent_id}
          </Box>
        </div>
      ),
      minWidth: 200,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (item: Agent) => (
        <div style={{ minHeight: '60px', display: 'flex', alignItems: 'center' }}>
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              onClick={() => handleViewJson(item)}
              iconName="file-open"
              variant="normal"
            >
              View JSON
            </Button>
            <Button
              onClick={() => handleCopyJson(item)}
              iconName="copy"
              variant="normal"
            >
              Copy
            </Button>
            <Button
              onClick={() => handleEditAgent(item)}
              iconName="edit"
              variant="normal"
            >
              Edit
            </Button>
            <Button
              onClick={() => handleDeleteAgent(item)}
              iconName="remove"
              variant="normal"
              loading={deleteLoading === item.agent_id}
            >
              Delete
            </Button>
          </SpaceBetween>
        </div>
      ),
      minWidth: 280,
    },
  ];

  // Property filter definitions
  const filteringProperties = [
    {
      key: 'name',
      operators: [':', '!:', '=', '!='],
      propertyLabel: 'Agent name',
      groupValuesLabel: 'Agent name values',
    },
    {
      key: 'skills',
      operators: [':', '!:', '=', '!='],
      propertyLabel: 'Skills',
      groupValuesLabel: 'Skill values',
    },
    {
      key: 'version',
      operators: [':', '!:', '=', '!='],
      propertyLabel: 'Version',
      groupValuesLabel: 'Version values',
    },

  ];

  // Handle preferences change with page size update
  const handlePreferencesChangeWithPageSize = (detail: any) => {
    // Remove actions from the preferences before saving since it's always shown
    const preferencesToSave = {
      ...detail.preferences,
      visibleContent: detail.preferences.visibleContent.filter((id: string) => id !== 'actions')
    };
    handlePreferencesChange({ ...detail, preferences: preferencesToSave });
    if (detail.preferences.pageSize !== pageSize) {
      handlePageSizeChange(detail.preferences.pageSize);
    }
  };

  return (
    <>
      <Table
      columnDefinitions={columnDefinitions.filter(col => 
        preferences.visibleContent.includes(col.id) || col.id === 'actions'
      )}
      items={agents}
      loading={loading}
      loadingText="Loading agents..."
      selectedItems={selectedItems}
      onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
      selectionType="multi"
      trackBy="agent_id"
      empty={
        <Box textAlign="center" color="inherit">
          <b>No agents found</b>
          <Box padding={{ bottom: 's' }} variant="p" color="inherit">
            {error ? 'There was an error loading agents.' : 'No agents match the current filters.'}
          </Box>
          <Button onClick={onRegisterAgent}>Register your first agent</Button>
        </Box>
      }
      filter={
        <div>
          <SpaceBetween direction="vertical" size="xs">
            <TextFilter
              filteringText={filteringText}
              onChange={({ detail }) => handleFilteringTextChange(detail.filteringText)}
              filteringPlaceholder="Search agents by name, description, or skills (semantic search supported)..."
              filteringAriaLabel="Filter agents"
            />
            <PropertyFilter
              query={propertyFilters}
              onChange={({ detail }) => handlePropertyFiltersChange(detail)}
              filteringProperties={filteringProperties}
              filteringPlaceholder="Filter agents by properties"
              filteringAriaLabel="Filter agents by properties"
              expandToViewport
              i18nStrings={{
                filteringAriaLabel: "Filter agents by properties",
                dismissAriaLabel: "Dismiss",
                filteringPlaceholder: "Filter agents by properties",
                groupValuesText: "Values",
                groupPropertiesText: "Properties",
                operatorsText: "Operators",
                operationAndText: "and",
                operationOrText: "or",
                operatorLessText: "Less than",
                operatorLessOrEqualText: "Less than or equal",
                operatorGreaterText: "Greater than",
                operatorGreaterOrEqualText: "Greater than or equal",
                operatorContainsText: "Contains",
                operatorDoesNotContainText: "Does not contain",
                operatorEqualsText: "Equals",
                operatorDoesNotEqualText: "Does not equal",
                editTokenHeader: "Edit filter",
                propertyText: "Property",
                operatorText: "Operator",
                valueText: "Value",
                cancelActionText: "Cancel",
                applyActionText: "Apply",
                allPropertiesLabel: "All properties",
                tokenLimitShowMore: "Show more",
                tokenLimitShowFewer: "Show fewer",
                clearFiltersText: "Clear filters",
                removeTokenButtonAriaLabel: (token) => `Remove token ${token.propertyKey} ${token.operator} ${token.value}`,
                enteredTextLabel: (text) => `Use: "${text}"`
              }}
            />
          </SpaceBetween>
        </div>
      }
      header={
        <Header
          counter={`(${totalItems})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={refresh} iconName="refresh">
                Refresh
              </Button>
              <Button variant="primary" onClick={onRegisterAgent}>
                Register Agent
              </Button>
            </SpaceBetween>
          }
        >
          Agents
        </Header>
      }
      pagination={
        <Pagination
          currentPageIndex={currentPageIndex}
          pagesCount={totalPages}
          onChange={({ detail }) => handlePaginationChange(detail)}
        />
      }
      preferences={
        <CollectionPreferences
          title="Preferences"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          preferences={rawPreferences}
          onConfirm={handlePreferencesChangeWithPageSize}
          pageSizePreference={{
            title: 'Page size',
            options: [
              { value: 10, label: '10 agents' },
              { value: 20, label: '20 agents' },
              { value: 50, label: '50 agents' },
              { value: 100, label: '100 agents' },
            ],
          }}
          visibleContentPreference={{
            title: 'Select visible columns',
            options: [
              {
                label: 'Agent properties',
                options: columnDefinitions
                  .filter(col => col.id !== 'actions') // Hide actions from preferences since it's always shown
                  .map(col => ({
                    id: col.id,
                    label: col.header,
                    editable: col.id !== 'name', // Name column is always required
                  })),
              },
            ],
          }}
          wrapLinesPreference={{
            label: 'Wrap lines',
            description: 'Check to see all the text and wrap the lines',
          }}
          stripedRowsPreference={{
            label: 'Striped rows',
            description: 'Check to add alternating shaded rows',
          }}
          contentDensityPreference={{
            label: 'Compact mode',
            description: 'Check to display content in a denser, more compact mode',
          }}
        />
      }
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
      />
      
      {/* JSON Modal */}
      <Modal
        onDismiss={() => setJsonModalVisible(false)}
        visible={jsonModalVisible}
        size="large"
        header={selectedAgentCard ? `Agent Card JSON - ${selectedAgentCard.agent_card.name}` : 'Agent Card JSON'}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button 
                onClick={() => selectedAgentCard && handleCopyJson(selectedAgentCard)}
                iconName="copy"
              >
                Copy to Clipboard
              </Button>
              <Button variant="primary" onClick={() => setJsonModalVisible(false)}>
                Close
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        {selectedAgentCard && (
          <Container>
            <Textarea
              value={JSON.stringify(selectedAgentCard.agent_card, null, 2)}
              readOnly
              rows={20}
              spellcheck={false}
              placeholder="Agent card JSON will appear here..."
              ariaLabel="Agent card JSON"
            />
          </Container>
        )}
      </Modal>
      
      {/* Edit Modal */}
      {editingAgent && (
        <AgentEditModal
          visible={editModalVisible}
          onDismiss={() => setEditModalVisible(false)}
          onSuccess={handleEditSuccess}
          agentId={editingAgent.agent_id}
          initialAgentCard={editingAgent.agent_card}
        />
      )}
    </>
  );
};

export default AgentRegistry;