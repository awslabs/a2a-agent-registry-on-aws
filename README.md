<h2 align="center">A2A Agent Registry on AWS</h2>
<p align="center">A scalable agent registry for discovering and managing AI agents using the <a href="https://a2a-protocol.org/latest/">A2A (Agent-to-Agent) protocol</a> with semantic search capabilities powered by Amazon Bedrock and S3 Vectors.</p>

---

<p align="center">
  <a href="https://github.com/awslabs/a2a-agent-registry-on-aws"><img alt="GitHub Repo" src="https://img.shields.io/badge/GitHub-Repo-green.svg" /></a>
  <img alt="Python 3.11+" src="https://img.shields.io/badge/python-3.11+-blue.svg" />
  <img alt="Node.js 18+" src="https://img.shields.io/badge/node.js-18+-green.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-CDK-blue.svg" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61dafb.svg" />
</p>

<p align="center">
  <img src="https://img.shields.io/github/stars/awslabs/a2a-agent-registry-on-aws?style=social" alt="GitHub stars">
  <img src="https://img.shields.io/github/forks/awslabs/a2a-agent-registry-on-aws?style=social" alt="GitHub forks">
</p>

<p align="center">
  <img src="https://img.shields.io/github/last-commit/awslabs/a2a-agent-registry-on-aws" alt="Last Commit">
  <img src="https://img.shields.io/github/issues/awslabs/a2a-agent-registry-on-aws" alt="Issues">
  <img src="https://img.shields.io/github/license/awslabs/a2a-agent-registry-on-aws" alt="License">
</p>

## What is the A2A Agent Registry?

The A2A Agent Registry is a **centralized service for registering, discovering, and managing AI agents** in multi-agent systems. It stores [AgentCards](https://a2a-protocol.org/latest/specification/#441-agentcard) — the standard metadata format that describes an agent's identity, capabilities, and endpoint. It implements Google's [Agent-to-Agent (A2A) protocol](https://a2a-protocol.org/latest/) to enable seamless agent-to-agent communication and discovery.

Build your own **agent marketplace**, **agentic AI platform**, or **LLM agent orchestration layer** with:
- **Semantic search** — Find agents using natural language queries (not just keyword matching)
- **Skill-based filtering** — Query agents by capabilities using metadata filters
- **Serverless architecture** — Pay only for what you use with AWS Lambda and S3 Vectors
- **Python SDK** — Python client with retry logic, error handling, and IAM auth

Perfect for teams building **multi-agent systems**, **AI agent orchestration**, **agentic workflows**, or **autonomous agent platforms**.

## 🎯 Use Cases

| Use Case | Description |
|----------|-------------|
| **Agent Marketplace** | Build a searchable catalog where developers register and discover AI agents |
| **Multi-Agent Orchestration** | Enable agents to dynamically discover and communicate with other agents |
| **Enterprise Agent Platform** | Centralized registry for managing internal AI agents across teams |
| **Agentic Workflow Engine** | Route tasks to the most capable agent based on semantic matching |
| **LLM Agent Discovery** | Help LLM-based agents find specialized tools and services at runtime |

## 🔖 Features

| Feature | Description |
|---------|-------------|
| 🔍 **Semantic Search** | Find agents using natural language queries powered by Amazon Bedrock Titan embeddings |
| 🏷️ **Skill-Based Filtering** | Filter agents by specific skills using Amazon S3 Vectors metadata |
| 📋 **A2A Protocol Compliant** | Full support for Agent-to-Agent protocol agent cards |
| 🔐 **Secure by Default** | IAM authentication on all API endpoints |
| 🐍 **Python SDK** | Client library with retry logic and error handling |
| 🌐 **Web Interface** | React-based UI built with AWS Cloudscape Design System |
| ☁️ **Serverless Architecture** | Fully managed with AWS Lambda, API Gateway, and S3 Vectors |
| 💰 **Cost Effective** | Pay-per-use pricing with no idle costs |

## 🎬 Web UI Demo

![Web UI Demo](web-ui/web-ui.gif)

The demo showcases:
- **Register new agent** — Add agents with their capabilities and skills
- **See all agents** — Browse the complete list of registered agents
- **Search with plain text** — Find agents using natural language queries
- **Search by skill name** — Filter agents by specific skills

## 🏗️ Architecture

![Architecture](a2a-agent-registry-on-aws.jpg)

When you deploy `AgentRegistryStack`, you get an out-of-the-box agent registry:

| Component | Purpose |
|-----------|---------|
| **API Gateway** | RESTful API with IAM authentication for secure access |
| **Lambda** | Serverless compute handling agent CRUD operations and search queries |
| **S3 Vectors** | Vector storage for agent embeddings enabling semantic search |
| **Amazon Bedrock** | Titan embeddings model for converting agent descriptions to vectors |

The **Python SDK** (`client/`) provides a client library with retry logic and IAM authentication.

Optionally, deploy `AgentRegistryWebUI` for a React-based web interface with Cognito authentication — connect it to your SSO provider or invite users directly from the Cognito console using their email address.

## 🚀 Quick Start

### Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+
- Python 3.11+
- Docker (required by CDK to build Lambda and install dependencies)

### Deploy the Agent Registry

```bash
# Build the Web UI first (required for deployment)
cd web-ui
npm install
npm run build

# Deploy the infrastructure
cd ../infrastructure
npm install
cdk deploy AgentRegistryStack
```

### Deploy Web UI (Optional)

```bash
cd infrastructure
cdk deploy AgentRegistryWebUI
```

The Web UI stack deploys:
- S3 bucket for static hosting
- CloudFront distribution
- Cognito User Pool for authentication
- Cognito Identity Pool for AWS credentials

> **Important: CORS Configuration**
>
> By default, the API allows cross-origin requests from any origin (`*`). You can restrict CORS to a specific domain by passing the `corsOrigin` parameter.
>
> **To restrict CORS to a specific origin:**
> ```bash
> # Using a custom domain
> cdk deploy AgentRegistryStack -c corsOrigin=https://your-domain.com
>
> # Using the Web UI CloudFront domain (get from AgentRegistryWebUI stack output)
> cdk deploy AgentRegistryStack -c corsOrigin=https://d1234567890.cloudfront.net
> ```
>
> **To restrict CORS to only the Web UI:**
> 1. Deploy `AgentRegistryStack` first
> 2. Deploy `AgentRegistryWebUI` and note the `CloudFrontDomainName` output
> 3. Update `AgentRegistryStack` with `-c corsOrigin=<CloudFrontDomainName>` to restrict CORS to only the Web UI

### Use the Python SDK

```python
from agent_registry_client import AgentRegistryClient
from a2a.types import AgentCard

client = AgentRegistryClient(api_gateway_url="https://your-api.execute-api.region.amazonaws.com/prod")

# Register an agent
agent_id = client.create_agent(AgentCard(
    name="My Agent",
    description="An agent that helps with tasks",
    version="1.0.0",
    url="https://my-agent.example.com"
))

# Search for agents using natural language
results = client.search_agents(query="help with financial analysis")

# Search by skills
results = client.search_agents(skills=["python", "data-analysis"])

# Combined semantic + skill search
results = client.search_agents(query="code review assistant", skills=["python"])
```

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [API Documentation](docs/api.md) | REST API endpoints, request/response formats, error codes |
| [Local Development](docs/local-development.md) | Setup local environment, run tests, development workflow |
| [Python SDK](client/README.md) | Client SDK installation, usage examples, error handling |

## 💰 Cost Estimate

The serverless architecture means you only pay for what you use. For **1 million requests per month** (20% add agent card, 80% search agent cards) in us-east-1:

| Service | Monthly Cost |
|---------|-------------|
| API Gateway | $1.00 |
| Lambda | $6.45 |
| Amazon Bedrock Titan Embeddings | $2.00 |
| Amazon S3 Vectors | $13.20 |
| **Total** | **$22.65** |

## ❓ FAQ

<details>
<summary><strong>How does semantic search work?</strong></summary>

When you register an agent, the registry generates a 1024-dimensional vector embedding from the agent's name and description using Amazon Bedrock Titan Text Embeddings V2. When you search, your query is converted to an embedding, and S3 Vectors finds agents with the most similar embeddings using cosine distance. Results are ranked by similarity score (1 - distance).
</details>

<details>
<summary><strong>What's the difference between semantic search and skill filtering?</strong></summary>

Semantic search finds agents based on meaning — "financial advisor" would match an agent described as "investment portfolio manager". Skill filtering is exact matching on declared skills — searching for skill "python" only returns agents that explicitly list "python" as a skill. You can combine both for precise results.
</details>

<details>
<summary><strong>Can I use this with agents built on LangChain, AutoGen, or CrewAI?</strong></summary>

Yes! The registry is framework-agnostic. Any agent that can be described with a name, description, URL, and skills can be registered. The A2A protocol provides a standard way for agents to advertise their capabilities regardless of how they're implemented.
</details>

<details>
<summary><strong>How do I authenticate API requests?</strong></summary>

All API endpoints use AWS IAM authentication (Signature Version 4). The Python SDK handles this automatically using your configured AWS credentials. For the Web UI, Cognito provides user authentication and vends temporary AWS credentials.
</details>

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

- 🐛 [Report bugs](https://github.com/awslabs/a2a-agent-registry-on-aws/issues)
- 💡 [Request features](https://github.com/awslabs/a2a-agent-registry-on-aws/issues)
- 🔧 [Submit pull requests](https://github.com/awslabs/a2a-agent-registry-on-aws/pulls)

## 📄 License

This project is licensed under the Apache 2.0 License. See [LICENSE](LICENSE) for details.
