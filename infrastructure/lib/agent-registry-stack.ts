import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { S3VectorsConstruct } from "./constructs/s3-vectors-construct";
import { NagSuppressions } from "cdk-nag";

export interface AgentRegistryStackProps extends cdk.StackProps {
  /**
   * The allowed CORS origin for the API Gateway.
   * Use '*' to allow all origins (default), or specify a specific origin
   * (e.g., 'https://d1234567890.cloudfront.net' or your custom domain).
   * @default '*'
   */
  corsOrigin?: string;
}

export class AgentRegistryStack extends cdk.Stack {
  public readonly s3Vectors: S3VectorsConstruct;
  public readonly apiLambda: PythonFunction;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: AgentRegistryStackProps) {
    super(scope, id, props);

    // CORS origin configuration - defaults to '*' (allow all)
    const corsOrigin = props?.corsOrigin ?? "*";

    // Generate unique bucket name with account ID and region
    const bucketName = `agent-registry-vectors-${this.account}-${this.region}`;

    // S3 Vectors infrastructure for agent embeddings storage
    // Uses custom resource Lambda since CDK doesn't have native S3 Vectors constructs
    this.s3Vectors = new S3VectorsConstruct(this, "S3Vectors", {
      bucketName: bucketName,
      indexName: "agent-embeddings",
      dimension: 1024, // Standard embedding dimension for text models
      distanceMetric: "cosine", // Cosine similarity for semantic search
      nonFilterableMetadataKeys: ["raw_agent_card"], // Large metadata that shouldn't be filtered
    });

    // Stack outputs for other services to reference
    new cdk.CfnOutput(this, "S3VectorsBucketName", {
      value: this.s3Vectors.vectorBucketName,
      description: "S3 Vectors bucket name for agent embeddings",
      exportName: `${this.stackName}-VectorBucketName`,
    });

    new cdk.CfnOutput(this, "S3VectorsIndexName", {
      value: this.s3Vectors.vectorIndexName,
      description: "S3 Vectors index name for agent embeddings",
      exportName: `${this.stackName}-VectorIndexName`,
    });

    new cdk.CfnOutput(this, "S3VectorsBucketArn", {
      value: this.s3Vectors.vectorBucketArn,
      description: "ARN of the S3 Vectors bucket",
      exportName: `${this.stackName}-VectorBucketArn`,
    });

    // Create IAM role for API Lambda function
    const apiLambdaRole = new iam.Role(this, "ApiLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for Agent Registry API Lambda function",
      inlinePolicies: {
        // Custom CloudWatch Logs policy instead of AWS managed policy
        CloudWatchLogs: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/agent-registry-api:*`,
              ],
            }),
          ],
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
              ],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
              ],
            }),
          ],
        }),
        S3VectorsAccess: new iam.PolicyDocument({
          statements: [
            // Vector bucket operations - scoped to specific bucket
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3vectors:GetVectorBucket", "s3vectors:ListIndexes"],
              resources: [
                `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${bucketName}`,
              ],
            }),
            // Vector index operations - scoped to specific index
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "s3vectors:GetIndex",
                "s3vectors:PutVectors",
                "s3vectors:GetVectors",
                "s3vectors:DeleteVectors",
                "s3vectors:QueryVectors",
                "s3vectors:ListVectors",
              ],
              resources: [
                `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${bucketName}/index/${this.s3Vectors.vectorIndexName}`,
              ],
            }),
          ],
        }),
      },
    });

    // Create CloudWatch Log Group for API Lambda
    const apiLambdaLogGroup = new logs.LogGroup(this, "ApiLambdaLogGroup", {
      logGroupName: `/aws/lambda/agent-registry-api`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create main API Lambda function using PythonFunction for automatic dependency management
    this.apiLambda = new PythonFunction(this, "ApiLambda", {
      entry: "../lambda/src",
      runtime: lambda.Runtime.PYTHON_3_14,
      index: "handler.py",
      handler: "lambda_handler",
      role: apiLambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      description: "Agent Registry API Lambda function",
      logGroup: apiLambdaLogGroup,
      environment: {
        S3_VECTORS_BUCKET_NAME: this.s3Vectors.vectorBucketName,
        S3_VECTORS_INDEX_NAME: this.s3Vectors.vectorIndexName,
        BEDROCK_MODEL_ID: "amazon.titan-embed-text-v2:0",
        LOG_LEVEL: "INFO",
      },
    });

    // Create CloudWatch Log Group for API Gateway access logs
    const apiLogGroup = new logs.LogGroup(this, "ApiGatewayLogGroup", {
      logGroupName: `/aws/apigateway/agent-registry-api`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create API Gateway with IAM authentication
    this.api = new apigateway.RestApi(this, "AgentRegistryApi", {
      restApiName: "Agent Registry API",
      description:
        "API for managing and searching agent cards with semantic capabilities",
      defaultCorsPreflightOptions: {
        allowOrigins: corsOrigin === "*" ? apigateway.Cors.ALL_ORIGINS : [corsOrigin],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
          "X-Amz-User-Agent",
          "X-Amz-Content-Sha256",
          "X-Amz-Target",
        ],
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        // Enable access logging
        accessLogDestination: new apigateway.LogGroupLogDestination(
          apiLogGroup
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
      cloudWatchRole: false, // Disable to avoid AWS managed policy
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
    });

    // Add request validator for API Gateway
    const requestValidator = new apigateway.RequestValidator(
      this,
      "RequestValidator",
      {
        restApi: this.api,
        requestValidatorName: "agent-registry-validator",
        validateRequestBody: true,
        validateRequestParameters: true,
      }
    );

    // Create Lambda integration for API Gateway
    const lambdaIntegration = new apigateway.LambdaIntegration(this.apiLambda, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' },
      proxy: true,
      allowTestInvoke: true,
    });

    // Configure proxy integration for all paths and methods
    // This allows the Lambda function to handle all routing internally
    this.api.root.addProxy({
      defaultIntegration: lambdaIntegration,
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.IAM,
        requestValidator: requestValidator,
        requestParameters: {
          "method.request.path.proxy": true,
        },
      },
      anyMethod: true, // Enable ANY method on proxy to handle all HTTP methods
    });

    // Add root resource method for base path (non-proxy) with IAM auth
    this.api.root.addMethod("GET", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      requestValidator: requestValidator,
    });

    // Grant API Gateway permission to invoke Lambda
    this.apiLambda.addPermission("ApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: this.api.arnForExecuteApi("*"),
    });

    // Add CORS headers to error responses - force update
    // Use configured corsOrigin for error responses
    const corsAllowOrigin = corsOrigin === "*" ? "'*'" : `'${corsOrigin}'`;
    
    this.api.addGatewayResponse("Default4XX", {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": corsAllowOrigin,
        "Access-Control-Allow-Headers": "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Amz-Content-Sha256,X-Amz-Target'",
        "Access-Control-Allow-Methods": "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
      },
    });

    this.api.addGatewayResponse("Default5XX", {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": corsAllowOrigin,
        "Access-Control-Allow-Headers": "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Amz-Content-Sha256,X-Amz-Target'",
        "Access-Control-Allow-Methods": "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
      },
    });

    // Stack outputs for API Gateway
    new cdk.CfnOutput(this, "ApiGatewayUrl", {
      value: this.api.url,
      description: "Agent Registry API Gateway URL",
      exportName: `${this.stackName}-ApiUrl`,
    });

    // Export for Agent Registry API Endpoint (prod stage)
    new cdk.CfnOutput(this, "AgentRegistryApiEndpoint", {
      value: this.api.url,
      description: "Agent Registry API Endpoint for prod stage",
      exportName: "AgentRegistry::Api::Endpoint",
    });

    new cdk.CfnOutput(this, "ApiGatewayId", {
      value: this.api.restApiId,
      description: "Agent Registry API Gateway ID",
      exportName: `${this.stackName}-ApiId`,
    });

    new cdk.CfnOutput(this, "ApiLambdaArn", {
      value: this.apiLambda.functionArn,
      description: "Agent Registry API Lambda function ARN",
      exportName: `${this.stackName}-ApiLambdaArn`,
    });

    new cdk.CfnOutput(this, "ApiLambdaName", {
      value: this.apiLambda.functionName,
      description: "Agent Registry API Lambda function name",
      exportName: `${this.stackName}-ApiLambdaName`,
    });

    // CDK-NAG Suppressions

    // Suppress AWS managed policy usage and wildcard permissions for S3 Vectors custom resource
    NagSuppressions.addResourceSuppressions(
      this.s3Vectors,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "S3 Vectors custom resource Lambda uses AWS managed policy for basic execution. This is standard practice for CDK custom resources and provides minimal required permissions.",
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "S3 Vectors custom resource requires wildcard permissions for account-level operations like ListVectorBuckets, and region/account wildcards for bucket/index creation during CloudFormation lifecycle. S3 Vectors is a new service and requires these permissions for cross-region resource management. See: https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-security.html",
          appliesTo: [
            "Resource::*",
            `Resource::arn:aws:s3vectors:*:*:bucket/${bucketName}`,
            `Resource::arn:aws:s3vectors:*:*:bucket/${bucketName}/index/${this.s3Vectors.vectorIndexName}`,
            `Resource::arn:aws:s3vectors:*:*:bucket/agent-registry-vectors-<AWS::AccountId>-us-east-1`,
            `Resource::arn:aws:s3vectors:*:*:bucket/agent-registry-vectors-<AWS::AccountId>-us-east-1/index/agent-embeddings`,
          ],
        },
      ],
      true
    );

    // Suppress wildcard permissions for CloudWatch Logs - scoped to specific log group
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/AgentRegistryStack/ApiLambdaRole/Resource",
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Wildcard permission needed for CloudWatch Logs stream creation. The resource is scoped to the specific log group for this Lambda function. See: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-identity-based-access-control-cwl.html",
          appliesTo: [
            {
              regex: "/Resource::arn:aws:logs:us-east-1:.*:log-group:/aws/lambda/agent-registry-api:\\*/"
            },
          ],
        },
      ],
      true
    );

    // Suppress API Gateway security warnings - using IAM authentication
    NagSuppressions.addResourceSuppressions(
      this.api,
      [
        {
          id: "AwsSolutions-COG4",
          reason:
            "Using IAM authentication instead of Cognito for this API. IAM provides sufficient security for this internal service API.",
        },
        {
          id: "AwsSolutions-APIG3",
          reason:
            "WAF is not required for this internal API. This is a backend service API that will be accessed by authenticated AWS services.",
        },
        {
          id: "AwsSolutions-APIG4",
          reason:
            "API uses IAM authentication which provides proper authorization. All methods are protected with IAM auth.",
        },
      ],
      true
    );
  }
}
