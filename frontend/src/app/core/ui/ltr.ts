/**
 * Isole un nombre ou un code (année « 2026-2027 », date, numéro) dans un texte de droite à gauche : sans cela, l'algorithme
 * bidirectionnel peut afficher « 2027-2026 ». Pour du texte de balise, préférer <bdi dir="ltr">; ceci sert aux endroits
 * qui n'acceptent que du texte brut (options de liste, chaînes assemblées).
 */
export const ltr = (text: string): string => `⁦${text}⁩`;
