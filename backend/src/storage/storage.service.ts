import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Stockage objet privé des fichiers. Les tests utilisent MemoryStorageService ; la production, S3 (SeaweedFS en local). */
export abstract class StorageService {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

@Injectable()
export class S3StorageService extends StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady?: Promise<void>;

  constructor(config: ConfigService) {
    super();
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.client = new S3Client({
      region: config.getOrThrow<string>('S3_REGION'),
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      forcePathStyle: true,
      credentials: { accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'), secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY') },
    });
  }

  /** Crée le bucket (privé : aucun accès anonyme) au premier usage, pour ne pas bloquer le démarrage si S3 démarre plus tard. */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })().catch((e) => {
      this.bucketReady = undefined; // nouvel essai à la prochaine requête
      throw e;
    });
    return this.bucketReady;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    await this.ensureBucket();
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
