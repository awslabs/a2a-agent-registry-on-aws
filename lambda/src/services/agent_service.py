"""
Agent service for CRUD operations
"""
import json
import uuid
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError

from a2a.types import AgentCard
from utils.logging import get_logger
from utils.validation import ValidationError, validate_agent_card, validate_uuid
from services.embedding_service import EmbeddingService, EmbeddingServiceError
from services.health_service import HealthService, HealthServiceError

logger = get_logger(__name__)


class AgentServiceError(Exception):
    """Custom exception for agent service errors"""
    def __init__(self, message: str, error_code: str = "AGENT_SERVICE_ERROR", details: Optional[Dict] = None):
        self.message = message
        self.error_code = error_code
        self.details = details or {}
        super().__init__(message)


class AgentService:
    """Service for managing AgentCard instances"""
    
    def __init__(self, vector_bucket_name: str = "agent-registry-vectors", index_name: str = "agent-embeddings"):
        """
        Initialize agent service
        
        Args:
            vector_bucket_name: S3 Vectors bucket name
            index_name: S3 Vectors index name
        """
        self.vector_bucket_name = vector_bucket_name
        self.index_name = index_name
        
        # Initialize S3 Vectors client, embedding service, and health service
        try:
            self.s3vectors_client = boto3.client('s3vectors')
            self.embedding_service = EmbeddingService()
            self.health_service = HealthService(vector_bucket_name, index_name)
            logger.info("Initialized S3 Vectors client, embedding service, and health service", bucket=vector_bucket_name, index=index_name)
        except Exception as e:
            logger.error("Failed to initialize services", error=str(e))
            raise AgentServiceError(f"Failed to initialize services: {str(e)}", "INITIALIZATION_ERROR")
    
    def create_agent(self, agent_data: Dict[str, Any]) -> str:
        """
        Create a new agent card
        
        Args:
            agent_data: Raw agent card data to validate and create
            
        Returns:
            Agent ID
            
        Raises:
            ValidationError: If agent data is invalid
            AgentServiceError: If storage operation fails
        """
        logger.info("Creating new agent")
        
        # Validate agent card data
        try:
            validated_data = validate_agent_card(agent_data)
        except ValidationError as e:
            logger.warning("Agent validation failed", field=e.field, validation_message=e.message)
            raise
        
        # Generate unique agent ID
        agent_id = str(uuid.uuid4())
        
        # Add metadata (S3 Vectors limit: 10 keys max)
        # Note: S3 Vectors metadata values must be strings, numbers, booleans, or arrays of strings/numbers
        now = datetime.now(timezone.utc)
        skills_list = validated_data.get("skills", [])
        # Extract skill names as simple strings for S3 Vectors filtering
        # (S3 Vectors arrays can only contain strings or numbers, not objects)
        skill_names = [skill.get("name", "") for skill in skills_list if isinstance(skill, dict) and skill.get("name")]
        
        agent_metadata = {
            "agent_id": agent_id,
            "name": validated_data.get("name"),
            "description": validated_data.get("description"),
            "skills": skill_names,  # Store as array of strings for S3 Vectors filtering
            "protocolVersion": validated_data.get("protocolVersion"),
            "url": validated_data.get("url"),
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "last_online": "",  # Use empty string instead of None
            # raw_agent_card is stored as non-filterable metadata (configured in S3VectorsConstruct)
            "raw_agent_card": json.dumps(validated_data)
        }
        
        try:
            # Generate embedding for the agent using the embedding service
            # Create text for embedding from agent name and description
            embedding_text = f"{validated_data.get('name', '')} {validated_data.get('description', '')}"
            
            try:
                embedding_vector = self.embedding_service.generate_embedding(embedding_text)
                logger.debug("Generated embedding for agent", agent_id=agent_id, embedding_dim=len(embedding_vector))
            except EmbeddingServiceError as e:
                logger.error("Failed to generate embedding for agent", agent_id=agent_id, error=str(e))
                # Fail fast - don't create agent with invalid embedding
                raise AgentServiceError(
                    f"Failed to generate embedding for agent: {str(e)}", 
                    "EMBEDDING_GENERATION_ERROR",
                    {"agent_id": agent_id, "embedding_error": str(e)}
                )
            
            # Store agent metadata and embedding in S3 Vectors
            self.s3vectors_client.put_vectors(
                vectorBucketName=self.vector_bucket_name,
                indexName=self.index_name,
                vectors=[{
                    "key": f"agent-{agent_id}",
                    "data": {"float32": embedding_vector},
                    "metadata": agent_metadata
                }]
            )
            
            logger.info("Agent created successfully", agent_id=agent_id, name=validated_data.get("name"))
            return agent_id
            
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'UNKNOWN')
            error_message = e.response.get('Error', {}).get('Message', str(e))
            
            logger.error("Failed to store agent in S3 Vectors", 
                        agent_id=agent_id, error_code=error_code, error_message=error_message)
            
            raise AgentServiceError(
                f"Failed to store agent: {error_message}",
                "STORAGE_ERROR",
                {"agent_id": agent_id, "aws_error_code": error_code}
            )
        except Exception as e:
            logger.error("Unexpected error creating agent", agent_id=agent_id, error=str(e))
            raise AgentServiceError(f"Unexpected error creating agent: {str(e)}", "CREATION_ERROR")
    
    def get_agent(self, agent_id: str) -> Optional[AgentCard]:
        """
        Get agent by ID
        
        Args:
            agent_id: Agent identifier
            
        Returns:
            AgentCard instance or None if not found
            
        Raises:
            ValidationError: If agent_id is invalid
            AgentServiceError: If retrieval operation fails
        """
        logger.info("Retrieving agent", agent_id=agent_id)
        
        # Validate agent ID format
        try:
            validate_uuid(agent_id, "agent_id")
        except ValidationError as e:
            logger.warning("Invalid agent ID format", agent_id=agent_id)
            raise
        
        try:
            # Use list_vectors to find the agent by agent_id in metadata
            response = self.s3vectors_client.list_vectors(
                vectorBucketName=self.vector_bucket_name,
                indexName=self.index_name,
                maxResults=1000,  # Get enough to find our agent
                returnMetadata=True
                # Note: We don't need returnData=True here since we only need metadata
            )
            
            vectors = response.get('vectors', [])
            agent_vector = None
            
            # Find the agent by agent_id in metadata
            for vector in vectors:
                metadata = vector.get('metadata', {})
                if metadata.get('agent_id') == agent_id:
                    agent_vector = vector
                    break
            
            if not agent_vector:
                logger.info("Agent not found", agent_id=agent_id)
                return None
            
            # Extract agent card from metadata
            agent_metadata = agent_vector.get('metadata', {})
            raw_agent_card = agent_metadata.get('raw_agent_card')
            
            if not raw_agent_card:
                logger.warning("Agent found but missing raw_agent_card data", agent_id=agent_id)
                return None
            
            # Parse the stored agent card data
            agent_data = json.loads(raw_agent_card)
            
            # TODO: Convert to proper AgentCard instance when a2a-sdk is fully integrated
            # For now, return the validated data as a dict
            logger.info("Agent retrieved successfully", agent_id=agent_id, name=agent_metadata.get('name'))
            return agent_data
            
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'UNKNOWN')
            error_message = e.response.get('Error', {}).get('Message', str(e))
            logger.error("Failed to retrieve agent from S3 Vectors", 
                        agent_id=agent_id, error_code=error_code, error_message=error_message)
            
            raise AgentServiceError(
                f"Failed to retrieve agent: {error_message}",
                "RETRIEVAL_ERROR",
                {"agent_id": agent_id, "aws_error_code": error_code}
            )
        except json.JSONDecodeError as e:
            logger.error("Failed to parse stored agent data", agent_id=agent_id, error=str(e))
            raise AgentServiceError(f"Corrupted agent data: {str(e)}", "DATA_CORRUPTION_ERROR")
        except Exception as e:
            logger.error("Unexpected error retrieving agent", agent_id=agent_id, error=str(e))
            raise AgentServiceError(f"Unexpected error retrieving agent: {str(e)}", "RETRIEVAL_ERROR")
    
    def list_agents(self, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        """
        List agents with pagination
        
        Args:
            limit: Maximum number of agents to return
            offset: Number of agents to skip
            
        Returns:
            Dictionary containing agents list and pagination info
            
        Raises:
            AgentServiceError: If listing operation fails
        """
        logger.info("Listing agents", limit=limit, offset=offset)
        
        try:
            # Use S3 Vectors list_vectors to get all agents
            # Note: S3 Vectors doesn't have built-in pagination, so we'll implement it manually
            response = self.s3vectors_client.list_vectors(
                vectorBucketName=self.vector_bucket_name,
                indexName=self.index_name,
                maxResults=min(limit + offset + 100, 1000),  # Get extra to handle pagination
                returnMetadata=True  # This is crucial - we need metadata to get agent card data
            )
            
            vectors = response.get('vectors', [])
            
            # Filter only agent vectors (keys starting with "agent-")
            agent_vectors = [v for v in vectors if v.get('key', '').startswith('agent-')]
            
            # Sort by creation date (newest first)
            agent_vectors.sort(
                key=lambda x: x.get('metadata', {}).get('created_at', ''),
                reverse=True
            )
            
            # Apply pagination
            total_count = len(agent_vectors)
            paginated_vectors = agent_vectors[offset:offset + limit]
            
            # Extract agent cards from metadata
            agents = []
            for vector in paginated_vectors:
                metadata = vector.get('metadata', {})
                raw_agent_card = metadata.get('raw_agent_card')
                
                if raw_agent_card:
                    try:
                        agent_data = json.loads(raw_agent_card)
                        # Add agent_id to the agent data
                        agent_data['agent_id'] = metadata.get('agent_id')
                        agents.append(agent_data)
                    except json.JSONDecodeError:
                        logger.warning("Skipping agent with corrupted data", 
                                     agent_id=metadata.get('agent_id'))
                        continue
            
            # Calculate pagination info
            has_more = (offset + limit) < total_count
            
            result = {
                'agents': agents,
                'pagination': {
                    'limit': limit,
                    'offset': offset,
                    'total': total_count,
                    'has_more': has_more
                }
            }
            
            logger.info("Agents listed successfully", 
                       count=len(agents), total=total_count, has_more=has_more)
            
            return result
            
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'UNKNOWN')
            error_message = e.response.get('Error', {}).get('Message', str(e))
            
            logger.error("Failed to list agents from S3 Vectors", 
                        error_code=error_code, error_message=error_message)
            
            raise AgentServiceError(
                f"Failed to list agents: {error_message}",
                "LISTING_ERROR",
                {"aws_error_code": error_code}
            )
        except Exception as e:
            logger.error("Unexpected error listing agents", error=str(e))
            raise AgentServiceError(f"Unexpected error listing agents: {str(e)}", "LISTING_ERROR")
    
    def delete_agent(self, agent_id: str) -> bool:
        """
        Delete agent by ID
        
        Args:
            agent_id: Agent identifier
            
        Returns:
            True if deletion was successful
            
        Raises:
            ValidationError: If agent_id is invalid
            AgentServiceError: If deletion operation fails
        """
        logger.info("Deleting agent", agent_id=agent_id)
        
        # Validate agent ID format
        try:
            validate_uuid(agent_id, "agent_id")
        except ValidationError as e:
            logger.warning("Invalid agent ID format", agent_id=agent_id)
            raise
        
        try:
            # First check if agent exists by trying to get it
            existing_agent = self.get_agent(agent_id)
            if not existing_agent:
                logger.warning("Agent not found for deletion", agent_id=agent_id)
                raise AgentServiceError(
                    f"Agent with ID {agent_id} not found",
                    "AGENT_NOT_FOUND",
                    {"agent_id": agent_id}
                )
            
            # Delete the vector from S3 Vectors
            vector_key = f"agent-{agent_id}"
            
            self.s3vectors_client.delete_vectors(
                vectorBucketName=self.vector_bucket_name,
                indexName=self.index_name,
                keys=[vector_key]
            )
            
            logger.info("Agent deleted successfully", agent_id=agent_id, vector_key=vector_key)
            return True
            
        except AgentServiceError:
            # Re-raise AgentServiceError (like AGENT_NOT_FOUND)
            raise
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'UNKNOWN')
            error_message = e.response.get('Error', {}).get('Message', str(e))
            
            logger.error("Failed to delete agent from S3 Vectors", 
                        agent_id=agent_id, error_code=error_code, error_message=error_message)
            
            raise AgentServiceError(
                f"Failed to delete agent: {error_message}",
                "DELETION_ERROR",
                {"agent_id": agent_id, "aws_error_code": error_code}
            )
        except Exception as e:
            logger.error("Unexpected error deleting agent", agent_id=agent_id, error=str(e))
            raise AgentServiceError(f"Unexpected error deleting agent: {str(e)}", "DELETION_ERROR")

    def update_agent(self, agent_id: str, agent_data: Dict[str, Any]) -> bool:
        """
        Update an existing agent card
        
        Args:
            agent_id: Agent identifier
            agent_data: Updated agent card data (can be partial)
            
        Returns:
            True if update was successful
            
        Raises:
            ValidationError: If agent_id or agent data is invalid
            AgentServiceError: If update operation fails
        """
        logger.info("Updating agent", agent_id=agent_id)
        
        # Validate agent ID format
        try:
            validate_uuid(agent_id, "agent_id")
        except ValidationError as e:
            logger.warning("Invalid agent ID format", agent_id=agent_id)
            raise
        
        try:
            # First get the existing agent
            existing_agent = self.get_agent(agent_id)
            if not existing_agent:
                logger.warning("Agent not found for update", agent_id=agent_id)
                raise AgentServiceError(
                    f"Agent with ID {agent_id} not found",
                    "AGENT_NOT_FOUND",
                    {"agent_id": agent_id}
                )
            
            # Merge existing data with updates
            updated_data = existing_agent.copy()
            updated_data.update(agent_data)
            
            # Validate the merged agent card data
            try:
                validated_data = validate_agent_card(updated_data)
            except ValidationError as e:
                logger.warning("Agent validation failed during update", 
                             agent_id=agent_id, field=e.field, validation_message=e.message)
                raise
            
            # Update metadata (S3 Vectors limit: 10 keys max)
            now = datetime.now(timezone.utc)
            skills_list = validated_data.get("skills", [])
            # Extract skill names as simple strings for S3 Vectors filtering
            # (S3 Vectors arrays can only contain strings or numbers, not objects)
            skill_names = [skill.get("name", "") for skill in skills_list if isinstance(skill, dict) and skill.get("name")]
            
            agent_metadata = {
                "agent_id": agent_id,
                "name": validated_data.get("name"),
                "description": validated_data.get("description"),
                "skills": skill_names,  # Store as array of strings for S3 Vectors filtering
                "protocolVersion": validated_data.get("protocolVersion"),
                "url": validated_data.get("url"),
                "created_at": existing_agent.get("created_at", now.isoformat()),  # Preserve original creation time
                "updated_at": now.isoformat(),
                "last_online": existing_agent.get("last_online", ""),  # Preserve existing health status
                # raw_agent_card is stored as non-filterable metadata (configured in S3VectorsConstruct)
                "raw_agent_card": json.dumps(validated_data)
            }
            
            # Generate new embedding if name or description changed
            name_changed = existing_agent.get("name") != validated_data.get("name")
            description_changed = existing_agent.get("description") != validated_data.get("description")
            
            if name_changed or description_changed:
                # Generate new embedding for the updated agent
                embedding_text = f"{validated_data.get('name', '')} {validated_data.get('description', '')}"
                
                try:
                    embedding_vector = self.embedding_service.generate_embedding(embedding_text)
                    logger.debug("Generated new embedding for updated agent", 
                               agent_id=agent_id, embedding_dim=len(embedding_vector))
                except EmbeddingServiceError as e:
                    logger.error("Failed to generate embedding for updated agent", 
                               agent_id=agent_id, error=str(e))
                    raise AgentServiceError(
                        f"Failed to generate embedding for updated agent: {str(e)}", 
                        "EMBEDDING_GENERATION_ERROR",
                        {"agent_id": agent_id, "embedding_error": str(e)}
                    )
            else:
                # Keep existing embedding - get it from S3 Vectors
                try:
                    response = self.s3vectors_client.list_vectors(
                        vectorBucketName=self.vector_bucket_name,
                        indexName=self.index_name,
                        maxResults=1000,
                        returnData=True,  # Need the embedding data
                        returnMetadata=True
                    )
                    
                    vectors = response.get('vectors', [])
                    existing_vector = None
                    
                    # Find the agent by agent_id in metadata
                    for vector in vectors:
                        metadata = vector.get('metadata', {})
                        if metadata.get('agent_id') == agent_id:
                            existing_vector = vector
                            break
                    
                    if not existing_vector:
                        raise AgentServiceError(
                            f"Could not find existing vector for agent {agent_id}",
                            "VECTOR_NOT_FOUND",
                            {"agent_id": agent_id}
                        )
                    
                    embedding_vector = existing_vector.get('data', {}).get('float32', [])
                    if not embedding_vector:
                        raise AgentServiceError(
                            f"Invalid embedding data for agent {agent_id}",
                            "INVALID_EMBEDDING_DATA",
                            {"agent_id": agent_id}
                        )
                    
                except ClientError as e:
                    error_code = e.response.get('Error', {}).get('Code', 'UNKNOWN')
                    error_message = e.response.get('Error', {}).get('Message', str(e))
                    logger.error("Failed to retrieve existing embedding", 
                               agent_id=agent_id, error_code=error_code, error_message=error_message)
                    raise AgentServiceError(
                        f"Failed to retrieve existing embedding: {error_message}",
                        "EMBEDDING_RETRIEVAL_ERROR",
                        {"agent_id": agent_id, "aws_error_code": error_code}
                    )
            
            # Update the vector in S3 Vectors
            vector_key = f"agent-{agent_id}"
            
            self.s3vectors_client.put_vectors(
                vectorBucketName=self.vector_bucket_name,
                indexName=self.index_name,
                vectors=[{
                    "key": vector_key,
                    "data": {"float32": embedding_vector},
                    "metadata": agent_metadata
                }]
            )
            
            logger.info("Agent updated successfully", 
                       agent_id=agent_id, 
                       name=validated_data.get("name"),
                       embedding_regenerated=name_changed or description_changed)
            return True
            
        except AgentServiceError:
            # Re-raise AgentServiceError (like AGENT_NOT_FOUND)
            raise
        except ValidationError:
            # Re-raise ValidationError
            raise
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'UNKNOWN')
            error_message = e.response.get('Error', {}).get('Message', str(e))
            
            logger.error("Failed to update agent in S3 Vectors", 
                        agent_id=agent_id, error_code=error_code, error_message=error_message)
            
            raise AgentServiceError(
                f"Failed to update agent: {error_message}",
                "UPDATE_ERROR",
                {"agent_id": agent_id, "aws_error_code": error_code}
            )
        except Exception as e:
            logger.error("Unexpected error updating agent", agent_id=agent_id, error=str(e))
            raise AgentServiceError(f"Unexpected error updating agent: {str(e)}", "UPDATE_ERROR")

    def update_agent_health(self, agent_id: str) -> bool:
        """
        Update agent health status (last online timestamp)
        
        Args:
            agent_id: Agent identifier
            
        Returns:
            True if update was successful
            
        Raises:
            ValidationError: If agent_id is invalid
            AgentServiceError: If update operation fails
        """
        logger.info("Delegating agent health update to health service", agent_id=agent_id)
        
        try:
            return self.health_service.update_agent_health(agent_id)
        except HealthServiceError as e:
            # Convert HealthServiceError to AgentServiceError for consistency
            logger.error("Health service error during agent health update", 
                        agent_id=agent_id, error_code=e.error_code, error_message=e.message)
            raise AgentServiceError(e.message, e.error_code, e.details)