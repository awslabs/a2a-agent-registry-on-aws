// Hook for managing agent table state and operations
import { useState, useEffect, useCallback } from "react";
import { useAgentRegistry } from "../contexts/AgentRegistryContext";
import { AgentCard, AgentWithId } from "../types/AgentCard";

interface Agent {
  agent_id: string;
  agent_card: AgentCard;
  is_online: boolean;
  last_seen: string;
}

interface UseAgentTableOptions {
  initialPageSize?: number;
}

export const useAgentTable = (options: UseAgentTableOptions = {}) => {
  const { client, isReady } = useAgentRegistry();
  const { initialPageSize = 20 } = options;

  // State
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Agent[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [totalItems, setTotalItems] = useState(0);
  const [filteringText, setFilteringText] = useState("");
  const [propertyFilters, setPropertyFilters] = useState<any>({
    tokens: [],
    operation: "and",
  });

  // Computed values (will be overridden by filtered results)
  // const totalPages = Math.ceil(totalItems / pageSize);

  // Load agents function - uses search API if there's a query, otherwise lists all
  const loadAgents = useCallback(
    async (
      page: number = currentPageIndex,
      searchQuery: string = filteringText
    ) => {
      setLoading(true);
      setError(null);
      try {
        let transformedAgents: Agent[] = [];
        let total = 0;

        if (!client) {
          setLoading(false);
          return;
        }

        if (searchQuery.trim()) {
          // Use search API when there's a search query
          const searchResults = await client.searchAgents(
            searchQuery,
            undefined,
            30
          ); // Get more results for search (S3 Vectors max limit is 30)

          transformedAgents = searchResults.map((result, index) => ({
            agent_id: result.agent_id || `search-${index + 1}`,
            agent_card: result.agent_card,
            is_online: Math.random() > 0.3, // Simulate online status
            last_seen: new Date(
              Date.now() - Math.random() * 86400000
            ).toISOString(), // Random last seen within 24h
          }));

          total = transformedAgents.length;
        } else {
          // Use list API when no search query
          const offset = (page - 1) * pageSize;
          const response = await client.listAgents(pageSize, offset);

          transformedAgents = (response.items || []).map(
            (agentData, index) => {
              // Check if agentData has agent_id (from backend) or is just an AgentCard
              const agentWithId = agentData as AgentWithId;
              const agent_id = agentWithId.agent_id || `agent-${offset + index + 1}`;
              
              // If agentData has agent_id, extract the clean agent card, otherwise use as-is
              const agent_card = agentWithId.agent_id 
                ? (() => {
                    const { agent_id: _, ...cleanCard } = agentWithId;
                    return cleanCard as AgentCard;
                  })()
                : agentData as AgentCard;
              
              return {
                agent_id,
                agent_card,
                is_online: Math.random() > 0.3, // Simulate online status
                last_seen: new Date(
                  Date.now() - Math.random() * 86400000
                ).toISOString(), // Random last seen within 24h
              };
            }
          );

          total = response.total;
        }

        setAgents(transformedAgents);
        setTotalItems(total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agents");
        setAgents([]);
        setTotalItems(0);
      } finally {
        setLoading(false);
      }
    },
    [client, currentPageIndex, pageSize, filteringText]
  );

  // Refresh function
  const refresh = useCallback(() => {
    loadAgents(currentPageIndex);
  }, [loadAgents, currentPageIndex]);

  // Pagination handlers
  const handlePaginationChange = useCallback(
    (detail: any) => {
      const newPage = detail.currentPageIndex;
      setCurrentPageIndex(newPage);
      // Only reload for list API (not search API which loads all results)
      if (!filteringText.trim()) {
        loadAgents(newPage, filteringText);
      }
    },
    [loadAgents, filteringText]
  );

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPageIndex(1);
    // loadAgents will be called by the effect when currentPageIndex changes
  }, []);

  // Apply property filters to agents
  const applyPropertyFilters = useCallback((agentList: Agent[], filters: any) => {
    if (!filters.tokens || filters.tokens.length === 0) {
      return agentList;
    }

    return agentList.filter(agent => {
      const results = filters.tokens.map((token: any) => {
        const { propertyKey, operator, value } = token;
        
        switch (propertyKey) {
          case 'name':
            const name = agent.agent_card.name?.toLowerCase() || '';
            const searchValue = value.toLowerCase();
            
            switch (operator) {
              case ':':
              case 'contains':
                return name.includes(searchValue);
              case '!:':
              case 'does-not-contain':
                return !name.includes(searchValue);
              case '=':
              case 'equals':
                return name === searchValue;
              case '!=':
              case 'does-not-equal':
                return name !== searchValue;
              default:
                return name.includes(searchValue);
            }

          case 'skills':
            const skills = agent.agent_card.skills || [];
            const skillSearchValue = value.toLowerCase();
            
            const skillMatches = skills.some(skill => {
              return skill.name?.toLowerCase().includes(skillSearchValue) ||
                     skill.description?.toLowerCase().includes(skillSearchValue) ||
                     skill.tags?.some(tag => tag.toLowerCase().includes(skillSearchValue));
            });
            
            switch (operator) {
              case ':':
              case 'contains':
                return skillMatches;
              case '!:':
              case 'does-not-contain':
                return !skillMatches;
              case '=':
              case 'equals':
                return skills.some(skill => skill.name?.toLowerCase() === skillSearchValue);
              case '!=':
              case 'does-not-equal':
                return !skills.some(skill => skill.name?.toLowerCase() === skillSearchValue);
              default:
                return skillMatches;
            }

          case 'version':
            const version = agent.agent_card.version?.toLowerCase() || '';
            const versionSearchValue = value.toLowerCase();
            
            switch (operator) {
              case ':':
              case 'contains':
                return version.includes(versionSearchValue);
              case '!:':
              case 'does-not-contain':
                return !version.includes(versionSearchValue);
              case '=':
              case 'equals':
                return version === versionSearchValue;
              case '!=':
              case 'does-not-equal':
                return version !== versionSearchValue;
              default:
                return version.includes(versionSearchValue);
            }

          default:
            return true;
        }
      });

      // Apply AND/OR logic
      return filters.operation === 'and' 
        ? results.every(Boolean) 
        : results.some(Boolean);
    });
  }, []);

  // Filter handlers
  const handleFilteringTextChange = useCallback((text: string) => {
    setFilteringText(text);
    setCurrentPageIndex(1); // Reset to first page when searching
  }, []);

  const handlePropertyFiltersChange = useCallback((filters: any) => {
    setPropertyFilters(filters);
    setCurrentPageIndex(1); // Reset to first page when filtering
  }, []);

  // Load agents when search text changes (with debounce effect)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadAgents(1, filteringText); // Always start from page 1 when searching
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [filteringText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload agents when property filters change
  useEffect(() => {
    if (propertyFilters.tokens && propertyFilters.tokens.length > 0) {
      loadAgents(1, filteringText);
    }
  }, [propertyFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load agents when client is ready
  useEffect(() => {
    if (isReady && client) {
      loadAgents();
    }
  }, [isReady, client]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply property filters to the agents
  const filteredAgents = applyPropertyFilters(agents, propertyFilters);
  
  // Update total items count for filtered results
  const filteredTotalItems = propertyFilters.tokens && propertyFilters.tokens.length > 0 
    ? filteredAgents.length 
    : totalItems;
  
  // For search results or property filters, we need to paginate client-side
  const paginatedAgents = (filteringText.trim() || (propertyFilters.tokens && propertyFilters.tokens.length > 0))
    ? filteredAgents.slice(
        (currentPageIndex - 1) * pageSize,
        currentPageIndex * pageSize
      )
    : filteredAgents;

  // Calculate total pages based on filtered results
  const filteredTotalPages = Math.ceil(filteredTotalItems / pageSize);

  return {
    agents: paginatedAgents,
    loading,
    error,
    selectedItems,
    setSelectedItems,
    currentPageIndex,
    pageSize,
    totalPages: filteredTotalPages,
    totalItems: filteredTotalItems,
    handlePaginationChange,
    handlePageSizeChange,
    filteringText,
    propertyFilters,
    handleFilteringTextChange,
    handlePropertyFiltersChange,
    refresh,
  };
};
