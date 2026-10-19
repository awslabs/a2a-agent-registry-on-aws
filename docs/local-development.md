# Local Development Guide

## Prerequisites

- Python 3.11+
- Node.js 24 (LTS)
- AWS CLI configured
- uv (Python package manager)
- Docker (optional, for Web UI containerization)

## Project Structure

```
a2a-agent-registry-on-aws/
├── infrastructure/     # AWS CDK infrastructure (TypeScript)
├── client/            # Python SDK
├── lambda/            # Lambda function code
├── web-ui/            # React web interface
├── integration_test/  # Integration tests
└── docs/              # Documentation
```

## Setting Up Local Environment

### 1. Infrastructure (CDK)

```bash
cd infrastructure
npm install
npm run build
```

### 2. Lambda Function

```bash
cd lambda
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

### 3. Python SDK

```bash
cd client
uv venv
source .venv/bin/activate
uv add -e .
```

### 4. Web UI

```bash
cd web-ui
npm install
```

### 5. Integration Tests

```bash
cd integration_test
uv venv
source .venv/bin/activate
uv sync
```

## Modifying the API

### Lambda Function Code

The API logic is in `lambda/src/`:

```
lambda/src/
├── handler.py              # Main Lambda handler and routing
├── services/
│   ├── agent_service.py    # Agent CRUD operations
│   ├── search_service.py   # Semantic search
│   ├── health_service.py   # Health status updates
│   └── embedding_service.py # Bedrock embeddings
└── utils/
    ├── validation.py       # Input validation
    ├── response.py         # Response formatting
    └── logging.py          # Structured logging
```

### Deploy API Changes

After modifying Lambda code:

```bash
cd infrastructure
npm run build
cdk deploy AgentRegistryStack
```

### Testing API Changes Locally

Run unit tests before deploying:

```bash
cd lambda
uv run pytest
```

## Modifying the Web UI

### Development Server

```bash
cd web-ui
npm start
```

The development server runs at `http://localhost:3000`.

### Configuration

Copy the environment template:

```bash
cp .env.example .env.local
```

Configure environment variables in `.env.local`:

```bash
REACT_APP_API_GATEWAY_URL=https://your-api.execute-api.us-east-1.amazonaws.com/prod
REACT_APP_AWS_REGION=us-east-1
REACT_APP_IDENTITY_POOL_ID=us-east-1:your-identity-pool-id
```

### Build for Production

```bash
npm run build
```

### Deploy Web UI Changes

```bash
cd web-ui
npm run build

cd ../infrastructure
cdk deploy AgentRegistryWebUI
```

## Running Integration Tests

### Prerequisites

1. Deploy the API stack first:
   ```bash
   cd infrastructure
   cdk deploy AgentRegistryStack
   ```

2. Configure AWS credentials:
   ```bash
   aws configure
   # or
   export AWS_PROFILE=your-profile
   ```

### Run Tests

```bash
cd integration_test
./run_tests.sh
```

Or run individual test files:

```bash
cd integration_test
uv run python test_agent_registry_api.py
uv run python test_delete_agent.py
uv run python test_comprehensive_heartbeat.py
```

### Test Files

| File | Description |
|------|-------------|
| `test_agent_registry_api.py` | Comprehensive API test suite |
| `test_delete_agent.py` | Delete agent functionality |
| `test_comprehensive_heartbeat.py` | Health monitoring tests |
| `test_embedding_error_handling.py` | Embedding error handling |
| `test_heartbeat_simple.py` | Basic heartbeat tests |

### Updating Test Configuration

Edit the API URL in test files or set environment variables:

```python
API_GATEWAY_URL = "https://your-api-gateway-id.execute-api.us-east-1.amazonaws.com/prod"
AWS_REGION = "us-east-1"
```

## Development Workflow

### Making API Changes

1. Modify code in `lambda/src/`
2. Run unit tests: `cd lambda && uv run pytest`
3. Deploy: `cd infrastructure && cdk deploy AgentRegistryStack`
4. Run integration tests: `cd integration_test && ./run_tests.sh`

### Making Web UI Changes

1. Start dev server: `cd web-ui && npm start`
2. Make changes and test locally
3. Build: `npm run build`
4. Deploy: `cd infrastructure && cdk deploy AgentRegistryWebUI`

### Making SDK Changes

1. Modify code in `client/src/agent_registry_client/`
2. Run tests: `cd client && uv run pytest`
3. Test with integration tests
