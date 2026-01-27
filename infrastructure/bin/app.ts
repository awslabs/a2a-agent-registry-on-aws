#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AgentRegistryStack } from '../lib/agent-registry-stack';
import { AgentRegistryWebUI } from '../lib/agent-registry-web-ui-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Get CORS origin from context (can be passed via -c corsOrigin=https://example.com)
// Defaults to '*' (allow all origins)
const corsOrigin = app.node.tryGetContext('corsOrigin') as string | undefined;

// Agent Registry API stack
const agentRegistryStack = new AgentRegistryStack(app, 'AgentRegistryStack', {
  env,
  corsOrigin,
  description: 'A2A Agent Registry API stack with S3 Vectors and API Gateway (uksb-7kqpd93zz4)',
});

// Web UI stack with CloudFront and Cognito
const webUIStack = new AgentRegistryWebUI(app, 'AgentRegistryWebUI', {
  env,
  description: 'A2A Agent Registry Web UI stack with CloudFront and Cognito (uksb-7kqpd93zz4)',
});

// Ensure Web UI stack depends on Agent Registry stack
webUIStack.addDependency(agentRegistryStack);

// Add cdk-nag AWS Solutions checks to validate security best practices
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));