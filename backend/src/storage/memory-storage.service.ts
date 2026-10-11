import { Injectable } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Stockage en mémoire pour les tests : même contrat que S3, sans réseau. */
@Injectable()
export class MemoryStorageService extends StorageService {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async get(key: string): Promise<Buffer> {
    const o = this.objects.get(key);
    if (!o) throw new Error(`Objet introuvable : ${key}`);
    return o.body;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
