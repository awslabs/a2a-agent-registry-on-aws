import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";

import { NagSuppressions } from "cdk-nag";

export interface AgentRegistryWebUIProps extends cdk.StackProps {
  // No additional props needed - we'll import from AgentRegistryStack
}

export class AgentRegistryWebUI extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly distribution: cloudfront.Distribution;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: AgentRegistryWebUIProps) {
    super(scope, id, props);

    // Create S3 bucket for hosting the React app
    this.bucket = new s3.Bucket(this, "WebUIBucket", {
      bucketName: `agent-registry-web-ui-${this.account}-${this.region}`,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "index.html", // SPA routing support
      publicReadAccess: false, // CloudFront will handle access
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      accessControl: s3.BucketAccessControl.PRIVATE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true, // Fix AwsSolutions-S10: Require SSL/TLS
    });

    // Origin Access Control will be handled automatically by the new S3BucketOrigin.withOriginAccessControl() method

    // Create CloudFront logs bucket
    const cloudFrontLogsBucket = new s3.Bucket(this, "CloudFrontLogsBucket", {
      bucketName: `agent-registry-cf-logs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true, // Fix AwsSolutions-S10: Require SSL/TLS
      // CloudFront logging requires ACL access
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: true,
        ignorePublicAcls: false,
        restrictPublicBuckets: true,
      }),
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [
        {
          id: "DeleteOldLogs",
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // Create CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, "WebUIDistribution", {
      comment: "Agent Registry Web UI Distribution",
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only North America and Europe
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket: cloudFrontLogsBucket,
      logFilePrefix: "cloudfront-logs/",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html", // SPA routing support
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html", // SPA routing support
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    // Create Cognito User Pool with self-signup disabled
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "agent-registry-users",
      selfSignUpEnabled: false, // Disable self-signup as requested
      signInAliases: {
        email: true,
        username: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Advanced security mode requires Plus feature plan, will suppress CDK-NAG warning
    });

    // Create User Pool Client for the web application
    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
      userPoolClientName: "agent-registry-web-client",
      generateSecret: false, // Public client for SPA
      authFlows: {
        userSrp: true,
        userPassword: false, // Disable less secure auth flows
        adminUserPassword: false,
        custom: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false, // More secure to use authorization code
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          `https://${this.distribution.distributionDomainName}`,
          `https://${this.distribution.distributionDomainName}/`,
          "http://localhost:3000", // For local development
          "http://localhost:3000/",
        ],
        logoutUrls: [
          `https://${this.distribution.distributionDomainName}`,
          `https://${this.distribution.distributionDomainName}/`,
          "http://localhost:3000",
          "http://localhost:3000/",
        ],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      preventUserExistenceErrors: true,
    });

    // Create Cognito User Pool Domain for hosted UI with deterministic random prefix
    const domainPrefix = `agent-registry-${cdk.Names.uniqueId(this)
      .toLowerCase()
      .substring(0, 8)}`;
    const userPoolDomain = new cognito.UserPoolDomain(this, "UserPoolDomain", {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: domainPrefix, // Deterministic but random-looking prefix
      },
    });

    // Create Cognito Identity Pool for AWS credentials (authenticated users only)
    this.identityPool = new cognito.CfnIdentityPool(this, "IdentityPool", {
      identityPoolName: "agent-registry-identity-pool",
      allowUnauthenticatedIdentities: false, // No unauthenticated access
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // Import values from the AgentRegistry stack
    const apiGatewayId = cdk.Fn.importValue("AgentRegistryStack-ApiId");
    const apiGatewayUrl = cdk.Fn.importValue("AgentRegistryStack-ApiUrl");

    // Create IAM role for authenticated users only
    const authenticatedRole = new iam.Role(this, "AuthenticatedRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
      description:
        "IAM role for authenticated Cognito users - Agent Registry API access only",
      inlinePolicies: {
        AgentRegistryApiAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["execute-api:Invoke"],
              resources: [
                // Restrict access to only the specific Agent Registry API
                `arn:aws:execute-api:${this.region}:${this.account}:${apiGatewayId}/*/*`,
              ],
            }),
          ],
        }),
      },
    });

    // Attach role to Identity Pool (authenticated users only)
    new cognito.CfnIdentityPoolRoleAttachment(
      this,
      "IdentityPoolRoleAttachment",
      {
        identityPoolId: this.identityPool.ref,
        roles: {
          authenticated: authenticatedRole.roleArn,
          // No unauthenticated role - no access without authentication
        },
      }
    );

    // Deploy the React app to S3 from pre-built files
    const webUIDeployment = new s3deploy.BucketDeployment(
      this,
      "WebUIDeployment",
      {
        sources: [s3deploy.Source.asset("../web-ui/build")],
        destinationBucket: this.bucket,
        distribution: this.distribution,
        distributionPaths: ["/*"],
        prune: true, // Remove files not in the new deployment
      }
    );

    // Create Lambda function to generate and upload aws-config.js
    const configGeneratorFunction = new lambda.Function(
      this,
      "ConfigGenerator",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: lambda.Code.fromInline(`
import json
import boto3
import cfnresponse
import logging
import hashlib

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    # Log incoming event first
    logger.info('=== INCOMING EVENT ===')
    logger.info(json.dumps(event, indent=2, default=str))
    logger.info('=== CONTEXT INFO ===')
    logger.info(f'Function name: {context.function_name}')
    logger.info(f'Request ID: {context.aws_request_id}')
    logger.info(f'Log stream: {context.log_stream_name}')
    logger.info('=====================')
    
    response_data = {}
    
    try:
        # Initialize AWS clients
        s3_client = boto3.client('s3')
        cloudfront_client = boto3.client('cloudfront')
        
        request_type = event['RequestType']
        logger.info(f'Request type: {request_type}')
        
        # Generate deployment hash from resource properties for physical resource ID
        resource_props = event.get('ResourceProperties', {})
        config_data = {
            'Region': resource_props.get('Region'),
            'UserPoolId': resource_props.get('UserPoolId'),
            'UserPoolClientId': resource_props.get('UserPoolClientId'),
            'IdentityPoolId': resource_props.get('IdentityPoolId'),
            'ApiGatewayUrl': resource_props.get('ApiGatewayUrl'),
            'CognitoDomain': resource_props.get('CognitoDomain'),
            'Version': resource_props.get('Version')
        }
        
        # Create hash of configuration to use as deployment hash
        config_string = json.dumps(config_data, sort_keys=True)
        deployment_hash = hashlib.sha256(config_string.encode()).hexdigest()[:16]
        physical_resource_id = f"ConfigGenerator-{deployment_hash}"
        
        logger.info(f'Generated physical resource ID: {physical_resource_id}')
        response_data['DeploymentHash'] = deployment_hash
        
        if request_type == 'Delete':
            # Do NOT delete the config file on Delete - we want it to persist
            # This allows the config file to remain available during stack updates
            logger.info('Delete request received - config file will be preserved')
            cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physical_resource_id)
            return
        
        elif request_type in ['Create', 'Update']:
            # Generate the config file content for both Create and Update
            config_content = f"""window.AWS_CONFIG = {{
  region: "{resource_props.get('Region')}",
  userPoolId: "{resource_props.get('UserPoolId')}",
  userPoolWebClientId: "{resource_props.get('UserPoolClientId')}",
  identityPoolId: "{resource_props.get('IdentityPoolId')}",
  apiGatewayUrl: "{resource_props.get('ApiGatewayUrl')}",
  cognitoDomain: "{resource_props.get('CognitoDomain')}"
}};
"""
            
            # Upload to S3
            s3_client.put_object(
                Bucket=resource_props.get('BucketName'),
                Key='aws-config.js',
                Body=config_content,
                ContentType='application/javascript',
                CacheControl='no-cache'
            )
            
            logger.info(f'Config file {request_type.lower()}d successfully')
            
            # Invalidate CloudFront cache for the config file
            if resource_props.get('DistributionId'):
                cloudfront_client.create_invalidation(
                    DistributionId=resource_props.get('DistributionId'),
                    InvalidationBatch={
                        'CallerReference': str(context.aws_request_id),
                        'Paths': {
                            'Quantity': 1,
                            'Items': ['/aws-config.js']
                        }
                    }
                )
                logger.info('CloudFront invalidation created')
            
            response_data['Message'] = f'Config file {request_type.lower()}d and uploaded successfully'
            cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physical_resource_id)
        
        else:
            logger.error(f'Unknown request type: {request_type}')
            response_data['Error'] = f'Unknown request type: {request_type}'
            cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physical_resource_id)
        
    except Exception as e:
        logger.error(f'Error: {str(e)}')
        response_data['Error'] = str(e)
        # Use a fallback physical resource ID if we can't generate one
        fallback_id = f"ConfigGenerator-{context.aws_request_id[:16]}"
        cfnresponse.send(event, context, cfnresponse.FAILED, response_data, fallback_id)
`),
        timeout: cdk.Duration.minutes(5),
      }
    );

    // Grant permissions to the Lambda function
    this.bucket.grantWrite(configGeneratorFunction);
    configGeneratorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
        ],
      })
    );

    // Create custom resource to trigger the Lambda function
    const configGeneratorResource = new cdk.CustomResource(
      this,
      "ConfigGeneratorResourceV4", // Changed name to force replacement
      {
        serviceToken: configGeneratorFunction.functionArn,
        properties: {
          BucketName: this.bucket.bucketName,
          DistributionId: this.distribution.distributionId,
          Region: this.region,
          UserPoolId: this.userPool.userPoolId,
          UserPoolClientId: this.userPoolClient.userPoolClientId,
          IdentityPoolId: this.identityPool.ref,
          ApiGatewayUrl: apiGatewayUrl,
          CognitoDomain: `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
          // Version identifier to ensure proper resource replacement
          Version: "4.0",
          // Add timestamp to force execution on every deployment
          DeploymentTimestamp: Date.now().toString(),
        },
      }
    );

    // Ensure the config is generated after the main deployment
    configGeneratorResource.node.addDependency(webUIDeployment);

    // Stack outputs
    new cdk.CfnOutput(this, "WebUIUrl", {
      value: `https://${this.distribution.distributionDomainName}`,
      description: "Agent Registry Web UI URL",
      exportName: `${this.stackName}-WebUIUrl`,
    });

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID",
      exportName: `${this.stackName}-UserPoolId`,
    });

    new cdk.CfnOutput(this, "CognitoUserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: `${this.stackName}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, "CognitoIdentityPoolId", {
      value: this.identityPool.ref,
      description: "Cognito Identity Pool ID",
      exportName: `${this.stackName}-IdentityPoolId`,
    });

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: "Cognito Hosted UI Domain",
      exportName: `${this.stackName}-CognitoDomain`,
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront Distribution ID",
      exportName: `${this.stackName}-DistributionId`,
    });

    new cdk.CfnOutput(this, "CloudFrontDomainName", {
      value: `https://${this.distribution.distributionDomainName}`,
      description:
        "CloudFront Domain Name - use this as corsOrigin in AgentRegistryStack to restrict CORS",
      exportName: `${this.stackName}-CloudFrontDomainName`,
    });

    // CDK-NAG Suppressions
    NagSuppressions.addResourceSuppressions(
      authenticatedRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Wildcard permission needed for API Gateway paths and methods. Users need to access various Agent Registry API endpoints (GET, POST, PUT, DELETE on /agents/*). This is scoped to the specific API Gateway only. See: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-control-access-using-iam-policies-to-invoke-api.html",
          appliesTo: [
            `Resource::arn:aws:execute-api:${this.region}:${this.account}:AgentRegistryStack-ApiId/*/*`,
            `Resource::arn:aws:execute-api:us-east-1:<AWS::AccountId>:AgentRegistryStack-ApiId/*/*`,
          ],
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this.distribution,
      [
        {
          id: "AwsSolutions-CFR1",
          reason:
            "Geo restriction not required for this internal enterprise application. Users may access from various global locations.",
        },
        {
          id: "AwsSolutions-CFR2",
          reason:
            "WAF not required for this internal web UI serving static content. The application is behind cognito authentication and serves only static assets.",
        },
        {
          id: "AwsSolutions-CFR4",
          reason:
            "Using default CloudFront certificate with TLS 1.2 minimum protocol version (TLS_V1_2_2021). Custom domain can be added later if needed.",
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this.bucket,
      [
        {
          id: "AwsSolutions-S1",
          reason:
            "Access logging not required for static website hosting bucket. CloudFront distribution logging is enabled instead for better performance and cost optimization.",
        },
        {
          id: "AwsSolutions-S5",
          reason:
            "This bucket uses the new CDK L2 construct S3BucketOrigin.withOriginAccessControl() which automatically configures CloudFront Origin Access Control (OAC). OAC is the recommended modern approach and provides better security than legacy OAI.",
        },
      ],
      true
    );

    // Suppress CloudFront logs bucket access logging (circular dependency)
    NagSuppressions.addResourceSuppressions(
      cloudFrontLogsBucket,
      [
        {
          id: "AwsSolutions-S1",
          reason:
            "This is the CloudFront access logs bucket itself. Enabling access logging on a logs bucket would create circular dependency and is not recommended.",
        },
        {
          id: "AwsSolutions-S2",
          reason:
            "CloudFront logs bucket requires specific ACL permissions for CloudFront service to write logs. The bucket is configured with minimal required permissions and is not publicly accessible.",
        },
      ],
      true
    );

    // Suppress Cognito MFA requirement
    NagSuppressions.addResourceSuppressions(
      this.userPool,
      [
        {
          id: "AwsSolutions-COG2",
          reason:
            "MFA not enforced for this internal enterprise application. Users are authenticated through corporate identity systems and additional MFA would create user friction without significant security benefit for this use case.",
        },
        {
          id: "AwsSolutions-COG3",
          reason:
            "Advanced Security Mode requires Cognito Plus feature plan which incurs additional costs. For this internal application, the standard security features combined with corporate authentication provide adequate protection.",
        },
      ],
      true
    );

    // Suppress config generator Lambda function issues
    NagSuppressions.addResourceSuppressions(
      configGeneratorFunction,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Lambda execution role uses AWS managed policy for basic execution permissions.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
        {
          id: "AwsSolutions-L1",
          reason:
            "Using Python 3.12 runtime which is the latest stable version supported by AWS Lambda at deployment time.",
        },
      ],
      true
    );

    // Suppress config generator Lambda function S3 policy issues
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/AgentRegistryWebUI/ConfigGenerator/ServiceRole/DefaultPolicy",
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Lambda function needs S3 write permissions to upload the config file. Permissions are scoped to the specific S3 bucket.",
          appliesTo: [
            "Action::s3:Abort*",
            "Action::s3:DeleteObject*",
            "Resource::<WebUIBucketF5DEB462.Arn>/*",
          ],
        },
      ],
      true
    );

    // Suppress config generator Lambda function policy issues
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/AgentRegistryWebUI/ConfigGenerator/ServiceRole/DefaultPolicy",
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Lambda function needs S3 write permissions to upload the config file. Permissions are scoped to the specific S3 bucket.",
          appliesTo: [
            "Action::s3:Abort*",
            "Action::s3:DeleteObject*",
            "Resource::<WebUIBucketF5DEB462.Arn>/*",
          ],
        },
      ],
      true
    );

    // Suppress bucket deployment Lambda function issues
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/AgentRegistryWebUI/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole",
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWS managed policy AWSLambdaBasicExecutionRole is required for CDK BucketDeployment custom resource. This is a standard CDK construct requirement.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/AgentRegistryWebUI/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/DefaultPolicy",
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Wildcard permissions required for CDK BucketDeployment custom resource to manage S3 objects and CloudFront invalidation. These are scoped to specific buckets and are necessary for the deployment process. See: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html",
          appliesTo: [
            "Action::s3:GetBucket*",
            "Action::s3:GetObject*",
            "Action::s3:List*",
            "Action::s3:Abort*",
            "Action::s3:DeleteObject*",
            "Resource::*",
            `Resource::arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}/*`,
            `Resource::arn:aws:s3:::cdk-hnb659fds-assets-<AWS::AccountId>-us-east-1/*`,
            "Resource::<WebUIBucketF5DEB462.Arn>/*",
          ],
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/AgentRegistryWebUI/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C",
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "CDK BucketDeployment custom resource uses the latest available runtime managed by CDK. Runtime version is controlled by the CDK framework version.",
        },
      ],
      true
    );
  }
}
