import { CreateBucketCommand, HeadBucketCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3'

const bucket = process.env.S3_BUCKET
if (!bucket) throw new Error('S3_BUCKET is not set')

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? ''
  }
})

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
  console.log(`Bucket "${bucket}" exists`)
} catch (error) {
  if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404) throw error
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
  console.log(`Bucket "${bucket}" created`)
}
