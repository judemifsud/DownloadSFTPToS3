import { Handler } from 'aws-lambda';
import Client from 'ssh2-sftp-client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';

const s3Client = new S3Client({});

export const handler: Handler = async (event) => {
    const sftp = new Client();

    const config = {
        host: process.env.SFTP_HOST,
        port: parseInt(process.env.SFTP_PORT || '22'),
        username: process.env.SFTP_USERNAME,
        password: process.env.SFTP_PASSWORD,
    };

    const s3Bucket = process.env.S3_BUCKET_NAME;
    const sourcePath = process.env.SFTP_SOURCE_PATH || '/';

    if (!config.host || !config.username || !config.password || !s3Bucket) {
        throw new Error('Missing required environment variables: SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, S3_BUCKET_NAME');
    }

    try {
        console.log('Connecting to SFTP server...');
        await sftp.connect(config);
        console.log('Connected to SFTP server.');

        console.log(`Listing files in ${sourcePath}...`);
        const fileList = await sftp.list(sourcePath);
        console.log(`Found ${fileList.length} items.`);

        const files = fileList.filter(item => item.type === '-'); // Filter for files only
        console.log(`Found ${files.length} files to process.`);

        const results = [];

        for (const file of files) {
            const remoteFilePath = sourcePath === '/' ? `/${file.name}` : `${sourcePath}/${file.name}`; // Handle root path logic safely
            console.log(`Downloading ${remoteFilePath}...`);

            // Download to buffer
            const buffer = await sftp.get(remoteFilePath);

            if (!(buffer instanceof Buffer)) {
                console.warn(`Skipping ${file.name}, content is not a buffer.`);
                continue;
            }

            console.log(`Uploading ${file.name} to S3 bucket ${s3Bucket}...`);
            await s3Client.send(new PutObjectCommand({
                Bucket: s3Bucket,
                Key: file.name,
                Body: buffer,
            }));

            results.push(file.name);
            console.log(`Successfully moved ${file.name}`);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Processing complete',
                processedFiles: results,
            }),
        };

    } catch (err: any) {
        console.error('An error occurred:', err);
        throw err;
    } finally {
        console.log('Closing SFTP connection...');
        await sftp.end();
        console.log('SFTP connection closed.');
    }
};
