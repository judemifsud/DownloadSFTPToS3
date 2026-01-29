import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as path from 'path';

export interface SftpToS3StackProps extends cdk.StackProps {
    readonly customerRoleArn?: string;
}

export class SftpToS3Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: SftpToS3StackProps = {}) {
        super(scope, id, props);

        const sftpHost = process.env.SFTP_HOST || '';
        const sftpPort = process.env.SFTP_PORT || '22';
        const sftpUsername = process.env.SFTP_USERNAME || '';
        // INSECURE: Creating a placeholder for where the password should come from.
        // Ideally this should be from Secrets Manager.
        const sftpPassword = process.env.SFTP_PASSWORD || '';
        const sftpSourcePath = process.env.SFTP_SOURCE_PATH || '/';

        // Create KMS Key
        const key = new kms.Key(this, 'SftpToS3Key', {
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/test
            pendingWindow: cdk.Duration.days(7), // For dev/test
        });

        // Create the bucket
        const bucket = new cdk.aws_s3.Bucket(this, 'TargetBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/test, easier cleanup. Modify for prod.
            autoDeleteObjects: true, // For dev/test
            encryption: cdk.aws_s3.BucketEncryption.KMS,
            encryptionKey: key,
            blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
        });

        // Create custom IAM role
        const lambdaRole = new iam.Role(this, 'SftpToS3FunctionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });

        // Grant S3 write permissions to the role
        bucket.grantPut(lambdaRole);

        // Grant KMS permissions to the role
        key.grantEncryptDecrypt(lambdaRole);

        const fn = new nodejs.NodejsFunction(this, 'SftpToS3Function', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../src/index.ts'),
            handler: 'handler',
            role: lambdaRole,
            bundling: {
                // externalModules: [], // Bundle everything except default exclusions (aws-sdk)
            },
            environment: {
                SFTP_HOST: sftpHost,
                SFTP_PORT: sftpPort,
                SFTP_USERNAME: sftpUsername,
                SFTP_PASSWORD: sftpPassword,
                S3_BUCKET_NAME: bucket.bucketName, // Use the actual bucket name (either imported or created)
                SFTP_SOURCE_PATH: sftpSourcePath,
            },
            timeout: cdk.Duration.minutes(5),
        });

        // Grant InvokeFunction permission to the role
        fn.grantInvoke(lambdaRole);

        // Grant access to external customer role if provided
        if (props.customerRoleArn) {
            const customerRole = iam.Role.fromRoleArn(this, 'ExternalCustomerRole', props.customerRoleArn);
            bucket.grantRead(customerRole);
            key.grantDecrypt(customerRole);
        }

        // EventBridge Rule
        const rule = new events.Rule(this, 'DailyMidnightSchedule', {
            schedule: events.Schedule.cron({ minute: '0', hour: '0' }),
        });

        rule.addTarget(new targets.LambdaFunction(fn));
    }
}
