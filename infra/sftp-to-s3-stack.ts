import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

export class SftpToS3Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const sftpHost = process.env.SFTP_HOST || '';
        const sftpPort = process.env.SFTP_PORT || '22';
        const sftpUsername = process.env.SFTP_USERNAME || '';
        // INSECURE: Creating a placeholder for where the password should come from.
        // Ideally this should be from Secrets Manager.
        const sftpPassword = process.env.SFTP_PASSWORD || '';
        const s3BucketName = process.env.S3_BUCKET_NAME || '';
        const sftpSourcePath = process.env.SFTP_SOURCE_PATH || '/';

        const fn = new nodejs.NodejsFunction(this, 'SftpToS3Function', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../src/index.ts'),
            handler: 'handler',
            bundling: {
                externalModules: ['ssh2', 'ssh2-sftp-client'], // ssh2 has native bindings, might need to be excluded or handled carefully
                // For ssh2-sftp-client/ssh2, it's often better to include them if possible OR use layers if native deps invoke issues.
                // However, NodejsFunction tries to bundle. ssh2 is problematic with esbuild sometimes due to native bindings.
                // Let's try bundling it first, but if it fails we might need to rely on a layer or docker bundling.
                // Actually, 'ssh2' often requires native modules. Let's try to let esbuild handle it, or exclude it if we install node_modules in the lambda environment.
                // For simplicity in a standard environment, we might need to bundle everything or ensure the Lambda environment matches.
                // Let's exclude nothing for now and see if esbuild warns, OR exclude aws-sdk (it's in runtime).
            },
            environment: {
                SFTP_HOST: sftpHost,
                SFTP_PORT: sftpPort,
                SFTP_USERNAME: sftpUsername,
                SFTP_PASSWORD: sftpPassword,
                S3_BUCKET_NAME: s3BucketName,
                SFTP_SOURCE_PATH: sftpSourcePath,
            },
            timeout: cdk.Duration.minutes(5),
        });

        // Grant permissions to write to the bucket - we should already have this
        // We don't have the bucket construct here (it's "existing"), so we might need to import it or give open permissions if we don't know the ARN.
        // If we assume the bucket exists, we can look it up.
        if (s3BucketName) {
            // This grants permission to ALL buckets if we don't import the specific one, or we can construct an ARN.
            // Best practice: Import the bucket.
            const bucket = cdk.aws_s3.Bucket.fromBucketName(this, 'TargetBucket', s3BucketName);
            bucket.grantPut(fn);
        }

        // EventBridge Rule
        const rule = new events.Rule(this, 'DailyMidnightSchedule', {
            schedule: events.Schedule.cron({ minute: '0', hour: '0' }),
        });

        rule.addTarget(new targets.LambdaFunction(fn));
    }
}
