import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Types de notification. `title` contient ce code : l'interface le traduit (ar/fr), le serveur n'écrit aucun texte de langue. */
export type NotificationType = 'ENROLLMENT_VERIFIED' | 'ENROLLMENT_REJECTED';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** `body` : texte libre éventuel (ex. motif de rejet saisi par le vérificateur). */
  notify(userId: string, type: NotificationType, body = '', db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return db.notification.create({ data: { userId, type, title: type, body } });
  }

  async list(userId: string) {
    const items = await this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return {
      unread: items.filter((n) => !n.readAt).length,
      items: items.map((n) => ({ id: n.id, type: n.type, body: n.body, readAt: n.readAt, createdAt: n.createdAt })),
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    // Une notification d'un autre utilisateur est introuvable (404), jamais « interdite ».
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException();
    if (!n.readAt) await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}
