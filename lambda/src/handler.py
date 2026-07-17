"""
Main Lambda handler for Agent Registry API
"""
import json
import uuid
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from utils.logging import get_logger
from utils.response import format_success_response, format_error_response
from utils.validation import ValidationError, validate_pagination_params

# Initialize structured logger
logger = get_logger(__name__)


class APIError(Exception):
    """Custom exception for API errors"""
    def __init__(self, status_code: int, error_code: str, message: str, details: Optional[Dict] = None):
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.details = details or {}
        super().__init__(message)


def create_response(status_code: int, body: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    """
    Create standardized API Gateway response
    
    Args:
        status_code: HTTP status code
        body: Response body
        request_id: Request ID for tracking
        
    Returns:
        API Gateway response format
    """
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token, X-Amz-User-Agent, X-Amz-Content-Sha256, X-Amz-Target',
            'X-Request-ID': request_id
        },
        'body': json.dumps(body)
    }


def create_error_response(error: APIError, request_id: str) -> Dict[str, Any]:
    """
    Create standardized error response
    
    Args:
        error: APIError instance
        request_id: Request ID for tracking
        
    Returns:
        API Gateway error response
    """
    error_body = {
        'error': {
            'code': error.error_code,
            'message': error.message,
            'details': error.details
        },
        'requestId': request_id
    }
    
    return create_response(error.status_code, error_body, request_id)


def parse_path_parameters(path: str) -> Dict[str, str]:
    """
    Parse path parameters from API Gateway path
    
    Args:
        path: Request path
        
    Returns:
        Dictionary of path parameters
    """
    path_params = {}
    
    # Handle /agents/{id} pattern
    if path.startswith('/agents/') and not path.startswith('/agents/search'):
        parts = path.split('/')
        if len(parts) >= 3:
            agent_id = parts[2]
            path_params['id'] = agent_id
            
            # Handle /agents/{id}/health pattern
            if len(parts) >= 4 and parts[3] == 'health':
                path_params['resource'] = 'health'
    
    return path_params


def route_request(method: str, path: str, query_params: Dict[str, Any], 
                 body: Optional[str], path_params: Dict[str, str]) -> Dict[str, Any]:
    """
    Route request to appropriate handler based on method and path
    
    Args:
        method: HTTP method
        path: Request path
        query_params: Query parameters
        body: Request body
        path_params: Path parameters
        
    Returns:
        Response data
    """
    logger.info(f"Routing request: {method} {path}")
    
    # CORS preflight requests are handled by API Gateway automatically
    # No need to handle OPTIONS in Lambda when API Gateway CORS is configured
    
    # Route based on path and method
    if path == '/agents':
        if method == 'POST':
            return handle_create_agent(body)
        elif method == 'GET':
            return handle_list_agents(query_params)
        else:
            raise APIError(405, 'METHOD_NOT_ALLOWED', f'Method {method} not allowed for {path}')
    
    elif path == '/agents/search':
        if method == 'GET':
            return handle_search_agents(query_params)
        else:
            raise APIError(405, 'METHOD_NOT_ALLOWED', f'Method {method} not allowed for {path}')
    
    elif path.startswith('/agents/') and 'id' in path_params:
        agent_id = path_params['id']
        
        if 'resource' in path_params and path_params['resource'] == 'health':
            # Handle /agents/{id}/health
            if method == 'POST':
                return handle_update_health(agent_id, body)
            else:
                raise APIError(405, 'METHOD_NOT_ALLOWED', f'Method {method} not allowed for {path}')
        else:
            # Handle /agents/{id}
            if method == 'GET':
                return handle_get_agent(agent_id)
            elif method == 'PUT':
                return handle_update_agent(agent_id, body)
            elif method == 'DELETE':
                return handle_delete_agent(agent_id)
            else:
                raise APIError(405, 'METHOD_NOT_ALLOWED', f'Method {method} not allowed for {path}')
    
    else:
        raise APIError(404, 'NOT_FOUND', f'Endpoint {path} not found')


def handle_create_agent(body: Optional[str]) -> Dict[str, Any]:
    """
    Handle POST /agents - Create new agent card
    
    Args:
        body: Request body containing agent card data
        
    Returns:
        Response with created agent ID
    """
    logger.info("Handling create agent request")
    
    if not body:
        raise APIError(400, 'VALIDATION_ERROR', 'Request body is required')
    
    try:
        agent_data = json.loads(body)
    except json.JSONDecodeError:
        raise APIError(400, 'VALIDATION_ERROR', 'Invalid JSON in request body')
    
    try:
        # Import and use agent service
        from services.agent_service import AgentService, AgentServiceError
        from utils.validation import ValidationError
        import os
        
        # Initialize agent service
        agent_service = AgentService(
            vector_bucket_name=os.environ.get('S3_VECTORS_BUCKET_NAME', 'agent-registry-vectors'),
            index_name=os.environ.get('S3_VECTORS_INDEX_NAME', 'agent-embeddings')
        )
        
        # Create agent using service
        agent_id = agent_service.create_agent(agent_data)
        
        logger.info(f"Created agent with ID: {agent_id}")
        
        return {
            'agent_id': agent_id,
            'message': 'Agent created successfully'
        }
        
    except ValidationError as e:
        logger.warning("Agent validation failed", field=e.field, validation_message=e.message)
        raise APIError(400, 'VALIDATION_ERROR', e.message, {'field': e.field})
    
    except AgentServiceError as e:
        logger.error("Agent service error during create", error_code=e.error_code, error_message=e.message)
        
        if e.error_code == "AGENT_NOT_FOUND":
            raise APIError(404, e.error_code, e.message, e.details)
        elif e.error_code in ["VALIDATION_ERROR", "DATA_CORRUPTION_ERROR", "EMBEDDING_GENERATION_ERROR"]:
            raise APIError(400, e.error_code, e.message, e.details)
        else:
            raise APIError(500, e.error_code, e.message, e.details)


def handle_get_agent(agent_id: str) -> Dict[str, Any]:
    """
    Handle GET /agents/{id} - Get specific agent card
    
    Args:
        agent_id: Agent ID from path parameter
        
    Returns:
        Agent card data
    """
    logger.info(f"Handling get agent request for ID: {agent_id}")
    
    try:
        # Import and use agent service
        from services.agent_service import AgentService, AgentServiceError
        from utils.validation import ValidationError
        import os
        
        # Initialize agent service
        agent_service = AgentService(
            vector_bucket_name=os.environ.get('S3_VECTORS_BUCKET_NAME', 'agent-registry-vectors'),
            index_name=os.environ.get('S3_VECTORS_INDEX_NAME', 'agent-embeddings')
        )
        
        # Get agent using service
        agent_card = agent_service.get_agent(agent_id)
        
        if agent_card is None:
            raise APIError(404, 'AGENT_NOT_FOUND', f'Agent with ID {agent_id} not found')

        logger.info(f"Retrieved agent with ID: {agent_id}")

        # Content-addressed reference over the served card, so a consumer can
        # verify it matches the card the agent published (recompute and compare).
        from utils.integrity import compute_card_ref
        return {
            'agent': agent_card,
            'card_ref': compute_card_ref(agent_card)
        }
        
    except ValidationError as e:
        logger.warning("Agent ID validation failed", field=e.field, validation_message=e.message)
        raise APIError(400, 'VALIDATION_ERROR', e.message, {'field': e.field})
    
    except AgentServiceError as e:
        logger.error("Agent service error during get", error_code=e.error_code, error_message=e.message)
        
        if e.error_code == "AGENT_NOT_FOUND":
            raise APIError(404, e.error_code, e.message, e.details)
        elif e.error_code in ["VALIDATION_ERROR", "DATA_CORRUPTION_ERROR"]:
            raise APIError(400, e.error_code, e.message, e.details)
        else:
            raise APIError(500, e.error_code, e.message, e.details)


def handle_list_agents(query_params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle GET /agents - List all agents with pagination
    
    Args:
        query_params: Query parameters for pagination
        
    Returns:
        List of agents with pagination info
    """
    logger.info("Handling list agents request")
    
    try:
        # Parse and validate pagination parameters
        limit_param = query_params.get('limit', [None])[0]
        offset_param = query_params.get('offset', [None])[0]
        
        # Convert to integers if provided
        limit = int(limit_param) if limit_param else None
        offset = int(offset_param) if offset_param else None
        
        # Validate pagination parameters
        pagination = validate_pagination_params(limit, offset)
        
        logger.info("Listing agents", limit=pagination['limit'], offset=pagination['offset'])
        
        # Import and use agent service
        from services.agent_service import AgentService, AgentServiceError
        import os
        
        # Initialize agent service
        agent_service = AgentService(
            vector_bucket_name=os.environ.get('S3_VECTORS_BUCKET_NAME', 'agent-registry-vectors'),
            index_name=os.environ.get('S3_VECTORS_INDEX_NAME', 'agent-embeddings')
        )
        
        # List agents using service
        result = agent_service.list_agents(pagination['limit'], pagination['offset'])
        
        logger.info("Listed agents successfully", 
                   count=len(result['agents']), 
                   total=result['pagination']['total'])
        
        return result
        
    except (ValueError, TypeError) as e:
        raise APIError(400, 'VALIDATION_ERROR', f'Invalid pagination parameters: {str(e)}')
    
    except AgentServiceError as e:
        logger.error("Agent service error during list", error_code=e.error_code, error_message=e.message)
        raise APIError(500, e.error_code, e.message, e.details)


def handle_search_agents(query_params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle GET /agents/search - Search agents by text and skills
    
    Args:
        query_params: Query parameters for search
        
    Returns:
        Search results
    """
    logger.info("Handling search agents request")
    
    try:
        # Parse search parameters
        text_query = query_params.get('text', [None])[0]
        skills_param = query_params.get('skills', [])
        top_k_param = query_params.get('top_k', [None])[0]
        
        # Handle skills parameter (can be comma-separated string or list)
        skills = []
        if skills_param:
            if isinstance(skills_param, list):
                # If it's already a list, check if items need to be split
                for item in skills_param:
                    if ',' in str(item):
                        # Split comma-separated values
                        skills.extend([skill.strip() for skill in str(item).split(',') if skill.strip()])
                    else:
                        skills.append(str(item).strip())
            else:
                # Handle comma-separated skills
                skills = [skill.strip() for skill in str(skills_param).split(',') if skill.strip()]
        
        # Parse top_k parameter
        top_k = 10  # Default value
        if top_k_param:
            try:
                top_k = int(top_k_param)
                if top_k <= 0 or top_k > 30:
                    raise ValueError("top_k must be between 1 and 30")
            except ValueError:
                raise APIError(400, 'VALIDATION_ERROR', 'Invalid top_k parameter: must be an integer between 1 and 30')
        
        # Validate search parameters using validation utility
        from utils.validation import validate_search_params
        validated_params = validate_search_params(text_query, skills if skills else None)
        
        logger.info("Searching agents", 
                   text=validated_params.get('text'), 
                   skills=validated_params.get('skills'),
                   top_k=top_k)
        
        # Import and use search service
        from services.search_service import SearchService, SearchServiceError
        import os
        
        # Initialize search service
        search_service = SearchService(
            vector_bucket_name=os.environ.get('S3_VECTORS_BUCKET_NAME', 'agent-registry-vectors'),
            index_name=os.environ.get('S3_VECTORS_INDEX_NAME', 'agent-embeddings')
        )
        
        # Execute unified search (handles all three types: semantic, skills-only, combined)
        results = search_service.search_agents(
            query=validated_params.get('text'),
            skills=validated_params.get('skills'),
            top_k=top_k
        )
        
        logger.info("Search completed successfully", 
                   results_count=len(results),
                   text=validated_params.get('text'),
                   skills=validated_params.get('skills'))
        
        # Format results to match expected client format
        formatted_results = []
        for result in results:
            # Create a result with agent_card structure expected by client
            formatted_result = {
                'agent_id': result.get('agent_id'),
                'agent_card': {k: v for k, v in result.items() if k not in ['agent_id', '_search_metadata']},
                'similarity_score': result.get('_search_metadata', {}).get('similarity_score', 0),
                'matched_skills': result.get('_search_metadata', {}).get('matched_skills', [])
            }
            formatted_results.append(formatted_result)
        
        return formatted_results
        
    except ValidationError as e:
        raise APIError(400, 'VALIDATION_ERROR', e.message, {'field': e.field})
    
    except SearchServiceError as e:
        logger.error("Search service error", error_code=e.error_code, error_message=e.message)
        
        if e.error_code in ["INVALID_QUERY", "INVALID_SKILLS"]:
            raise APIError(400, e.error_code, e.message, e.details)
        elif e.error_code == "EMBEDDING_ERROR":
            raise APIError(503, e.error_code, e.message, e.details)
        else:
            raise APIError(500, e.error_code, e.message, e.details)


def handle_delete_agent(agent_id: str) -> Dict[str, Any]:
    """
    Handle DELETE /agents/{id} - Delete specific agent card
    
    Args:
        agent_id: Agent ID from path parameter
        
    Returns:
        Deletion confirmation
    """
    logger.info(f"Handling delete agent request for ID: {agent_id}")
    
    try:
        # Import and use agent service
        from services.agent_service import AgentService, AgentServiceError
        from utils.validation import ValidationError
        import os
        
        # Initialize agent service
        agent_service = AgentService(
            vector_bucket_name=os.environ.get('S3_VECTORS_BUCKET_NAME', 'agent-registry-vectors'),
            index_name=os.environ.get('S3_VECTORS_INDEX_NAME', 'agent-embeddings')
        )
        
        # Delete agent using service
        success = agent_service.delete_agent(agent_id)
        
        if success:
            logger.info(f"Agent deleted successfully: {agent_id}")
            return {
                'agent_id': agent_id,
                'message': 'Agent deleted successfully'
            }
        else:
            raise APIError(500, 'DELETE_FAILED', 'Failed to delete agent')
        
    except ValidationError as e:
        logger.warning("Agent ID validation failed", field=e.field, validation_message=e.message)
        raise APIError(400, 'VALIDATION_ERROR', e.message, {'field': e.field})
    
    except AgentServiceError as e:
        logger.error("Agent service error during delete", error_code=e.error_code, error_message=e.message)
        
        if e.error_code == "AGENT_NOT_FOUND":
            raise APIError(404, e.error_code, e.message, e.details)
        elif e.error_code in ["VALIDATION_ERROR"]:
            raise APIError(400, e.error_code, e.message, e.details)
        else:
            raise APIError(500, e.error_code, e.message, e.details)


def handle_update_agent(agent_id: str, body: Optional[str]) -> Dict[str, Any]:
    """
    Handle PUT /agents/{id} - Update existing agent card
    
    Args:
        agent_id: Agent ID from path parameter
        body: Request body containing updated agent card data
        
    Returns:
        Update confirmation
    """
    logger.info(f"Handling update agent request for ID: {agent_id}")
    
    if not body:
        raise APIError(400, 'VALIDATION_ERROR', 'Request body is required')
    
    try:
        update_data = json.loads(body)
    except json.JSONDecodeError:
        raise APIError(400, 'VALIDATION_ERROR', 'Invalid JSON in request body')
    
    try:
        # Import and use agent service
        from services.agent_service import AgentService, AgentServiceError
        from utils.validation import ValidationError, validate_agent_card_update
        import os
        
        # Validate the update data
        validated_update_data = validate_agent_card_update(update_data)
        
        # Initialize agent service
        agent_service = AgentService(
            vector_bucket_name=os.environ.get('S3_VECTORS_BUCKET_NAME', 'agent-registry-vectors'),
            index_name=os.environ.get('S3_VECTORS_INDEX_NAME', 'agent-embeddings')
        )
        
        # Update agent using service
        success = agent_service.update_agent(agent_id, validated_update_data)
        
        if success:
            logger.info(f"Agent updated successfully: {agent_id}")
            return {
                'agent_id': agent_id,
                'message': 'Agent updated successfully'
            }
        else:
            raise APIError(500, 'UPDATE_FAILED', 'Failed to update agent')
        
    except ValidationError as e:
        logger.warning("Agent update validation failed", 
                      agent_id=agent_id, field=e.field, validation_message=e.message)
        raise APIError(400, 'VALIDATION_ERROR', e.message, {'field': e.field})
    
    except AgentServiceError as e:
        logger.error("Agent service error during update", 
                    agent_id=agent_id, error_code=e.error_code, error_message=e.message)
        
        if e.error_code == "AGENT_NOT_FOUND":
            raise APIError(404, e.error_code, e.message, e.details)
        elif e.error_code in ["VALIDATION_ERROR", "DATA_CORRUPTION_ERROR", "EMBEDDING_GENERATION_ERROR"]:
            raise APIError(400, e.error_code, e.message, e.details)
        else:
            raise APIError(500, e.error_code, e.message, e.details)


def handle_update_health(agent_id: str, body: Optional[str]) -> Dict[str, Any]:
    """
    Handle POST /agents/{id}/health - Update agent health status
    
    Args:
        agent_id: Agent ID from path parameter
        body: Request body (optional)
        
    Returns:
        Health update confirmation
    """
    logger.info(f"Handling update health request for agent ID: {agent_id}")
    
    try:
        # Import and use agent service
        from services.agent_service import AgentService, AgentServiceError
        from utils.validation import ValidationError
        import os
        
        # Initialize agent service
        agent_service = AgentService(
            vector_bucket_name=os.environ.get('S3_VECTORS_BUCKET_NAME', 'agent-registry-vectors'),
            index_name=os.environ.get('S3_VECTORS_INDEX_NAME', 'agent-embeddings')
        )
        
        # Update agent health using service
        success = agent_service.update_agent_health(agent_id)
        
        if success:
            logger.info(f"Health status updated successfully for agent ID: {agent_id}")
            return {
                'agent_id': agent_id,
                'message': 'Health status updated successfully'
            }
        else:
            raise APIError(500, 'HEALTH_UPDATE_FAILED', 'Failed to update health status')
        
    except ValidationError as e:
        logger.warning("Agent ID validation failed", field=e.field, validation_message=e.message)
        raise APIError(400, 'VALIDATION_ERROR', e.message, {'field': e.field})
    
    except AgentServiceError as e:
        logger.error("Agent service error during health update", error_code=e.error_code, error_message=e.message)
        
        if e.error_code == "AGENT_NOT_FOUND":
            raise APIError(404, e.error_code, e.message, e.details)
        elif e.error_code in ["VALIDATION_ERROR"]:
            raise APIError(400, e.error_code, e.message, e.details)
        else:
            raise APIError(500, e.error_code, e.message, e.details)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for all API requests
    
    Args:
        event: API Gateway event
        context: Lambda context
        
    Returns:
        API Gateway response
    """
    request_id = str(uuid.uuid4())
    start_time = datetime.now(timezone.utc)
    
    try:
        # Extract request information
        method = event.get('httpMethod', '')
        path = event.get('path', '')
        query_string_parameters = event.get('queryStringParameters') or {}
        body = event.get('body')
        
        # Log incoming request
        logger.log_request(method, path, request_id, 
                          query_params=query_string_parameters,
                          has_body=bool(body))
        
        # Parse query parameters (handle both single values and lists)
        query_params = {}
        for key, value in query_string_parameters.items():
            if isinstance(value, str):
                query_params[key] = [value]
            else:
                query_params[key] = value if isinstance(value, list) else [value]
        
        # Parse path parameters
        path_params = parse_path_parameters(path)
        
        # Route the request
        response_data = route_request(method, path, query_params, body, path_params)
        
        # Calculate request duration
        end_time = datetime.now(timezone.utc)
        duration_ms = (end_time - start_time).total_seconds() * 1000
        
        # Create successful response
        response = create_response(200, response_data, request_id)
        
        # Log successful response
        logger.log_response(200, request_id, duration_ms)
        
        return response
        
    except APIError as e:
        # Calculate request duration
        end_time = datetime.now(timezone.utc)
        duration_ms = (end_time - start_time).total_seconds() * 1000
        
        # Log API error
        logger.log_api_error(e.error_code, e.message, request_id, 
                           status_code=e.status_code, duration_ms=duration_ms)
        
        return create_error_response(e, request_id)
        
    except Exception as e:
        # Calculate request duration
        end_time = datetime.now(timezone.utc)
        duration_ms = (end_time - start_time).total_seconds() * 1000
        
        # Log unexpected error
        logger.error("Unexpected error occurred", error=e, request_id=request_id, 
                    duration_ms=duration_ms)
        
        error = APIError(500, 'INTERNAL_ERROR', 'Internal server error')
        return create_error_response(error, request_id)